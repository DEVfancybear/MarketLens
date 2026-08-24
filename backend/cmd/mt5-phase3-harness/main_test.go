package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadConfigRejectsUnknownFieldsAndNonLoopbackListen(t *testing.T) {
	unknown := `{"listenAddress":"127.0.0.1:1","unexpected":true}`
	if _, err := readConfig(strings.NewReader(unknown)); err == nil {
		t.Fatal("unknown configuration field was accepted")
	}
	nonLoopback := `{"listenAddress":"0.0.0.0:8080","executionAdminUrl":"http://127.0.0.1:1","executionAdminTokenFile":"x","vaultAddress":"http://127.0.0.1:2","vaultTokenFile":"x","authJwtSecretFile":"x","sessions":[]}`
	if _, err := readConfig(strings.NewReader(nonLoopback)); err == nil {
		t.Fatal("non-loopback listen address was accepted")
	}
}

func TestReadConfigRejectsLegacyVaultFields(t *testing.T) {
	legacy := `{"listenAddress":"127.0.0.1:1","vaultAddress":"http://127.0.0.1:2"}`
	_, err := readConfig(strings.NewReader(legacy))
	if err == nil || !strings.Contains(err.Error(), `unknown field "vaultAddress"`) {
		t.Fatalf("legacy Vault field was not rejected as unknown: %v", err)
	}
}

func TestValidateLoopbackServiceOriginFailsClosed(t *testing.T) {
	for _, value := range []string{
		"http://example.com",
		"http://user@example.com",
		"http://127.0.0.1/path",
	} {
		if err := validateLoopbackServiceOrigin(value); err == nil {
			t.Fatalf("unsafe gateway origin accepted: %q", value)
		}
	}
	if err := validateLoopbackServiceOrigin("http://127.0.0.1:8791"); err != nil {
		t.Fatalf("loopback gateway rejected: %v", err)
	}
}

func TestReadConfigAcceptsExactLoopbackServicesFilesAndSessions(t *testing.T) {
	t.Setenv("EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE", "")
	root := t.TempDir()
	secretPath := filepath.Join(root, "secret")
	if err := os.WriteFile(secretPath, []byte("synthetic-secret-value"), 0o600); err != nil {
		t.Fatal(err)
	}
	fixture := harnessConfig{
		ListenAddress:           "127.0.0.1:18787",
		ExecutionAdminURL:       "http://127.0.0.1:8791",
		ExecutionAdminTokenFile: secretPath,
		MT5IdentityHMACKeyFile:  secretPath,
		AuthJWTSecretFile:       secretPath,
		Sessions: []harnessSession{
			{UserID: "11111111-1111-4111-8111-111111111111", SessionID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},
			{UserID: "22222222-2222-4222-8222-222222222222", SessionID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"},
		},
	}
	payload, err := json.Marshal(fixture)
	if err != nil {
		t.Fatal(err)
	}
	got, err := readConfig(strings.NewReader(string(payload)))
	if err != nil {
		t.Fatalf("valid disposable harness config rejected: %v", err)
	}
	if got.MT5IdentityHMACKeyFile != secretPath || len(got.Sessions) != 2 {
		t.Fatalf("harness config drifted: %#v", got)
	}
	if _, err := readConfigWithEnvironment(
		strings.NewReader(string(payload)),
		func(string, string) error { return errors.New("synthetic environment failure") },
	); err == nil {
		t.Fatal("identity key path environment registration failure was ignored")
	}
}
