package mt5stream

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"
)

const (
	defaultReconnectMin = time.Second
	defaultReconnectMax = 30 * time.Second
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
		if err := s.readLoop(ctx, conn); err != nil && ctx.Err() == nil {
			s.setDisconnected(fmt.Sprintf("read MT5 bridge: %v", err))
		}
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
			// The Phase 6 HTTP API only exposes symbols. Tick fan-out is kept for
			// a later frontend realtime transport so this service can stay small.
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

func (s *Service) setConnected() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.connected = true
	s.lastErr = ""
	log.Info().Str("bridge", s.cfg.BridgeURL).Msg("connected to MT5 bridge")
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
