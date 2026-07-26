package execution

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v3"
)

func TestEAProxyForwardsOnlyExplicitEARequestData(t *testing.T) {
	var receivedPath string
	var receivedAuthorization string
	var receivedCookie string
	var receivedBody string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedPath = r.URL.Path
		receivedAuthorization = r.Header.Get("Authorization")
		receivedCookie = r.Header.Get("Cookie")
		payload, _ := io.ReadAll(r.Body)
		receivedBody = string(payload)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer upstream.Close()

	proxy, err := NewEAProxy(upstream.URL)
	if err != nil {
		t.Fatalf("NewEAProxy: %v", err)
	}
	response, err := proxy.Forward(
		context.Background(),
		http.MethodPost,
		"/v1/ea/events",
		"Bearer session-token",
		[]byte(`{"events":[]}`),
	)
	if err != nil {
		t.Fatalf("Forward: %v", err)
	}
	if response.StatusCode != http.StatusAccepted || string(response.Body) != `{"ok":true}` {
		t.Fatalf("response = %#v", response)
	}
	if receivedPath != "/v1/ea/events" ||
		receivedAuthorization != "Bearer session-token" ||
		receivedCookie != "" ||
		receivedBody != `{"events":[]}` {
		t.Fatalf(
			"forwarded path=%q auth=%q cookie=%q body=%q",
			receivedPath,
			receivedAuthorization,
			receivedCookie,
			receivedBody,
		)
	}
}

func TestEAProxyRejectsUnsafeUpstreamAndOversizedBody(t *testing.T) {
	for _, raw := range []string{
		"https://127.0.0.1:8790",
		"http://example.com:8790",
		"http://user@127.0.0.1:8790",
	} {
		if _, err := NewEAProxy(raw); err == nil {
			t.Fatalf("NewEAProxy(%q) should fail", raw)
		}
	}

	proxy, err := NewEAProxy("http://127.0.0.1:8790")
	if err != nil {
		t.Fatalf("NewEAProxy: %v", err)
	}
	_, err = proxy.Forward(
		context.Background(),
		http.MethodPost,
		"/v1/ea/events",
		"",
		[]byte(strings.Repeat("x", maxEAProxyBytes+1)),
	)
	if err == nil {
		t.Fatal("oversized EA body should fail before transport")
	}
}

func TestPublicEARoutesRequireBearerAndNeverExposeAdmin(t *testing.T) {
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"connectedAccounts":999}`))
	}))
	defer upstream.Close()
	proxy, err := NewEAProxy(upstream.URL)
	if err != nil {
		t.Fatalf("NewEAProxy: %v", err)
	}
	app := fiber.New()
	(&Handler{eaProxy: proxy}).RegisterPublic(app)

	response, err := app.Test(
		httptest.NewRequest(http.MethodGet, "/execution-ea/health", nil),
	)
	if err != nil {
		t.Fatalf("health request: %v", err)
	}
	healthBody, _ := io.ReadAll(response.Body)
	if response.StatusCode != http.StatusOK ||
		!strings.Contains(string(healthBody), `"execution-ea-relay"`) ||
		strings.Contains(string(healthBody), "connectedAccounts") ||
		calls != 1 {
		t.Fatalf("health status=%d body=%q calls=%d", response.StatusCode, healthBody, calls)
	}

	request := httptest.NewRequest(
		http.MethodPost,
		"/execution-ea/v1/ea/poll",
		strings.NewReader(`{}`),
	)
	response, err = app.Test(request)
	if err != nil {
		t.Fatalf("missing bearer request: %v", err)
	}
	if response.StatusCode != http.StatusUnauthorized || calls != 1 {
		t.Fatalf("missing bearer status=%d calls=%d", response.StatusCode, calls)
	}

	request = httptest.NewRequest(
		http.MethodPost,
		"/execution-ea/v1/ea/poll",
		strings.NewReader(`{}`),
	)
	request.Header.Set("Authorization", "Bearer valid-session")
	response, err = app.Test(request)
	if err != nil {
		t.Fatalf("authorized request: %v", err)
	}
	if response.StatusCode != http.StatusOK || calls != 2 {
		t.Fatalf("authorized status=%d calls=%d", response.StatusCode, calls)
	}

	response, err = app.Test(
		httptest.NewRequest(http.MethodPost, "/execution-ea/v1/admin/orders", nil),
	)
	if err != nil {
		t.Fatalf("admin probe: %v", err)
	}
	if response.StatusCode != http.StatusNotFound || calls != 2 {
		t.Fatalf("admin probe status=%d calls=%d", response.StatusCode, calls)
	}
}
