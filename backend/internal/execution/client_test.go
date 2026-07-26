package execution

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientRejectsNonLoopbackAdminURL(t *testing.T) {
	const token = "admin-token-with-at-least-32-characters"
	for _, raw := range []string{
		"https://execution.example.com",
		"http://10.0.0.8:8791",
		"http://127.0.0.1:8791?redirect=evil",
		"http://user:pass@127.0.0.1:8791",
	} {
		if _, err := NewClient(raw, token); err == nil {
			t.Fatalf("NewClient(%q) succeeded, want error", raw)
		}
	}
}

func TestClientAcceptsLoopbackAdminURL(t *testing.T) {
	const token = "admin-token-with-at-least-32-characters"
	for _, raw := range []string{
		"http://127.0.0.1:8791",
		"http://[::1]:8791",
		"http://localhost:8791",
	} {
		if _, err := NewClient(raw, token); err != nil {
			t.Fatalf("NewClient(%q): %v", raw, err)
		}
	}
}

func TestEAVersionGateFailsClosedForMissingAndOldAgents(t *testing.T) {
	for _, value := range []string{"", "1.21", "invalid", "1.22.0.1"} {
		if eaVersionSupported(value) {
			t.Fatalf("eaVersionSupported(%q) = true, want false", value)
		}
	}
	for _, value := range []string{"1.22", "1.22.1", "1.23.0", "2.0.0"} {
		if !eaVersionSupported(value) {
			t.Fatalf("eaVersionSupported(%q) = false, want true", value)
		}
	}
}

func TestClientScopesAccountActionsAndKeepsAdminTokenServerSide(t *testing.T) {
	const token = "admin-token-with-at-least-32-characters"
	const owner = "11111111-1111-4111-8111-111111111111"
	const account = "mt5_account"
	var paths []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Header.Get("X-Execution-Admin-Token") != token {
			t.Error("missing internal admin credential")
		}
		var body struct {
			OwnerID   string `json:"ownerId"`
			AccountID string `json:"accountId"`
		}
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Errorf("decode body: %v", err)
		}
		if body.OwnerID != owner || body.AccountID != account {
			t.Errorf("unexpected action scope: %+v", body)
		}
		paths = append(paths, request.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	client, err := NewClient(server.URL, token)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	if err := client.DisconnectAccount(t.Context(), owner, account); err != nil {
		t.Fatalf("DisconnectAccount: %v", err)
	}
	if err := client.RemoveAccount(t.Context(), owner, account); err != nil {
		t.Fatalf("RemoveAccount: %v", err)
	}
	if len(paths) != 2 ||
		paths[0] != "/v1/admin/accounts/disconnect" ||
		paths[1] != "/v1/admin/accounts/remove" {
		t.Fatalf("unexpected gateway paths: %#v", paths)
	}
}

func TestClientRejectsInvalidAccountActionAcknowledgement(t *testing.T) {
	const token = "admin-token-with-at-least-32-characters"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":false}`))
	}))
	defer server.Close()
	client, err := NewClient(server.URL, token)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	if err := client.RemoveAccount(t.Context(), "owner", "account"); err == nil {
		t.Fatal("invalid acknowledgement must fail closed")
	}
}
