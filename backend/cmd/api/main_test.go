package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/smc-trading-terminal/backend/internal/config"
)

func TestMT5VerifierConfigurationRequiresAnIsolatedProductionTerminal(t *testing.T) {
	tempDir := t.TempDir()
	marketTerminal := filepath.Join(tempDir, "market", "terminal64.exe")
	verifierTerminal := filepath.Join(tempDir, "verifier", "terminal64.exe")
	for _, path := range []string{marketTerminal, verifierTerminal} {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("test"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	tests := []struct {
		name string
		cfg  config.Config
		code string
	}{
		{
			name: "development permits auto detection",
			cfg:  config.Config{Env: "development", MT5StreamAPIEnabled: true},
		},
		{
			name: "production without market data permits auto detection",
			cfg:  config.Config{Env: "production", MT5StreamAPIEnabled: false},
		},
		{
			name: "production requires resolved paths",
			cfg:  config.Config{Env: "production", MT5StreamAPIEnabled: true},
			code: "MT5_VERIFIER_UNAVAILABLE",
		},
		{
			name: "production rejects a shared terminal",
			cfg: config.Config{
				Env:                   "production",
				MT5StreamAPIEnabled:   true,
				MT5TerminalPath:       marketTerminal,
				MT5VerifyTerminalPath: marketTerminal,
			},
			code: "MT5_VERIFIER_UNAVAILABLE",
		},
		{
			name: "production rejects a missing verifier terminal",
			cfg: config.Config{
				Env:                   "production",
				MT5StreamAPIEnabled:   true,
				MT5TerminalPath:       marketTerminal,
				MT5VerifyTerminalPath: filepath.Join(tempDir, "missing.exe"),
			},
			code: "MT5_VERIFIER_UNAVAILABLE",
		},
		{
			name: "production accepts distinct terminal installations",
			cfg: config.Config{
				Env:                   "production",
				MT5StreamAPIEnabled:   true,
				MT5TerminalPath:       marketTerminal,
				MT5VerifyTerminalPath: verifierTerminal,
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			code, message := mt5VerifierConfigurationIssue(test.cfg)
			if code != test.code {
				t.Fatalf("code=%q, want %q", code, test.code)
			}
			if code != "" && message != mt5VerifierUnavailableMessage {
				t.Fatalf("message=%q, want generic unavailable message", message)
			}
			for _, forbidden := range []string{"MT5_VERIFY", "MT5_TERMINAL", "terminal64.exe", ".env"} {
				if code != "" && strings.Contains(message, forbidden) {
					t.Fatalf("message leaks operator detail %q: %q", forbidden, message)
				}
			}
		})
	}
}
