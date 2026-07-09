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
