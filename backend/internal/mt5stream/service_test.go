package mt5stream

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type historyBridgeHarness struct {
	server   *httptest.Server
	url      string
	requests chan map[string]any
	replies  chan HistoryMessage
}

func TestTicksSinceReturnsOrderedRetainedTicks(t *testing.T) {
	service := NewService(Config{Enabled: true, BridgeURL: "ws://localhost:8765"})
	service.applyTick(Tick{Symbol: "EURUSD", Bid: 1.14380, Ask: 1.14382, TimeMSC: 9000, ReceivedAt: 1000})
	service.applyTick(Tick{Symbol: "EURUSD", Bid: 1.14393, Ask: 1.14395, TimeMSC: 7000, ReceivedAt: 3000})
	service.applyTick(Tick{Symbol: "EURUSD", Bid: 1.14388, Ask: 1.14390, TimeMSC: 8000, ReceivedAt: 2000})

	snapshot := service.TicksSince([]string{"EURUSD"}, 1000)
	if len(snapshot.Ticks) != 2 {
		t.Fatalf("ticks since = %d, want 2", len(snapshot.Ticks))
	}
	if snapshot.Ticks[0].ReceivedAt != 2000 || snapshot.Ticks[1].ReceivedAt != 3000 {
		t.Fatalf("ticks not ordered: %+v", snapshot.Ticks)
	}
}

func TestHistoryFreshnessUsesCalendarWindows(t *testing.T) {
	service := NewService(Config{Enabled: true, BridgeURL: "ws://localhost:8765"})
	tickTime := int64(1_800_000_000)
	service.applyTick(Tick{Symbol: "NZDJPY", Timestamp: tickTime})

	if !service.historyIsFresh("NZDJPY", "1M", []Candle{{Time: tickTime - (40 * 86400)}}) {
		t.Fatal("40-day-old monthly bar should be accepted as current/previous calendar month")
	}
	if service.historyIsFresh("NZDJPY", "1M", []Candle{{Time: tickTime - (70 * 86400)}}) {
		t.Fatal("70-day-old monthly bar should be stale")
	}
	if !service.historyIsFresh("NZDJPY", "1W", []Candle{{Time: tickTime - (10 * 86400)}}) {
		t.Fatal("10-day-old weekly bar should be accepted as current/previous calendar week")
	}
}

func newHistoryBridgeHarness(t *testing.T) *historyBridgeHarness {
	t.Helper()

	h := &historyBridgeHarness{
		requests: make(chan map[string]any, 8),
		replies:  make(chan HistoryMessage, 8),
	}
	upgrader := websocket.Upgrader{}
	h.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("upgrade websocket: %v", err)
			return
		}
		defer conn.Close()

		for {
			var payload map[string]any
			if err := conn.ReadJSON(&payload); err != nil {
				return
			}
			h.requests <- payload

			reply := <-h.replies
			if reply.RequestID == "" {
				reply.RequestID = fmt.Sprint(payload["id"])
			}
			if reply.Symbol == "" {
				reply.Symbol = fmt.Sprint(payload["symbol"])
			}
			if reply.Timeframe == "" {
				reply.Timeframe = fmt.Sprint(payload["timeframe"])
			}
			if reply.Type == "" {
				reply.Type = "history"
			}
			if err := conn.WriteJSON(reply); err != nil {
				return
			}
		}
	}))
	h.url = "ws" + strings.TrimPrefix(h.server.URL, "http")
	t.Cleanup(h.server.Close)
	return h
}

func waitForServiceConnection(t *testing.T, service *Service) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if service.Snapshot().Connected {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("service did not connect to bridge")
}

func TestHistoryRequestsAreCoalesced(t *testing.T) {
	bridge := newHistoryBridgeHarness(t)
	service := NewService(Config{
		Enabled:     true,
		BridgeURL:   bridge.url,
		DialTimeout: time.Second,
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)
	waitForServiceConnection(t, service)

	var wg sync.WaitGroup
	results := make(chan HistorySnapshot, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- service.History(context.Background(), "EURUSD", "15m", 10, 0, false)
		}()
	}

	request := <-bridge.requests
	if request["symbol"] != "EURUSD" || request["timeframe"] != "15m" {
		t.Fatalf("unexpected bridge request: %+v", request)
	}
	select {
	case extra := <-bridge.requests:
		t.Fatalf("coalesced request sent twice: %+v", extra)
	case <-time.After(100 * time.Millisecond):
	}

	bridge.replies <- HistoryMessage{
		Type:      "history",
		Source:    "mt5",
		RequestID: fmt.Sprint(request["id"]),
		Symbol:    "EURUSD",
		Timeframe: "15m",
		Candles: []Candle{
			{Time: 1800000000, Open: 1.1, High: 1.2, Low: 1.0, Close: 1.15, Volume: 10},
		},
	}
	wg.Wait()
	close(results)

	for result := range results {
		if result.LastError != "" || len(result.Candles) != 1 || result.Candles[0].Close != 1.15 {
			t.Fatalf("unexpected coalesced result: %+v", result)
		}
	}
	select {
	case extra := <-bridge.requests:
		t.Fatalf("unexpected second bridge request after completion: %+v", extra)
	case <-time.After(100 * time.Millisecond):
	}
}

func TestCanceledCoalescedWaiterDoesNotCancelActiveWaiter(t *testing.T) {
	bridge := newHistoryBridgeHarness(t)
	service := NewService(Config{
		Enabled:     true,
		BridgeURL:   bridge.url,
		DialTimeout: time.Second,
	})
	serviceCtx, stopService := context.WithCancel(context.Background())
	defer stopService()
	service.Start(serviceCtx)
	waitForServiceConnection(t, service)

	firstCtx, cancelFirst := context.WithCancel(context.Background())
	firstDone := make(chan HistorySnapshot, 1)
	secondDone := make(chan HistorySnapshot, 1)
	go func() {
		firstDone <- service.History(firstCtx, "NZDJPY", "4H", 400, 0, false)
	}()
	go func() {
		secondDone <- service.History(context.Background(), "NZDJPY", "4H", 400, 0, false)
	}()

	request := <-bridge.requests
	cancelFirst()
	firstResult := <-firstDone
	if firstResult.LastError == "" {
		t.Fatalf("expected canceled waiter error, got %+v", firstResult)
	}

	select {
	case result := <-secondDone:
		t.Fatalf("active waiter completed before bridge response: %+v", result)
	case <-time.After(50 * time.Millisecond):
	}

	bridge.replies <- HistoryMessage{
		Type:      "history",
		Source:    "mt5",
		RequestID: fmt.Sprint(request["id"]),
		Symbol:    "NZDJPY",
		Timeframe: "4H",
		Candles: []Candle{
			{Time: 1800000000, Open: 93.1, High: 93.2, Low: 93.0, Close: 93.15, Volume: 10},
		},
	}
	secondResult := <-secondDone
	if secondResult.LastError != "" || len(secondResult.Candles) != 1 {
		t.Fatalf("unexpected active waiter result: %+v", secondResult)
	}

	select {
	case extra := <-bridge.requests:
		t.Fatalf("coalesced request sent more than once: %+v", extra)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestCanceledQueuedHistoryRequestIsNotSentToBridge(t *testing.T) {
	bridge := newHistoryBridgeHarness(t)
	service := NewService(Config{
		Enabled:     true,
		BridgeURL:   bridge.url,
		DialTimeout: time.Second,
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)
	waitForServiceConnection(t, service)

	firstDone := make(chan HistorySnapshot, 1)
	go func() {
		firstDone <- service.History(context.Background(), "EURUSD", "15m", 10, 0, false)
	}()

	firstRequest := <-bridge.requests
	if firstRequest["symbol"] != "EURUSD" {
		t.Fatalf("unexpected first request: %+v", firstRequest)
	}

	secondCtx, cancelSecond := context.WithCancel(context.Background())
	secondDone := make(chan HistorySnapshot, 1)
	go func() {
		secondDone <- service.History(secondCtx, "GBPUSD", "15m", 10, 0, false)
	}()
	time.Sleep(50 * time.Millisecond)
	cancelSecond()

	secondResult := <-secondDone
	if secondResult.LastError == "" {
		t.Fatalf("expected canceled second request error, got %+v", secondResult)
	}

	select {
	case extra := <-bridge.requests:
		t.Fatalf("canceled queued request reached bridge: %+v", extra)
	case <-time.After(100 * time.Millisecond):
	}

	bridge.replies <- HistoryMessage{
		Type:      "history",
		Source:    "mt5",
		RequestID: fmt.Sprint(firstRequest["id"]),
		Symbol:    "EURUSD",
		Timeframe: "15m",
		Candles: []Candle{
			{Time: 1800000000, Open: 1.1, High: 1.2, Low: 1.0, Close: 1.15, Volume: 10},
		},
	}
	firstResult := <-firstDone
	if firstResult.LastError != "" || len(firstResult.Candles) != 1 {
		t.Fatalf("unexpected first result: %+v", firstResult)
	}

	select {
	case extra := <-bridge.requests:
		t.Fatalf("canceled request was sent after first completed: %+v", extra)
	case <-time.After(100 * time.Millisecond):
	}
}
