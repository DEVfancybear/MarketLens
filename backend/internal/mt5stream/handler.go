package mt5stream

import (
	"context"
	"strconv"
	"strings"

	"github.com/gofiber/contrib/v3/websocket"
	"github.com/gofiber/fiber/v3"
)

type SymbolSource interface {
	Snapshot() Snapshot
	Ticks(symbols []string) TickSnapshot
	History(ctx context.Context, symbol, timeframe string, limit int, before int64, refresh bool) HistorySnapshot
}

type HistoryAroundSource interface {
	HistoryAround(ctx context.Context, symbol, timeframe string, limit int, requestedTime int64) HistorySnapshot
}

type TickStreamSource interface {
	RegisterTickSubscriber() *TickSubscriber
}

type TickHistorySource interface {
	TicksSince(symbols []string, sinceMS int64) TickSnapshot
}

type MarketStatusSource interface {
	MarketStatuses(symbols []string) MarketStatusSnapshot
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
	g.Get("/market-status", h.marketStatus)
	g.Get("/history/around", h.historyAround)
	g.Get("/history", h.history)
	g.Use("/stream", func(c fiber.Ctx) error {
		if websocket.IsWebSocketUpgrade(c) {
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})
	g.Get("/stream", websocket.New(h.stream))
}

func (h *Handler) historyAround(c fiber.Ctx) error {
	symbol := normalizeSymbol(c.Query("symbol"))
	timeframe := c.Query("timeframe", "15m")
	limit := parseIntQuery(c.Query("limit"), 600)
	requestedTime := parseInt64Query(c.Query("time"), 0)

	if h == nil || h.source == nil {
		return c.JSON(HistorySnapshot{
			Connected:     false,
			Source:        "mt5",
			Symbol:        symbol,
			Timeframe:     timeframe,
			Candles:       []Candle{},
			RequestedTime: requestedTime,
			LastError:     "MT5 history-around service is not configured",
		})
	}
	source, ok := h.source.(HistoryAroundSource)
	if !ok {
		return c.JSON(HistorySnapshot{
			Connected:     false,
			Source:        "mt5",
			Symbol:        symbol,
			Timeframe:     timeframe,
			Candles:       []Candle{},
			RequestedTime: requestedTime,
			LastError:     "MT5 history-around service is not configured",
		})
	}

	ctx, cancel := context.WithTimeout(c.Context(), defaultHistoryHTTPTimeout)
	defer cancel()
	snapshot := source.HistoryAround(ctx, symbol, timeframe, limit, requestedTime)
	if snapshot.Candles == nil {
		snapshot.Candles = []Candle{}
	}
	return c.JSON(snapshot)
}

func (h *Handler) symbols(c fiber.Ctx) error {
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

func (h *Handler) ticks(c fiber.Ctx) error {
	if h == nil || h.source == nil {
		return c.JSON(TickSnapshot{
			Connected: false,
			Source:    "mt5",
			Ticks:     []Tick{},
			LastError: "MT5 stream service is not configured",
		})
	}
	symbols := parseSymbolsQuery(c.Query("symbols"))
	since := parseInt64Query(c.Query("since"), 0)
	snapshot := h.source.Ticks(symbols)
	if since > 0 {
		if historySource, ok := h.source.(TickHistorySource); ok {
			snapshot = historySource.TicksSince(symbols, since)
		}
	}
	if snapshot.Ticks == nil {
		snapshot.Ticks = []Tick{}
	}
	return c.JSON(snapshot)
}

func (h *Handler) marketStatus(c fiber.Ctx) error {
	symbols := parseSymbolsQuery(c.Query("symbols"))
	if h == nil || h.source == nil {
		return c.JSON(unavailableMarketStatusSnapshot(
			symbols,
			"MT5 market-status service is not configured",
		))
	}
	source, ok := h.source.(MarketStatusSource)
	if !ok {
		return c.JSON(unavailableMarketStatusSnapshot(
			symbols,
			"MT5 market-status service is not configured",
		))
	}

	snapshot := source.MarketStatuses(symbols)
	if snapshot.Sessions == nil {
		snapshot.Sessions = []MarketStatus{}
	}
	return c.JSON(snapshot)
}

func unavailableMarketStatusSnapshot(symbols []string, message string) MarketStatusSnapshot {
	normalized := normalizeSymbols(symbols)
	sessions := make([]MarketStatus, 0, len(normalized))
	for _, symbol := range normalized {
		sessions = append(sessions, unknownMarketStatus(symbol, "service_unavailable"))
	}
	return MarketStatusSnapshot{
		Connected: false,
		Source:    "mt5",
		Sessions:  sessions,
		LastError: message,
	}
}

func (h *Handler) history(c fiber.Ctx) error {
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

type tickStreamClientMessage struct {
	Type    string   `json:"type"`
	Symbols []string `json:"symbols"`
}

func (h *Handler) stream(c *websocket.Conn) {
	if h == nil || h.source == nil {
		_ = c.WriteJSON(TickStreamMessage{
			Type:      "error",
			Connected: false,
			Source:    "mt5",
			LastError: "MT5 stream service is not configured",
		})
		return
	}
	source, ok := h.source.(TickStreamSource)
	if !ok {
		_ = c.WriteJSON(TickStreamMessage{
			Type:      "error",
			Connected: false,
			Source:    "mt5",
			LastError: "MT5 stream service does not support browser streaming",
		})
		return
	}

	subscriber := source.RegisterTickSubscriber()
	defer subscriber.Close()

	writerDone := make(chan struct{})
	go func() {
		defer close(writerDone)
		for {
			select {
			case message := <-subscriber.Messages():
				if err := c.WriteJSON(message); err != nil {
					return
				}
			case <-subscriber.Done():
				return
			}
		}
	}()

	for {
		var message tickStreamClientMessage
		if err := c.ReadJSON(&message); err != nil {
			break
		}
		switch strings.ToLower(strings.TrimSpace(message.Type)) {
		case "unsubscribe":
			subscriber.Unsubscribe(message.Symbols)
		case "set", "set_symbols", "replace":
			subscriber.SetSymbols(message.Symbols)
		case "ping":
			// The writer goroutine owns all writes; status messages and ticks are
			// enough to prove liveness, so pings are accepted as no-ops.
		default:
			subscriber.Subscribe(message.Symbols)
		}
	}

	subscriber.Close()
	<-writerDone
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
