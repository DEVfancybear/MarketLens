package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

const (
	defaultBridgeURL = "ws://localhost:8765"
	minBackoff       = time.Second
	maxBackoff       = 30 * time.Second
)

// Mt5Tick is the stable contract emitted by bridge/mt5_stream/mt5_server.py.
// Keep this payload intentionally small; downstream services can enrich it
// with spread, candles, persistence, or fan-out without changing the bridge.
type Mt5Tick struct {
	Type      string  `json:"type,omitempty"`
	Source    string  `json:"source,omitempty"`
	Symbol    string  `json:"symbol"`
	Bid       float64 `json:"bid"`
	Ask       float64 `json:"ask"`
	Timestamp int64   `json:"timestamp"`
	TimeMSC   int64   `json:"time_msc,omitempty"`
}

type Mt5Symbol struct {
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

type Mt5SymbolCatalog struct {
	Type          string      `json:"type"`
	Source        string      `json:"source,omitempty"`
	Count         int         `json:"count"`
	StreamSymbols []string    `json:"stream_symbols"`
	Symbols       []Mt5Symbol `json:"symbols"`
}

type inboundMessage struct {
	Type   string `json:"type"`
	Symbol string `json:"symbol,omitempty"`
}

type config struct {
	BridgeURL      string
	DialTimeout    time.Duration
	ReadLimitBytes int64
}

func main() {
	logger := log.New(os.Stdout, "", log.LstdFlags)
	cfg := loadConfig()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	ticks := make(chan Mt5Tick, 1024)
	events := make(chan string, 32)

	go streamLoop(ctx, cfg, ticks, events)

	logger.Printf("MT5 stream consumer starting bridge=%s", cfg.BridgeURL)
	for {
		select {
		case tick := <-ticks:
			logger.Println(formatTick(tick))
		case event := <-events:
			logger.Println(event)
		case <-ctx.Done():
			logger.Println("shutdown requested; closing MT5 stream consumer")
			return
		}
	}
}

func loadConfig() config {
	return config{
		BridgeURL:      envString("MT5_BRIDGE_WS_URL", defaultBridgeURL),
		DialTimeout:    envDurationSeconds("MT5_BRIDGE_DIAL_TIMEOUT_SECONDS", 10),
		ReadLimitBytes: envInt64("MT5_BRIDGE_READ_LIMIT_BYTES", 8*1024*1024),
	}
}

func streamLoop(ctx context.Context, cfg config, ticks chan<- Mt5Tick, events chan<- string) {
	backoff := minBackoff
	for ctx.Err() == nil {
		conn, err := dialBridge(ctx, cfg)
		if err != nil {
			sendEvent(ctx, events, fmt.Sprintf("MT5 bridge dial failed: %v", err))
			if !sleepContext(ctx, backoff) {
				return
			}
			backoff = nextBackoff(backoff)
			continue
		}

		backoff = minBackoff
		sendEvent(ctx, events, "MT5 bridge connected")
		err = readMessages(ctx, conn, ticks, events)
		_ = conn.Close()

		if ctx.Err() != nil {
			return
		}
		if err != nil && !isNormalClose(err) {
			sendEvent(ctx, events, fmt.Sprintf("MT5 bridge read failed: %v", err))
		} else {
			sendEvent(ctx, events, "MT5 bridge closed")
		}
		if !sleepContext(ctx, backoff) {
			return
		}
		backoff = nextBackoff(backoff)
	}
}

func dialBridge(ctx context.Context, cfg config) (*websocket.Conn, error) {
	dialer := websocket.Dialer{
		HandshakeTimeout: cfg.DialTimeout,
		Proxy:            http.ProxyFromEnvironment,
	}
	conn, _, err := dialer.DialContext(ctx, cfg.BridgeURL, nil)
	if err != nil {
		return nil, err
	}
	conn.SetReadLimit(cfg.ReadLimitBytes)
	return conn, nil
}

func readMessages(
	ctx context.Context,
	conn *websocket.Conn,
	ticks chan<- Mt5Tick,
	events chan<- string,
) error {
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
			return fmt.Errorf("decode mt5 message header: %w", err)
		}

		switch header.Type {
		case "symbols":
			var catalog Mt5SymbolCatalog
			if err := json.Unmarshal(payload, &catalog); err != nil {
				return fmt.Errorf("decode mt5 symbols: %w", err)
			}
			sendEvent(ctx, events, formatSymbolCatalog(catalog))
		case "", "tick":
			var tick Mt5Tick
			if err := json.Unmarshal(payload, &tick); err != nil {
				return fmt.Errorf("decode mt5 tick: %w", err)
			}
			if tick.Symbol == "" {
				return errors.New("decode mt5 tick: symbol is empty")
			}
			select {
			case ticks <- tick:
			case <-ctx.Done():
				return ctx.Err()
			}
		default:
			sendEvent(ctx, events, fmt.Sprintf("MT5 bridge ignored message type=%q", header.Type))
		}
	}
}

func formatSymbolCatalog(catalog Mt5SymbolCatalog) string {
	visible := 0
	for _, symbol := range catalog.Symbols {
		if symbol.Visible {
			visible++
		}
	}
	return fmt.Sprintf(
		"MT5 symbols loaded total=%d visible=%d streaming=%v",
		catalog.Count,
		visible,
		catalog.StreamSymbols,
	)
}

func formatTick(tick Mt5Tick) string {
	ts := tickTime(tick).Format("15:04:05")
	return fmt.Sprintf(
		"[%s] Bid: %.5f | Ask: %.5f | Time: %s",
		tick.Symbol,
		tick.Bid,
		tick.Ask,
		ts,
	)
}

func tickTime(tick Mt5Tick) time.Time {
	if tick.TimeMSC > 0 {
		return time.UnixMilli(tick.TimeMSC).Local()
	}
	if tick.Timestamp > 0 {
		return time.Unix(tick.Timestamp, 0).Local()
	}
	return time.Now()
}

func isNormalClose(err error) bool {
	return websocket.IsCloseError(
		err,
		websocket.CloseNormalClosure,
		websocket.CloseGoingAway,
	)
}

func nextBackoff(current time.Duration) time.Duration {
	next := current * 2
	if next > maxBackoff {
		return maxBackoff
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

func sendEvent(ctx context.Context, events chan<- string, message string) {
	select {
	case events <- message:
	case <-ctx.Done():
	default:
	}
}

func envString(key string, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envDurationSeconds(key string, fallback int) time.Duration {
	value := envInt64(key, int64(fallback))
	return time.Duration(value) * time.Second
}

func envInt64(key string, fallback int64) int64 {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}
