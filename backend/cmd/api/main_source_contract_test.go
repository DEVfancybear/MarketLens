package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestManagedMT5IdentityKeyIsIndependentFromAdminTokenRotation(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve API source test path")
	}
	sourceBytes, err := os.ReadFile(filepath.Join(
		filepath.Dir(currentFile), "..", "..", "internal", "execution", "handler.go",
	))
	if err != nil {
		t.Fatalf("read API main source: %v", err)
	}
	source := string(sourceBytes)

	if strings.Contains(source, "WithMT5ConnectorVault(vaultClient, cfg.ExecutionAdminToken)") {
		t.Fatal("rotatable execution admin token still supplies the durable MT5 identity key")
	}
	if !strings.Contains(source, `ReadMT5IdentityHMACKey(os.Getenv("EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE"))`) {
		t.Fatal("connector handler does not load the dedicated stable identity key file")
	}
}
