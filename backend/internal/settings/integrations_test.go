package settings

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
)

type fakeIntegrationStore struct {
	row        IntegrationRecord
	rows       map[string]IntegrationRecord
	getUserIDs []string
	putUserIDs []string
}

func (f *fakeIntegrationStore) Get(_ context.Context, userID string) (IntegrationRecord, error) {
	f.getUserIDs = append(f.getUserIDs, userID)
	if f.rows != nil {
		return f.rows[userID], nil
	}
	return f.row, nil
}

func (f *fakeIntegrationStore) Put(_ context.Context, userID string, row IntegrationRecord) (IntegrationRecord, error) {
	f.putUserIDs = append(f.putUserIDs, userID)
	f.row = row
	if f.rows != nil {
		f.rows[userID] = row
	}
	return row, nil
}

func integrationTestApp(store IntegrationStore, box *SecretBox) *fiber.App {
	app := fiber.New()
	NewHandler(newFakeSettingsStore(), fakeRequireAuth).
		WithIntegrations(store, box, "worker-secret").
		Register(app.Group("/api/v1"))
	return app
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

func TestIntegrationHandlerMasksAndPreservesNotificationSecrets(t *testing.T) {
	box, _ := NewSecretBox("test-secret")
	store := &fakeIntegrationStore{}
	app := integrationTestApp(store, box)
	req := httptest.NewRequest(
		http.MethodPut,
		"/api/v1/settings/integrations",
		strings.NewReader(`{"telegram":{"chatId":"42","botToken":"123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef","enabled":true},"discord":{"webhookUrl":"https://discord.com/api/webhooks/1/token","enabled":true}}`),
	)
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("put status=%d err=%v", resp.StatusCode, err)
	}
	var view IntegrationView
	if err := json.NewDecoder(resp.Body).Decode(&view); err != nil {
		t.Fatal(err)
	}
	if !view.Telegram.BotTokenConfigured || !view.Discord.WebhookConfigured {
		t.Fatalf("bad view: %+v", view)
	}
	if len(store.row.TelegramBotToken) == 0 ||
		string(store.row.TelegramBotToken) == "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef" {
		t.Fatal("Telegram secret was not encrypted")
	}
	if len(store.row.DiscordWebhook) == 0 ||
		string(store.row.DiscordWebhook) == "https://discord.com/api/webhooks/1/token" {
		t.Fatal("Discord secret was not encrypted")
	}

	req = httptest.NewRequest(
		http.MethodPut,
		"/api/v1/settings/integrations",
		strings.NewReader(`{"telegram":{"chatId":"42","enabled":true},"discord":{"enabled":true}}`),
	)
	req.Header.Set("Content-Type", "application/json")
	resp, err = app.Test(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("second put status=%d err=%v", resp.StatusCode, err)
	}
	telegram, _ := box.Open(store.row.TelegramBotToken)
	discord, _ := box.Open(store.row.DiscordWebhook)
	if telegram == "" || discord == "" {
		t.Fatal("blank secret fields should preserve configured notification secrets")
	}
}

func TestIntegrationHandlerRejectsRemovedMT5CredentialShape(t *testing.T) {
	box, _ := NewSecretBox("test-secret")
	app := integrationTestApp(&fakeIntegrationStore{}, box)
	req := httptest.NewRequest(
		http.MethodPut,
		"/api/v1/settings/integrations",
		strings.NewReader(`{"mt5":{"login":"123","server":"Demo","password":"must-not-be-stored"}}`),
	)
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil || resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("legacy MT5 credential body status=%d err=%v", resp.StatusCode, err)
	}
}

func TestIntegrationHandlerRejectsTelegramTokenInChatID(t *testing.T) {
	box, _ := NewSecretBox("test-secret")
	app := integrationTestApp(&fakeIntegrationStore{}, box)
	req := httptest.NewRequest(
		http.MethodPut,
		"/api/v1/settings/integrations",
		strings.NewReader(`{"telegram":{"chatId":"123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef","botToken":"123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef","enabled":true}}`),
	)
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil || resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("put status=%d err=%v", resp.StatusCode, err)
	}
}

func TestTelegramAndDiscordCredentialValidation(t *testing.T) {
	if !looksLikeTelegramBotToken("123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef") {
		t.Fatal("valid Telegram bot token rejected")
	}
	for _, chatID := range []string{"123456789", "-100123456789", "@public_channel"} {
		if !validTelegramChatID(chatID) {
			t.Fatalf("valid chat ID rejected: %s", chatID)
		}
	}
	if validTelegramChatID("123:bot-token") {
		t.Fatal("bot token accepted as chat ID")
	}
	if !validDiscordWebhook("https://discord.com/api/webhooks/1/token") {
		t.Fatal("official HTTPS Discord webhook rejected")
	}
	for _, value := range []string{
		"http://discord.com/api/webhooks/1/token",
		"https://attacker.example/api/webhooks/1/token",
	} {
		if validDiscordWebhook(value) {
			t.Fatalf("unsafe Discord webhook accepted: %s", value)
		}
	}
}

func TestWorkerDeliveryRequiresServiceSecretAndSignedUser(t *testing.T) {
	box, _ := NewSecretBox("test-secret")
	app := integrationTestApp(&fakeIntegrationStore{}, box)
	body := fmt.Sprintf(
		`{"deliveryToken":%q,"message":{"symbol":"EURUSD","condition":"above","targetPrice":1,"triggerPrice":1.1,"triggeredAt":1},"channels":{}}`,
		box.IssueDeliveryToken("user-1"),
	)
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/settings/integrations/worker-deliver",
		strings.NewReader(body),
	)
	request.Header.Set("Content-Type", "application/json")
	resp, _ := app.Test(request)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("missing service secret status=%d", resp.StatusCode)
	}
	request = httptest.NewRequest(
		http.MethodPost,
		"/api/v1/settings/integrations/worker-deliver",
		strings.NewReader(body),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("x-push-worker-secret", "worker-secret")
	resp, _ = app.Test(request)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("authorized worker status=%d", resp.StatusCode)
	}
}

func TestFormatIntegrationAlertMessageUsesRequestedTimeZone(t *testing.T) {
	message := integrationAlertMessage{
		Symbol:       "BTCUSD",
		Condition:    "crossUp",
		TargetPrice:  64098.59,
		TriggerPrice: 64099.84,
		TriggeredAt:  time.Date(2026, 7, 18, 14, 19, 57, 0, time.UTC).UnixMilli(),
		TimeZone:     "America/Los_Angeles",
		Source:       "browser-open",
		Note:         "confirm\r\nbreakout",
	}
	got := formatIntegrationAlertMessage(message)
	for _, want := range []string{
		"BTCUSD",
		"64,098.59",
		"64,099.84",
		"2026-07-18 07:19:57 UTC-7",
		"America/Los_Angeles (UTC-7)",
		"confirm breakout",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("message %q missing %q", got, want)
		}
	}
}

func TestNotificationFormattingNormalizesSecondsAndInvalidValues(t *testing.T) {
	if got := formatNotificationPrice(math.NaN()); !strings.Contains(got, "x") &&
		!strings.Contains(got, "X") {
		// The localized label may change; it must not leak the string "NaN".
		if got == "NaN" || got == "" {
			t.Fatalf("invalid price was not normalized: %q", got)
		}
	}
	at, zone := formatNotificationTime(
		time.Date(2026, 7, 18, 14, 19, 57, 0, time.UTC).Unix(),
		"invalid/zone",
	)
	if at != "2026-07-18 14:19:57 UTC" || zone != "UTC" {
		t.Fatalf("unexpected normalized time=%q zone=%q", at, zone)
	}
}

func TestResolveIntegrationTimeZonePrefersFreshRequestAndResolvesExchange(t *testing.T) {
	store := newFakeSettingsStore()
	store.doc.Chart = json.RawMessage(`{"timeZone":"Asia/Ho_Chi_Minh"}`)
	h := NewHandler(store, fakeRequireAuth)
	h.exchangeTimeZone = "Asia/Ho_Chi_Minh"

	if got := h.resolveIntegrationTimeZone(context.Background(), "user-1", "America/Los_Angeles"); got != "America/Los_Angeles" {
		t.Fatalf("fresh request zone = %q", got)
	}
	if got := h.resolveIntegrationTimeZone(context.Background(), "user-1", ""); got != "Asia/Ho_Chi_Minh" {
		t.Fatalf("stored zone = %q", got)
	}
	store.doc.Chart = json.RawMessage(`{"timeZone":"exchange"}`)
	if got := h.resolveIntegrationTimeZone(context.Background(), "user-1", "exchange"); got != "Asia/Ho_Chi_Minh" {
		t.Fatalf("exchange zone = %q", got)
	}
	if got := normalizeIntegrationTimeZone("invalid/zone", "Asia/Ho_Chi_Minh"); got != "UTC" {
		t.Fatalf("invalid zone = %q", got)
	}
}
