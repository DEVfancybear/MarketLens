package mt5stream

import "github.com/gofiber/fiber/v2"

type SymbolSource interface {
	Snapshot() Snapshot
}

type Handler struct {
	source SymbolSource
}

func NewHandler(source SymbolSource) *Handler {
	return &Handler{source: source}
}

func (h *Handler) Register(router fiber.Router) {
	g := router.Group("/mt5")
	g.Get("/symbols", h.symbols)
}

func (h *Handler) symbols(c *fiber.Ctx) error {
	if h == nil || h.source == nil {
		return c.JSON(Snapshot{
			Connected: false,
			Source:    "mt5",
			Symbols:   []Symbol{},
			LastError: "MT5 stream service is not configured",
		})
	}
	snapshot := h.source.Snapshot()
	if snapshot.Symbols == nil {
		snapshot.Symbols = []Symbol{}
	}
	if snapshot.StreamSymbols == nil {
		snapshot.StreamSymbols = []string{}
	}
	return c.JSON(snapshot)
}
