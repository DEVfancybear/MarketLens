package replay

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/gofiber/contrib/websocket"
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
	engine      *Engine
	requireAuth fiber.Handler
}

func NewHandler(service SessionService, requireAuth fiber.Handler, engines ...*Engine) *Handler {
	var engine *Engine
	if len(engines) > 0 {
		engine = engines[0]
	}
	return &Handler{service: service, engine: engine, requireAuth: requireAuth}
}
func (h *Handler) Register(router fiber.Router) {
	g := router.Group("/replay/sessions", h.requireAuth)
	g.Post("/", h.create)
	g.Get("/:id", h.get)
	g.Delete("/:id", h.close)
	g.Post("/:id/commands", h.command)
	g.Get("/:id/events", h.events)
	g.Use("/:id/stream", func(c *fiber.Ctx) error {
		if websocket.IsWebSocketUpgrade(c) {
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})
	g.Get("/:id/stream", websocket.New(h.stream))
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
	if h.engine != nil {
		snapshot, err := h.engine.Close(c.Context(), replayUserID(c), c.Params("id"))
		if err != nil {
			return replayAPIError(err)
		}
		return c.JSON(snapshot)
	}
	snapshot, err := h.service.Close(c.Context(), replayUserID(c), c.Params("id"))
	if err != nil {
		return replayAPIError(err)
	}
	return c.JSON(snapshot)
}

func (h *Handler) command(c *fiber.Ctx) error {
	if h.engine == nil {
		return fiber.NewError(fiber.StatusServiceUnavailable, "replay clock is unavailable")
	}
	var input CommandInput
	if err := json.Unmarshal(c.Body(), &input); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	result, err := h.engine.Command(c.Context(), replayUserID(c), c.Params("id"), input)
	if err != nil {
		return replayAPIError(err)
	}
	return c.JSON(result)
}

func (h *Handler) events(c *fiber.Ctx) error {
	if h.engine == nil {
		return fiber.NewError(fiber.StatusServiceUnavailable, "replay clock is unavailable")
	}
	afterSeq, _ := strconv.ParseInt(c.Query("afterSeq", "0"), 10, 64)
	limit64, _ := strconv.ParseInt(c.Query("limit", "1000"), 10, 32)
	events, err := h.engine.Events(c.Context(), replayUserID(c), c.Params("id"), afterSeq, int32(limit64))
	if err != nil {
		return replayAPIError(err)
	}
	return c.JSON(events)
}

func (h *Handler) stream(c *websocket.Conn) {
	if h.engine == nil {
		_ = c.WriteJSON(map[string]any{"type": "error", "payload": map[string]any{"code": "replay_unavailable"}})
		return
	}
	userID, _ := c.Locals(auth.LocalUserID).(string)
	snapshot, subscriber, err := h.engine.Subscribe(context.Background(), userID, c.Params("id"))
	if err != nil {
		_ = c.WriteJSON(map[string]any{"type": "error", "payload": map[string]any{"code": replayErrorCode(err)}})
		return
	}
	defer subscriber.Close()
	payload, _ := json.Marshal(snapshot)
	if err := c.WriteJSON(EventEnvelope{SessionID: snapshot.ID, EventSeq: snapshot.LastEventSeq, Version: snapshot.Version,
		SimulatedTime: snapshot.SimulatedTime, Type: "snapshot", Payload: payload}); err != nil {
		return
	}
	lastSent := snapshot.LastEventSeq
	readerDone := make(chan struct{})
	go func() {
		defer close(readerDone)
		for {
			if _, _, err := c.ReadMessage(); err != nil {
				return
			}
		}
	}()
	for {
		select {
		case event := <-subscriber.Events():
			if event.EventSeq <= lastSent {
				continue
			}
			if err := c.WriteJSON(event); err != nil {
				return
			}
			lastSent = event.EventSeq
		case <-subscriber.Done():
			return
		case <-readerDone:
			return
		}
	}
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
	case errors.Is(err, ErrVersionConflict):
		current := int64(0)
		var conflict *VersionConflictError
		if errors.As(err, &conflict) {
			current = conflict.CurrentVersion
		}
		return apierror.NewWithDetails(409, "version_conflict", "Replay session changed; refresh the snapshot", map[string]any{"currentVersion": current})
	case errors.Is(err, ErrSessionBusy):
		return apierror.New(409, "session_busy", "replay session is busy; retry the command")
	case errors.Is(err, ErrSessionClosed):
		return apierror.New(409, "session_closed", "replay session is closed")
	default:
		return fiber.NewError(500, "internal server error")
	}
}

func replayErrorCode(err error) string {
	switch {
	case errors.Is(err, ErrNotFound):
		return "not_found"
	case errors.Is(err, ErrSessionClosed):
		return "session_closed"
	case errors.Is(err, ErrCheckpointCorrupt):
		return "checkpoint_corrupt"
	default:
		return "internal"
	}
}
