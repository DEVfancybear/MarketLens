package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestManagedMT5IdentityKeyIsIndependentFromAdminTokenRotation(t *testing.T) {
	source := readRepositorySource(t, "internal", "execution", "handler.go")

	if strings.Contains(source, "WithMT5ConnectorVault(vaultClient, cfg.ExecutionAdminToken)") {
		t.Fatal("rotatable execution admin token still supplies the durable MT5 identity key")
	}
	if !strings.Contains(source, `ReadMT5IdentityHMACKey(os.Getenv("EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE"))`) {
		t.Fatal("connector handler does not load the dedicated stable identity key file")
	}
}

func TestManagedMT5StartupUsesCredentialManagerProbeWithoutVault(t *testing.T) {
	mainSource := readRepositorySource(t, "cmd", "api", "main.go")
	handlerSource := readRepositorySource(t, "internal", "execution", "handler.go")

	for _, forbidden := range []string{
		"internal/mt5vault",
		"MT5Vault",
		"WithMT5ConnectorVault",
		"vaultClient",
		"credential vault",
	} {
		if strings.Contains(mainSource+handlerSource, forbidden) {
			t.Fatalf("API startup still contains Vault dependency %q", forbidden)
		}
	}
	if strings.Contains(mainSource, "mt5credentials.NewStore") || strings.Contains(mainSource, "credentialStore.Probe") {
		t.Fatal("API main bypasses the tested execution-handler readiness boundary")
	}
	for _, required := range []string{
		"mt5credentials.NewStore",
		"store.Probe",
		"if storeErr != nil {",
		"WithMT5CredentialStore",
		"EnableMT5Connector",
	} {
		if !strings.Contains(handlerSource, required) {
			t.Fatalf("API startup is missing credential-store readiness step %q", required)
		}
	}
}

func readRepositorySource(t *testing.T, parts ...string) string {
	t.Helper()
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve API source test path")
	}
	pathParts := append([]string{filepath.Dir(currentFile), "..", ".."}, parts...)
	sourceBytes, err := os.ReadFile(filepath.Join(pathParts...))
	if err != nil {
		t.Fatalf("read repository source: %v", err)
	}
	return string(sourceBytes)
}
