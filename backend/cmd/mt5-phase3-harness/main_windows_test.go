//go:build windows

package main

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gofiber/fiber/v3"
)

func TestHarnessMainBuildsManagedRoutesAfterRealCredentialReadiness(t *testing.T) {
	root := t.TempDir()
	adminToken := writeHarnessSecret(t, root, "admin-token", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	identityKey := writeHarnessSecret(t, root, "identity-key", "managed-mt5-harness-identity-key-32bytes")
	authSecret := writeHarnessSecret(t, root, "auth-secret", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
	cfg := harnessConfig{
		ListenAddress:           "127.0.0.1:0",
		ExecutionAdminURL:       "http://127.0.0.1:8788",
		ExecutionAdminTokenFile: adminToken,
		MT5IdentityHMACKeyFile:  identityKey,
		AuthJWTSecretFile:       authSecret,
		Sessions: []harnessSession{
			{UserID: "11111111-1111-4111-8111-111111111111", SessionID: "22222222-2222-4222-8222-222222222222"},
			{UserID: "33333333-3333-4333-8333-333333333333", SessionID: "44444444-4444-4444-8444-444444444444"},
		},
	}
	encoded, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(root, "harness.json")
	if err := os.WriteFile(configPath, encoded, 0o600); err != nil {
		t.Fatal(err)
	}
	configFile, err := os.Open(configPath)
	if err != nil {
		t.Fatal(err)
	}
	defer configFile.Close()

	originalStdin := os.Stdin
	originalListen := harnessListen
	originalIdentity, identityWasSet := os.LookupEnv("EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE")
	t.Cleanup(func() {
		os.Stdin = originalStdin
		harnessListen = originalListen
		if identityWasSet {
			_ = os.Setenv("EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE", originalIdentity)
		} else {
			_ = os.Unsetenv("EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE")
		}
	})
	os.Stdin = configFile
	listenCalls := 0
	harnessListen = func(app *fiber.App, address string) error {
		listenCalls++
		if address != cfg.ListenAddress {
			t.Fatalf("listen address=%q", address)
		}
		health, err := app.Test(httptest.NewRequest(http.MethodGet, "/health", nil))
		if err != nil || health.StatusCode != http.StatusOK {
			t.Fatalf("health status=%v err=%v", health, err)
		}
		managed, err := app.Test(httptest.NewRequest(http.MethodPost, "/api/v1/execution/connectors/mt5/accounts", nil))
		if err != nil || managed.StatusCode == http.StatusNotFound {
			t.Fatalf("managed route status=%v err=%v", managed, err)
		}
		return nil
	}

	main()
	if listenCalls != 1 {
		t.Fatalf("listen calls=%d", listenCalls)
	}
}

func TestServeHarnessReturnsBindFailure(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	if err := serveHarness(fiber.New(), listener.Addr().String()); err == nil {
		t.Fatal("occupied listener address was accepted")
	}
}

func writeHarnessSecret(t *testing.T, root, name, value string) string {
	t.Helper()
	path := filepath.Join(root, name)
	if err := os.WriteFile(path, []byte(value), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}
