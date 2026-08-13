package mt5vault

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestVaultClientWritesOpaqueKVV2SecretAndPermanentlyDeletesVersions(t *testing.T) {
	tokenFile := filepath.Join(t.TempDir(), "vault-token")
	if err := os.WriteFile(tokenFile, []byte("test-vault-token-with-enough-entropy"), 0o600); err != nil {
		t.Fatal(err)
	}
	credential := Credential{Login: "12345678", Password: "private-value", Server: "Broker-Demo"}
	var paths []string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		paths = append(paths, request.Method+" "+request.URL.Path)
		if request.Header.Get("X-Vault-Token") != "test-vault-token-with-enough-entropy" {
			t.Fatal("vault token was not loaded from the token file")
		}
		if request.Method == http.MethodPost {
			var body struct {
				Data Credential `json:"data"`
			}
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body.Data.Password != "private-value" || body.Data.Login != "12345678" {
				t.Fatalf("unexpected vault body: %#v", body.Data)
			}
		} else if request.Method == http.MethodGet {
			response.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(response).Encode(map[string]any{
				"data": map[string]any{"data": credential},
			})
			return
		}
		response.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	client, err := NewClient(Config{
		Address: server.URL, TokenFile: tokenFile, Mount: "secret", Prefix: "marketlens/mt5",
	})
	if err != nil {
		t.Fatal(err)
	}
	ref := "mt5-0123456789abcdef0123456789abcdef"
	if err := client.Put(context.Background(), ref, credential); err != nil {
		t.Fatal(err)
	}
	loaded, err := client.Get(context.Background(), ref)
	if err != nil {
		t.Fatal(err)
	}
	if loaded != credential {
		t.Fatalf("loaded credential=%#v", loaded)
	}
	loaded.Password = ""
	if err := client.Delete(context.Background(), ref); err != nil {
		t.Fatal(err)
	}
	want := []string{
		"POST /v1/secret/data/marketlens/mt5/" + ref,
		"GET /v1/secret/data/marketlens/mt5/" + ref,
		"DELETE /v1/secret/metadata/marketlens/mt5/" + ref,
	}
	if strings.Join(paths, "|") != strings.Join(want, "|") {
		t.Fatalf("vault paths=%v want=%v", paths, want)
	}
}

func TestVaultClientFailsClosedForUnsafeConfigurationAndCredential(t *testing.T) {
	for _, address := range []string{"http://vault.example.com", "https://user@vault.example.com", "file:///tmp/vault"} {
		if _, err := NewClient(Config{Address: address, TokenFile: `C:\vault-token`, Mount: "secret", Prefix: "mt5"}); err == nil {
			t.Fatalf("unsafe address accepted: %s", address)
		}
	}
	if validCredential(Credential{Login: "12x", Password: "secret", Server: "Demo"}) {
		t.Fatal("non-numeric MT5 login accepted")
	}
	refs := map[string]struct{}{}
	for range 32 {
		ref, err := NewSecretRef()
		if err != nil || !validSecretRef(ref) {
			t.Fatalf("secret ref=%q err=%v", ref, err)
		}
		refs[ref] = struct{}{}
	}
	if len(refs) != 32 {
		t.Fatal("generated MT5 secret references collided")
	}
}
