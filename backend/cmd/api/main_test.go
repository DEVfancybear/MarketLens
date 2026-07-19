package main

import (
	"os"
	"path/filepath"
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
			name: "production requires explicit paths",
			cfg:  config.Config{Env: "production", MT5StreamAPIEnabled: true},
			code: "MT5_VERIFIER_TERMINAL_REQUIRED",
		},
		{
			name: "production rejects a shared terminal",
			cfg: config.Config{
				Env:                   "production",
				MT5StreamAPIEnabled:   true,
				MT5TerminalPath:       marketTerminal,
				MT5VerifyTerminalPath: marketTerminal,
			},
			code: "MT5_VERIFIER_TERMINAL_NOT_ISOLATED",
		},
		{
			name: "production rejects a missing verifier terminal",
			cfg: config.Config{
				Env:                   "production",
				MT5StreamAPIEnabled:   true,
				MT5TerminalPath:       marketTerminal,
				MT5VerifyTerminalPath: filepath.Join(tempDir, "missing.exe"),
			},
			code: "MT5_VERIFIER_TERMINAL_UNAVAILABLE",
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
			code, _ := mt5VerifierConfigurationIssue(test.cfg)
			if code != test.code {
				t.Fatalf("code=%q, want %q", code, test.code)
			}
		})
	}
}
