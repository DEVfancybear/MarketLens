package replay

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/smc-trading-terminal/backend/internal/apierror"
	"github.com/smc-trading-terminal/backend/internal/auth"
)

type SessionService interface {
	Create(context.Context, string, CreateSessionInput) (SessionSnapshot, error)
	Get(context.Context, string, string) (SessionSnapshot, error)
	Close(context.Context, string, string) (SessionSnapshot, error)
}

type Handler struct {
	service     SessionService
	requireAuth fiber.Handler
}

func NewHandler(service SessionService, requireAuth fiber.Handler) *Handler {
	return &Handler{service: service, requireAuth: requireAuth}
}
func (h *Handler) Register(router fiber.Router) {
	g := router.Group("/replay/sessions", h.requireAuth)
	g.Post("/", h.create)
	g.Get("/:id", h.get)
	g.Delete("/:id", h.close)
}
func (h *Handler) create(c *fiber.Ctx) error {
	var input CreateSessionInput
	if err := json.Unmarshal(c.Body(), &input); err != nil {
		return fiber.NewError(400, "invalid request body")
	}
	// A cold MT5 history request can legitimately take up to 60 seconds.
	ctx, cancel := context.WithTimeout(c.Context(), 70*time.Second)
	defer cancel()
	snapshot, err := h.service.Create(ctx, replayUserID(c), input)
	if err != nil {
		return replayAPIError(err)
	}
	return c.Status(fiber.StatusAccepted).JSON(snapshot)
}
func (h *Handler) get(c *fiber.Ctx) error {
	snapshot, err := h.service.Get(c.Context(), replayUserID(c), c.Params("id"))
	if err != nil {
		return replayAPIError(err)
	}
	return c.JSON(snapshot)
}
func (h *Handler) close(c *fiber.Ctx) error {
	snapshot, err := h.service.Close(c.Context(), replayUserID(c), c.Params("id"))
	if err != nil {
		return replayAPIError(err)
	}
	return c.JSON(snapshot)
}
func replayUserID(c *fiber.Ctx) string { id, _ := c.Locals(auth.LocalUserID).(string); return id }
func replayAPIError(err error) error {
	switch {
	case errors.Is(err, ErrNotFound):
		return apierror.New(404, "not_found", "not found")
	case errors.Is(err, ErrDataUnavailable):
		return apierror.New(422, "data_point_unavailable", "the requested replay data point is unavailable")
	case errors.Is(err, ErrDatasetPreparation):
		return apierror.New(502, "dataset_preparation_failed", "replay dataset preparation failed")
	case errors.Is(err, ErrBadRequest):
		return apierror.New(400, "bad_request", err.Error())
	default:
		return fiber.NewError(500, "internal server error")
	}
}
