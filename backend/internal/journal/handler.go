package journal

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/smc-trading-terminal/backend/internal/auth"
	objectstorage "github.com/smc-trading-terminal/backend/internal/storage"
)

type Handler struct {
	store       Store
	signer      objectstorage.Signer
	requireAuth fiber.Handler
}

func NewHandler(store Store, signer objectstorage.Signer, requireAuth fiber.Handler) *Handler {
	return &Handler{store: store, signer: signer, requireAuth: requireAuth}
}

func (h *Handler) Register(router fiber.Router) {
	j := router.Group("/journal", h.requireAuth)
	j.Get("/", h.list)
	j.Post("/", h.create)
	j.Get("/:id", h.get)
	j.Put("/:id", h.update)
	j.Delete("/:id", h.delete)

	s := router.Group("/screenshots", h.requireAuth)
	s.Post("/upload-url", h.uploadURL)
	s.Post("/", h.createScreenshot)
	s.Get("/:id", h.getScreenshot)
	s.Delete("/:id", h.deleteScreenshot)
}

func (h *Handler) list(c *fiber.Ctx) error {
	filter := ListFilter{Symbol: c.Query("symbol"), Tag: c.Query("tag")}
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil {
			return fiber.NewError(fiber.StatusBadRequest, "limit must be an integer")
		}
		filter.Limit = limit
	}
	if raw := strings.TrimSpace(c.Query("before")); raw != "" {
		before, err := time.Parse(time.RFC3339Nano, raw)
		if err != nil {
			return fiber.NewError(fiber.StatusBadRequest, "before must be an RFC3339 timestamp")
		}
		filter.Before = &before
	}
	items, err := h.store.List(c.Context(), userID(c), filter)
	if err != nil {
		return apiError(err)
	}
	return c.JSON(items)
}

func (h *Handler) get(c *fiber.Ctx) error {
	item, err := h.store.Get(c.Context(), userID(c), c.Params("id"))
	if err != nil {
		return apiError(err)
	}
	return c.JSON(item)
}

func (h *Handler) create(c *fiber.Ctx) error {
	var in CreateInput
	if err := json.Unmarshal(c.Body(), &in); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	item, err := h.store.Create(c.Context(), userID(c), in)
	if err != nil {
		return apiError(err)
	}
	return c.Status(fiber.StatusCreated).JSON(item)
}

func (h *Handler) update(c *fiber.Ctx) error {
	var in UpdateInput
	if err := json.Unmarshal(c.Body(), &in); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	item, err := h.store.Update(c.Context(), userID(c), c.Params("id"), in)
	if err != nil {
		return apiError(err)
	}
	return c.JSON(item)
}

func (h *Handler) delete(c *fiber.Ctx) error {
	if err := h.store.Delete(c.Context(), userID(c), c.Params("id")); err != nil {
		return apiError(err)
	}
	return c.JSON(fiber.Map{"ok": true})
}

func (h *Handler) uploadURL(c *fiber.Ctx) error {
	if h.signer == nil {
		return fiber.NewError(fiber.StatusServiceUnavailable, "object storage is not configured")
	}
	var in UploadURLInput
	if err := json.Unmarshal(c.Body(), &in); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	contentType := strings.ToLower(strings.TrimSpace(in.ContentType))
	ext := map[string]string{"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}[contentType]
	if ext == "" {
		return fiber.NewError(fiber.StatusBadRequest, "contentType must be image/png, image/jpeg or image/webp")
	}
	storageKey, err := newStorageKey(userID(c), ext)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "could not allocate storage key")
	}
	url, err := h.signer.PresignPut(storageKey, 10*time.Minute)
	if err != nil {
		return fiber.NewError(fiber.StatusServiceUnavailable, "could not sign upload URL")
	}
	return c.JSON(fiber.Map{"uploadUrl": url, "storageKey": storageKey, "expiresIn": 600})
}

func (h *Handler) createScreenshot(c *fiber.Ctx) error {
	var in ScreenshotInput
	if err := json.Unmarshal(c.Body(), &in); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	item, err := h.store.CreateScreenshot(c.Context(), userID(c), in)
	if err != nil {
		return apiError(err)
	}
	return c.Status(fiber.StatusCreated).JSON(item)
}

func (h *Handler) getScreenshot(c *fiber.Ctx) error {
	if h.signer == nil {
		return fiber.NewError(fiber.StatusServiceUnavailable, "object storage is not configured")
	}
	item, err := h.store.GetScreenshot(c.Context(), userID(c), c.Params("id"))
	if err != nil {
		return apiError(err)
	}
	url, err := h.signer.PresignGet(item.StorageKey, 15*time.Minute)
	if err != nil {
		return fiber.NewError(fiber.StatusServiceUnavailable, "could not sign screenshot URL")
	}
	return c.JSON(fiber.Map{"url": url, "expiresAt": time.Now().UTC().Add(15 * time.Minute)})
}

func (h *Handler) deleteScreenshot(c *fiber.Ctx) error {
	if err := h.store.DeleteScreenshot(c.Context(), userID(c), c.Params("id")); err != nil {
		return apiError(err)
	}
	return c.JSON(fiber.Map{"ok": true})
}

func newStorageKey(userID, ext string) (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return fmt.Sprintf("users/%s/journal/%s%s", userID, hex.EncodeToString(buf), ext), nil
}

func userID(c *fiber.Ctx) string {
	id, _ := c.Locals(auth.LocalUserID).(string)
	return id
}

func apiError(err error) error {
	switch {
	case errors.Is(err, ErrNotFound):
		return fiber.NewError(fiber.StatusNotFound, "not found")
	case errors.Is(err, ErrBadRequest):
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	default:
		return fiber.NewError(fiber.StatusInternalServerError, "internal server error")
	}
}
