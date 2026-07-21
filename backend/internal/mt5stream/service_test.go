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

func TestHistoryFreshnessRequiresCurrentBarAcrossAllTimeframes(t *testing.T) {
	service := NewService(Config{Enabled: true, BridgeURL: "ws://localhost:8765"})
	tickTime := time.Date(2026, time.July, 22, 12, 0, 0, 0, time.UTC).Unix()
	service.applyTick(Tick{Symbol: "NZDJPY", Timestamp: tickTime})

	for _, timeframe := range []string{"1m", "3m", "5m", "15m", "30m", "1H", "2H", "4H", "1D", "1W"} {
		t.Run(timeframe, func(t *testing.T) {
			step := timeframeSeconds(timeframe)
			if !service.historyIsFresh("NZDJPY", timeframe, []Candle{{Time: tickTime - step/2}}) {
				t.Fatalf("current %s bar should be fresh", timeframe)
			}
			if service.historyIsFresh("NZDJPY", timeframe, []Candle{{Time: tickTime - step}}) {
				t.Fatalf("previous %s bar must be stale", timeframe)
			}
		})
	}

	monthStart := time.Date(2026, time.July, 1, 0, 0, 0, 0, time.UTC)
	if !service.historyIsFresh("NZDJPY", "1M", []Candle{{Time: monthStart.Add(-2 * time.Hour).Unix()}}) {
		t.Fatal("broker-offset current monthly bar should be fresh")
	}
	if service.historyIsFresh("NZDJPY", "1M", []Candle{{Time: time.Date(2026, time.June, 1, 0, 0, 0, 0, time.UTC).Unix()}}) {
		t.Fatal("previous monthly bar must be stale")
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

func TestHistoryAroundRequestsTargetAndResolvesFirstTradableCandle(t *testing.T) {
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

	// Reproduces the UI bug: the selected date predates the first locally
	// loaded candle. HistoryAround must ask MT5 instead of clamping to that bar.
	const requestedTime int64 = 1782345600 // 2026-06-25 00:00:00 UTC
	service.applyHistory(HistoryMessage{
		Source:    "mt5",
		Symbol:    "EURUSD",
		Timeframe: "15m",
		Candles: []Candle{
			{Time: 1782608400, Open: 1.1, High: 1.2, Low: 1.0, Close: 1.15},
		},
	})

	resultDone := make(chan HistorySnapshot, 1)
	go func() {
		resultDone <- service.HistoryAround(
			context.Background(),
			"EURUSD",
			"15m",
			4,
			requestedTime,
		)
	}()

	request := <-bridge.requests
	if got := int64(request["around"].(float64)); got != requestedTime {
		t.Fatalf("around = %d, want %d", got, requestedTime)
	}
	if _, hasBefore := request["before"]; hasBefore {
		t.Fatalf("history-around request unexpectedly included before: %+v", request)
	}

	bridge.replies <- HistoryMessage{
		Type:          "history",
		Source:        "mt5",
		RequestID:     fmt.Sprint(request["id"]),
		Symbol:        "EURUSD",
		Timeframe:     "15m",
		RequestedTime: requestedTime,
		ResolvedTime:  requestedTime,
		Candles: []Candle{
			{Time: requestedTime - 900, Open: 1.0, High: 1.1, Low: 0.9, Close: 1.05},
			{Time: requestedTime, Open: 1.05, High: 1.2, Low: 1.0, Close: 1.15},
			{Time: requestedTime + 900, Open: 1.15, High: 1.25, Low: 1.1, Close: 1.2},
		},
	}

	result := <-resultDone
	if result.LastError != "" {
		t.Fatalf("unexpected history-around error: %s", result.LastError)
	}
	if result.RequestedTime != requestedTime || result.ResolvedTime != requestedTime {
		t.Fatalf("unexpected resolution: %+v", result)
	}
	if len(result.Candles) != 3 || result.Candles[1].Time != requestedTime {
		t.Fatalf("unexpected history-around candles: %+v", result.Candles)
	}
}

func TestLimitCandlesAroundDoesNotClampPastTheLoadedTail(t *testing.T) {
	candles, resolved := limitCandlesAround(
		[]Candle{{Time: 1000}, {Time: 1060}},
		10,
		2000,
	)
	if resolved != 0 || len(candles) != 0 {
		t.Fatalf("resolved=%d candles=%+v, want no resolution", resolved, candles)
	}
}

func TestHistoryRefreshesPaginatedCacheThatDoesNotReachBefore(t *testing.T) {
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

	const staleTime int64 = 1_800_000_000
	const before int64 = staleTime + 6*60*60
	service.applyHistory(HistoryMessage{
		Source:    "mt5",
		Symbol:    "EURUSD",
		Timeframe: "1m",
		Candles: []Candle{
			{Time: staleTime, Open: 1.1, High: 1.2, Low: 1.0, Close: 1.15, Volume: 10},
		},
	})

	resultDone := make(chan HistorySnapshot, 1)
	go func() {
		resultDone <- service.History(context.Background(), "EURUSD", "1m", 5000, before, false)
	}()

	var request map[string]any
	select {
	case request = <-bridge.requests:
	case <-time.After(time.Second):
		t.Fatal("stale paginated cache was returned without refreshing the bridge")
	}
	if request["symbol"] != "EURUSD" || request["timeframe"] != "1m" {
		t.Fatalf("unexpected bridge request: %+v", request)
	}
	if got := int64(request["before"].(float64)); got != before {
		t.Fatalf("before = %d, want %d", got, before)
	}

	freshTime := before - 60
	bridge.replies <- HistoryMessage{
		Type:      "history",
		Source:    "mt5",
		RequestID: fmt.Sprint(request["id"]),
		Symbol:    "EURUSD",
		Timeframe: "1m",
		Candles: []Candle{
			{Time: freshTime, Open: 1.2, High: 1.3, Low: 1.1, Close: 1.25, Volume: 20},
		},
	}

	result := <-resultDone
	if result.LastError != "" || len(result.Candles) != 1 || result.Candles[0].Time != freshTime {
		t.Fatalf("unexpected refreshed result: %+v", result)
	}
}

func TestHistoryRefreshReadsThroughCacheSynchronously(t *testing.T) {
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

	service.applyHistory(HistoryMessage{
		Source:    "mt5",
		Symbol:    "EURUSD",
		Timeframe: "15m",
		Candles: []Candle{
			{Time: 1_800_000_000, Open: 1.1, High: 1.2, Low: 1.0, Close: 1.15},
		},
	})

	resultDone := make(chan HistorySnapshot, 1)
	go func() {
		resultDone <- service.History(context.Background(), "EURUSD", "15m", 1500, 0, true)
	}()

	request := <-bridge.requests
	if request["symbol"] != "EURUSD" || request["timeframe"] != "15m" {
		t.Fatalf("unexpected refresh request: %+v", request)
	}
	if request["refresh"] != true {
		t.Fatalf("refresh flag = %v, want true", request["refresh"])
	}
	select {
	case result := <-resultDone:
		t.Fatalf("refresh returned cached data before bridge response: %+v", result)
	case <-time.After(50 * time.Millisecond):
	}

	freshTime := int64(1_800_000_900)
	hasMore := false
	fresh := false
	freshnessKnown := true
	bridge.replies <- HistoryMessage{
		Type:                "history",
		Source:              "mt5",
		RequestID:           fmt.Sprint(request["id"]),
		Symbol:              "EURUSD",
		Timeframe:           "15m",
		HasMore:             &hasMore,
		Stale:               &fresh,
		FreshnessKnown:      &freshnessKnown,
		LastBarTime:         freshTime,
		MinimumFreshBarTime: freshTime,
		Candles: []Candle{
			{Time: freshTime, Open: 1.2, High: 1.3, Low: 1.1, Close: 1.25},
		},
	}

	result := <-resultDone
	if result.LastError != "" || result.Stale || result.RefreshPending {
		t.Fatalf("unexpected refresh status: %+v", result)
	}
	if result.FreshnessKnown == nil || !*result.FreshnessKnown || result.LastBarTime != freshTime {
		t.Fatalf("missing freshness evidence: %+v", result)
	}
	if len(result.Candles) != 1 || result.Candles[0].Time != freshTime {
		t.Fatalf("refresh returned stale candles: %+v", result.Candles)
	}
	if result.HasMore == nil || *result.HasMore {
		t.Fatalf("hasMore = %v, want explicit false", result.HasMore)
	}
}

func TestHistoryRefreshRetainsCacheWhenBridgeExhaustsStaleRates(t *testing.T) {
	bridge := newHistoryBridgeHarness(t)
	service := NewService(Config{Enabled: true, BridgeURL: bridge.url, DialTimeout: time.Second})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)
	waitForServiceConnection(t, service)

	const cachedTime int64 = 1_800_000_000
	service.applyHistory(HistoryMessage{
		Source: "mt5", Symbol: "EURUSD", Timeframe: "1H",
		Candles: []Candle{{Time: cachedTime, Open: 1.1, High: 1.2, Low: 1.0, Close: 1.15}},
	})

	done := make(chan HistorySnapshot, 1)
	go func() {
		done <- service.History(context.Background(), "EURUSD", "1H", 100, 0, true)
	}()
	request := <-bridge.requests
	stale := true
	known := true
	bridge.replies <- HistoryMessage{
		Type: "history", Source: "mt5", RequestID: fmt.Sprint(request["id"]),
		Symbol: "EURUSD", Timeframe: "1H", Stale: &stale, FreshnessKnown: &known,
		LastBarTime: cachedTime, MinimumFreshBarTime: cachedTime + 3600,
		RefreshExhausted: true,
		Candles:          []Candle{{Time: cachedTime, Open: 1.1, High: 1.2, Low: 1.0, Close: 0.95}},
	}

	result := <-done
	if !result.Stale || !result.RefreshExhausted || result.LastError == "" {
		t.Fatalf("stale refresh status not preserved: %+v", result)
	}
	if len(result.Candles) != 1 || result.Candles[0].Time != cachedTime {
		t.Fatalf("cached chart window was not retained: %+v", result.Candles)
	}
	if result.Candles[0].Close != 1.15 {
		t.Fatalf("stale response regressed cached OHLC: %+v", result.Candles[0])
	}
}

func TestHistoryRefreshRetainsCacheWhenBridgeReturnsEmptyLatestWindow(t *testing.T) {
	bridge := newHistoryBridgeHarness(t)
	service := NewService(Config{Enabled: true, BridgeURL: bridge.url, DialTimeout: time.Second})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)
	waitForServiceConnection(t, service)

	const cachedTime int64 = 1_800_000_000
	service.applyHistory(HistoryMessage{
		Source: "mt5", Symbol: "GBPUSD", Timeframe: "1D",
		Candles: []Candle{{Time: cachedTime, Open: 1.2, High: 1.3, Low: 1.1, Close: 1.25}},
	})
	done := make(chan HistorySnapshot, 1)
	go func() {
		done <- service.History(context.Background(), "GBPUSD", "1D", 100, 0, true)
	}()
	request := <-bridge.requests
	stale := true
	known := true
	bridge.replies <- HistoryMessage{
		Type: "history", Source: "mt5", RequestID: fmt.Sprint(request["id"]),
		Symbol: "GBPUSD", Timeframe: "1D", Candles: []Candle{},
		Stale: &stale, FreshnessKnown: &known, RefreshExhausted: true,
	}

	result := <-done
	if len(result.Candles) != 1 || result.Candles[0].Time != cachedTime || !result.Stale {
		t.Fatalf("empty refresh replaced usable cache: %+v", result)
	}
}

func TestHistoryRefreshRejectsExplicitlyUnknownFreshness(t *testing.T) {
	bridge := newHistoryBridgeHarness(t)
	service := NewService(Config{Enabled: true, BridgeURL: bridge.url, DialTimeout: time.Second})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)
	waitForServiceConnection(t, service)

	done := make(chan HistorySnapshot, 1)
	go func() {
		done <- service.History(context.Background(), "AUDUSD", "1W", 100, 0, true)
	}()
	request := <-bridge.requests
	unknown := false
	notStale := false
	bridge.replies <- HistoryMessage{
		Type: "history", Source: "mt5", RequestID: fmt.Sprint(request["id"]),
		Symbol: "AUDUSD", Timeframe: "1W", FreshnessKnown: &unknown, Stale: &notStale,
		Candles: []Candle{{Time: 1_800_000_000, Close: 0.7}},
	}

	result := <-done
	if result.LastError == "" || result.Stale || result.RefreshExhausted {
		t.Fatalf("unknown freshness was treated as authoritative: %+v", result)
	}
	if result.FreshnessKnown == nil || *result.FreshnessKnown {
		t.Fatalf("unknown freshness evidence was lost: %+v", result)
	}
}

func TestPaginatedCacheRequiresExactLoadedCursorCoverage(t *testing.T) {
	bridge := newHistoryBridgeHarness(t)
	service := NewService(Config{Enabled: true, BridgeURL: bridge.url, DialTimeout: time.Second})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)
	waitForServiceConnection(t, service)

	// These two islands straddle the cursor but do not prove that the page
	// immediately to its left was ever loaded from MT5.
	service.applyHistory(HistoryMessage{
		Source: "mt5", Symbol: "USDCHF", Timeframe: "4H",
		Candles: []Candle{{Time: 100, Close: 0.8}, {Time: 1000, Close: 0.9}},
	})

	done := make(chan HistorySnapshot, 1)
	go func() {
		done <- service.History(context.Background(), "USDCHF", "4H", 10, 500, false)
	}()
	request := <-bridge.requests
	if got := int64(request["before"].(float64)); got != 500 {
		t.Fatalf("before = %d, want 500", got)
	}
	hasMore := false
	bridge.replies <- HistoryMessage{
		Type: "history", Source: "mt5", RequestID: fmt.Sprint(request["id"]),
		Symbol: "USDCHF", Timeframe: "4H",
		HasMore: &hasMore,
		Candles: []Candle{
			{Time: 300, Close: 0.83},
			{Time: 350, Close: 0.84},
			{Time: 400, Close: 0.85},
		},
	}
	result := <-done
	if len(result.Candles) != 3 || result.Candles[0].Time != 300 || result.HasMore == nil || *result.HasMore {
		t.Fatalf("unrelated cache island was served: %+v", result.Candles)
	}
	cached := service.History(context.Background(), "USDCHF", "4H", 10, 500, false)
	if len(cached.Candles) != 3 || cached.Candles[0].Time != 300 || cached.HasMore == nil || *cached.HasMore {
		t.Fatalf("covered cursor leaked another cache island: %+v", cached.Candles)
	}
	smaller := service.History(context.Background(), "USDCHF", "4H", 2, 500, false)
	if len(smaller.Candles) != 2 || smaller.Candles[0].Time != 350 || smaller.Candles[1].Time != 400 {
		t.Fatalf("smaller cached page returned wrong rows: %+v", smaller.Candles)
	}
	if smaller.HasMore == nil || !*smaller.HasMore {
		t.Fatalf("trimmed cached page must expose remaining rows: %+v", smaller)
	}
	select {
	case extra := <-bridge.requests:
		t.Fatalf("exact covered cursor unexpectedly reloaded: %+v", extra)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestHistoryResponseIsSortedAndDeduplicatedBeforeReturn(t *testing.T) {
	bridge := newHistoryBridgeHarness(t)
	service := NewService(Config{Enabled: true, BridgeURL: bridge.url, DialTimeout: time.Second})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)
	waitForServiceConnection(t, service)

	done := make(chan HistorySnapshot, 1)
	go func() {
		done <- service.History(context.Background(), "EURUSD", "30m", 10, 0, false)
	}()
	request := <-bridge.requests
	bridge.replies <- HistoryMessage{
		Type: "history", Source: "mt5", RequestID: fmt.Sprint(request["id"]),
		Symbol: "EURUSD", Timeframe: "30m",
		Candles: []Candle{
			{Time: 200, Close: 2.0},
			{Time: 100, Close: 1.0},
			{Time: 200, Close: 2.5},
		},
	}
	result := <-done
	if len(result.Candles) != 2 || result.Candles[0].Time != 100 || result.Candles[1].Time != 200 {
		t.Fatalf("candles not normalized: %+v", result.Candles)
	}
	if result.Candles[1].Close != 2.5 {
		t.Fatalf("last duplicate did not win: %+v", result.Candles[1])
	}
}

func TestLateCanceledHistoryResponseCannotRegressCache(t *testing.T) {
	service := NewService(Config{Enabled: true, BridgeURL: "ws://localhost:8765"})
	service.applyHistory(HistoryMessage{
		Source: "mt5", Symbol: "EURUSD", Timeframe: "15m",
		Candles: []Candle{{Time: 100, Close: 1.20}},
	})

	// The active request is still pending, so its newer value is accepted.
	service.pendingHistory["active"] = make(chan HistoryMessage, 1)
	service.applyHistory(HistoryMessage{
		RequestID: "active", Source: "mt5", Symbol: "EURUSD", Timeframe: "15m",
		Candles: []Candle{{Time: 100, Close: 1.25}},
	})

	// A canceled background request has no pending waiter anymore. Even if the
	// bridge ignores history.cancel and sends its old response, it must not win.
	service.applyHistory(HistoryMessage{
		RequestID: "canceled", Source: "mt5", Symbol: "EURUSD", Timeframe: "15m",
		Candles: []Candle{{Time: 100, Close: 1.10}},
	})

	result := service.cachedHistory("EURUSD", "15m", 10, 0)
	if len(result) != 1 || result[0].Close != 1.25 {
		t.Fatalf("late canceled response regressed cache: %+v", result)
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
