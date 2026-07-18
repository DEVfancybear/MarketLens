package mt5stream

import "time"

// Symbol mirrors one item from the Python bridge's MT5 symbol catalog payload.
// Keep field names aligned with bridge/mt5_stream/mt5_server.py so this can be
// decoded without adapter code.
type Symbol struct {
	Name           string  `json:"name"`
	Path           string  `json:"path,omitempty"`
	Description    string  `json:"description,omitempty"`
	Visible        bool    `json:"visible"`
	Digits         int     `json:"digits"`
	Point          float64 `json:"point"`
	Spread         int     `json:"spread"`
	TradeMode      int     `json:"trade_mode"`
	CurrencyBase   string  `json:"currency_base,omitempty"`
	CurrencyProfit string  `json:"currency_profit,omitempty"`
	CurrencyMargin string  `json:"currency_margin,omitempty"`
}

// SymbolCatalog is sent by the Python sidecar when a Go client connects.
type SymbolCatalog struct {
	Type          string   `json:"type"`
	Source        string   `json:"source,omitempty"`
	Count         int      `json:"count"`
	StreamSymbols []string `json:"stream_symbols"`
	Symbols       []Symbol `json:"symbols"`
}

// Tick is the market-data message emitted after the catalog. The service caches
// the latest tick per symbol for quotes/watchlist rows. MT5 chart candles come
// from the history endpoint instead of being synthesized from bid/ask ticks.
type Tick struct {
	Type       string  `json:"type,omitempty"`
	Source     string  `json:"source,omitempty"`
	Symbol     string  `json:"symbol"`
	Bid        float64 `json:"bid"`
	Ask        float64 `json:"ask"`
	Timestamp  int64   `json:"timestamp"`
	TimeMSC    int64   `json:"time_msc,omitempty"`
	ReceivedAt int64   `json:"received_at,omitempty"`
}

// Snapshot is returned by the HTTP API. It is intentionally status-rich so FE
// can render "bridge disconnected" without treating an empty catalog as a hard
// request failure.
type Snapshot struct {
	Connected     bool      `json:"connected"`
	BridgeURL     string    `json:"bridgeUrl"`
	Source        string    `json:"source"`
	Count         int       `json:"count"`
	StreamSymbols []string  `json:"streamSymbols"`
	Symbols       []Symbol  `json:"symbols"`
	UpdatedAt     time.Time `json:"updatedAt,omitempty"`
	LastError     string    `json:"lastError,omitempty"`
}

// TickSnapshot is returned by GET /api/v1/mt5/ticks. Without `since` it contains
// the latest quote per symbol; with `since=<unix-ms>` it contains the retained
// ordered ticks after that point for exact closed-browser alert replay.
type TickSnapshot struct {
	Connected bool      `json:"connected"`
	BridgeURL string    `json:"bridgeUrl"`
	Source    string    `json:"source"`
	Ticks     []Tick    `json:"ticks"`
	UpdatedAt time.Time `json:"updatedAt,omitempty"`
	LastError string    `json:"lastError,omitempty"`
}

// MarketStatus is the browser-facing, per-symbol trading-session state. The
// Python bridge receives the broker schedule from its native MQL5 helper and
// sends snake_case fields; the API exposes the same data using the existing
// camelCase HTTP/WebSocket convention. All timestamps are UTC Unix seconds;
// ServerTime is the helper heartbeat reference, not broker-local wall time.
type MarketStatus struct {
	Symbol           string `json:"symbol"`
	Source           string `json:"source,omitempty"`
	State            string `json:"state"`
	ScheduledOpen    bool   `json:"scheduledOpen"`
	Reason           string `json:"reason"`
	SessionOpenAt    int64  `json:"sessionOpenAt"`
	SessionCloseAt   int64  `json:"sessionCloseAt"`
	NextOpenAt       int64  `json:"nextOpenAt"`
	NextTransitionAt int64  `json:"nextTransitionAt"`
	ServerTime       int64  `json:"serverTime"`
	ObservedAt       int64  `json:"observedAt"`
	ValidUntil       int64  `json:"validUntil"`
}

// MarketStatusSnapshot is returned by GET /api/v1/mt5/market-status. A missing,
// expired, or disconnected bridge observation is represented as state=unknown;
// the API never infers a closed market from absent data.
type MarketStatusSnapshot struct {
	Connected bool           `json:"connected"`
	BridgeURL string         `json:"bridgeUrl"`
	Source    string         `json:"source"`
	Sessions  []MarketStatus `json:"sessions"`
	UpdatedAt time.Time      `json:"updatedAt,omitempty"`
	LastError string         `json:"lastError,omitempty"`
}

// bridgeMarketStatusMessage mirrors the Python bridge wire contract. Keep the
// item field names snake_case here and convert them before exposing API data.
type bridgeMarketStatusMessage struct {
	Type     string               `json:"type"`
	Source   string               `json:"source,omitempty"`
	Statuses []bridgeMarketStatus `json:"statuses"`
}

type bridgeMarketStatus struct {
	Symbol           string `json:"symbol"`
	State            string `json:"state"`
	ScheduledOpen    bool   `json:"scheduled_open"`
	Reason           string `json:"reason"`
	SessionOpenAt    int64  `json:"session_open_at"`
	SessionCloseAt   int64  `json:"session_close_at"`
	NextOpenAt       int64  `json:"next_open_at"`
	NextTransitionAt int64  `json:"next_transition_at"`
	ServerTime       int64  `json:"server_time"`
	ObservedAt       int64  `json:"observed_at"`
	ValidUntil       int64  `json:"valid_until"`
}

func (status bridgeMarketStatus) public() MarketStatus {
	return MarketStatus{
		Symbol:           status.Symbol,
		State:            status.State,
		ScheduledOpen:    status.ScheduledOpen,
		Reason:           status.Reason,
		SessionOpenAt:    status.SessionOpenAt,
		SessionCloseAt:   status.SessionCloseAt,
		NextOpenAt:       status.NextOpenAt,
		NextTransitionAt: status.NextTransitionAt,
		ServerTime:       status.ServerTime,
		ObservedAt:       status.ObservedAt,
		ValidUntil:       status.ValidUntil,
	}
}

// Candle is the backend/frontend OHLCV contract for MT5 history. Time is UNIX
// seconds at bar open, aligned with lightweight-charts and the frontend
// MarketCandle type.
type Candle struct {
	Time   int64   `json:"time"`
	Open   float64 `json:"open"`
	High   float64 `json:"high"`
	Low    float64 `json:"low"`
	Close  float64 `json:"close"`
	Volume float64 `json:"volume"`
}

// HistoryMessage is sent by the Python bridge for either an initial preload or
// a Go-initiated history request.
type HistoryMessage struct {
	Type          string   `json:"type"`
	Source        string   `json:"source,omitempty"`
	RequestID     string   `json:"request_id,omitempty"`
	Symbol        string   `json:"symbol"`
	Timeframe     string   `json:"timeframe"`
	Candles       []Candle `json:"candles"`
	RequestedTime int64    `json:"requested_time,omitempty"`
	ResolvedTime  int64    `json:"resolved_time,omitempty"`
	// HasMore is populated for cursor pages. A pointer distinguishes an
	// explicit end-of-history from older bridge versions that omit the field.
	HasMore *bool  `json:"has_more,omitempty"`
	Error   string `json:"error,omitempty"`
}

// HistorySnapshot is returned by GET /api/v1/mt5/history.
type HistorySnapshot struct {
	Connected bool     `json:"connected"`
	BridgeURL string   `json:"bridgeUrl"`
	Source    string   `json:"source"`
	Symbol    string   `json:"symbol"`
	Timeframe string   `json:"timeframe"`
	Candles   []Candle `json:"candles"`
	// HasMore is populated for `before` pages when the bridge can determine
	// whether another page exists to the left.
	HasMore        *bool     `json:"hasMore,omitempty"`
	Stale          bool      `json:"stale,omitempty"`
	RefreshPending bool      `json:"refreshPending,omitempty"`
	RequestedTime  int64     `json:"requestedTime,omitempty"`
	ResolvedTime   int64     `json:"resolvedTime,omitempty"`
	UpdatedAt      time.Time `json:"updatedAt,omitempty"`
	LastError      string    `json:"lastError,omitempty"`
}

type inboundMessage struct {
	Type string `json:"type"`
}
