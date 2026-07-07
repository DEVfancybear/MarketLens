package mt5stream

import (
	"context"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type SymbolSource interface {
	Snapshot() Snapshot
	Ticks(symbols []string) TickSnapshot
	History(ctx context.Context, symbol, timeframe string, limit int, before int64, refresh bool) HistorySnapshot
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
	g.Get("/ticks", h.ticks)
	g.Get("/history", h.history)
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

func (h *Handler) ticks(c *fiber.Ctx) error {
	if h == nil || h.source == nil {
		return c.JSON(TickSnapshot{
			Connected: false,
			Source:    "mt5",
			Ticks:     []Tick{},
			LastError: "MT5 stream service is not configured",
		})
	}
	snapshot := h.source.Ticks(parseSymbolsQuery(c.Query("symbols")))
	if snapshot.Ticks == nil {
		snapshot.Ticks = []Tick{}
	}
	return c.JSON(snapshot)
}

func (h *Handler) history(c *fiber.Ctx) error {
	if h == nil || h.source == nil {
		return c.JSON(HistorySnapshot{
			Connected: false,
			Source:    "mt5",
			Candles:   []Candle{},
			LastError: "MT5 stream service is not configured",
		})
	}
	symbol := normalizeSymbol(c.Query("symbol"))
	timeframe := c.Query("timeframe", "15m")
	limit := parseIntQuery(c.Query("limit"), 1500)
	before := parseInt64Query(c.Query("before"), 0)
	refresh := parseBoolQuery(c.Query("refresh"))

	ctx, cancel := context.WithTimeout(c.Context(), defaultHistoryHTTPTimeout)
	defer cancel()

	snapshot := h.source.History(ctx, symbol, timeframe, limit, before, refresh)
	if snapshot.Candles == nil {
		snapshot.Candles = []Candle{}
	}
	return c.JSON(snapshot)
}

func parseSymbolsQuery(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	symbols := make([]string, 0, len(parts))
	for _, part := range parts {
		symbol := normalizeSymbol(part)
		if symbol != "" {
			symbols = append(symbols, symbol)
		}
	}
	return symbols
}

func parseIntQuery(raw string, fallback int) int {
	if strings.TrimSpace(raw) == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return value
}

func parseInt64Query(raw string, fallback int64) int64 {
	if strings.TrimSpace(raw) == "" {
		return fallback
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return fallback
	}
	return value
}

func parseBoolQuery(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "y", "on":
		return true
	default:
		return false
	}
}
