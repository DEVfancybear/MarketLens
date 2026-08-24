package execution

import (
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestManagedMT5IdentityFingerprintMatchesRustVector(t *testing.T) {
	handler := &Handler{gateway: &connectorGatewayFake{}}
	handler.WithMT5CredentialStore(
		&connectorCredentialStoreFake{},
		[]byte("stable-identity-master-key-32bytes!"),
	)

	if got := hex.EncodeToString(handler.mt5IdentityKey); got != "912be3d8b810051fc805e433bd3871e482bac7aeb354a300d346c12364fd92b0" {
		t.Fatalf("derived identity key drifted: %s", got)
	}
	if got := mt5IdentityFingerprint(handler.mt5IdentityKey, " 123456 ", " Broker-Live "); got != "208c9aa2b11247c445024ffd79624bbc89bd89b907552fdf3ba2994a3039c69d" {
		t.Fatalf("managed identity fingerprint drifted: %s", got)
	}
}

func TestManagedMT5ConnectorLoadsStableIdentityKeyFromValidatedFilePath(t *testing.T) {
	path := filepath.Join(t.TempDir(), "identity-key")
	if err := os.WriteFile(path, []byte("stable-identity-master-key-32bytes!"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE", path)
	handler := (&Handler{gateway: &connectorGatewayFake{}}).
		WithMT5CredentialStore(&connectorCredentialStoreFake{})
	if got := hex.EncodeToString(handler.mt5IdentityKey); got != "912be3d8b810051fc805e433bd3871e482bac7aeb354a300d346c12364fd92b0" {
		t.Fatalf("file-backed derived identity key drifted: %s", got)
	}
}

func TestManagedMT5ConnectorPanicsBeforeEnablingWithMissingOrAmbiguousIdentityKey(t *testing.T) {
	for _, test := range []struct {
		name    string
		secrets [][]byte
	}{
		{name: "missing file"},
		{name: "ambiguous sources", secrets: [][]byte{[]byte("a"), []byte("b")}},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE", filepath.Join(t.TempDir(), "missing"))
			defer func() {
				if recover() == nil {
					t.Fatal("unsafe connector identity configuration did not panic")
				}
			}()
			(&Handler{gateway: &connectorGatewayFake{}}).
				WithMT5CredentialStore(&connectorCredentialStoreFake{}, test.secrets...)
		})
	}
}

func TestReadMT5IdentityHMACKeyRejectsUnsafeFiles(t *testing.T) {
	root := t.TempDir()
	validPath := filepath.Join(root, "identity-key")
	if err := os.WriteFile(validPath, []byte("stable-identity-master-key-32bytes!\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	key, err := ReadMT5IdentityHMACKey(validPath)
	if err != nil {
		t.Fatalf("valid key file rejected: %v", err)
	}
	if string(key) != "stable-identity-master-key-32bytes!" {
		t.Fatal("key file whitespace handling drifted")
	}
	clear(key)

	shortPath := filepath.Join(root, "short-key")
	if err := os.WriteFile(shortPath, []byte("too-short"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadMT5IdentityHMACKey(shortPath); err == nil {
		t.Fatal("short identity key was accepted")
	}
	if _, err := ReadMT5IdentityHMACKey("relative-key"); err == nil {
		t.Fatal("relative identity key path was accepted")
	}
	if _, err := ReadMT5IdentityHMACKey(filepath.Join(root, "missing-key")); err == nil {
		t.Fatal("missing identity key was accepted")
	}
	if _, err := ReadMT5IdentityHMACKey(root); err == nil {
		t.Fatal("identity key directory was accepted as a regular file")
	}
	if _, err := readMT5IdentityHMACKey(
		validPath,
		filepath.EvalSymlinks,
		func(string) ([]byte, error) { return nil, errors.New("synthetic read failure") },
	); err == nil {
		t.Fatal("identity key read failure was ignored")
	}
	if _, err := readMT5IdentityHMACKey(
		validPath,
		func(string) (string, error) { return filepath.Join(root, "different-key"), nil },
		os.ReadFile,
	); err == nil {
		t.Fatal("identity key reached through a linked parent was accepted")
	}
}

func TestSameCanonicalPathUsesPlatformCaseRules(t *testing.T) {
	if !sameCanonicalPathForOS("windows", `C:\Keys\Identity`, `c:\keys\identity`) {
		t.Fatal("Windows canonical path comparison was not case insensitive")
	}
	if sameCanonicalPathForOS("linux", "/keys/Identity", "/keys/identity") {
		t.Fatal("non-Windows canonical path comparison ignored case")
	}
}
