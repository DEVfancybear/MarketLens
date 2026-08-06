package execution

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
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

func TestClientForwardsOrderAuthorizationContext(t *testing.T) {
	const token = "admin-token-with-at-least-32-characters"
	const owner = "11111111-1111-4111-8111-111111111111"
	const authorization = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ"
	const session = "22222222-2222-4222-8222-222222222222"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/admin/orders" {
			t.Errorf("unexpected gateway path: %s", request.URL.Path)
		}
		var body struct {
			OwnerID                string          `json:"ownerId"`
			Intent                 json.RawMessage `json:"intent"`
			Targets                json.RawMessage `json:"targets"`
			AuthorizationToken     string          `json:"authorizationToken"`
			AuthorizationSessionID string          `json:"authorizationSessionId"`
		}
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if body.OwnerID != owner ||
			body.AuthorizationToken != authorization ||
			body.AuthorizationSessionID != session {
			t.Errorf("unexpected order authorization context: %+v", body)
		}
		if string(body.Intent) != `{"commandId":"exec_cmd"}` ||
			string(body.Targets) != `[{"accountId":"mt5_account"}]` {
			t.Errorf("unexpected order payload: intent=%s targets=%s", body.Intent, body.Targets)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"commandId":"exec_cmd","targets":[]}`))
	}))
	defer server.Close()

	client, err := NewClient(server.URL, token)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	_, err = client.RouteOrder(t.Context(), owner, OrderRequest{
		Intent:                 json.RawMessage(`{"commandId":"exec_cmd"}`),
		Targets:                json.RawMessage(`[{"accountId":"mt5_account"}]`),
		AuthorizationToken:     authorization,
		AuthorizationSessionID: session,
	})
	if err != nil {
		t.Fatalf("RouteOrder: %v", err)
	}
}

func TestClientForwardsCommandAuthorizationContext(t *testing.T) {
	const token = "admin-token-with-at-least-32-characters"
	const owner = "11111111-1111-4111-8111-111111111111"
	const authorization = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ"
	const session = "22222222-2222-4222-8222-222222222222"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/admin/commands" {
			t.Errorf("unexpected gateway path: %s", request.URL.Path)
		}
		var body struct {
			OwnerID                string          `json:"ownerId"`
			Command                json.RawMessage `json:"command"`
			AuthorizationToken     string          `json:"authorizationToken"`
			AuthorizationSessionID string          `json:"authorizationSessionId"`
		}
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if body.OwnerID != owner ||
			body.AuthorizationToken != authorization ||
			body.AuthorizationSessionID != session {
			t.Errorf("unexpected command authorization context: %+v", body)
		}
		if string(body.Command) != `{"type":"cancelOrder"}` {
			t.Errorf("unexpected command payload: %s", body.Command)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	client, err := NewClient(server.URL, token)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	_, err = client.QueueCommand(t.Context(), owner, CommandRequest{
		Command:                json.RawMessage(`{"type":"cancelOrder"}`),
		AuthorizationToken:     authorization,
		AuthorizationSessionID: session,
	})
	if err != nil {
		t.Fatalf("QueueCommand: %v", err)
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

func TestClientForwardsCopyGroupOwnerServerSide(t *testing.T) {
	const token = "admin-token-with-at-least-32-characters"
	const owner = "owner-1"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/admin/copy-groups" || request.URL.Query().Get("ownerId") != owner {
			t.Errorf("unexpected list request: %s?%s", request.URL.Path, request.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[]`))
	}))
	defer server.Close()
	client, err := NewClient(server.URL, token)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	if _, err := client.ListCopyGroups(t.Context(), owner, "group-1"); err != nil {
		t.Fatalf("ListCopyGroups: %v", err)
	}
}

func TestClientForwardsCopyGroupAuthorizationWithoutChangingApprovedPayload(t *testing.T) {
	const token = "admin-token-with-at-least-32-characters"
	const owner = "11111111-1111-4111-8111-111111111111"
	const authorization = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ"
	const session = "22222222-2222-4222-8222-222222222222"

	upsertJSON := copyGroupRequestBody(true, true)
	var expectedUpsert map[string]any
	if err := json.Unmarshal([]byte(upsertJSON), &expectedUpsert); err != nil {
		t.Fatalf("decode expected upsert: %v", err)
	}
	expectedAction := map[string]any{
		"groupId":          testCopyGroupID,
		"expectedRevision": float64(7),
		"action":           CopyGroupActionResume,
	}
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		requests++
		if request.Header.Get("X-Execution-Admin-Token") != token {
			t.Error("missing internal admin credential")
		}
		var forwarded map[string]any
		if err := json.NewDecoder(request.Body).Decode(&forwarded); err != nil {
			t.Errorf("decode copier request: %v", err)
			return
		}
		if forwarded["ownerId"] != owner ||
			forwarded["authorizationToken"] != authorization ||
			forwarded["authorizationSessionId"] != session {
			t.Errorf("unexpected copier authorization context: %#v", forwarded)
		}
		delete(forwarded, "ownerId")
		delete(forwarded, "authorizationToken")
		delete(forwarded, "authorizationSessionId")
		switch request.URL.Path {
		case "/v1/admin/copy-groups":
			if !reflect.DeepEqual(forwarded, expectedUpsert) {
				t.Errorf("forwarded upsert changed approved payload:\n got %#v\nwant %#v", forwarded, expectedUpsert)
			}
		case "/v1/admin/copy-groups/actions":
			if !reflect.DeepEqual(forwarded, expectedAction) {
				t.Errorf("forwarded action changed approved payload:\n got %#v\nwant %#v", forwarded, expectedAction)
			}
		default:
			t.Errorf("unexpected copier gateway path: %s", request.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"group":{"id":"` + testCopyGroupID + `"},"targets":[]}`))
	}))
	defer server.Close()

	client, err := NewClient(server.URL, token)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	var upsert CopyGroupUpsertRequest
	if err = json.Unmarshal([]byte(upsertJSON), &upsert); err != nil {
		t.Fatalf("decode upsert request: %v", err)
	}
	upsert.AuthorizationToken = authorization
	upsert.AuthorizationSessionID = session
	if _, err = client.UpsertCopyGroup(t.Context(), owner, upsert); err != nil {
		t.Fatalf("UpsertCopyGroup: %v", err)
	}
	if _, err = client.ApplyCopyGroupAction(t.Context(), owner, CopyGroupActionRequest{
		GroupID:                testCopyGroupID,
		ExpectedRevision:       7,
		Action:                 CopyGroupActionResume,
		AuthorizationToken:     authorization,
		AuthorizationSessionID: session,
	}); err != nil {
		t.Fatalf("ApplyCopyGroupAction: %v", err)
	}
	if requests != 2 {
		t.Fatalf("copier gateway requests=%d, want 2", requests)
	}
}
