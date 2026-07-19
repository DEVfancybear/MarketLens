package settings

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type IntegrationRecord struct {
	MT5Login, MT5Server, TelegramChatID           string
	MT5Password, TelegramBotToken, DiscordWebhook []byte
	MT5VerifiedAt                                 *time.Time
	TelegramEnabled, DiscordEnabled               bool
}

type MT5IntegrationView struct {
	Login              string     `json:"login"`
	Server             string     `json:"server"`
	PasswordConfigured bool       `json:"passwordConfigured"`
	Verified           bool       `json:"verified"`
	VerifiedAt         *time.Time `json:"verifiedAt"`
}
type TelegramIntegrationView struct {
	ChatID             string `json:"chatId"`
	BotTokenConfigured bool   `json:"botTokenConfigured"`
	Enabled            bool   `json:"enabled"`
}
type DiscordIntegrationView struct {
	WebhookConfigured bool `json:"webhookConfigured"`
	Enabled           bool `json:"enabled"`
}
type IntegrationView struct {
	MT5           MT5IntegrationView      `json:"mt5"`
	Telegram      TelegramIntegrationView `json:"telegram"`
	Discord       DiscordIntegrationView  `json:"discord"`
	DeliveryToken string                  `json:"deliveryToken"`
}

type integrationWrite struct {
	MT5 struct {
		Login, Server, Password string
		ClearPassword           bool
	} `json:"mt5"`
	Telegram struct {
		ChatID, BotToken       string
		Enabled, ClearBotToken bool
	} `json:"telegram"`
	Discord struct {
		WebhookURL            string `json:"webhookUrl"`
		Enabled, ClearWebhook bool
	} `json:"discord"`
}

type IntegrationStore interface {
	Get(context.Context, string) (IntegrationRecord, error)
	Put(context.Context, string, IntegrationRecord) (IntegrationRecord, error)
	MarkMT5Verified(context.Context, string, string, string, []byte, time.Time) (IntegrationRecord, bool, error)
	ClearMT5Verified(context.Context, string, string, string, []byte) (bool, error)
}

type IntegrationRepo struct{ pool *pgxpool.Pool }

func NewIntegrationRepo(pool *pgxpool.Pool) *IntegrationRepo { return &IntegrationRepo{pool: pool} }

func (r *IntegrationRepo) Get(ctx context.Context, userID string) (IntegrationRecord, error) {
	uid, err := integrationUUID(userID)
	if err != nil {
		return IntegrationRecord{}, err
	}
	_, err = r.pool.Exec(ctx, `INSERT INTO user_integrations (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, uid)
	if err != nil {
		return IntegrationRecord{}, err
	}
	return scanIntegration(r.pool.QueryRow(ctx, `SELECT mt5_login, mt5_server, mt5_password_cipher, mt5_verified_at, telegram_chat_id, telegram_bot_cipher, telegram_enabled, discord_webhook_cipher, discord_enabled FROM user_integrations WHERE user_id=$1`, uid))
}

func (r *IntegrationRepo) Put(ctx context.Context, userID string, v IntegrationRecord) (IntegrationRecord, error) {
	uid, err := integrationUUID(userID)
	if err != nil {
		return IntegrationRecord{}, err
	}
	return scanIntegration(r.pool.QueryRow(ctx, `INSERT INTO user_integrations (user_id,mt5_login,mt5_server,mt5_password_cipher,mt5_verified_at,telegram_chat_id,telegram_bot_cipher,telegram_enabled,discord_webhook_cipher,discord_enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(user_id) DO UPDATE SET mt5_login=EXCLUDED.mt5_login,mt5_server=EXCLUDED.mt5_server,mt5_password_cipher=EXCLUDED.mt5_password_cipher,mt5_verified_at=EXCLUDED.mt5_verified_at,telegram_chat_id=EXCLUDED.telegram_chat_id,telegram_bot_cipher=EXCLUDED.telegram_bot_cipher,telegram_enabled=EXCLUDED.telegram_enabled,discord_webhook_cipher=EXCLUDED.discord_webhook_cipher,discord_enabled=EXCLUDED.discord_enabled,updated_at=now() RETURNING mt5_login,mt5_server,mt5_password_cipher,mt5_verified_at,telegram_chat_id,telegram_bot_cipher,telegram_enabled,discord_webhook_cipher,discord_enabled`, uid, v.MT5Login, v.MT5Server, v.MT5Password, v.MT5VerifiedAt, v.TelegramChatID, v.TelegramBotToken, v.TelegramEnabled, v.DiscordWebhook, v.DiscordEnabled))
}

func (r *IntegrationRepo) MarkMT5Verified(ctx context.Context, userID, login, server string, passwordCipher []byte, verifiedAt time.Time) (IntegrationRecord, bool, error) {
	uid, err := integrationUUID(userID)
	if err != nil {
		return IntegrationRecord{}, false, err
	}
	record, err := scanIntegration(r.pool.QueryRow(ctx, `UPDATE user_integrations SET mt5_verified_at=$5,updated_at=now() WHERE user_id=$1 AND mt5_login=$2 AND mt5_server=$3 AND mt5_password_cipher=$4 RETURNING mt5_login,mt5_server,mt5_password_cipher,mt5_verified_at,telegram_chat_id,telegram_bot_cipher,telegram_enabled,discord_webhook_cipher,discord_enabled`, uid, login, server, passwordCipher, verifiedAt))
	if errors.Is(err, pgx.ErrNoRows) {
		return IntegrationRecord{}, false, nil
	}
	return record, err == nil, err
}

func (r *IntegrationRepo) ClearMT5Verified(ctx context.Context, userID, login, server string, passwordCipher []byte) (bool, error) {
	uid, err := integrationUUID(userID)
	if err != nil {
		return false, err
	}
	tag, err := r.pool.Exec(ctx, `UPDATE user_integrations SET mt5_verified_at=NULL,updated_at=now() WHERE user_id=$1 AND mt5_login=$2 AND mt5_server=$3 AND mt5_password_cipher=$4`, uid, login, server, passwordCipher)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

type integrationScanner interface{ Scan(...any) error }

func scanIntegration(row integrationScanner) (v IntegrationRecord, err error) {
	err = row.Scan(&v.MT5Login, &v.MT5Server, &v.MT5Password, &v.MT5VerifiedAt, &v.TelegramChatID, &v.TelegramBotToken, &v.TelegramEnabled, &v.DiscordWebhook, &v.DiscordEnabled)
	return
}
func integrationUUID(s string) (pgtype.UUID, error) {
	var u pgtype.UUID
	if err := u.Scan(s); err != nil {
		return u, err
	}
	return u, nil
}

type SecretBox struct {
	aead cipher.AEAD
	key  [32]byte
}

func NewSecretBox(secret string) (*SecretBox, error) {
	if strings.TrimSpace(secret) == "" {
		return nil, errors.New("integration encryption secret is empty")
	}
	key := sha256.Sum256([]byte("user-integrations:" + secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	return &SecretBox{aead: aead, key: key}, err
}
func (b *SecretBox) Seal(value string) ([]byte, error) {
	if value == "" {
		return nil, nil
	}
	nonce := make([]byte, b.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return b.aead.Seal(nonce, nonce, []byte(value), nil), nil
}
func (b *SecretBox) Open(value []byte) (string, error) {
	if len(value) == 0 {
		return "", nil
	}
	n := b.aead.NonceSize()
	if len(value) < n {
		return "", errors.New("invalid encrypted secret")
	}
	out, err := b.aead.Open(nil, value[:n], value[n:], nil)
	return string(out), err
}

func (b *SecretBox) IssueDeliveryToken(userID string) string {
	payload := base64.RawURLEncoding.EncodeToString([]byte(userID))
	mac := hmac.New(sha256.New, b.aeadKey())
	_, _ = mac.Write([]byte(payload))
	return payload + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func (b *SecretBox) VerifyDeliveryToken(token string) (string, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return "", errors.New("invalid delivery token")
	}
	mac := hmac.New(sha256.New, b.aeadKey())
	_, _ = mac.Write([]byte(parts[0]))
	sig, e := base64.RawURLEncoding.DecodeString(parts[1])
	if e != nil || !hmac.Equal(sig, mac.Sum(nil)) {
		return "", errors.New("invalid delivery token")
	}
	raw, e := base64.RawURLEncoding.DecodeString(parts[0])
	return string(raw), e
}
func (b *SecretBox) aeadKey() []byte { return b.key[:] }

func integrationView(v IntegrationRecord, userID string, box *SecretBox) IntegrationView {
	var out IntegrationView
	out.MT5.Login = v.MT5Login
	out.MT5.Server = v.MT5Server
	out.MT5.PasswordConfigured = len(v.MT5Password) > 0
	out.MT5.Verified = v.MT5VerifiedAt != nil && v.MT5Login != "" && v.MT5Server != "" && len(v.MT5Password) > 0
	if out.MT5.Verified {
		out.MT5.VerifiedAt = v.MT5VerifiedAt
	}
	out.Telegram.ChatID = v.TelegramChatID
	out.Telegram.BotTokenConfigured = len(v.TelegramBotToken) > 0
	out.Telegram.Enabled = v.TelegramEnabled
	out.Discord.WebhookConfigured = len(v.DiscordWebhook) > 0
	out.Discord.Enabled = v.DiscordEnabled
	out.DeliveryToken = box.IssueDeliveryToken(userID)
	return out
}

func (h *Handler) WithIntegrations(store IntegrationStore, box *SecretBox, workerSecret string, exchangeTimeZones ...string) *Handler {
	h.integrationStore = store
	h.secretBox = box
	h.workerSecret = workerSecret
	h.exchangeTimeZone = "UTC"
	if len(exchangeTimeZones) > 0 {
		h.exchangeTimeZone = normalizeIntegrationTimeZone(exchangeTimeZones[0], "UTC")
	}
	return h
}
func (h *Handler) registerIntegrationRoutes(router fiber.Router) {
	router.Get("/settings/integrations", h.requireAuth, h.getIntegrations)
	router.Put("/settings/integrations", h.requireAuth, h.putIntegrations)
	router.Post("/settings/integrations/verify/mt5", h.requireAuth, h.verifyMT5Integration)
	router.Post("/settings/integrations/test/:channel", h.requireAuth, h.testIntegration)
	router.Post("/settings/integrations/deliver", h.requireAuth, h.deliverIntegration)
	router.Post("/settings/integrations/worker-deliver", h.workerDeliverIntegration)
}
func (h *Handler) getIntegrations(c *fiber.Ctx) error {
	v, err := h.integrationStore.Get(c.Context(), userID(c))
	if err != nil {
		return fiber.ErrInternalServerError
	}
	return c.JSON(integrationView(v, userID(c), h.secretBox))
}
func (h *Handler) putIntegrations(c *fiber.Ctx) error {
	var req integrationWrite
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return fiber.NewError(400, "invalid request body")
	}
	chatID := strings.TrimSpace(req.Telegram.ChatID)
	botToken := strings.TrimSpace(req.Telegram.BotToken)
	if looksLikeTelegramBotToken(chatID) {
		return fiber.NewError(400, "Telegram Chat ID contains a bot token; enter the numeric chat ID instead")
	}
	if chatID != "" && !validTelegramChatID(chatID) {
		return fiber.NewError(400, "Telegram Chat ID must be numeric or a public @channel username")
	}
	if botToken != "" && !looksLikeTelegramBotToken(botToken) {
		return fiber.NewError(400, "Telegram bot token has an invalid format")
	}
	if req.Discord.WebhookURL != "" && !validDiscordWebhook(req.Discord.WebhookURL) {
		return fiber.NewError(400, "Discord webhook must be an official HTTPS webhook URL")
	}
	v, err := h.integrationStore.Get(c.Context(), userID(c))
	if err != nil {
		return fiber.ErrInternalServerError
	}
	mt5Login := strings.TrimSpace(req.MT5.Login)
	mt5Server := strings.TrimSpace(req.MT5.Server)
	mt5CredentialsChanged := mt5Login != v.MT5Login || mt5Server != v.MT5Server || req.MT5.Password != "" || req.MT5.ClearPassword
	v.MT5Login = mt5Login
	v.MT5Server = mt5Server
	v.TelegramChatID = chatID
	v.TelegramEnabled = req.Telegram.Enabled
	v.DiscordEnabled = req.Discord.Enabled
	if req.MT5.ClearPassword {
		v.MT5Password = nil
	} else if req.MT5.Password != "" {
		v.MT5Password, err = h.secretBox.Seal(req.MT5.Password)
	}
	if mt5CredentialsChanged {
		v.MT5VerifiedAt = nil
	}
	if req.Telegram.ClearBotToken {
		v.TelegramBotToken = nil
	} else if botToken != "" {
		v.TelegramBotToken, err = h.secretBox.Seal(botToken)
	}
	if req.Discord.ClearWebhook {
		v.DiscordWebhook = nil
	} else if req.Discord.WebhookURL != "" {
		v.DiscordWebhook, err = h.secretBox.Seal(req.Discord.WebhookURL)
	}
	if err != nil {
		return fiber.ErrInternalServerError
	}
	v, err = h.integrationStore.Put(c.Context(), userID(c), v)
	if err != nil {
		return fiber.ErrInternalServerError
	}
	return c.JSON(integrationView(v, userID(c), h.secretBox))
}

func looksLikeTelegramBotToken(value string) bool {
	parts := strings.Split(strings.TrimSpace(value), ":")
	if len(parts) != 2 || len(parts[0]) < 6 || len(parts[1]) < 20 {
		return false
	}
	for _, char := range parts[0] {
		if char < '0' || char > '9' {
			return false
		}
	}
	for _, char := range parts[1] {
		if !((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '_' || char == '-') {
			return false
		}
	}
	return true
}

func validTelegramChatID(value string) bool {
	value = strings.TrimSpace(value)
	if strings.HasPrefix(value, "@") {
		name := value[1:]
		if len(name) < 5 || len(name) > 32 {
			return false
		}
		for _, char := range name {
			if !((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '_') {
				return false
			}
		}
		return true
	}
	digits := strings.TrimPrefix(value, "-")
	if digits == "" {
		return false
	}
	for _, char := range digits {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}

func validDiscordWebhook(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return (host == "discord.com" || host == "discordapp.com") && strings.HasPrefix(u.Path, "/api/webhooks/")
}
func (h *Handler) testIntegration(c *fiber.Ctx) error {
	v, err := h.integrationStore.Get(c.Context(), userID(c))
	if err != nil {
		return fiber.ErrInternalServerError
	}
	channel := c.Params("channel")
	if err := h.sendConfigured(v, channel, "✅ Tin nhắn kiểm tra tích hợp SMC Terminal đã được gửi thành công."); err != nil {
		return fiber.NewError(502, err.Error())
	}
	return c.JSON(fiber.Map{"ok": true, "channel": channel})
}

type integrationAlertMessage struct {
	Symbol         string  `json:"symbol"`
	Condition      string  `json:"condition"`
	ConditionLabel string  `json:"conditionLabel"`
	Note           string  `json:"note"`
	Source         string  `json:"source"`
	TargetPrice    float64 `json:"targetPrice"`
	TriggerPrice   float64 `json:"triggerPrice"`
	TriggeredAt    int64   `json:"triggeredAt"`
	TimeZone       string  `json:"timeZone"`
}

type integrationDeliveryRequest struct {
	Message  integrationAlertMessage          `json:"message"`
	Channels struct{ Telegram, Discord bool } `json:"channels"`
}

type workerDeliveryRequest struct {
	DeliveryToken string                           `json:"deliveryToken"`
	Message       integrationAlertMessage          `json:"message"`
	Channels      struct{ Telegram, Discord bool } `json:"channels"`
}

func (h *Handler) deliverIntegration(c *fiber.Ctx) error {
	var in integrationDeliveryRequest
	if err := json.Unmarshal(c.Body(), &in); err != nil || in.Message.Symbol == "" {
		return fiber.NewError(400, "invalid alert message")
	}
	uid := userID(c)
	in.Message.TimeZone = h.resolveIntegrationTimeZone(c.Context(), uid, in.Message.TimeZone)
	v, err := h.integrationStore.Get(c.Context(), uid)
	if err != nil {
		return fiber.ErrInternalServerError
	}
	return c.JSON(fiber.Map{"ok": true, "results": h.deliverResults(v, in)})
}

func (h *Handler) workerDeliverIntegration(c *fiber.Ctx) error {
	if h.workerSecret == "" || !hmac.Equal([]byte(c.Get("x-push-worker-secret")), []byte(h.workerSecret)) {
		return fiber.ErrUnauthorized
	}
	var raw workerDeliveryRequest
	if err := json.Unmarshal(c.Body(), &raw); err != nil || raw.Message.Symbol == "" {
		return fiber.NewError(400, "invalid alert message")
	}
	uid, err := h.secretBox.VerifyDeliveryToken(raw.DeliveryToken)
	if err != nil {
		return fiber.ErrUnauthorized
	}
	v, err := h.integrationStore.Get(c.Context(), uid)
	if err != nil {
		return fiber.ErrInternalServerError
	}
	var in integrationDeliveryRequest
	in.Message = raw.Message
	in.Message.TimeZone = h.resolveIntegrationTimeZone(c.Context(), uid, raw.Message.TimeZone)
	in.Channels.Telegram = raw.Channels.Telegram
	in.Channels.Discord = raw.Channels.Discord
	return c.JSON(fiber.Map{"ok": true, "results": h.deliverResults(v, in)})
}

func (h *Handler) deliverResults(v IntegrationRecord, in integrationDeliveryRequest) []fiber.Map {
	text := formatIntegrationAlertMessage(in.Message)
	results := []fiber.Map{}
	for _, item := range []struct {
		name               string
		requested, enabled bool
	}{{"telegram", in.Channels.Telegram, v.TelegramEnabled}, {"discord", in.Channels.Discord, v.DiscordEnabled}} {
		if !item.requested {
			continue
		}
		if !item.enabled {
			results = append(results, fiber.Map{"channel": item.name, "ok": false, "error": "channel disabled"})
			continue
		}
		e := h.sendConfigured(v, item.name, text)
		row := fiber.Map{"channel": item.name, "ok": e == nil}
		if e != nil {
			row["error"] = e.Error()
		}
		results = append(results, row)
	}
	return results
}

func normalizeIntegrationTimeZone(value, exchangeTimeZone string) string {
	value = cleanNotificationText(value, 80)
	if value == "exchange" {
		value = cleanNotificationText(exchangeTimeZone, 80)
	}
	if value == "" {
		return "UTC"
	}
	if _, err := time.LoadLocation(value); err != nil {
		return "UTC"
	}
	return value
}

func chartTimeZoneFromDocument(doc Document) string {
	var chart struct {
		TimeZone string `json:"timeZone"`
	}
	if err := json.Unmarshal(doc.Chart, &chart); err != nil {
		return ""
	}
	return chart.TimeZone
}

func (h *Handler) resolveIntegrationTimeZone(ctx context.Context, uid, requested string) string {
	selected := cleanNotificationText(requested, 80)
	// A concrete zone from the browser/device is the freshest chart setting.
	// Resolve the symbolic Exchange value (or a missing legacy field) from the
	// persisted account setting so closed-browser records remain deterministic.
	if selected == "" || selected == "exchange" {
		selected = ""
	}
	if selected == "" && h.store != nil {
		if doc, err := h.store.Get(ctx, uid); err == nil {
			if stored := chartTimeZoneFromDocument(doc); stored != "" {
				selected = stored
			}
		}
	}
	return normalizeIntegrationTimeZone(selected, h.exchangeTimeZone)
}

func cleanNotificationText(value string, limit int) string {
	value = strings.TrimSpace(value)
	var normalized strings.Builder
	wasLineBreak := false
	for _, char := range value {
		if char == '\r' || char == '\n' {
			if !wasLineBreak {
				normalized.WriteByte(' ')
			}
			wasLineBreak = true
			continue
		}
		wasLineBreak = false
		normalized.WriteRune(char)
	}
	value = strings.TrimSpace(normalized.String())
	runes := []rune(value)
	if len(runes) > limit {
		return string(runes[:limit])
	}
	return value
}

func integrationConditionLabel(message integrationAlertMessage) string {
	if label := cleanNotificationText(message.ConditionLabel, 160); label != "" {
		return label
	}
	switch message.Condition {
	case "above":
		return "Giá chạm hoặc vượt mức cảnh báo"
	case "below":
		return "Giá chạm hoặc giảm xuống dưới mức cảnh báo"
	case "crossUp":
		return "Giá cắt lên mức cảnh báo"
	case "crossDown":
		return "Giá cắt xuống mức cảnh báo"
	default:
		return "Điều kiện cảnh báo"
	}
}

func formatNotificationPrice(value float64) string {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return "Không xác định"
	}
	text := strings.TrimRight(strings.TrimRight(strconv.FormatFloat(value, 'f', 8, 64), "0"), ".")
	parts := strings.SplitN(text, ".", 2)
	integer := parts[0]
	sign := ""
	if strings.HasPrefix(integer, "-") {
		sign = "-"
		integer = strings.TrimPrefix(integer, "-")
	}
	for index := len(integer) - 3; index > 0; index -= 3 {
		integer = integer[:index] + "," + integer[index:]
	}
	if len(parts) == 2 {
		return sign + integer + "." + parts[1]
	}
	return sign + integer
}

func integrationSourceLabel(source string) string {
	switch source {
	case "browser-open":
		return "Ứng dụng web đang mở"
	case "closed-browser-worker":
		return "Bộ xử lý nền"
	case "test":
		return "Kiểm tra tích hợp"
	default:
		return "Hệ thống cảnh báo"
	}
}

func notificationUTCOffset(offsetSeconds int) string {
	if offsetSeconds == 0 {
		return "UTC"
	}
	sign := "+"
	if offsetSeconds < 0 {
		sign = "-"
		offsetSeconds = -offsetSeconds
	}
	totalMinutes := offsetSeconds / 60
	hours := totalMinutes / 60
	minutes := totalMinutes % 60
	if minutes == 0 {
		return fmt.Sprintf("UTC%s%d", sign, hours)
	}
	return fmt.Sprintf("UTC%s%d:%02d", sign, hours, minutes)
}

func formatNotificationTime(timestamp int64, requestedTimeZone string) (string, string) {
	timeZone := normalizeIntegrationTimeZone(requestedTimeZone, "UTC")
	location, err := time.LoadLocation(timeZone)
	if err != nil {
		timeZone = "UTC"
		location = time.UTC
	}
	zoneLabel := timeZone
	if timestamp <= 0 {
		return "Không xác định", zoneLabel
	}
	if timestamp < 100_000_000_000 {
		timestamp *= 1000
	}
	eventTime := time.UnixMilli(timestamp).In(location)
	_, offsetSeconds := eventTime.Zone()
	offset := notificationUTCOffset(offsetSeconds)
	if timeZone != "UTC" {
		zoneLabel = fmt.Sprintf("%s (%s)", timeZone, offset)
	}
	return eventTime.Format("2006-01-02 15:04:05") + " " + offset, zoneLabel
}

func formatIntegrationAlertMessage(message integrationAlertMessage) string {
	symbol := cleanNotificationText(message.Symbol, 40)
	if symbol == "" {
		symbol = "Không xác định"
	}
	triggeredAt, timeZoneLabel := formatNotificationTime(message.TriggeredAt, message.TimeZone)
	lines := []string{
		fmt.Sprintf("🚨 CẢNH BÁO GIAO DỊCH — %s", symbol),
		"Sự kiện: " + integrationConditionLabel(message),
		"Mức cảnh báo: " + formatNotificationPrice(message.TargetPrice),
		"Giá thị trường khi kích hoạt: " + formatNotificationPrice(message.TriggerPrice),
		"Thời điểm kích hoạt: " + triggeredAt,
		"Múi giờ hiển thị: " + timeZoneLabel,
		"Nguồn xử lý: " + integrationSourceLabel(message.Source),
	}
	if note := cleanNotificationText(message.Note, 500); note != "" {
		lines = append(lines, "Ghi chú: "+note)
	}
	return strings.Join(lines, "\n")
}
func (h *Handler) sendConfigured(v IntegrationRecord, channel, text string) error {
	client := &http.Client{Timeout: 5 * time.Second}
	var req *http.Request
	switch channel {
	case "telegram":
		token, e := h.secretBox.Open(v.TelegramBotToken)
		if e != nil || token == "" || v.TelegramChatID == "" {
			return errors.New("Telegram is not configured")
		}
		bodyBytes, _ := json.Marshal(fiber.Map{"chat_id": v.TelegramChatID, "text": text, "disable_web_page_preview": true})
		body := string(bodyBytes)
		req, _ = http.NewRequest(http.MethodPost, "https://api.telegram.org/bot"+token+"/sendMessage", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
	case "discord":
		url, e := h.secretBox.Open(v.DiscordWebhook)
		if e != nil || url == "" || !validDiscordWebhook(url) {
			return errors.New("Discord is not configured")
		}
		bodyBytes, _ := json.Marshal(fiber.Map{"content": text, "allowed_mentions": fiber.Map{"parse": []string{}}})
		req, _ = http.NewRequest(http.MethodPost, url, strings.NewReader(string(bodyBytes)))
		req.Header.Set("Content-Type", "application/json")
	default:
		return errors.New("unsupported channel")
	}
	resp, err := client.Do(req)
	if err != nil {
		return errors.New("delivery failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if channel == "telegram" {
			var telegramError struct {
				Description string `json:"description"`
			}
			if json.NewDecoder(io.LimitReader(resp.Body, 8*1024)).Decode(&telegramError) == nil && telegramError.Description != "" {
				return fmt.Errorf("Telegram rejected request: %s", telegramError.Description)
			}
		}
		return fmt.Errorf("%s delivery rejected with HTTP %d", strings.Title(channel), resp.StatusCode)
	}
	return nil
}
