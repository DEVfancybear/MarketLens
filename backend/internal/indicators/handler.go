package indicators

import (
	"encoding/json"
	"errors"

	"github.com/gofiber/fiber/v3"

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
	g := router.Group("/indicators", h.requireAuth)
	g.Get("/", h.list)
	g.Post("/", h.save)
	g.Put("/:id", h.replace)
	g.Delete("/:id", h.delete)
}

func (h *Handler) list(c fiber.Ctx) error {
	items, err := h.store.List(c.Context(), userID(c))
	if err != nil {
		return apiError(err)
	}
	return c.JSON(items)
}

func (h *Handler) save(c fiber.Ctx) error {
	var req IndicatorWrite
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	item, err := h.store.Save(c.Context(), userID(c), req)
	if err != nil {
		return apiError(err)
	}
	return c.Status(fiber.StatusCreated).JSON(item)
}

func (h *Handler) replace(c fiber.Ctx) error {
	var req IndicatorWrite
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	item, err := h.store.Replace(c.Context(), userID(c), c.Params("id"), req)
	if err != nil {
		return apiError(err)
	}
	return c.JSON(item)
}

func (h *Handler) delete(c fiber.Ctx) error {
	if err := h.store.Delete(c.Context(), userID(c), c.Params("id")); err != nil {
		return apiError(err)
	}
	return c.JSON(fiber.Map{"ok": true})
}

func userID(c fiber.Ctx) string {
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
