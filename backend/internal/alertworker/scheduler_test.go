package alertworker

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRunOncePostsWorkerSecret(t *testing.T) {
	var method, secret string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		method = r.Method
		secret = r.Header.Get("x-push-worker-secret")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	s := New(Config{Enabled: true, URL: server.URL, Secret: "shared-secret", Timeout: time.Second})
	if err := s.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if method != http.MethodPost || secret != "shared-secret" {
		t.Fatalf("method=%s secret=%q", method, secret)
	}
}

func TestRunOnceRejectsNonSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusUnauthorized) }))
	defer server.Close()
	if err := New(Config{URL: server.URL}).RunOnce(context.Background()); err == nil {
		t.Fatal("expected HTTP error")
	}
}
