package drawings

import (
	"encoding/json"
	"errors"
	"net/url"

	"github.com/gofiber/fiber/v2"

	"github.com/smc-trading-terminal/backend/internal/auth"
)

type Handler struct {
	store       Store
	requireAuth fiber.Handler
}

func NewHandler(store Store, requireAuth fiber.Handler) *Handler {
	return &Handler{store: store, requireAuth: requireAuth}
}

func (h *Handler) Register(router fiber.Router) {
	g := router.Group("/drawings", h.requireAuth)
	g.Get("/", h.list)
	g.Post("/", h.create)
	g.Post("/batch", h.batch)
	g.Put("/:id", h.replace)
	g.Patch("/:id", h.patch)
	g.Delete("/:id", h.delete)

	t := router.Group("/drawing-templates", h.requireAuth)
	t.Get("/", h.listTemplates)
	t.Post("/", h.saveTemplate)
	t.Put("/:id", h.updateTemplate)
	t.Delete("/:id", h.deleteTemplate)

	f := router.Group("/drawing-tool-favorites", h.requireAuth)
	f.Get("/", h.getToolFavorites)
	f.Put("/", h.replaceToolFavorites)
}

func (h *Handler) list(c *fiber.Ctx) error {
	symbol := c.Query("symbol")
	if decoded, err := url.QueryUnescape(symbol); err == nil {
		symbol = decoded
	}
	items, err := h.store.List(c.Context(), userID(c), symbol)
	if err != nil {
		return apiError(err)
	}
	return c.JSON(items)
}

func (h *Handler) create(c *fiber.Ctx) error {
	var req DrawingWrite
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	d, err := h.store.Create(c.Context(), userID(c), req)
	if err != nil {
		return apiError(err)
	}
	return c.Status(fiber.StatusCreated).JSON(d)
}

func (h *Handler) replace(c *fiber.Ctx) error {
	var req DrawingWrite
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	d, err := h.store.Replace(c.Context(), userID(c), c.Params("id"), req)
	if err != nil {
		return apiError(err)
	}
	return c.JSON(d)
}

func (h *Handler) patch(c *fiber.Ctx) error {
	var req DrawingPatch
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	d, err := h.store.Patch(c.Context(), userID(c), c.Params("id"), req)
	if err != nil {
		return apiError(err)
	}
	return c.JSON(d)
}

func (h *Handler) delete(c *fiber.Ctx) error {
	if err := h.store.Delete(c.Context(), userID(c), c.Params("id")); err != nil {
		return apiError(err)
	}
	return c.JSON(fiber.Map{"ok": true})
}

func (h *Handler) batch(c *fiber.Ctx) error {
	var req BatchRequest
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	resp, err := h.store.Batch(c.Context(), userID(c), req)
	if err != nil {
		return apiError(err)
	}
	return c.JSON(resp)
}

func (h *Handler) listTemplates(c *fiber.Ctx) error {
	items, err := h.store.ListTemplates(c.Context(), userID(c))
	if err != nil {
		return apiError(err)
	}
	return c.JSON(items)
}

func (h *Handler) saveTemplate(c *fiber.Ctx) error {
	var req DrawingTemplateWrite
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	t, err := h.store.SaveTemplate(c.Context(), userID(c), req)
	if err != nil {
		return apiError(err)
	}
	return c.Status(fiber.StatusCreated).JSON(t)
}

func (h *Handler) updateTemplate(c *fiber.Ctx) error {
	var req DrawingTemplateWrite
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	t, err := h.store.UpdateTemplate(c.Context(), userID(c), c.Params("id"), req)
	if err != nil {
		return apiError(err)
	}
	return c.JSON(t)
}

func (h *Handler) deleteTemplate(c *fiber.Ctx) error {
	if err := h.store.DeleteTemplate(c.Context(), userID(c), c.Params("id")); err != nil {
		return apiError(err)
	}
	return c.JSON(fiber.Map{"ok": true})
}

func (h *Handler) getToolFavorites(c *fiber.Ctx) error {
	favs, err := h.store.GetToolFavorites(c.Context(), userID(c))
	if err != nil {
		return apiError(err)
	}
	return c.JSON(favs)
}

func (h *Handler) replaceToolFavorites(c *fiber.Ctx) error {
	var req DrawingToolFavoritesWrite
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	favs, err := h.store.ReplaceToolFavorites(c.Context(), userID(c), req)
	if err != nil {
		return apiError(err)
	}
	return c.JSON(favs)
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
	case errors.Is(err, ErrConflict):
		return fiber.NewError(fiber.StatusConflict, err.Error())
	default:
		return fiber.NewError(fiber.StatusInternalServerError, "internal server error")
	}
}
