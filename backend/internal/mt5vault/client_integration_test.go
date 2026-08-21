package mt5vault

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestVaultClientDisposableKVV2Lifecycle(t *testing.T) {
	if os.Getenv("MT5_VAULT_INTEGRATION") != "1" {
		t.Skip("set MT5_VAULT_INTEGRATION=1 for the disposable Vault gate")
	}
	address := os.Getenv("MT5_VAULT_ADDR")
	tokenFile := os.Getenv("MT5_VAULT_TOKEN_FILE")
	client, err := NewClient(Config{
		Address:   address,
		TokenFile: tokenFile,
		Mount:     "mt5",
		Prefix:    "marketlens/integration",
		Timeout:   5 * time.Second,
	})
	if err != nil {
		t.Fatal("create disposable Vault client:", err)
	}
	secretRef, err := NewSecretRef()
	if err != nil {
		t.Fatal("create opaque secret reference:", err)
	}
	first := Credential{Login: "12345678", Password: "disposable-first", Server: "Broker-Demo"}
	second := Credential{Login: "12345678", Password: "disposable-rotated", Server: "Broker-Demo"}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := client.Put(ctx, secretRef, first); err != nil {
		t.Fatal("write first disposable credential:", err)
	}
	loaded, err := client.Get(ctx, secretRef)
	if err != nil {
		t.Fatal("read first disposable credential:", err)
	}
	if loaded.Login != first.Login || loaded.Password != first.Password || loaded.Server != first.Server {
		loaded.Password = ""
		t.Fatal("first disposable credential did not round-trip")
	}
	loaded.Password = ""
	if err := client.Put(ctx, secretRef, second); err != nil {
		t.Fatal("rotate disposable credential:", err)
	}
	loaded, err = client.Get(ctx, secretRef)
	if err != nil {
		t.Fatal("read rotated disposable credential:", err)
	}
	if loaded.Login != second.Login || loaded.Password != second.Password || loaded.Server != second.Server {
		loaded.Password = ""
		t.Fatal("rotated disposable credential did not round-trip")
	}
	loaded.Password = ""
	if err := client.Delete(ctx, secretRef); err != nil {
		t.Fatal("permanently delete disposable credential versions:", err)
	}
	if deleted, err := client.Get(ctx, secretRef); err == nil {
		deleted.Password = ""
		t.Fatal("deleted disposable credential remained readable")
	}
}
