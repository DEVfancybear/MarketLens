package mt5stream

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestBrowserSubscriptionsReplaceBridgeDynamicSymbolSet(t *testing.T) {
	requests := make(chan map[string]any, 8)
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("upgrade websocket: %v", err)
			return
		}
		defer conn.Close()
		if err := conn.WriteJSON(SymbolCatalog{
			Type:   "symbols",
			Source: "mt5",
			Count:  2,
			Symbols: []Symbol{
				{Name: "EURUSD"},
				{Name: "XAUUSD"},
			},
		}); err != nil {
			return
		}
		for {
			var payload map[string]any
			if err := conn.ReadJSON(&payload); err != nil {
				return
			}
			requests <- payload
		}
	}))
	defer server.Close()

	service := NewService(Config{
		Enabled:     true,
		BridgeURL:   "ws" + strings.TrimPrefix(server.URL, "http"),
		DialTimeout: time.Second,
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	deadline := time.Now().Add(2 * time.Second)
	for service.Snapshot().Count != 2 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if service.Snapshot().Count != 2 {
		t.Fatal("service did not receive symbol catalog")
	}

	assertStreamSet(t, requests, []string{})
	subscriber := service.RegisterTickSubscriber()
	subscriber.SetSymbols([]string{"eurusd"})
	assertStreamSet(t, requests, []string{"EURUSD"})
	subscriber.SetSymbols([]string{"EURUSD"})
	assertNoStreamSet(t, requests)

	subscriber.SetSymbols([]string{"xauusd"})
	assertStreamSet(t, requests, []string{"XAUUSD"})

	subscriber.Close()
	assertStreamSet(t, requests, []string{})
}

func assertNoStreamSet(t *testing.T, requests <-chan map[string]any) {
	t.Helper()
	select {
	case payload := <-requests:
		t.Fatalf("unexpected duplicate stream request: %+v", payload)
	case <-time.After(100 * time.Millisecond):
	}
}

func assertStreamSet(t *testing.T, requests <-chan map[string]any, want []string) {
	t.Helper()
	select {
	case payload := <-requests:
		if payload["type"] != "stream.set" {
			t.Fatalf("message type = %v, want stream.set", payload["type"])
		}
		raw, ok := payload["symbols"].([]any)
		if !ok {
			t.Fatalf("symbols payload has type %T", payload["symbols"])
		}
		got := make([]string, 0, len(raw))
		for _, value := range raw {
			got = append(got, value.(string))
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("stream symbols = %v, want %v", got, want)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for stream.set %v", want)
	}
}
