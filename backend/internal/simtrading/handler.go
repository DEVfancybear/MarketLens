package simtrading

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
	g := router.Group("/sim", h.requireAuth)
	g.Get("/accounts", h.listAccounts)
	g.Post("/accounts", h.createAccount)
	g.Put("/accounts/:id", h.updateAccount)
	g.Delete("/accounts/:id", h.deleteAccount)
	g.Post("/accounts/:id/reset", h.resetAccount)
	g.Get("/accounts/:id/positions", h.listPositions)
	g.Post("/accounts/:id/orders", h.upsertPosition)
	g.Post("/positions/:id/close", h.closePosition)
	g.Get("/accounts/:id/analytics", h.analytics)
}
func (h *Handler) listAccounts(c fiber.Ctx) error {
	v, e := h.store.ListAccounts(c.Context(), userID(c))
	if e != nil {
		return apiError(e)
	}
	return c.JSON(v)
}
func (h *Handler) createAccount(c fiber.Ctx) error {
	var in AccountWrite
	if e := json.Unmarshal(c.Body(), &in); e != nil {
		return fiber.NewError(400, "invalid request body")
	}
	v, e := h.store.CreateAccount(c.Context(), userID(c), in)
	if e != nil {
		return apiError(e)
	}
	return c.Status(201).JSON(v)
}
func (h *Handler) updateAccount(c fiber.Ctx) error {
	var in AccountWrite
	if e := json.Unmarshal(c.Body(), &in); e != nil {
		return fiber.NewError(400, "invalid request body")
	}
	v, e := h.store.UpdateAccount(c.Context(), userID(c), c.Params("id"), in)
	if e != nil {
		return apiError(e)
	}
	return c.JSON(v)
}
func (h *Handler) deleteAccount(c fiber.Ctx) error {
	if e := h.store.DeleteAccount(c.Context(), userID(c), c.Params("id")); e != nil {
		return apiError(e)
	}
	return c.JSON(fiber.Map{"ok": true})
}
func (h *Handler) resetAccount(c fiber.Ctx) error {
	v, e := h.store.ResetAccount(c.Context(), userID(c), c.Params("id"))
	if e != nil {
		return apiError(e)
	}
	return c.JSON(v)
}
func (h *Handler) listPositions(c fiber.Ctx) error {
	v, e := h.store.ListPositions(c.Context(), userID(c), c.Params("id"), c.Query("status"))
	if e != nil {
		return apiError(e)
	}
	return c.JSON(v)
}
func (h *Handler) upsertPosition(c fiber.Ctx) error {
	var in PositionWrite
	if e := json.Unmarshal(c.Body(), &in); e != nil {
		return fiber.NewError(400, "invalid request body")
	}
	v, e := h.store.UpsertPosition(c.Context(), userID(c), c.Params("id"), in)
	if e != nil {
		return apiError(e)
	}
	return c.Status(201).JSON(v)
}
func (h *Handler) closePosition(c fiber.Ctx) error {
	var in struct {
		AccountID string `json:"accountId"`
		PositionWrite
	}
	if e := json.Unmarshal(c.Body(), &in); e != nil {
		return fiber.NewError(400, "invalid request body")
	}
	if in.ClientID == "" {
		in.ClientID = c.Params("id")
	}
	in.Status = "closed"
	v, e := h.store.UpsertPosition(c.Context(), userID(c), in.AccountID, in.PositionWrite)
	if e != nil {
		return apiError(e)
	}
	return c.JSON(v)
}
func (h *Handler) analytics(c fiber.Ctx) error {
	v, e := h.store.Analytics(c.Context(), userID(c), c.Params("id"))
	if e != nil {
		return apiError(e)
	}
	return c.JSON(v)
}
func userID(c fiber.Ctx) string { id, _ := c.Locals(auth.LocalUserID).(string); return id }
func apiError(err error) error {
	if errors.Is(err, ErrBadRequest) {
		return fiber.NewError(400, err.Error())
	}
	if errors.Is(err, ErrNotFound) {
		return fiber.NewError(404, "not found")
	}
	return fiber.NewError(500, "internal server error")
}
