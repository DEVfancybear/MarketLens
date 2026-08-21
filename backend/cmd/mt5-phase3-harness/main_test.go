package main

import (
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

func TestValidateServiceOriginFailsClosed(t *testing.T) {
	for _, value := range []string{
		"http://example.com",
		"http://user@example.com",
		"http://127.0.0.1/path",
	} {
		if err := validateServiceOrigin(value, true); err == nil {
			t.Fatalf("unsafe gateway origin accepted: %q", value)
		}
	}
	if err := validateServiceOrigin("http://127.0.0.1:8791", true); err != nil {
		t.Fatalf("loopback gateway rejected: %v", err)
	}
	if err := validateServiceOrigin("https://vault.example.com", false); err != nil {
		t.Fatalf("HTTPS Vault rejected: %v", err)
	}
}
