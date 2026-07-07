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
	Type      string  `json:"type,omitempty"`
	Source    string  `json:"source,omitempty"`
	Symbol    string  `json:"symbol"`
	Bid       float64 `json:"bid"`
	Ask       float64 `json:"ask"`
	Timestamp int64   `json:"timestamp"`
	TimeMSC   int64   `json:"time_msc,omitempty"`
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

// TickSnapshot is returned by GET /api/v1/mt5/ticks. It is intentionally small:
// the Python bridge streams ticks continuously and the Go service caches only
// the latest quote per symbol. The chart must use GET /api/v1/mt5/history for
// real MT5 OHLC bars.
type TickSnapshot struct {
	Connected bool      `json:"connected"`
	BridgeURL string    `json:"bridgeUrl"`
	Source    string    `json:"source"`
	Ticks     []Tick    `json:"ticks"`
	UpdatedAt time.Time `json:"updatedAt,omitempty"`
	LastError string    `json:"lastError,omitempty"`
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
	Type      string   `json:"type"`
	Source    string   `json:"source,omitempty"`
	RequestID string   `json:"request_id,omitempty"`
	Symbol    string   `json:"symbol"`
	Timeframe string   `json:"timeframe"`
	Candles   []Candle `json:"candles"`
	Error     string   `json:"error,omitempty"`
}

// HistorySnapshot is returned by GET /api/v1/mt5/history.
type HistorySnapshot struct {
	Connected bool      `json:"connected"`
	BridgeURL string    `json:"bridgeUrl"`
	Source    string    `json:"source"`
	Symbol    string    `json:"symbol"`
	Timeframe string    `json:"timeframe"`
	Candles   []Candle  `json:"candles"`
	UpdatedAt time.Time `json:"updatedAt,omitempty"`
	LastError string    `json:"lastError,omitempty"`
}

type inboundMessage struct {
	Type string `json:"type"`
}
