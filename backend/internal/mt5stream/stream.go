package mt5stream

import (
	"sort"
	"sync"
	"time"
)

const tickStreamBuffer = 1024

// TickStreamMessage is the browser-facing WebSocket envelope for realtime MT5
// quotes. REST /ticks remains a point-in-time snapshot API; this stream is the
// push path used by watchlists and chart price labels.
type TickStreamMessage struct {
	Type      string         `json:"type"`
	Connected bool           `json:"connected,omitempty"`
	Source    string         `json:"source,omitempty"`
	Symbols   []string       `json:"symbols,omitempty"`
	Ticks     []Tick         `json:"ticks,omitempty"`
	Tick      *Tick          `json:"tick,omitempty"`
	Sessions  []MarketStatus `json:"sessions,omitempty"`
	UpdatedAt time.Time      `json:"updatedAt,omitempty"`
	LastError string         `json:"lastError,omitempty"`
}

// TickSubscriber is one browser WebSocket client. It owns its symbol filter and
// a buffered outbound queue so a slow tab cannot block the MT5 bridge reader.
type TickSubscriber struct {
	id      uint64
	service *Service

	mu      sync.RWMutex
	symbols map[string]struct{}

	send chan TickStreamMessage
	done chan struct{}
	once sync.Once
}

func (s *Service) RegisterTickSubscriber() *TickSubscriber {
	s.mu.Lock()
	s.nextSubscriber++
	subscriber := &TickSubscriber{
		id:      s.nextSubscriber,
		service: s,
		symbols: make(map[string]struct{}),
		send:    make(chan TickStreamMessage, tickStreamBuffer),
		done:    make(chan struct{}),
	}
	s.subscribers[subscriber.id] = subscriber
	status := TickStreamMessage{
		Type:      "status",
		Connected: s.connected,
		Source:    s.source,
		UpdatedAt: s.updatedAt,
		LastError: s.lastErr,
	}
	s.mu.Unlock()

	subscriber.enqueue(status)
	return subscriber
}

func (s *Service) unregisterTickSubscriber(id uint64) {
	s.mu.Lock()
	delete(s.subscribers, id)
	s.mu.Unlock()
}

func (s *Service) broadcastStreamStatus(message string) {
	s.mu.RLock()
	subscribers := make([]*TickSubscriber, 0, len(s.subscribers))
	status := TickStreamMessage{
		Type:      "status",
		Connected: s.connected,
		Source:    s.source,
		UpdatedAt: s.updatedAt,
		LastError: firstNonEmpty(message, s.lastErr),
	}
	for _, subscriber := range s.subscribers {
		subscribers = append(subscribers, subscriber)
	}
	s.mu.RUnlock()

	for _, subscriber := range subscribers {
		subscriber.enqueue(status)
	}
}

// broadcastUnknownMarketStatuses invalidates the browser's last known session
// state when the bridge disappears. The service cache is cleared at the same
// transition, so reconnecting cannot accidentally revive a stale open/closed
// observation before the bridge sends a fresh market_status message.
func (s *Service) broadcastUnknownMarketStatuses() {
	s.mu.RLock()
	subscribers := make([]*TickSubscriber, 0, len(s.subscribers))
	for _, subscriber := range s.subscribers {
		subscribers = append(subscribers, subscriber)
	}
	source := firstNonEmpty(s.marketStatusSource, "mt5-mql5-session")
	updatedAt := s.updatedAt
	lastErr := s.lastErr
	s.mu.RUnlock()

	for _, subscriber := range subscribers {
		symbols := subscriber.symbolSnapshot()
		if len(symbols) == 0 {
			continue
		}
		sessions := make([]MarketStatus, 0, len(symbols))
		for _, symbol := range symbols {
			status := unknownMarketStatus(symbol, "bridge_disconnected")
			status.Source = source
			sessions = append(sessions, status)
		}
		subscriber.enqueue(TickStreamMessage{
			Type:      "market_status",
			Connected: false,
			Source:    source,
			Sessions:  sessions,
			UpdatedAt: updatedAt,
			LastError: lastErr,
		})
	}
}

func (s *TickSubscriber) Messages() <-chan TickStreamMessage {
	return s.send
}

func (s *TickSubscriber) Done() <-chan struct{} {
	return s.done
}

func (s *TickSubscriber) Close() {
	s.once.Do(func() {
		s.service.unregisterTickSubscriber(s.id)
		close(s.done)
		s.service.syncBrowserStreamSymbols()
	})
}

func (s *TickSubscriber) Subscribe(symbols []string) {
	normalized := normalizeSymbols(symbols)
	if len(normalized) == 0 {
		return
	}

	s.mu.Lock()
	for _, symbol := range normalized {
		s.symbols[symbol] = struct{}{}
	}
	s.mu.Unlock()
	s.service.syncBrowserStreamSymbols()

	snapshot := s.service.ticksCached(normalized)
	marketStatus := s.service.marketStatusesCached(normalized)
	s.enqueue(TickStreamMessage{
		Type:      "snapshot",
		Connected: snapshot.Connected,
		Source:    snapshot.Source,
		Symbols:   normalized,
		Ticks:     snapshot.Ticks,
		Sessions:  marketStatus.Sessions,
		UpdatedAt: snapshot.UpdatedAt,
		LastError: firstNonEmpty(snapshot.LastError, marketStatus.LastError),
	})
}

func (s *TickSubscriber) Unsubscribe(symbols []string) {
	normalized := normalizeSymbols(symbols)
	if len(normalized) == 0 {
		return
	}

	s.mu.Lock()
	for _, symbol := range normalized {
		delete(s.symbols, symbol)
	}
	s.mu.Unlock()
	s.service.syncBrowserStreamSymbols()
}

func (s *TickSubscriber) SetSymbols(symbols []string) {
	normalized := normalizeSymbols(symbols)

	s.mu.Lock()
	s.symbols = make(map[string]struct{}, len(normalized))
	for _, symbol := range normalized {
		s.symbols[symbol] = struct{}{}
	}
	s.mu.Unlock()
	s.service.syncBrowserStreamSymbols()

	if len(normalized) == 0 {
		s.enqueue(TickStreamMessage{
			Type:    "snapshot",
			Source:  "mt5",
			Symbols: []string{},
			Ticks:   []Tick{},
		})
		return
	}

	snapshot := s.service.ticksCached(normalized)
	marketStatus := s.service.marketStatusesCached(normalized)
	s.enqueue(TickStreamMessage{
		Type:      "snapshot",
		Connected: snapshot.Connected,
		Source:    snapshot.Source,
		Symbols:   normalized,
		Ticks:     snapshot.Ticks,
		Sessions:  marketStatus.Sessions,
		UpdatedAt: snapshot.UpdatedAt,
		LastError: firstNonEmpty(snapshot.LastError, marketStatus.LastError),
	})
}

func (s *TickSubscriber) matches(symbol string) bool {
	s.mu.RLock()
	_, ok := s.symbols[symbol]
	s.mu.RUnlock()
	return ok
}

func (s *TickSubscriber) symbolSnapshot() []string {
	s.mu.RLock()
	symbols := make([]string, 0, len(s.symbols))
	for symbol := range s.symbols {
		symbols = append(symbols, symbol)
	}
	s.mu.RUnlock()
	sort.Strings(symbols)
	return symbols
}

func (s *TickSubscriber) enqueue(message TickStreamMessage) {
	select {
	case <-s.done:
		return
	default:
	}

	select {
	case s.send <- message:
		return
	default:
	}

	// Keep the newest quote flowing if the browser tab is momentarily slow.
	select {
	case <-s.send:
	default:
	}
	select {
	case s.send <- message:
	case <-s.done:
	default:
	}
}

func normalizeSymbols(symbols []string) []string {
	out := make([]string, 0, len(symbols))
	seen := make(map[string]struct{}, len(symbols))
	for _, raw := range symbols {
		symbol := normalizeSymbol(raw)
		if symbol == "" {
			continue
		}
		if _, ok := seen[symbol]; ok {
			continue
		}
		seen[symbol] = struct{}{}
		out = append(out, symbol)
	}
	return out
}
