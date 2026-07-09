package workspace

import (
	"context"

	"github.com/gofiber/fiber/v2"

	"github.com/smc-trading-terminal/backend/internal/auth"
	"github.com/smc-trading-terminal/backend/internal/drawings"
	"github.com/smc-trading-terminal/backend/internal/indicators"
	"github.com/smc-trading-terminal/backend/internal/settings"
	"github.com/smc-trading-terminal/backend/internal/watchlists"
)

// SettingsReader is the narrow settings dependency bootstrap needs. Keeping it
// small lets future resource stores be added without coupling this package to a
// concrete repository type.
type SettingsReader interface {
	Get(ctx context.Context, userID string) (settings.Document, error)
}

// WatchlistLister is the narrow watchlists dependency bootstrap needs.
type WatchlistLister interface {
	List(ctx context.Context, userID string) ([]watchlists.Watchlist, error)
}

// DrawingTemplateLister is intentionally narrow: bootstrap includes the small
// global template set, while per-symbol drawings remain lazy-loaded by symbol.
type DrawingTemplateLister interface {
	ListTemplates(ctx context.Context, userID string) ([]drawings.DrawingTemplate, error)
}

// IndicatorLister is the Phase 8 bootstrap slice. Indicator configs are small
// and global to the workspace, so they are safe to include during sign-in.
type IndicatorLister interface {
	List(ctx context.Context, userID string) ([]indicators.IndicatorPreset, error)
}

type Handler struct {
	settings         SettingsReader
	watchlists       WatchlistLister
	drawingTemplates DrawingTemplateLister
	indicators       IndicatorLister
	requireAuth      fiber.Handler
}

func NewHandler(
	settings SettingsReader,
	watchlists WatchlistLister,
	drawingTemplates DrawingTemplateLister,
	indicators IndicatorLister,
	requireAuth fiber.Handler,
) *Handler {
	return &Handler{
		settings:         settings,
		watchlists:       watchlists,
		drawingTemplates: drawingTemplates,
		indicators:       indicators,
		requireAuth:      requireAuth,
	}
}

func (h *Handler) Register(router fiber.Router) {
	router.Get("/sync/bootstrap", h.requireAuth, h.bootstrap)
}

type bootstrapResponse struct {
	Settings         settings.Document            `json:"settings"`
	Watchlists       []watchlists.Watchlist       `json:"watchlists"`
	DrawingTemplates []drawings.DrawingTemplate   `json:"drawingTemplates"`
	Indicators       []indicators.IndicatorPreset `json:"indicators"`
	PineScripts      []any                        `json:"pineScripts"`
	Alerts           []any                        `json:"alerts"`
	Layouts          []any                        `json:"layouts"`
}

func (h *Handler) bootstrap(c *fiber.Ctx) error {
	userID, _ := c.Locals(auth.LocalUserID).(string)

	doc, err := h.settings.Get(c.Context(), userID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "internal server error")
	}

	lists := []watchlists.Watchlist{}
	if h.watchlists != nil {
		lists, err = h.watchlists.List(c.Context(), userID)
		if err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, "internal server error")
		}
	}

	templates := []drawings.DrawingTemplate{}
	if h.drawingTemplates != nil {
		templates, err = h.drawingTemplates.ListTemplates(c.Context(), userID)
		if err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, "internal server error")
		}
	}

	indicatorPresets := []indicators.IndicatorPreset{}
	if h.indicators != nil {
		indicatorPresets, err = h.indicators.List(c.Context(), userID)
		if err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, "internal server error")
		}
	}

	empty := []any{}
	return c.JSON(bootstrapResponse{
		Settings:         doc,
		Watchlists:       lists,
		DrawingTemplates: templates,
		Indicators:       indicatorPresets,
		PineScripts:      empty,
		Alerts:           empty,
		Layouts:          empty,
	})
}
