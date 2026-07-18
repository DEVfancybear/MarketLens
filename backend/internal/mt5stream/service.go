package mt5stream

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"
)

const (
	defaultReconnectMin       = time.Second
	defaultReconnectMax       = 30 * time.Second
	defaultStreamRequestRetry = 10 * time.Second

	// Cold MT5 symbols can spend several seconds downloading recent history
	// after the first copy_rates_from request. Keep the WebSocket request budget
	// above the Python retry window so the first chart load does not return an
	// empty history while the terminal is still warming the cache.
	defaultHistoryRequestTimeout = 60 * time.Second
	defaultHistoryHTTPTimeout    = 70 * time.Second
	defaultHistoryConcurrency    = 1
	maxRetainedTicksPerSymbol    = 512
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

	mu                 sync.RWMutex
	connected          bool
	source             string
	marketStatusSource string
	count              int
	streamSymbols      []string
	symbols            []Symbol
	ticks              map[string]Tick
	tickHistory        map[string][]Tick
	marketStatuses     map[string]MarketStatus
	history            map[string][]Candle
	conn               *websocket.Conn
	writeMu            sync.Mutex
	pendingHistory     map[string]chan HistoryMessage
	historyFlights     map[string]*historyFlight
	historySlots       chan struct{}
	pendingStream      map[string]time.Time
	subscribers        map[uint64]*TickSubscriber
	nextSubscriber     uint64
	updatedAt          time.Time
	lastErr            string
	startOnce          sync.Once
	reconnectMin       time.Duration
	reconnectMax       time.Duration
	readLimitBytes     int64
}

type historyFlight struct {
	done    chan struct{}
	msg     HistoryMessage
	err     error
	cancel  context.CancelFunc
	waiters int
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
		cfg:                cfg,
		reconnectMin:       reconnectMin,
		reconnectMax:       reconnectMax,
		readLimitBytes:     readLimit,
		source:             "mt5",
		marketStatusSource: "mt5-mql5-session",
		ticks:              make(map[string]Tick),
		tickHistory:        make(map[string][]Tick),
		marketStatuses:     make(map[string]MarketStatus),
		history:            make(map[string][]Candle),
		pendingHistory:     make(map[string]chan HistoryMessage),
		historyFlights:     make(map[string]*historyFlight),
		historySlots:       make(chan struct{}, defaultHistoryConcurrency),
		pendingStream:      make(map[string]time.Time),
		subscribers:        make(map[uint64]*TickSubscriber),
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

	sort.SliceStable(ticks, func(i, j int) bool {
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

func (s *Service) TicksSince(symbols []string, sinceMS int64) TickSnapshot {
	s.ensureStreamSymbols(symbols)

	s.mu.RLock()
	defer s.mu.RUnlock()

	requested := make(map[string]struct{}, len(symbols))
	for _, symbol := range symbols {
		requested[normalizeSymbol(symbol)] = struct{}{}
	}
	ticks := make([]Tick, 0)
	for symbol, history := range s.tickHistory {
		if len(requested) > 0 {
			if _, ok := requested[symbol]; !ok {
				continue
			}
		}
		for _, tick := range history {
			if tickCursorMS(tick) > sinceMS {
				ticks = append(ticks, tick)
			}
		}
	}
	sort.Slice(ticks, func(i, j int) bool {
		left, right := tickCursorMS(ticks[i]), tickCursorMS(ticks[j])
		if left == right {
			return ticks[i].Symbol < ticks[j].Symbol
		}
		return left < right
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

// MarketStatuses returns the latest broker-provided session observations. The
// method is cache-only: requesting a symbol may ask the bridge to start
// streaming it, but the HTTP response never blocks waiting for MT5. Until an
// observation arrives, and whenever the bridge is disconnected or an
// observation expires, the state is explicitly unknown.
func (s *Service) MarketStatuses(symbols []string) MarketStatusSnapshot {
	requestedAll := len(symbols) == 0
	requested := normalizeSymbols(symbols)
	if len(requested) > 0 {
		s.ensureStreamSymbols(requested)
	}

	s.mu.RLock()
	connected := s.connected
	source := firstNonEmpty(s.marketStatusSource, "mt5-mql5-session")
	updatedAt := s.updatedAt
	lastErr := s.lastErr
	now := time.Now().UTC().Unix()

	if requestedAll {
		requested = make([]string, 0, len(s.marketStatuses))
		for symbol := range s.marketStatuses {
			requested = append(requested, symbol)
		}
		sort.Strings(requested)
	}

	sessions := make([]MarketStatus, 0, len(requested))
	for _, symbol := range requested {
		status, ok := s.marketStatuses[symbol]
		if !ok {
			reason := "status_missing"
			if !connected {
				reason = "bridge_disconnected"
			}
			status = unknownMarketStatus(symbol, reason)
		} else {
			status = marketStatusForSnapshot(status, connected, now)
		}
		if status.Source == "" {
			status.Source = source
		}
		sessions = append(sessions, status)
	}
	s.mu.RUnlock()

	return MarketStatusSnapshot{
		Connected: connected,
		BridgeURL: s.cfg.BridgeURL,
		Source:    source,
		Sessions:  sessions,
		UpdatedAt: updatedAt,
		LastError: lastErr,
	}
}

func tickCursorMS(tick Tick) int64 {
	if tick.ReceivedAt > 0 {
		return tick.ReceivedAt
	}
	if tick.TimeMSC > 0 {
		return tick.TimeMSC
	}
	return tick.Timestamp * 1000
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
	now := time.Now()
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
		if requestedAt, ok := s.pendingStream[symbol]; ok &&
			now.Sub(requestedAt) < defaultStreamRequestRetry {
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
	for _, symbol := range missing {
		s.pendingStream[symbol] = now
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

	// Serve known data immediately for ordinary (non-refresh) reads. An explicit
	// refresh request is a synchronous read-through: callers using
	// `refresh=true` must not receive a stale window while MT5 is being refreshed.
	// Older pagination also waits for MT5 because returning a stale page would
	// duplicate the current viewport instead of extending the left edge.
	candles := s.cachedHistory(symbol, timeframe, limit, before)
	if len(candles) > 0 {
		if before > 0 && s.historyCacheCoversBefore(symbol, timeframe, before) {
			return s.historySnapshot(symbol, timeframe, candles, "")
		}
		if before == 0 && !refresh && s.historyIsFresh(symbol, timeframe, candles) {
			return s.historySnapshot(symbol, timeframe, candles, "")
		}
		if before == 0 && !refresh {
			// Keep the chart responsive while MT5 warms or refreshes rates. The
			// background request updates the Go cache; the next frontend refresh
			// receives fresh bars without making this HTTP call wait behind the
			// single-threaded MT5 history bridge.
			s.refreshHistoryAsync(symbol, timeframe, limit, before)
			snapshot := s.historySnapshot(symbol, timeframe, candles, "")
			snapshot.Stale = true
			snapshot.RefreshPending = true
			return snapshot
		}
	}

	msg, err := s.requestHistory(ctx, symbol, timeframe, limit, before, 0)
	if err != nil {
		if candles := s.cachedHistory(symbol, timeframe, limit, before); len(candles) > 0 {
			snapshot := s.historySnapshot(symbol, timeframe, candles, err.Error())
			snapshot.Stale = true
			return snapshot
		}
		snapshot := s.historySnapshot(symbol, timeframe, []Candle{}, err.Error())
		snapshot.HasMore = nil
		return snapshot
	}
	if msg.Error != "" {
		if candles := s.cachedHistory(symbol, timeframe, limit, before); len(candles) > 0 {
			snapshot := s.historySnapshot(symbol, timeframe, candles, msg.Error)
			snapshot.Stale = true
			return snapshot
		}
		snapshot := s.historySnapshot(symbol, timeframe, []Candle{}, msg.Error)
		snapshot.HasMore = msg.HasMore
		return snapshot
	}
	snapshot := s.historySnapshot(
		symbol,
		timeframe,
		limitCandles(msg.Candles, limit, before),
		"",
	)
	snapshot.HasMore = msg.HasMore
	return snapshot
}

func (s *Service) HistoryAround(
	ctx context.Context,
	symbol, timeframe string,
	limit int,
	requestedTime int64,
) HistorySnapshot {
	symbol = normalizeSymbol(symbol)
	timeframe = normalizeTimeframe(timeframe)
	limit = clampLimit(limit)

	if symbol == "" || timeframe == "" || requestedTime <= 0 {
		return HistorySnapshot{
			Connected:     false,
			BridgeURL:     s.cfg.BridgeURL,
			Source:        "mt5",
			Symbol:        symbol,
			Timeframe:     timeframe,
			Candles:       []Candle{},
			RequestedTime: requestedTime,
			LastError:     "symbol, timeframe, and a positive time are required",
		}
	}

	msg, err := s.requestHistory(ctx, symbol, timeframe, limit, 0, requestedTime)
	if err != nil {
		snapshot := s.historySnapshot(symbol, timeframe, []Candle{}, err.Error())
		snapshot.RequestedTime = requestedTime
		return snapshot
	}
	if msg.Error != "" {
		snapshot := s.historySnapshot(symbol, timeframe, []Candle{}, msg.Error)
		snapshot.RequestedTime = requestedTime
		return snapshot
	}

	candles, resolvedTime := limitCandlesAround(msg.Candles, limit, requestedTime)
	if resolvedTime == 0 {
		snapshot := s.historySnapshot(
			symbol,
			timeframe,
			candles,
			"MT5 returned no candle at or after the requested time",
		)
		snapshot.RequestedTime = requestedTime
		return snapshot
	}
	snapshot := s.historySnapshot(symbol, timeframe, candles, "")
	snapshot.RequestedTime = requestedTime
	snapshot.ResolvedTime = resolvedTime
	return snapshot
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
		case "market_status":
			var status bridgeMarketStatusMessage
			if err := json.Unmarshal(payload, &status); err != nil {
				return fmt.Errorf("decode MT5 market status: %w", err)
			}
			s.applyMarketStatuses(status)
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
	confirmed := make(map[string]struct{}, len(s.streamSymbols))
	for _, symbol := range s.streamSymbols {
		confirmed[normalizeSymbol(symbol)] = struct{}{}
	}
	for symbol := range s.pendingStream {
		if _, ok := confirmed[symbol]; ok {
			delete(s.pendingStream, symbol)
		}
	}
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
	if tick.ReceivedAt <= 0 {
		tick.ReceivedAt = time.Now().UTC().UnixMilli()
	}

	s.mu.Lock()
	s.connected = true
	s.lastErr = ""
	s.source = tick.Source
	s.ticks[key] = tick
	history := append(s.tickHistory[key], tick)
	if len(history) > maxRetainedTicksPerSymbol {
		history = append([]Tick(nil), history[len(history)-maxRetainedTicksPerSymbol:]...)
	}
	s.tickHistory[key] = history
	s.updatedAt = time.Now().UTC()

	subscribers := make([]*TickSubscriber, 0, len(s.subscribers))
	for _, subscriber := range s.subscribers {
		if subscriber.matches(key) {
			subscribers = append(subscribers, subscriber)
		}
	}
	updatedAt := s.updatedAt
	s.mu.Unlock()

	message := TickStreamMessage{
		Type:      "tick",
		Connected: true,
		Source:    tick.Source,
		Tick:      &tick,
		UpdatedAt: updatedAt,
	}
	for _, subscriber := range subscribers {
		subscriber.enqueue(message)
	}
}

func (s *Service) applyMarketStatuses(message bridgeMarketStatusMessage) {
	source := firstNonEmpty(message.Source, "mt5-mql5-session")
	sessions := make([]MarketStatus, 0, len(message.Statuses))
	for _, item := range message.Statuses {
		status := normalizeMarketStatus(item.public())
		if status.Symbol == "" {
			continue
		}
		status.Source = source
		sessions = append(sessions, status)
	}

	updatedAt := time.Now().UTC()
	s.mu.Lock()
	s.connected = true
	s.lastErr = ""
	accepted := sessions[:0]
	for _, status := range sessions {
		current, exists := s.marketStatuses[status.Symbol]
		if exists && marketStatusIsOlder(status, current) {
			continue
		}
		s.marketStatuses[status.Symbol] = status
		accepted = append(accepted, status)
	}
	sessions = accepted
	if len(sessions) > 0 {
		s.marketStatusSource = source
	}
	s.updatedAt = updatedAt
	subscribers := make([]*TickSubscriber, 0, len(s.subscribers))
	for _, subscriber := range s.subscribers {
		subscribers = append(subscribers, subscriber)
	}
	s.mu.Unlock()

	if len(sessions) == 0 {
		return
	}
	for _, subscriber := range subscribers {
		filtered := make([]MarketStatus, 0, len(sessions))
		for _, status := range sessions {
			if subscriber.matches(status.Symbol) {
				filtered = append(filtered, status)
			}
		}
		if len(filtered) == 0 {
			continue
		}
		subscriber.enqueue(TickStreamMessage{
			Type:      "market_status",
			Connected: true,
			Source:    source,
			Sessions:  filtered,
			UpdatedAt: updatedAt,
		})
	}
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
		key := historyKey(symbol, timeframe)
		s.history[key] = mergeCandles(s.history[key], history.Candles)
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
	s.connected = true
	s.lastErr = ""
	log.Info().Str("bridge", s.cfg.BridgeURL).Msg("connected to MT5 bridge")
	s.mu.Unlock()
	s.broadcastStreamStatus("")
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

// historyCacheCoversBefore distinguishes a real cached page from an unrelated,
// stale tail. A candle at or beyond the requested boundary proves the cache was
// populated across that boundary; otherwise a synchronous bridge request is
// required before Replay can decide that a selected UTC time is unavailable.
func (s *Service) historyCacheCoversBefore(symbol, timeframe string, before int64) bool {
	if before <= 0 {
		return true
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	candles := s.history[historyKey(symbol, timeframe)]
	return len(candles) > 0 && candles[len(candles)-1].Time >= before
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
	lastBar := candles[len(candles)-1].Time
	if timeframe == "1W" {
		return lastBar >= tick.Timestamp-(2*7*86400)
	}
	if timeframe == "1M" {
		return lastBar >= tick.Timestamp-(2*31*86400)
	}
	currentBar := tick.Timestamp - (tick.Timestamp % tfSec)
	return lastBar >= currentBar-tfSec
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
		// use the 31-day upper bound so the freshness check stays lenient: a
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

func (s *Service) requestHistory(
	ctx context.Context,
	symbol, timeframe string,
	limit int,
	before, around int64,
) (HistoryMessage, error) {
	key := historyRequestKey(symbol, timeframe, limit, before, around)
	flight, leader := s.joinHistoryFlight(key)
	if leader {
		requestCtx, cancel := context.WithTimeout(context.Background(), defaultHistoryRequestTimeout)
		s.mu.Lock()
		if s.historyFlights[key] == flight {
			flight.cancel = cancel
		}
		s.mu.Unlock()

		go func() {
			defer cancel()
			msg, err := s.performHistoryRequest(
				requestCtx,
				symbol,
				timeframe,
				limit,
				before,
				around,
			)
			s.finishHistoryFlight(key, flight, msg, err)
		}()
	}
	return s.waitForHistoryFlight(ctx, key, flight)
}

func (s *Service) waitForHistoryFlight(ctx context.Context, key string, flight *historyFlight) (HistoryMessage, error) {
	select {
	case <-flight.done:
		return flight.msg, flight.err
	case <-ctx.Done():
		s.leaveHistoryFlight(key, flight)
		return HistoryMessage{}, ctx.Err()
	}
}

func (s *Service) joinHistoryFlight(key string) (*historyFlight, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if flight := s.historyFlights[key]; flight != nil {
		flight.waiters++
		return flight, false
	}
	flight := &historyFlight{done: make(chan struct{}), waiters: 1}
	s.historyFlights[key] = flight
	return flight, true
}

func (s *Service) leaveHistoryFlight(key string, flight *historyFlight) {
	var cancel context.CancelFunc
	s.mu.Lock()
	if s.historyFlights[key] == flight {
		flight.waiters--
		if flight.waiters <= 0 {
			// Remove the abandoned flight immediately so a new active chart request
			// cannot join a canceled StrictMode/timeframe-switch request.
			delete(s.historyFlights, key)
			cancel = flight.cancel
		}
	}
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (s *Service) finishHistoryFlight(key string, flight *historyFlight, msg HistoryMessage, err error) {
	flight.msg = msg
	flight.err = err
	close(flight.done)

	s.mu.Lock()
	if s.historyFlights[key] == flight {
		delete(s.historyFlights, key)
	}
	s.mu.Unlock()
}

func (s *Service) hasHistoryFlight(key string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.historyFlights[key] != nil
}

func (s *Service) refreshHistoryAsync(symbol, timeframe string, limit int, before int64) {
	key := historyRequestKey(symbol, timeframe, limit, before, 0)
	if s.hasHistoryFlight(key) {
		return
	}

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), defaultHistoryRequestTimeout)
		defer cancel()
		if _, err := s.requestHistory(ctx, symbol, timeframe, limit, before, 0); err != nil {
			log.Debug().
				Err(err).
				Str("symbol", symbol).
				Str("timeframe", timeframe).
				Int("limit", limit).
				Int64("before", before).
				Msg("refresh MT5 history")
		}
	}()
}

func (s *Service) performHistoryRequest(
	ctx context.Context,
	symbol, timeframe string,
	limit int,
	before, around int64,
) (HistoryMessage, error) {
	release, err := s.acquireHistorySlot(ctx)
	if err != nil {
		return HistoryMessage{}, err
	}
	defer release()

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
	if before > 0 {
		payload["before"] = before
	}
	if around > 0 {
		payload["around"] = around
	}

	s.writeMu.Lock()
	err = conn.WriteJSON(payload)
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
		s.cancelBridgeHistory(conn, id)
		return HistoryMessage{}, ctx.Err()
	case <-timer.C:
		s.mu.Lock()
		delete(s.pendingHistory, id)
		s.mu.Unlock()
		s.cancelBridgeHistory(conn, id)
		return HistoryMessage{}, fmt.Errorf("MT5 history request timed out after %s", defaultHistoryRequestTimeout)
	}
}

func (s *Service) cancelBridgeHistory(conn *websocket.Conn, id string) {
	if conn == nil || id == "" {
		return
	}
	payload := map[string]any{
		"type": "history.cancel",
		"id":   id,
	}
	s.writeMu.Lock()
	err := conn.WriteJSON(payload)
	s.writeMu.Unlock()
	if err != nil {
		log.Debug().Err(err).Str("request_id", id).Msg("cancel MT5 history")
	}
}

func (s *Service) acquireHistorySlot(ctx context.Context) (func(), error) {
	select {
	case s.historySlots <- struct{}{}:
		return func() { <-s.historySlots }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func historyKey(symbol, timeframe string) string {
	return normalizeSymbol(symbol) + ":" + normalizeTimeframe(timeframe)
}

func historyRequestKey(symbol, timeframe string, limit int, before, around int64) string {
	return historyKey(symbol, timeframe) + ":" + strconv.Itoa(limit) + ":" +
		strconv.FormatInt(before, 10) + ":" + strconv.FormatInt(around, 10)
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

func normalizeMarketStatus(status MarketStatus) MarketStatus {
	status.Symbol = normalizeSymbol(status.Symbol)
	switch strings.ToLower(strings.TrimSpace(status.State)) {
	case "open":
		status.State = "open"
	case "closed":
		status.State = "closed"
	case "unknown":
		status.State = "unknown"
	default:
		status.State = "unknown"
		if strings.TrimSpace(status.Reason) == "" {
			status.Reason = "invalid_status"
		}
	}
	status.Reason = strings.TrimSpace(status.Reason)
	if status.State == "unknown" && status.Reason == "" {
		status.Reason = "status_unknown"
	}
	if status.State == "unknown" {
		status.ScheduledOpen = false
	}
	status.SessionOpenAt = nonNegativeTimestamp(status.SessionOpenAt)
	status.SessionCloseAt = nonNegativeTimestamp(status.SessionCloseAt)
	status.NextOpenAt = nonNegativeTimestamp(status.NextOpenAt)
	status.NextTransitionAt = nonNegativeTimestamp(status.NextTransitionAt)
	status.ServerTime = nonNegativeTimestamp(status.ServerTime)
	status.ObservedAt = nonNegativeTimestamp(status.ObservedAt)
	status.ValidUntil = nonNegativeTimestamp(status.ValidUntil)
	return status
}

func marketStatusIsOlder(incoming, current MarketStatus) bool {
	// A zero-clock unknown is an explicit invalidation emitted when the
	// authoritative helper/bridge disappears. It must replace a cached open even
	// if the browser or another process has a skewed wall clock.
	if incoming.State == "unknown" && incoming.ObservedAt == 0 && incoming.ServerTime == 0 {
		return false
	}
	if incoming.ObservedAt != current.ObservedAt {
		return incoming.ObservedAt < current.ObservedAt
	}
	return incoming.ServerTime < current.ServerTime
}

func marketStatusForSnapshot(status MarketStatus, connected bool, now int64) MarketStatus {
	if !connected {
		status.State = "unknown"
		status.ScheduledOpen = false
		status.Reason = "bridge_disconnected"
		return status
	}
	if status.ValidUntil > 0 && now >= status.ValidUntil {
		status.State = "unknown"
		status.ScheduledOpen = false
		status.Reason = "status_expired"
	} else if status.NextTransitionAt > 0 && now >= status.NextTransitionAt {
		status.State = "unknown"
		status.ScheduledOpen = false
		status.Reason = "status_transition_elapsed"
	} else if status.State == "unknown" {
		status.ScheduledOpen = false
	}
	return status
}

func unknownMarketStatus(symbol, reason string) MarketStatus {
	return MarketStatus{
		Symbol: normalizeSymbol(symbol),
		Source: "mt5-mql5-session",
		State:  "unknown",
		Reason: reason,
	}
}

func nonNegativeTimestamp(value int64) int64 {
	if value < 0 {
		return 0
	}
	return value
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

func limitCandlesAround(
	candles []Candle,
	limit int,
	requestedTime int64,
) ([]Candle, int64) {
	if len(candles) == 0 || requestedTime <= 0 {
		return []Candle{}, 0
	}
	sorted := sortCandlesCopy(candles)
	resolvedIndex := sort.Search(len(sorted), func(index int) bool {
		return sorted[index].Time >= requestedTime
	})
	if resolvedIndex >= len(sorted) {
		return []Candle{}, 0
	}
	limit = clampLimit(limit)
	leftCount := limit / 2
	start := resolvedIndex - leftCount
	if start < 0 {
		start = 0
	}
	end := start + limit
	if end > len(sorted) {
		end = len(sorted)
		start = end - limit
		if start < 0 {
			start = 0
		}
	}
	return append([]Candle(nil), sorted[start:end]...), sorted[resolvedIndex].Time
}

func mergeCandles(existing []Candle, incoming []Candle) []Candle {
	if len(existing) == 0 {
		return sortCandlesCopy(incoming)
	}
	if len(incoming) == 0 {
		return sortCandlesCopy(existing)
	}

	byTime := make(map[int64]Candle, len(existing)+len(incoming))
	for _, candle := range existing {
		byTime[candle.Time] = candle
	}
	for _, candle := range incoming {
		byTime[candle.Time] = candle
	}

	merged := make([]Candle, 0, len(byTime))
	for _, candle := range byTime {
		merged = append(merged, candle)
	}
	sort.Slice(merged, func(i, j int) bool {
		return merged[i].Time < merged[j].Time
	})
	return merged
}

func sortCandlesCopy(candles []Candle) []Candle {
	next := append([]Candle(nil), candles...)
	sort.Slice(next, func(i, j int) bool {
		return next[i].Time < next[j].Time
	})
	return next
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
	s.connected = false
	s.lastErr = message
	s.marketStatuses = make(map[string]MarketStatus)
	s.updatedAt = time.Now().UTC()
	log.Warn().Str("bridge", s.cfg.BridgeURL).Msg(message)
	s.mu.Unlock()
	s.broadcastStreamStatus(message)
	s.broadcastUnknownMarketStatuses()
}

func (s *Service) setError(message string) {
	s.mu.Lock()
	s.connected = false
	s.lastErr = message
	s.marketStatuses = make(map[string]MarketStatus)
	s.updatedAt = time.Now().UTC()
	s.mu.Unlock()
	s.broadcastStreamStatus(message)
	s.broadcastUnknownMarketStatuses()
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
