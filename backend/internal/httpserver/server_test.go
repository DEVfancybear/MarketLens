package httpserver

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/smc-trading-terminal/backend/internal/config"
)

func TestServerCredentialedCORS(t *testing.T) {
	const allowedOrigin = "https://app.example.com"

	server := newMinimalServer(config.Config{CORSAllowedOrigins: []string{allowedOrigin}})

	tests := []struct {
		name       string
		origin     string
		wantOrigin string
	}{
		{name: "allowed origin", origin: allowedOrigin, wantOrigin: allowedOrigin},
		{name: "disallowed origin", origin: "https://evil.example"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodOptions, "/api/v1/chart/time-navigation/shortcuts", nil)
			request.Header.Set(fiber.HeaderOrigin, test.origin)
			request.Header.Set(fiber.HeaderAccessControlRequestMethod, http.MethodGet)
			request.Header.Set(fiber.HeaderAccessControlRequestHeaders, fiber.HeaderAuthorization)

			response, err := server.app.Test(request)
			if err != nil {
				t.Fatalf("preflight request: %v", err)
			}
			defer response.Body.Close()

			if response.StatusCode != http.StatusNoContent {
				t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusNoContent)
			}
			if got := response.Header.Get(fiber.HeaderAccessControlAllowOrigin); got != test.wantOrigin {
				t.Fatalf("allow origin = %q, want %q", got, test.wantOrigin)
			}
			if test.wantOrigin != "" {
				if got := response.Header.Get(fiber.HeaderAccessControlAllowCredentials); got != "true" {
					t.Fatalf("allow credentials = %q, want true", got)
				}
				if got := response.Header.Get(fiber.HeaderAccessControlAllowMethods); got == "" {
					t.Fatal("allow methods header is empty")
				}
				if got := response.Header.Get(fiber.HeaderAccessControlAllowHeaders); got == "" {
					t.Fatal("allow headers header is empty")
				}
			}
		})
	}
}

func TestServerStartStopsWithGracefulContext(t *testing.T) {
	server := newMinimalServer(config.Config{
		CORSAllowedOrigins: []string{"https://app.example.com"},
	})
	started := make(chan string, 1)
	server.app.Hooks().OnListen(func(data fiber.ListenData) error {
		started <- data.Port
		return nil
	})

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	errCh := make(chan error, 1)
	go func() {
		errCh <- server.Start(ctx)
	}()

	var port string
	select {
	case port = <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("server did not start listening")
	}

	client := &http.Client{Timeout: 500 * time.Millisecond}
	readyDeadline := time.Now().Add(5 * time.Second)
	for {
		request, err := http.NewRequest(http.MethodGet, "http://127.0.0.1:"+port+"/health", nil)
		if err != nil {
			t.Fatalf("create readiness request: %v", err)
		}
		request.Close = true
		response, err := client.Do(request)
		if err == nil {
			response.Body.Close()
			break
		}
		if time.Now().After(readyDeadline) {
			t.Fatalf("server did not become ready: %v", err)
		}
		time.Sleep(10 * time.Millisecond)
	}

	cancel()
	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("graceful shutdown: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("server did not stop after context cancellation")
	}
}

func newMinimalServer(cfg config.Config) *Server {
	return New(
		cfg,
		nil, // database pool
		nil, // auth
		nil, // settings
		nil, // watchlists
		nil, // drawings
		nil, // indicators
		nil, // Pine scripts
		nil, // alerts
		nil, // layouts
		nil, // workspace
		nil, // journal
		nil, // simulated trading
		nil, // execution
		nil, // replay
		nil, // MT5 stream
		nil, // Pine runtime
	)
}
