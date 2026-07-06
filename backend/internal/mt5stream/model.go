package mt5stream

import "time"

// Symbol mirrors one item from the Python bridge's MT5 symbol catalog payload.
// Keep field names aligned with bridge/mt5_stream/mt5_server.py so this can be
// decoded without adapter code.
type Symbol struct {
	Name           string `json:"name"`
	Path           string `json:"path,omitempty"`
	Description    string `json:"description,omitempty"`
	Visible        bool   `json:"visible"`
	Digits         int    `json:"digits"`
	Spread         int    `json:"spread"`
	TradeMode      int    `json:"trade_mode"`
	CurrencyBase   string `json:"currency_base,omitempty"`
	CurrencyProfit string `json:"currency_profit,omitempty"`
	CurrencyMargin string `json:"currency_margin,omitempty"`
}

// SymbolCatalog is sent by the Python sidecar when a Go client connects.
type SymbolCatalog struct {
	Type          string   `json:"type"`
	Source        string   `json:"source,omitempty"`
	Count         int      `json:"count"`
	StreamSymbols []string `json:"stream_symbols"`
	Symbols       []Symbol `json:"symbols"`
}

// Tick is the market-data message emitted after the catalog. The API service
// currently only caches the catalog, but keeping the tick contract here avoids
// another shape when the backend later fans MT5 ticks to frontend sockets.
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

type inboundMessage struct {
	Type string `json:"type"`
}
