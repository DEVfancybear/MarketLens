package settings

import (
	"encoding/json"
	"errors"

	"github.com/gofiber/fiber/v2"

	"github.com/smc-trading-terminal/backend/internal/auth"
)

type Handler struct {
	store            Store
	requireAuth      fiber.Handler
	integrationStore IntegrationStore
	secretBox        *SecretBox
	workerSecret     string
}

func NewHandler(store Store, requireAuth fiber.Handler) *Handler {
	return &Handler{store: store, requireAuth: requireAuth}
}

func (h *Handler) Register(router fiber.Router) {
	router.Get("/settings", h.requireAuth, h.get)
	router.Put("/settings", h.requireAuth, h.replace)
	router.Patch("/settings", h.requireAuth, h.patch)
	router.Get("/settings/chart/favorite-timeframes", h.requireAuth, h.getFavoriteTimeframes)
	router.Put("/settings/chart/favorite-timeframes", h.requireAuth, h.replaceFavoriteTimeframes)
	if h.integrationStore != nil && h.secretBox != nil {
		h.registerIntegrationRoutes(router)
	}
}

func (h *Handler) get(c *fiber.Ctx) error {
	doc, err := h.store.Get(c.Context(), userID(c))
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "internal server error")
	}
	return c.JSON(doc)
}

func (h *Handler) replace(c *fiber.Ctx) error {
	doc, err := parseDocument(c.Body())
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	}
	doc, err = h.store.Replace(c.Context(), userID(c), doc)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "internal server error")
	}
	return c.JSON(doc)
}

func (h *Handler) patch(c *fiber.Ctx) error {
	patch, err := parsePatch(c.Body())
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	}
	doc, err := h.store.Patch(c.Context(), userID(c), patch)
	if err != nil {
		if errors.Is(err, ErrBadPatch) {
			return fiber.NewError(fiber.StatusBadRequest, err.Error())
		}
		return fiber.NewError(fiber.StatusInternalServerError, "internal server error")
	}
	return c.JSON(doc)
}

func (h *Handler) getFavoriteTimeframes(c *fiber.Ctx) error {
	doc, err := h.store.Get(c.Context(), userID(c))
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "internal server error")
	}
	return c.JSON(FavoriteTimeframesFromDocument(doc))
}

func (h *Handler) replaceFavoriteTimeframes(c *fiber.Ctx) error {
	var req FavoriteTimeframesWrite
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	patch, err := FavoriteTimeframesPatch(req.Timeframes)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	}
	doc, err := h.store.Patch(c.Context(), userID(c), patch)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "internal server error")
	}
	return c.JSON(FavoriteTimeframesFromDocument(doc))
}

func userID(c *fiber.Ctx) string {
	id, _ := c.Locals(auth.LocalUserID).(string)
	return id
}

func parseDocument(body []byte) (Document, error) {
	sections, err := parseSections(body)
	if err != nil {
		return Document{}, err
	}
	return NormalizeDocument(Document{
		UI:            sections.value("ui"),
		SMC:           sections.value("smc"),
		Chart:         sections.value("chart"),
		Notifications: sections.value("notifications"),
	}), nil
}

func parsePatch(body []byte) (Patch, error) {
	sections, err := parseSections(body)
	if err != nil {
		return Patch{}, err
	}
	return Patch{
		UI:            sections.ptr("ui"),
		SMC:           sections.ptr("smc"),
		Chart:         sections.ptr("chart"),
		Notifications: sections.ptr("notifications"),
	}, nil
}

type sectionBody map[string]json.RawMessage

func parseSections(body []byte) (sectionBody, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, errors.New("settings body must be a JSON object")
	}
	if raw == nil {
		return nil, errors.New("settings body must be a JSON object")
	}

	for key, value := range raw {
		switch key {
		case "ui", "smc", "chart", "notifications":
			if err := validateSection(value); err != nil {
				return nil, err
			}
		default:
			return nil, errors.New("unknown settings section: " + key)
		}
	}
	return sectionBody(raw), nil
}

func validateSection(raw json.RawMessage) error {
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil || obj == nil {
		return errors.New("settings sections must be JSON objects")
	}
	return nil
}

func (s sectionBody) value(key string) json.RawMessage {
	if raw, ok := s[key]; ok {
		return cloneRaw(raw)
	}
	return cloneRaw(emptyJSON)
}

func (s sectionBody) ptr(key string) *json.RawMessage {
	raw, ok := s[key]
	if !ok {
		return nil
	}
	cloned := cloneRaw(raw)
	return &cloned
}
