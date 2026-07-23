package alerts

import (
	"crypto/hmac"
	"encoding/json"
	"errors"
	"net/url"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v3"

	"github.com/smc-trading-terminal/backend/internal/auth"
)

type Handler struct {
	store               Store
	requireAuth         fiber.Handler
	workerSecret        string
	verifyDeliveryToken func(string) (string, error)
}

func NewHandler(store Store, requireAuth fiber.Handler) *Handler {
	return &Handler{store: store, requireAuth: requireAuth}
}

func (h *Handler) WithWorkerTrigger(
	workerSecret string,
	verifyDeliveryToken func(string) (string, error),
) *Handler {
	h.workerSecret = strings.TrimSpace(workerSecret)
	h.verifyDeliveryToken = verifyDeliveryToken
	return h
}

func (h *Handler) Register(router fiber.Router) {
	router.Post("/alerts/worker-trigger", h.workerTrigger)

	g := router.Group("/alerts", h.requireAuth)
	g.Get("/", h.list)
	g.Post("/", h.create)
	g.Get("/history", h.history)
	g.Delete("/history", h.clearHistory)
	g.Get("/:id/events", h.events)
	g.Post("/:id/trigger", h.trigger)
	g.Patch("/:id", h.patch)
	g.Delete("/:id", h.delete)

	p := router.Group("/push/tokens", h.requireAuth)
	p.Post("/", h.upsertPushToken)
	p.Delete("/:token", h.deletePushToken)
}

func (h *Handler) list(c fiber.Ctx) error {
	items, err := h.store.List(c.Context(), userID(c), c.Query("status"))
	if err != nil {
		return apiError(err)
	}
	return c.JSON(items)
}

func (h *Handler) create(c fiber.Ctx) error {
	var req CreateInput
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	item, err := h.store.Create(c.Context(), userID(c), req)
	if err != nil {
		return apiError(err)
	}
	return c.Status(fiber.StatusCreated).JSON(item)
}

func (h *Handler) patch(c fiber.Ctx) error {
	var req PatchInput
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	if emptyPatch(req) {
		return fiber.NewError(fiber.StatusBadRequest, "at least one alert field is required")
	}
	item, err := h.store.Patch(c.Context(), userID(c), c.Params("id"), req)
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

func (h *Handler) trigger(c fiber.Ctx) error {
	var req TriggerInput
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	item, event, err := h.store.Trigger(c.Context(), userID(c), c.Params("id"), req)
	if errors.Is(err, ErrAlreadyTriggered) {
		return c.JSON(fiber.Map{
			"alreadyTriggered": true,
			"event":            event,
		})
	}
	if err != nil {
		return apiError(err)
	}
	return c.JSON(fiber.Map{"alert": item, "event": event})
}

type workerTriggerRequest struct {
	DeliveryToken string `json:"deliveryToken"`
	AlertID       string `json:"alertId"`
	TriggerInput
}

func (h *Handler) workerTrigger(c fiber.Ctx) error {
	if h.workerSecret == "" || h.verifyDeliveryToken == nil ||
		!hmac.Equal([]byte(c.Get("x-push-worker-secret")), []byte(h.workerSecret)) {
		return fiber.ErrUnauthorized
	}

	var req workerTriggerRequest
	if err := json.Unmarshal(c.Body(), &req); err != nil || strings.TrimSpace(req.AlertID) == "" {
		return fiber.NewError(fiber.StatusBadRequest, "invalid worker trigger request")
	}
	uid, err := h.verifyDeliveryToken(strings.TrimSpace(req.DeliveryToken))
	if err != nil || strings.TrimSpace(uid) == "" {
		return fiber.ErrUnauthorized
	}

	item, event, err := h.store.Trigger(c.Context(), uid, req.AlertID, req.TriggerInput)
	if errors.Is(err, ErrAlreadyTriggered) {
		return c.JSON(fiber.Map{
			"ok":               true,
			"alreadyTriggered": true,
			"event":            event,
		})
	}
	if err != nil {
		return apiError(err)
	}
	return c.JSON(fiber.Map{
		"ok":               true,
		"alreadyTriggered": false,
		"alert":            item,
		"event":            event,
	})
}

func (h *Handler) events(c fiber.Ctx) error {
	items, err := h.store.ListEvents(c.Context(), userID(c), c.Params("id"), queryLimit(c))
	if err != nil {
		return apiError(err)
	}
	return c.JSON(items)
}

func (h *Handler) history(c fiber.Ctx) error {
	items, err := h.store.ListHistory(c.Context(), userID(c), queryLimit(c))
	if err != nil {
		return apiError(err)
	}
	return c.JSON(items)
}

func (h *Handler) clearHistory(c fiber.Ctx) error {
	if err := h.store.ClearHistory(c.Context(), userID(c)); err != nil {
		return apiError(err)
	}
	return c.JSON(fiber.Map{"ok": true})
}

func (h *Handler) upsertPushToken(c fiber.Ctx) error {
	var req PushTokenInput
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	item, err := h.store.UpsertPushToken(c.Context(), userID(c), req)
	if err != nil {
		return apiError(err)
	}
	return c.JSON(item)
}

func (h *Handler) deletePushToken(c fiber.Ctx) error {
	token, err := url.PathUnescape(c.Params("token"))
	if err != nil {
		token = c.Params("token")
	}
	if err := h.store.DeletePushToken(c.Context(), userID(c), token); err != nil {
		return apiError(err)
	}
	return c.JSON(fiber.Map{"ok": true})
}

func emptyPatch(req PatchInput) bool {
	if req.Symbol != nil || req.Condition != nil || req.Price != nil || req.Note != nil ||
		req.Status != nil || req.Enabled != nil || req.Locked != nil || req.Recurring != nil ||
		req.TechnicalTarget != nil {
		return false
	}
	if req.Channels == nil {
		return true
	}
	return req.Channels.Sound == nil && req.Channels.Browser == nil && req.Channels.Push == nil &&
		req.Channels.Telegram == nil && req.Channels.Discord == nil
}

func queryLimit(c fiber.Ctx) int {
	limit, err := strconv.Atoi(c.Query("limit"))
	if err != nil {
		return MaxHistory
	}
	return normalizeLimit(limit)
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
