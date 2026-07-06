package workspace

import (
	"context"

	"github.com/gofiber/fiber/v2"

	"github.com/smc-trading-terminal/backend/internal/auth"
	"github.com/smc-trading-terminal/backend/internal/settings"
)

// SettingsReader is the narrow settings dependency bootstrap needs. Keeping it
// small lets future resource stores be added without coupling this package to a
// concrete repository type.
type SettingsReader interface {
	Get(ctx context.Context, userID string) (settings.Document, error)
}

type Handler struct {
	settings    SettingsReader
	requireAuth fiber.Handler
}

func NewHandler(settings SettingsReader, requireAuth fiber.Handler) *Handler {
	return &Handler{settings: settings, requireAuth: requireAuth}
}

func (h *Handler) Register(router fiber.Router) {
	router.Get("/sync/bootstrap", h.requireAuth, h.bootstrap)
}

type bootstrapResponse struct {
	Settings         settings.Document `json:"settings"`
	Watchlists       []any             `json:"watchlists"`
	DrawingTemplates []any             `json:"drawingTemplates"`
	Indicators       []any             `json:"indicators"`
	PineScripts      []any             `json:"pineScripts"`
	Alerts           []any             `json:"alerts"`
	Layouts          []any             `json:"layouts"`
}

func (h *Handler) bootstrap(c *fiber.Ctx) error {
	userID, _ := c.Locals(auth.LocalUserID).(string)
	doc, err := h.settings.Get(c.Context(), userID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "internal server error")
	}

	empty := []any{}
	return c.JSON(bootstrapResponse{
		Settings:         doc,
		Watchlists:       empty,
		DrawingTemplates: empty,
		Indicators:       empty,
		PineScripts:      empty,
		Alerts:           empty,
		Layouts:          empty,
	})
}
