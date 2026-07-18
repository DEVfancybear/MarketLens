package mt5stream

import (
	"encoding/json"
	"testing"
	"time"
)

func TestBridgeMarketStatusSnakeCaseFieldsAreCached(t *testing.T) {
	const payload = `{
		"type":"market_status",
		"source":"mt5",
		"statuses":[{
			"symbol":"eurusd",
			"state":"OPEN",
			"scheduled_open":true,
			"reason":"inside_trade_session",
			"session_open_at":1800000000,
			"session_close_at":1800003600,
			"next_open_at":1800600000,
			"next_transition_at":1800003600,
			"server_time":1800000100,
			"observed_at":1800000101,
			"valid_until":4000000000
		}]
	}`

	var message bridgeMarketStatusMessage
	if err := json.Unmarshal([]byte(payload), &message); err != nil {
		t.Fatalf("decode bridge message: %v", err)
	}
	service := NewService(Config{Enabled: true, BridgeURL: "ws://localhost:8765"})
	service.applyMarketStatuses(message)

	snapshot := service.MarketStatuses([]string{"eurusd", "xauusd"})
	if !snapshot.Connected || snapshot.Source != "mt5" || len(snapshot.Sessions) != 2 {
		t.Fatalf("unexpected market-status snapshot: %+v", snapshot)
	}
	status := snapshot.Sessions[0]
	if status.Symbol != "EURUSD" || status.State != "open" || !status.ScheduledOpen {
		t.Fatalf("unexpected normalized market status: %+v", status)
	}
	if status.Source != "mt5" {
		t.Fatalf("per-session source = %q, want mt5", status.Source)
	}
	if status.SessionOpenAt != 1_800_000_000 ||
		status.SessionCloseAt != 1_800_003_600 ||
		status.NextOpenAt != 1_800_600_000 ||
		status.NextTransitionAt != 1_800_003_600 ||
		status.ServerTime != 1_800_000_100 ||
		status.ObservedAt != 1_800_000_101 ||
		status.ValidUntil != 4_000_000_000 {
		t.Fatalf("snake_case timestamps were not propagated: %+v", status)
	}
	missing := snapshot.Sessions[1]
	if missing.Symbol != "XAUUSD" || missing.State != "unknown" || missing.Reason != "status_missing" {
		t.Fatalf("missing status claimed a market state: %+v", missing)
	}
}

func TestMarketStatusDoesNotOverwriteTickSourceAndRejectsOlderObservation(t *testing.T) {
	service := NewService(Config{Enabled: true, BridgeURL: "ws://localhost:8765"})
	service.source = "mt5-ticks"
	service.applyMarketStatuses(bridgeMarketStatusMessage{
		Type:   "market_status",
		Source: "mt5-mql5-session",
		Statuses: []bridgeMarketStatus{{
			Symbol:        "EURUSD",
			State:         "open",
			ScheduledOpen: true,
			ServerTime:    200,
			ObservedAt:    200,
			ValidUntil:    4_000_000_000,
		}},
	})
	service.applyMarketStatuses(bridgeMarketStatusMessage{
		Type:   "market_status",
		Source: "older-helper",
		Statuses: []bridgeMarketStatus{{
			Symbol:     "EURUSD",
			State:      "closed",
			ServerTime: 199,
			ObservedAt: 199,
			ValidUntil: 4_000_000_000,
		}},
	})

	if service.source != "mt5-ticks" {
		t.Fatalf("tick source was overwritten by market status: %q", service.source)
	}
	snapshot := service.MarketStatuses([]string{"EURUSD"})
	status := snapshot.Sessions[0]
	if snapshot.Source != "mt5-mql5-session" || status.State != "open" || status.Source != "mt5-mql5-session" {
		t.Fatalf("older status replaced the authoritative observation: %+v", status)
	}

	// A zero-clock unknown is a disconnect invalidation and must win regardless
	// of timestamp ordering.
	service.applyMarketStatuses(bridgeMarketStatusMessage{
		Type:   "market_status",
		Source: "mt5-mql5-session",
		Statuses: []bridgeMarketStatus{{
			Symbol: "EURUSD",
			State:  "unknown",
			Reason: "session_helper_unavailable",
		}},
	})
	status = service.MarketStatuses([]string{"EURUSD"}).Sessions[0]
	if status.State != "unknown" || status.ScheduledOpen {
		t.Fatalf("disconnect invalidation did not clear open state: %+v", status)
	}
}

func TestExpiredMarketStatusBecomesUnknown(t *testing.T) {
	service := NewService(Config{Enabled: true, BridgeURL: "ws://localhost:8765"})
	service.applyMarketStatuses(bridgeMarketStatusMessage{
		Type:   "market_status",
		Source: "mt5",
		Statuses: []bridgeMarketStatus{
			{
				Symbol:     "EURUSD",
				State:      "closed",
				Reason:     "outside_trade_session",
				NextOpenAt: time.Now().UTC().Unix() + 3600,
				ObservedAt: time.Now().UTC().Unix() - 60,
				ValidUntil: time.Now().UTC().Unix() - 1,
			},
		},
	})

	snapshot := service.MarketStatuses([]string{"EURUSD"})
	if len(snapshot.Sessions) != 1 {
		t.Fatalf("sessions = %d, want 1", len(snapshot.Sessions))
	}
	status := snapshot.Sessions[0]
	if status.State != "unknown" || status.Reason != "status_expired" {
		t.Fatalf("expired status was presented as current: %+v", status)
	}
}

func TestElapsedMarketTransitionBecomesUnknown(t *testing.T) {
	now := time.Now().UTC().Unix()
	service := NewService(Config{Enabled: true, BridgeURL: "ws://localhost:8765"})
	service.applyMarketStatuses(bridgeMarketStatusMessage{
		Type:   "market_status",
		Source: "mt5-mql5-session",
		Statuses: []bridgeMarketStatus{{
			Symbol:           "EURUSD",
			State:            "open",
			ScheduledOpen:    true,
			ServerTime:       now - 2,
			ObservedAt:       now - 2,
			NextTransitionAt: now - 1,
			ValidUntil:       now + 10,
		}},
	})

	status := service.MarketStatuses([]string{"EURUSD"}).Sessions[0]
	if status.State != "unknown" || status.ScheduledOpen || status.Reason != "status_transition_elapsed" {
		t.Fatalf("elapsed transition was presented as current: %+v", status)
	}
}

func TestMarketStatusStreamSnapshotsAndTransitionsAreFiltered(t *testing.T) {
	service := NewService(Config{Enabled: true, BridgeURL: "ws://localhost:8765"})
	service.applyMarketStatuses(bridgeMarketStatusMessage{
		Type:   "market_status",
		Source: "mt5",
		Statuses: []bridgeMarketStatus{
			{Symbol: "EURUSD", State: "open", ScheduledOpen: true, ValidUntil: 4_000_000_000},
			{Symbol: "XAUUSD", State: "open", ScheduledOpen: true, ValidUntil: 4_000_000_000},
		},
	})

	eurusd := service.RegisterTickSubscriber()
	xauusd := service.RegisterTickSubscriber()
	defer eurusd.Close()
	defer xauusd.Close()
	assertStreamMessageType(t, eurusd, "status")
	assertStreamMessageType(t, xauusd, "status")

	eurusd.Subscribe([]string{"eurusd"})
	xauusd.Subscribe([]string{"xauusd"})
	eurSnapshot := receiveStreamMessage(t, eurusd)
	xauSnapshot := receiveStreamMessage(t, xauusd)
	assertSingleSession(t, eurSnapshot, "snapshot", "EURUSD", "open")
	assertSingleSession(t, xauSnapshot, "snapshot", "XAUUSD", "open")

	service.applyMarketStatuses(bridgeMarketStatusMessage{
		Type:   "market_status",
		Source: "mt5",
		Statuses: []bridgeMarketStatus{
			{Symbol: "EURUSD", State: "closed", Reason: "outside_trade_session", ValidUntil: 4_000_000_000},
			{Symbol: "XAUUSD", State: "closed", Reason: "maintenance", ValidUntil: 4_000_000_000},
		},
	})

	assertSingleSession(t, receiveStreamMessage(t, eurusd), "market_status", "EURUSD", "closed")
	assertSingleSession(t, receiveStreamMessage(t, xauusd), "market_status", "XAUUSD", "closed")

	service.setDisconnected("bridge connection lost")
	assertStreamMessageType(t, eurusd, "status")
	assertStreamMessageType(t, xauusd, "status")
	eurUnknown := receiveStreamMessage(t, eurusd)
	xauUnknown := receiveStreamMessage(t, xauusd)
	assertSingleSession(t, eurUnknown, "market_status", "EURUSD", "unknown")
	assertSingleSession(t, xauUnknown, "market_status", "XAUUSD", "unknown")

	snapshot := service.MarketStatuses([]string{"EURUSD"})
	if snapshot.Connected || len(snapshot.Sessions) != 1 ||
		snapshot.Sessions[0].State != "unknown" ||
		snapshot.Sessions[0].Reason != "bridge_disconnected" {
		t.Fatalf("disconnected snapshot retained a market claim: %+v", snapshot)
	}
}

func receiveStreamMessage(t *testing.T, subscriber *TickSubscriber) TickStreamMessage {
	t.Helper()
	select {
	case message := <-subscriber.Messages():
		return message
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for MT5 stream message")
		return TickStreamMessage{}
	}
}

func assertStreamMessageType(t *testing.T, subscriber *TickSubscriber, want string) {
	t.Helper()
	message := receiveStreamMessage(t, subscriber)
	if message.Type != want {
		t.Fatalf("stream message type = %q, want %q: %+v", message.Type, want, message)
	}
}

func assertSingleSession(
	t *testing.T,
	message TickStreamMessage,
	wantType, wantSymbol, wantState string,
) {
	t.Helper()
	if message.Type != wantType || len(message.Sessions) != 1 {
		t.Fatalf("unexpected stream session message: %+v", message)
	}
	status := message.Sessions[0]
	if status.Symbol != wantSymbol || status.State != wantState {
		t.Fatalf("stream status = %+v, want symbol=%s state=%s", status, wantSymbol, wantState)
	}
}
