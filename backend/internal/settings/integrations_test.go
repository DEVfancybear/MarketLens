package settings

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

type fakeIntegrationStore struct{ row IntegrationRecord }

func (f *fakeIntegrationStore) Get(context.Context, string) (IntegrationRecord, error) {
	return f.row, nil
}
func (f *fakeIntegrationStore) Put(_ context.Context, _ string, row IntegrationRecord) (IntegrationRecord, error) {
	f.row = row
	return row, nil
}

func TestSecretBoxRoundTrip(t *testing.T) {
	box, err := NewSecretBox("test-secret")
	if err != nil {
		t.Fatal(err)
	}
	ciphertext, err := box.Seal("private-value")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(ciphertext), "private-value") {
		t.Fatal("ciphertext contains plaintext")
	}
	plain, err := box.Open(ciphertext)
	if err != nil || plain != "private-value" {
		t.Fatalf("round trip=%q err=%v", plain, err)
	}
	token := box.IssueDeliveryToken("user-1")
	uid, err := box.VerifyDeliveryToken(token)
	if err != nil || uid != "user-1" {
		t.Fatalf("delivery token uid=%q err=%v", uid, err)
	}
	if _, err := box.VerifyDeliveryToken(token + "x"); err == nil {
		t.Fatal("tampered delivery token accepted")
	}
}

func TestIntegrationHandlerMasksAndPreservesSecrets(t *testing.T) {
	box, _ := NewSecretBox("test-secret")
	store := &fakeIntegrationStore{}
	app := fiber.New()
	NewHandler(newFakeSettingsStore(), fakeRequireAuth).WithIntegrations(store, box, "worker-secret").Register(app.Group("/api/v1"))
	req := httptest.NewRequest(http.MethodPut, "/api/v1/settings/integrations", strings.NewReader(`{"mt5":{"login":"123","server":"Demo","password":"mt5-secret"},"telegram":{"chatId":"42","botToken":"bot-secret","enabled":true},"discord":{"webhookUrl":"https://discord.com/api/webhooks/1/token","enabled":true}}`))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("put status=%d err=%v", resp.StatusCode, err)
	}
	var view IntegrationView
	if err := json.NewDecoder(resp.Body).Decode(&view); err != nil {
		t.Fatal(err)
	}
	if view.MT5.Login != "123" || !view.MT5.PasswordConfigured || !view.Telegram.BotTokenConfigured || !view.Discord.WebhookConfigured {
		t.Fatalf("bad view: %+v", view)
	}
	if len(store.row.MT5Password) == 0 || string(store.row.MT5Password) == "mt5-secret" {
		t.Fatal("MT5 password was not encrypted")
	}
	req = httptest.NewRequest(http.MethodPut, "/api/v1/settings/integrations", strings.NewReader(`{"mt5":{"login":"456","server":"Demo"},"telegram":{"chatId":"42","enabled":true},"discord":{"enabled":true}}`))
	req.Header.Set("Content-Type", "application/json")
	resp, err = app.Test(req)
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("second put status=%d err=%v", resp.StatusCode, err)
	}
	plain, _ := box.Open(store.row.MT5Password)
	if plain != "mt5-secret" {
		t.Fatalf("blank secret should preserve existing, got %q", plain)
	}
}

func TestWorkerDeliveryRequiresServiceSecretAndSignedUser(t *testing.T) {
	box, _ := NewSecretBox("test-secret")
	store := &fakeIntegrationStore{}
	app := fiber.New()
	NewHandler(newFakeSettingsStore(), fakeRequireAuth).WithIntegrations(store, box, "worker-secret").Register(app.Group("/api/v1"))
	body := fmt.Sprintf(`{"deliveryToken":%q,"message":{"symbol":"EURUSD","condition":"above","targetPrice":1,"triggerPrice":1.1,"triggeredAt":1},"channels":{}}`, box.IssueDeliveryToken("user-1"))
	request := httptest.NewRequest(http.MethodPost, "/api/v1/settings/integrations/worker-deliver", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	resp, _ := app.Test(request)
	if resp.StatusCode != 401 {
		t.Fatalf("missing service secret status=%d", resp.StatusCode)
	}
	request = httptest.NewRequest(http.MethodPost, "/api/v1/settings/integrations/worker-deliver", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("x-push-worker-secret", "worker-secret")
	resp, _ = app.Test(request)
	if resp.StatusCode != 200 {
		t.Fatalf("authorized worker status=%d", resp.StatusCode)
	}
}
