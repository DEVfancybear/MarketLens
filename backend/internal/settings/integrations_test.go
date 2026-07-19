package settings

import (
	"bytes"
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

type fakeIntegrationStore struct {
	row            IntegrationRecord
	rows           map[string]IntegrationRecord
	getUserIDs     []string
	putUserIDs     []string
	markUserIDs    []string
	markCallCount  int
	clearCallCount int
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

func (f *fakeIntegrationStore) MarkMT5Verified(_ context.Context, userID, login, server string, passwordCipher []byte, verifiedAt time.Time) (IntegrationRecord, bool, error) {
	f.markCallCount++
	f.markUserIDs = append(f.markUserIDs, userID)
	row := f.row
	if f.rows != nil {
		row = f.rows[userID]
	}
	if row.MT5Login != login || row.MT5Server != server || !bytes.Equal(row.MT5Password, passwordCipher) {
		return IntegrationRecord{}, false, nil
	}
	row.MT5VerifiedAt = &verifiedAt
	f.row = row
	if f.rows != nil {
		f.rows[userID] = row
	}
	return row, true, nil
}

func (f *fakeIntegrationStore) ClearMT5Verified(_ context.Context, userID, login, server string, passwordCipher []byte) (bool, error) {
	f.clearCallCount++
	row := f.row
	if f.rows != nil {
		row = f.rows[userID]
	}
	if row.MT5Login != login || row.MT5Server != server || !bytes.Equal(row.MT5Password, passwordCipher) {
		return false, nil
	}
	row.MT5VerifiedAt = nil
	f.row = row
	if f.rows != nil {
		f.rows[userID] = row
	}
	return true, nil
}

type fakeMT5Verifier struct {
	result       MT5VerifyResult
	err          error
	credentials  []MT5VerifyCredentials
	beforeReturn func()
}

func (f *fakeMT5Verifier) Verify(_ context.Context, credentials MT5VerifyCredentials) (MT5VerifyResult, error) {
	f.credentials = append(f.credentials, credentials)
	if f.beforeReturn != nil {
		f.beforeReturn()
	}
	return f.result, f.err
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

func TestVerifyMT5IntegrationSuccess(t *testing.T) {
	box, _ := NewSecretBox("test-secret")
	passwordCipher, _ := box.Seal("master-password")
	store := &fakeIntegrationStore{row: IntegrationRecord{
		MT5Login:    "12345678",
		MT5Server:   "FTMO-Server4",
		MT5Password: passwordCipher,
	}}
	account := &MT5AccountSummary{
		Login:        "12345678",
		Server:       "FTMO-Server4",
		Currency:     "USD",
		TradeAllowed: true,
	}
	verifier := &fakeMT5Verifier{result: MT5VerifyResult{
		Verified: true,
		Code:     "verified",
		Message:  "MT5 account verified.",
		Account:  account,
	}}
	app := fiber.New()
	NewHandler(newFakeSettingsStore(), fakeRequireAuth).
		WithIntegrations(store, box, "worker-secret").
		WithMT5Verifier(verifier).
		Register(app.Group("/api/v1"))

	request := httptest.NewRequest(http.MethodPost, "/api/v1/settings/integrations/verify/mt5", nil)
	response, err := app.Test(request)
	if err != nil || response.StatusCode != http.StatusOK {
		t.Fatalf("verify status=%d err=%v", response.StatusCode, err)
	}
	var body struct {
		OK      bool               `json:"ok"`
		MT5     MT5IntegrationView `json:"mt5"`
		Account MT5AccountSummary  `json:"account"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if !body.OK || !body.MT5.Verified || body.MT5.VerifiedAt == nil || body.Account.Login != "12345678" || !body.Account.TradeAllowed {
		t.Fatalf("unexpected verify response: %+v", body)
	}
	if store.row.MT5VerifiedAt == nil || store.markCallCount != 1 || len(store.markUserIDs) != 1 || store.markUserIDs[0] != "user-1" {
		t.Fatalf("verification was not persisted for authenticated user: %+v", store)
	}
	if len(verifier.credentials) != 1 || verifier.credentials[0].Password != "master-password" || verifier.credentials[0].Login != "12345678" || verifier.credentials[0].Server != "FTMO-Server4" {
		t.Fatalf("verifier credentials mismatch: %+v", verifier.credentials)
	}
}

func TestVerifyMT5IntegrationFailureDoesNotMarkVerified(t *testing.T) {
	box, _ := NewSecretBox("test-secret")
	passwordCipher, _ := box.Seal("wrong-password")
	previouslyVerifiedAt := time.Date(2026, 7, 19, 12, 0, 0, 0, time.UTC)
	store := &fakeIntegrationStore{row: IntegrationRecord{
		MT5Login:      "12345678",
		MT5Server:     "FTMO-Server4",
		MT5Password:   passwordCipher,
		MT5VerifiedAt: &previouslyVerifiedAt,
	}}
	verifier := &fakeMT5Verifier{result: MT5VerifyResult{
		Verified: false,
		Code:     "login_failed",
		Message:  "MT5 rejected the login, server, or password.",
	}}
	app := fiber.New()
	NewHandler(newFakeSettingsStore(), fakeRequireAuth).
		WithIntegrations(store, box, "worker-secret").
		WithMT5Verifier(verifier).
		Register(app.Group("/api/v1"))

	request := httptest.NewRequest(http.MethodPost, "/api/v1/settings/integrations/verify/mt5", nil)
	response, err := app.Test(request)
	if err != nil || response.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("verify failure status=%d err=%v", response.StatusCode, err)
	}
	var body struct {
		OK    bool `json:"ok"`
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.OK || body.Error.Code != "login_failed" {
		t.Fatalf("unexpected failure response: %+v", body)
	}
	if store.row.MT5VerifiedAt != nil || store.markCallCount != 0 || store.clearCallCount != 1 {
		t.Fatal("failed credentials were marked verified")
	}
}

func TestVerifyMT5IntegrationMapsVerifierTimeoutToGatewayTimeout(t *testing.T) {
	box, _ := NewSecretBox("test-secret")
	passwordCipher, _ := box.Seal("master-password")
	store := &fakeIntegrationStore{row: IntegrationRecord{
		MT5Login:    "12345678",
		MT5Server:   "FTMO-Server4",
		MT5Password: passwordCipher,
	}}
	app := fiber.New()
	NewHandler(newFakeSettingsStore(), fakeRequireAuth).
		WithIntegrations(store, box, "worker-secret").
		WithMT5Verifier(&fakeMT5Verifier{err: context.DeadlineExceeded}).
		Register(app.Group("/api/v1"))

	response, err := app.Test(httptest.NewRequest(http.MethodPost, "/api/v1/settings/integrations/verify/mt5", nil))
	if err != nil || response.StatusCode != http.StatusGatewayTimeout {
		t.Fatalf("verify timeout status=%d err=%v", response.StatusCode, err)
	}
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Error.Code != "MT5_VERIFICATION_TIMEOUT" || store.markCallCount != 0 {
		t.Fatalf("unexpected timeout response=%+v markCalls=%d", body, store.markCallCount)
	}
}

func TestVerifyMT5IntegrationReturnsConfiguredUnavailableReason(t *testing.T) {
	box, _ := NewSecretBox("test-secret")
	store := &fakeIntegrationStore{}
	app := fiber.New()
	NewHandler(newFakeSettingsStore(), fakeRequireAuth).
		WithIntegrations(store, box, "worker-secret").
		WithMT5VerifierUnavailable(
			"MT5_VERIFIER_UNAVAILABLE",
			"MT5 verification is temporarily unavailable. Please try again later.",
		).
		Register(app.Group("/api/v1"))

	response, err := app.Test(httptest.NewRequest(http.MethodPost, "/api/v1/settings/integrations/verify/mt5", nil))
	if err != nil || response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("verify unavailable status=%d err=%v", response.StatusCode, err)
	}
	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Error.Code != "MT5_VERIFIER_UNAVAILABLE" || !strings.Contains(body.Error.Message, "temporarily unavailable") {
		t.Fatalf("unexpected unavailable response: %+v", body)
	}
}

func TestIntegrationHandlerInvalidatesMT5VerificationWhenCredentialsChange(t *testing.T) {
	verifiedAt := time.Date(2026, 7, 19, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name         string
		body         string
		wantVerified bool
	}{
		{name: "unchanged", body: `{"mt5":{"login":"12345678","server":"FTMO-Server4"}}`, wantVerified: true},
		{name: "login changed", body: `{"mt5":{"login":"12345679","server":"FTMO-Server4"}}`},
		{name: "server changed", body: `{"mt5":{"login":"12345678","server":"FTMO-Server5"}}`},
		{name: "password replaced", body: `{"mt5":{"login":"12345678","server":"FTMO-Server4","password":"new-password"}}`},
		{name: "password cleared", body: `{"mt5":{"login":"12345678","server":"FTMO-Server4","clearPassword":true}}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			box, _ := NewSecretBox("test-secret")
			passwordCipher, _ := box.Seal("master-password")
			store := &fakeIntegrationStore{row: IntegrationRecord{
				MT5Login:      "12345678",
				MT5Server:     "FTMO-Server4",
				MT5Password:   passwordCipher,
				MT5VerifiedAt: &verifiedAt,
			}}
			app := fiber.New()
			NewHandler(newFakeSettingsStore(), fakeRequireAuth).
				WithIntegrations(store, box, "worker-secret").
				Register(app.Group("/api/v1"))

			request := httptest.NewRequest(http.MethodPut, "/api/v1/settings/integrations", strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			response, err := app.Test(request)
			if err != nil || response.StatusCode != http.StatusOK {
				t.Fatalf("put status=%d err=%v", response.StatusCode, err)
			}
			if got := store.row.MT5VerifiedAt != nil; got != test.wantVerified {
				t.Fatalf("verified=%v, want %v", got, test.wantVerified)
			}
		})
	}
}

func TestVerifyMT5IntegrationScopesPersistenceToAuthenticatedUser(t *testing.T) {
	box, _ := NewSecretBox("test-secret")
	userOnePassword, _ := box.Seal("user-one-password")
	userTwoPassword, _ := box.Seal("user-two-password")
	store := &fakeIntegrationStore{rows: map[string]IntegrationRecord{
		"user-1": {MT5Login: "111", MT5Server: "FTMO-Server4", MT5Password: userOnePassword},
		"user-2": {MT5Login: "222", MT5Server: "FTMO-Server4", MT5Password: userTwoPassword},
	}}
	verifier := &fakeMT5Verifier{result: MT5VerifyResult{
		Verified: true,
		Code:     "verified",
		Message:  "MT5 account verified.",
		Account:  &MT5AccountSummary{Login: "111", Server: "FTMO-Server4", TradeAllowed: true},
	}}
	app := fiber.New()
	NewHandler(newFakeSettingsStore(), fakeRequireAuth).
		WithIntegrations(store, box, "worker-secret").
		WithMT5Verifier(verifier).
		Register(app.Group("/api/v1"))

	response, err := app.Test(httptest.NewRequest(http.MethodPost, "/api/v1/settings/integrations/verify/mt5", nil))
	if err != nil || response.StatusCode != http.StatusOK {
		t.Fatalf("verify status=%d err=%v", response.StatusCode, err)
	}
	if store.rows["user-1"].MT5VerifiedAt == nil {
		t.Fatal("authenticated user's verification was not persisted")
	}
	if store.rows["user-2"].MT5VerifiedAt != nil {
		t.Fatal("verification leaked to another user")
	}
	if len(store.markUserIDs) != 1 || store.markUserIDs[0] != "user-1" {
		t.Fatalf("unexpected persistence user IDs: %v", store.markUserIDs)
	}
}

func TestVerifyMT5IntegrationRejectsCredentialsChangedInFlight(t *testing.T) {
	box, _ := NewSecretBox("test-secret")
	originalPassword, _ := box.Seal("original-password")
	changedPassword, _ := box.Seal("changed-password")
	store := &fakeIntegrationStore{row: IntegrationRecord{
		MT5Login:    "12345678",
		MT5Server:   "FTMO-Server4",
		MT5Password: originalPassword,
	}}
	verifier := &fakeMT5Verifier{result: MT5VerifyResult{
		Verified: true,
		Code:     "verified",
		Message:  "MT5 account verified.",
		Account:  &MT5AccountSummary{Login: "12345678", Server: "FTMO-Server4", TradeAllowed: true},
	}}
	verifier.beforeReturn = func() {
		store.row.MT5Password = changedPassword
	}
	app := fiber.New()
	NewHandler(newFakeSettingsStore(), fakeRequireAuth).
		WithIntegrations(store, box, "worker-secret").
		WithMT5Verifier(verifier).
		Register(app.Group("/api/v1"))

	response, err := app.Test(httptest.NewRequest(http.MethodPost, "/api/v1/settings/integrations/verify/mt5", nil))
	if err != nil || response.StatusCode != http.StatusConflict {
		t.Fatalf("verify conflict status=%d err=%v", response.StatusCode, err)
	}
	if store.row.MT5VerifiedAt != nil || !bytes.Equal(store.row.MT5Password, changedPassword) {
		t.Fatal("stale verification overwrote credentials changed in flight")
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
