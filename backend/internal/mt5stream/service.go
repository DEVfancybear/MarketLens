package mt5stream

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"
)

const (
	defaultReconnectMin = time.Second
	defaultReconnectMax = 30 * time.Second

	// Cold MT5 symbols can spend several seconds downloading recent history
	// after the first copy_rates_from request. Keep the WebSocket request budget
	// above the Python retry window so the first chart load does not return an
	// empty history while the terminal is still warming the cache.
	defaultHistoryRequestTimeout = 25 * time.Second
	defaultHistoryHTTPTimeout    = 30 * time.Second
)

// Config controls the backend API's connection to the local Python MT5 bridge.
type Config struct {
	Enabled        bool
	BridgeURL      string
	DialTimeout    time.Duration
	ReadLimitBytes int64
	ReconnectMin   time.Duration
	ReconnectMax   time.Duration
}

// Service owns one reconnecting WebSocket client and an in-memory copy of the
// latest symbol catalog. It is read-mostly: HTTP handlers should only call
// Snapshot(), never touch the socket directly.
type Service struct {
	cfg Config

	mu             sync.RWMutex
	connected      bool
	source         string
	count          int
	streamSymbols  []string
	symbols        []Symbol
	ticks          map[string]Tick
	history        map[string][]Candle
	conn           *websocket.Conn
	writeMu        sync.Mutex
	pendingHistory map[string]chan HistoryMessage
	updatedAt      time.Time
	lastErr        string
	startOnce      sync.Once
	reconnectMin   time.Duration
	reconnectMax   time.Duration
	readLimitBytes int64
}

func NewService(cfg Config) *Service {
	reconnectMin := cfg.ReconnectMin
	if reconnectMin <= 0 {
		reconnectMin = defaultReconnectMin
	}
	reconnectMax := cfg.ReconnectMax
	if reconnectMax <= 0 {
		reconnectMax = defaultReconnectMax
	}
	readLimit := cfg.ReadLimitBytes
	if readLimit <= 0 {
		readLimit = 8 * 1024 * 1024
	}
	return &Service{
		cfg:            cfg,
		reconnectMin:   reconnectMin,
		reconnectMax:   reconnectMax,
		readLimitBytes: readLimit,
		source:         "mt5",
		ticks:          make(map[string]Tick),
		history:        make(map[string][]Candle),
		pendingHistory: make(map[string]chan HistoryMessage),
	}
}

func (s *Service) Start(ctx context.Context) {
	if !s.cfg.Enabled {
		s.setError("MT5 stream API disabled")
		return
	}
	if s.cfg.BridgeURL == "" {
		s.setError("MT5 bridge URL is empty")
		return
	}
	s.startOnce.Do(func() {
		go s.run(ctx)
	})
}

func (s *Service) Snapshot() Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()

	symbols := append([]Symbol(nil), s.symbols...)
	streamSymbols := append([]string(nil), s.streamSymbols...)
	return Snapshot{
		Connected:     s.connected,
		BridgeURL:     s.cfg.BridgeURL,
		Source:        s.source,
		Count:         s.count,
		StreamSymbols: streamSymbols,
		Symbols:       symbols,
		UpdatedAt:     s.updatedAt,
		LastError:     s.lastErr,
	}
}

func (s *Service) Ticks(symbols []string) TickSnapshot {
	s.ensureStreamSymbols(symbols)

	s.mu.RLock()
	defer s.mu.RUnlock()

	ticks := make([]Tick, 0, len(s.ticks))
	if len(symbols) == 0 {
		for _, tick := range s.ticks {
			ticks = append(ticks, tick)
		}
	} else {
		for _, symbol := range symbols {
			if tick, ok := s.ticks[normalizeSymbol(symbol)]; ok {
				ticks = append(ticks, tick)
			}
		}
	}

	sort.Slice(ticks, func(i, j int) bool {
		return ticks[i].Symbol < ticks[j].Symbol
	})

	return TickSnapshot{
		Connected: s.connected,
		BridgeURL: s.cfg.BridgeURL,
		Source:    s.source,
		Ticks:     ticks,
		UpdatedAt: s.updatedAt,
		LastError: s.lastErr,
	}
}

func (s *Service) ensureStreamSymbols(symbols []string) {
	if len(symbols) == 0 {
		return
	}

	requested := make([]string, 0, len(symbols))
	seenRequested := make(map[string]struct{}, len(symbols))
	for _, symbol := range symbols {
		normalized := normalizeSymbol(symbol)
		if normalized == "" {
			continue
		}
		if _, ok := seenRequested[normalized]; ok {
			continue
		}
		seenRequested[normalized] = struct{}{}
		requested = append(requested, normalized)
	}
	if len(requested) == 0 {
		return
	}

	s.mu.RLock()
	conn := s.conn
	connected := s.connected
	streamed := make(map[string]struct{}, len(s.streamSymbols))
	for _, symbol := range s.streamSymbols {
		streamed[normalizeSymbol(symbol)] = struct{}{}
	}
	available := make(map[string]struct{}, len(s.symbols))
	for _, symbol := range s.symbols {
		available[normalizeSymbol(symbol.Name)] = struct{}{}
	}
	missing := make([]string, 0, len(requested))
	for _, symbol := range requested {
		if _, ok := streamed[symbol]; ok {
			continue
		}
		if _, ok := available[symbol]; !ok {
			continue
		}
		missing = append(missing, symbol)
	}
	s.mu.RUnlock()

	if !connected || conn == nil || len(missing) == 0 {
		return
	}

	payload := map[string]any{
		"type":    "stream.subscribe",
		"symbols": missing,
	}
	s.writeMu.Lock()
	err := conn.WriteJSON(payload)
	s.writeMu.Unlock()
	if err != nil {
		log.Warn().Err(err).Strs("symbols", missing).Msg("request MT5 stream symbols")
		return
	}

	s.mu.Lock()
	existing := make(map[string]struct{}, len(s.streamSymbols)+len(missing))
	for _, symbol := range s.streamSymbols {
		existing[normalizeSymbol(symbol)] = struct{}{}
	}
	for _, symbol := range missing {
		if _, ok := existing[symbol]; ok {
			continue
		}
		s.streamSymbols = append(s.streamSymbols, symbol)
		existing[symbol] = struct{}{}
	}
	s.mu.Unlock()
}

func (s *Service) History(ctx context.Context, symbol, timeframe string, limit int, before int64, refresh bool) HistorySnapshot {
	symbol = normalizeSymbol(symbol)
	timeframe = normalizeTimeframe(timeframe)
	limit = clampLimit(limit)

	if symbol == "" || timeframe == "" {
		return HistorySnapshot{
			Connected: false,
			BridgeURL: s.cfg.BridgeURL,
			Source:    "mt5",
			Symbol:    symbol,
			Timeframe: timeframe,
			Candles:   []Candle{},
			LastError: "symbol and timeframe are required",
		}
	}

	// Serve from cache only when it is complete AND still current. Paginating
	// older data (before > 0) always uses the cache; the latest window must not
	// be served stale — MT5 can hand back cached bars that lag the live tick by
	// many bars, which would leave a gap before the realtime candle.
	if candles := s.cachedHistory(symbol, timeframe, limit, before); !refresh &&
		len(candles) >= limit &&
		(before > 0 || s.historyIsFresh(symbol, timeframe, candles)) {
		return s.historySnapshot(symbol, timeframe, candles, "")
	}

	msg, err := s.requestHistory(ctx, symbol, timeframe, limit)
	if err != nil {
		return s.historySnapshot(symbol, timeframe, []Candle{}, err.Error())
	}
	if msg.Error != "" {
		return s.historySnapshot(symbol, timeframe, []Candle{}, msg.Error)
	}
	return s.historySnapshot(symbol, timeframe, limitCandles(msg.Candles, limit, before), "")
}

func (s *Service) run(ctx context.Context) {
	backoff := s.reconnectMin
	for ctx.Err() == nil {
		conn, err := s.dial(ctx)
		if err != nil {
			s.setDisconnected(fmt.Sprintf("dial MT5 bridge: %v", err))
			if !sleepContext(ctx, backoff) {
				return
			}
			backoff = s.nextBackoff(backoff)
			continue
		}

		backoff = s.reconnectMin
		s.setConnected()
		s.setConn(conn)
		if err := s.readLoop(ctx, conn); err != nil && ctx.Err() == nil {
			s.setDisconnected(fmt.Sprintf("read MT5 bridge: %v", err))
		}
		s.clearConn(conn)
		_ = conn.Close()

		if ctx.Err() != nil {
			return
		}
		if !sleepContext(ctx, backoff) {
			return
		}
		backoff = s.nextBackoff(backoff)
	}
}

func (s *Service) dial(ctx context.Context) (*websocket.Conn, error) {
	dialer := websocket.Dialer{
		HandshakeTimeout: s.cfg.DialTimeout,
		Proxy:            http.ProxyFromEnvironment,
	}
	conn, _, err := dialer.DialContext(ctx, s.cfg.BridgeURL, nil)
	if err != nil {
		return nil, err
	}
	conn.SetReadLimit(s.readLimitBytes)
	return conn, nil
}

func (s *Service) readLoop(ctx context.Context, conn *websocket.Conn) error {
	closeDone := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			deadline := time.Now().Add(time.Second)
			_ = conn.WriteControl(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseNormalClosure, "shutdown"),
				deadline,
			)
			_ = conn.Close()
		case <-closeDone:
		}
	}()
	defer close(closeDone)

	for {
		_, payload, err := conn.ReadMessage()
		if err != nil {
			return err
		}

		var header inboundMessage
		if err := json.Unmarshal(payload, &header); err != nil {
			return fmt.Errorf("decode MT5 message header: %w", err)
		}
		switch header.Type {
		case "symbols":
			var catalog SymbolCatalog
			if err := json.Unmarshal(payload, &catalog); err != nil {
				return fmt.Errorf("decode MT5 symbols: %w", err)
			}
			s.applyCatalog(catalog)
		case "tick", "":
			var tick Tick
			if err := json.Unmarshal(payload, &tick); err != nil {
				return fmt.Errorf("decode MT5 tick: %w", err)
			}
			s.applyTick(tick)
		case "history":
			var history HistoryMessage
			if err := json.Unmarshal(payload, &history); err != nil {
				return fmt.Errorf("decode MT5 history: %w", err)
			}
			s.applyHistory(history)
		default:
			log.Debug().Str("type", header.Type).Msg("ignored MT5 bridge message")
		}
	}
}

func (s *Service) applyCatalog(catalog SymbolCatalog) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.connected = true
	s.lastErr = ""
	s.source = catalog.Source
	if s.source == "" {
		s.source = "mt5"
	}
	s.count = catalog.Count
	if s.count == 0 {
		s.count = len(catalog.Symbols)
	}
	s.streamSymbols = append([]string(nil), catalog.StreamSymbols...)
	s.symbols = append([]Symbol(nil), catalog.Symbols...)
	s.updatedAt = time.Now().UTC()
	log.Info().
		Int("count", s.count).
		Int("stream_symbols", len(s.streamSymbols)).
		Msg("loaded MT5 symbol catalog")
}

func (s *Service) applyTick(tick Tick) {
	key := normalizeSymbol(tick.Symbol)
	if key == "" {
		return
	}
	if tick.Source == "" {
		tick.Source = "mt5"
	}
	tick.Symbol = key

	s.mu.Lock()
	defer s.mu.Unlock()
	s.connected = true
	s.lastErr = ""
	s.source = tick.Source
	s.ticks[key] = tick
	s.updatedAt = time.Now().UTC()
}

func (s *Service) applyHistory(history HistoryMessage) {
	symbol := normalizeSymbol(history.Symbol)
	timeframe := normalizeTimeframe(history.Timeframe)
	if history.Source == "" {
		history.Source = "mt5"
	}
	history.Symbol = symbol
	history.Timeframe = timeframe

	s.mu.Lock()
	if symbol != "" && timeframe != "" && history.Error == "" {
		s.history[historyKey(symbol, timeframe)] = append([]Candle(nil), history.Candles...)
		s.connected = true
		s.lastErr = ""
		s.source = history.Source
		s.updatedAt = time.Now().UTC()
	}
	pending := s.pendingHistory[history.RequestID]
	if history.RequestID != "" {
		delete(s.pendingHistory, history.RequestID)
	}
	s.mu.Unlock()

	if pending != nil {
		select {
		case pending <- history:
		default:
		}
	}
}

func (s *Service) setConnected() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.connected = true
	s.lastErr = ""
	log.Info().Str("bridge", s.cfg.BridgeURL).Msg("connected to MT5 bridge")
}

func (s *Service) setConn(conn *websocket.Conn) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.conn = conn
}

func (s *Service) clearConn(conn *websocket.Conn) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.conn == conn {
		s.conn = nil
	}
	for id, pending := range s.pendingHistory {
		delete(s.pendingHistory, id)
		close(pending)
	}
}

func (s *Service) cachedHistory(symbol, timeframe string, limit int, before int64) []Candle {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return limitCandles(s.history[historyKey(symbol, timeframe)], limit, before)
}

// historyIsFresh reports whether the cached candles reach the current bar,
// judged against the latest streamed tick for the symbol. Stale cache (last bar
// more than one interval behind the live bar) must be re-requested so the chart
// has no gap between history and the realtime candle.
func (s *Service) historyIsFresh(symbol, timeframe string, candles []Candle) bool {
	tfSec := timeframeSeconds(timeframe)
	if tfSec <= 0 || len(candles) == 0 {
		return true
	}
	s.mu.RLock()
	tick, ok := s.ticks[symbol]
	s.mu.RUnlock()
	if !ok || tick.Timestamp <= 0 {
		return true // no live reference; don't force an endless refetch
	}
	currentBar := tick.Timestamp - (tick.Timestamp % tfSec)
	return candles[len(candles)-1].Time >= currentBar-tfSec
}

func timeframeSeconds(timeframe string) int64 {
	switch timeframe {
	case "1m":
		return 60
	case "3m":
		return 180
	case "5m":
		return 300
	case "15m":
		return 900
	case "30m":
		return 1800
	case "1H":
		return 3600
	case "2H":
		return 7200
	case "4H":
		return 14400
	case "1D":
		return 86400
	case "1W":
		return 604800
	case "1M":
		// Monthly bars ("1M", not "1m"). A month is variable length (28-31 days);
		// use the 31-day upper bound so the freshness check stays lenient — a
		// valid current-month bar always passes, while a cache several months
		// behind is refetched.
		return 2678400
	default:
		return 0
	}
}

func (s *Service) historySnapshot(symbol, timeframe string, candles []Candle, err string) HistorySnapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if candles == nil {
		candles = []Candle{}
	}
	return HistorySnapshot{
		Connected: s.connected,
		BridgeURL: s.cfg.BridgeURL,
		Source:    s.source,
		Symbol:    symbol,
		Timeframe: timeframe,
		Candles:   candles,
		UpdatedAt: s.updatedAt,
		LastError: firstNonEmpty(err, s.lastErr),
	}
}

func (s *Service) requestHistory(ctx context.Context, symbol, timeframe string, limit int) (HistoryMessage, error) {
	id := "hist-" + strconv.FormatInt(time.Now().UnixNano(), 36)
	pending := make(chan HistoryMessage, 1)

	s.mu.Lock()
	conn := s.conn
	if conn == nil || !s.connected {
		lastErr := s.lastErr
		s.mu.Unlock()
		if lastErr == "" {
			lastErr = "MT5 bridge is not connected"
		}
		return HistoryMessage{}, fmt.Errorf("%s", lastErr)
	}
	s.pendingHistory[id] = pending
	s.mu.Unlock()

	payload := map[string]any{
		"type":      "history.request",
		"id":        id,
		"symbol":    symbol,
		"timeframe": timeframe,
		"limit":     limit,
	}

	s.writeMu.Lock()
	err := conn.WriteJSON(payload)
	s.writeMu.Unlock()
	if err != nil {
		s.mu.Lock()
		delete(s.pendingHistory, id)
		s.mu.Unlock()
		return HistoryMessage{}, fmt.Errorf("request MT5 history: %w", err)
	}

	timer := time.NewTimer(defaultHistoryRequestTimeout)
	defer timer.Stop()

	select {
	case msg, ok := <-pending:
		if !ok {
			return HistoryMessage{}, fmt.Errorf("MT5 bridge disconnected while loading history")
		}
		return msg, nil
	case <-ctx.Done():
		s.mu.Lock()
		delete(s.pendingHistory, id)
		s.mu.Unlock()
		return HistoryMessage{}, ctx.Err()
	case <-timer.C:
		s.mu.Lock()
		delete(s.pendingHistory, id)
		s.mu.Unlock()
		return HistoryMessage{}, fmt.Errorf("MT5 history request timed out after %s", defaultHistoryRequestTimeout)
	}
}

func historyKey(symbol, timeframe string) string {
	return normalizeSymbol(symbol) + ":" + normalizeTimeframe(timeframe)
}

func normalizeSymbol(symbol string) string {
	b := make([]byte, 0, len(symbol))
	for i := 0; i < len(symbol); i++ {
		c := symbol[i]
		if c >= 'a' && c <= 'z' {
			c -= 'a' - 'A'
		}
		if c != ' ' && c != '\t' && c != '\r' && c != '\n' {
			b = append(b, c)
		}
	}
	return string(b)
}

func normalizeTimeframe(timeframe string) string {
	switch timeframe {
	case "1m", "3m", "5m", "15m", "30m", "1H", "2H", "4H", "1D", "1W", "1M":
		return timeframe
	case "1h":
		return "1H"
	case "2h":
		return "2H"
	case "4h":
		return "4H"
	case "1d":
		return "1D"
	case "1w":
		return "1W"
	case "1mo":
		return "1M"
	default:
		return ""
	}
}

func clampLimit(limit int) int {
	if limit <= 0 {
		return 1500
	}
	if limit > 5000 {
		return 5000
	}
	return limit
}

func limitCandles(candles []Candle, limit int, before int64) []Candle {
	if len(candles) == 0 {
		return []Candle{}
	}
	filtered := make([]Candle, 0, len(candles))
	for _, candle := range candles {
		if before > 0 && candle.Time >= before {
			continue
		}
		filtered = append(filtered, candle)
	}
	if len(filtered) > limit {
		filtered = filtered[len(filtered)-limit:]
	}
	return append([]Candle(nil), filtered...)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func (s *Service) setDisconnected(message string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.connected = false
	s.lastErr = message
	log.Warn().Str("bridge", s.cfg.BridgeURL).Msg(message)
}

func (s *Service) setError(message string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.connected = false
	s.lastErr = message
}

func (s *Service) nextBackoff(current time.Duration) time.Duration {
	next := current * 2
	if next > s.reconnectMax {
		return s.reconnectMax
	}
	return next
}

func sleepContext(ctx context.Context, d time.Duration) bool {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-timer.C:
		return true
	case <-ctx.Done():
		return false
	}
}
