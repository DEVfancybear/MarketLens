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
	req := httptest.NewRequest(http.MethodPut, "/api/v1/settings/integrations", strings.NewReader(`{"mt5":{"login":"123","server":"Demo","password":"mt5-secret"},"telegram":{"chatId":"42","botToken":"123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef","enabled":true},"discord":{"webhookUrl":"https://discord.com/api/webhooks/1/token","enabled":true}}`))
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

func TestIntegrationHandlerRejectsTelegramTokenInChatID(t *testing.T) {
	box, _ := NewSecretBox("test-secret")
	store := &fakeIntegrationStore{}
	app := fiber.New()
	NewHandler(newFakeSettingsStore(), fakeRequireAuth).WithIntegrations(store, box, "worker-secret").Register(app.Group("/api/v1"))
	req := httptest.NewRequest(http.MethodPut, "/api/v1/settings/integrations", strings.NewReader(`{"telegram":{"chatId":"123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef","botToken":"123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef","enabled":true}}`))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil || resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("put status=%d err=%v", resp.StatusCode, err)
	}
}

func TestTelegramCredentialValidation(t *testing.T) {
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

func TestFormatIntegrationAlertMessageUsesVietnameseAndSelectedTimeZone(t *testing.T) {
	message := integrationAlertMessage{
		Symbol:         "BTCUSD",
		Condition:      "crossUp",
		ConditionLabel: "Giá cắt lên đường xu hướng",
		TargetPrice:    64098.59,
		TriggerPrice:   64099.84,
		TriggeredAt:    time.Date(2026, 7, 18, 14, 19, 57, 0, time.UTC).UnixMilli(),
		TimeZone:       "America/Los_Angeles",
		Source:         "browser-open",
		Note:           "Xác nhận\r\nbreakout",
	}
	want := strings.Join([]string{
		"🚨 CẢNH BÁO GIAO DỊCH — BTCUSD",
		"Sự kiện: Giá cắt lên đường xu hướng",
		"Mức cảnh báo: 64,098.59",
		"Giá thị trường khi kích hoạt: 64,099.84",
		"Thời điểm kích hoạt: 2026-07-18 07:19:57 UTC-7",
		"Múi giờ hiển thị: America/Los_Angeles (UTC-7)",
		"Nguồn xử lý: Ứng dụng web đang mở",
		"Ghi chú: Xác nhận breakout",
	}, "\n")
	if got := formatIntegrationAlertMessage(message); got != want {
		t.Fatalf("message mismatch\n got:\n%s\nwant:\n%s", got, want)
	}
}

func TestFormatIntegrationAlertMessageNormalizesSecondsAndInvalidValues(t *testing.T) {
	message := integrationAlertMessage{
		Symbol:       "EURUSD",
		Condition:    "unknown",
		TargetPrice:  math.NaN(),
		TriggerPrice: math.Inf(1),
		TriggeredAt:  time.Date(2026, 7, 18, 14, 19, 57, 0, time.UTC).Unix(),
		TimeZone:     "invalid/zone",
		Source:       "unknown",
	}
	got := formatIntegrationAlertMessage(message)
	for _, want := range []string{
		"Sự kiện: Điều kiện cảnh báo",
		"Mức cảnh báo: Không xác định",
		"Giá thị trường khi kích hoạt: Không xác định",
		"Thời điểm kích hoạt: 2026-07-18 14:19:57 UTC",
		"Múi giờ hiển thị: UTC",
		"Nguồn xử lý: Hệ thống cảnh báo",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("message %q missing %q", got, want)
		}
	}
}

func TestResolveIntegrationTimeZonePrefersFreshRequestAndResolvesExchange(t *testing.T) {
	store := newFakeSettingsStore()
	store.doc.Chart = json.RawMessage(`{"timeZone":"Asia/Ho_Chi_Minh"}`)
	h := NewHandler(store, fakeRequireAuth)
	h.exchangeTimeZone = "Asia/Ho_Chi_Minh"

	if got := h.resolveIntegrationTimeZone(context.Background(), "user-1", "America/Los_Angeles"); got != "America/Los_Angeles" {
		t.Fatalf("fresh request zone = %q, want America/Los_Angeles", got)
	}
	if got := h.resolveIntegrationTimeZone(context.Background(), "user-1", ""); got != "Asia/Ho_Chi_Minh" {
		t.Fatalf("legacy blank zone = %q, want stored zone", got)
	}

	store.doc.Chart = json.RawMessage(`{"timeZone":"exchange"}`)
	if got := h.resolveIntegrationTimeZone(context.Background(), "user-1", "exchange"); got != "Asia/Ho_Chi_Minh" {
		t.Fatalf("exchange zone = %q, want backend exchange zone", got)
	}
	if got := normalizeIntegrationTimeZone("invalid/zone", "Asia/Ho_Chi_Minh"); got != "UTC" {
		t.Fatalf("invalid zone = %q, want UTC fallback", got)
	}
}
