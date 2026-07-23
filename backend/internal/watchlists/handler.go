package watchlists

import (
	"encoding/json"
	"errors"
	"net/url"

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
	g := router.Group("/watchlists", h.requireAuth)
	g.Get("/", h.list)
	g.Post("/", h.create)
	g.Put("/active", h.setActive)
	g.Patch("/:id", h.update)
	g.Delete("/:id", h.delete)
	g.Put("/:id/layout", h.replaceLayout)
	g.Post("/:id/symbols", h.addSymbol)
	g.Delete("/:id/symbols/:symbol", h.removeSymbol)
}

func (h *Handler) list(c fiber.Ctx) error {
	lists, err := h.store.List(c.Context(), userID(c))
	if err != nil {
		return apiError(err)
	}
	return c.JSON(lists)
}

func (h *Handler) create(c fiber.Ctx) error {
	var req struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	w, err := h.store.Create(c.Context(), userID(c), req.Name)
	if err != nil {
		return apiError(err)
	}
	return c.Status(fiber.StatusCreated).JSON(w)
}

func (h *Handler) update(c fiber.Ctx) error {
	var req struct {
		Name     *string `json:"name"`
		Position *int    `json:"position"`
		Shared   *bool   `json:"shared"`
		SortKey  *string `json:"sortKey"`
		SortDir  *string `json:"sortDir"`
	}
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	if req.Name == nil && req.Position == nil && req.Shared == nil && req.SortKey == nil && req.SortDir == nil {
		return fiber.NewError(fiber.StatusBadRequest, "name, position, shared, sortKey, or sortDir is required")
	}
	w, err := h.store.Update(c.Context(), userID(c), c.Params("id"), req.Name, req.Position, req.Shared, req.SortKey, req.SortDir)
	if err != nil {
		return apiError(err)
	}
	return c.JSON(w)
}

func (h *Handler) delete(c fiber.Ctx) error {
	if err := h.store.Delete(c.Context(), userID(c), c.Params("id")); err != nil {
		return apiError(err)
	}
	return c.JSON(fiber.Map{"ok": true})
}

func (h *Handler) setActive(c fiber.Ctx) error {
	var req struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	if req.ID == "" {
		return fiber.NewError(fiber.StatusBadRequest, "id is required")
	}
	w, err := h.store.SetActive(c.Context(), userID(c), req.ID)
	if err != nil {
		return apiError(err)
	}
	return c.JSON(w)
}

func (h *Handler) replaceLayout(c fiber.Ctx) error {
	var req WatchlistLayout
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	w, err := h.store.ReplaceLayout(c.Context(), userID(c), c.Params("id"), req)
	if err != nil {
		return apiError(err)
	}
	return c.JSON(w)
}

func (h *Handler) addSymbol(c fiber.Ctx) error {
	var req struct {
		Symbol string `json:"symbol"`
	}
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	w, err := h.store.AddSymbol(c.Context(), userID(c), c.Params("id"), req.Symbol)
	if err != nil {
		return apiError(err)
	}
	return c.JSON(w)
}

func (h *Handler) removeSymbol(c fiber.Ctx) error {
	// Symbols can contain characters that must survive URL encoding.
	symbol, err := url.PathUnescape(c.Params("symbol"))
	if err != nil {
		symbol = c.Params("symbol")
	}
	w, err := h.store.RemoveSymbol(c.Context(), userID(c), c.Params("id"), symbol)
	if err != nil {
		return apiError(err)
	}
	return c.JSON(w)
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
