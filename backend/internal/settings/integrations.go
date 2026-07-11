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
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type IntegrationRecord struct {
	MT5Login, MT5Server, TelegramChatID           string
	MT5Password, TelegramBotToken, DiscordWebhook []byte
	TelegramEnabled, DiscordEnabled               bool
}

type MT5IntegrationView struct {
	Login              string `json:"login"`
	Server             string `json:"server"`
	PasswordConfigured bool   `json:"passwordConfigured"`
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
	return scanIntegration(r.pool.QueryRow(ctx, `SELECT mt5_login, mt5_server, mt5_password_cipher, telegram_chat_id, telegram_bot_cipher, telegram_enabled, discord_webhook_cipher, discord_enabled FROM user_integrations WHERE user_id=$1`, uid))
}

func (r *IntegrationRepo) Put(ctx context.Context, userID string, v IntegrationRecord) (IntegrationRecord, error) {
	uid, err := integrationUUID(userID)
	if err != nil {
		return IntegrationRecord{}, err
	}
	return scanIntegration(r.pool.QueryRow(ctx, `INSERT INTO user_integrations (user_id,mt5_login,mt5_server,mt5_password_cipher,telegram_chat_id,telegram_bot_cipher,telegram_enabled,discord_webhook_cipher,discord_enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(user_id) DO UPDATE SET mt5_login=EXCLUDED.mt5_login,mt5_server=EXCLUDED.mt5_server,mt5_password_cipher=EXCLUDED.mt5_password_cipher,telegram_chat_id=EXCLUDED.telegram_chat_id,telegram_bot_cipher=EXCLUDED.telegram_bot_cipher,telegram_enabled=EXCLUDED.telegram_enabled,discord_webhook_cipher=EXCLUDED.discord_webhook_cipher,discord_enabled=EXCLUDED.discord_enabled,updated_at=now() RETURNING mt5_login,mt5_server,mt5_password_cipher,telegram_chat_id,telegram_bot_cipher,telegram_enabled,discord_webhook_cipher,discord_enabled`, uid, v.MT5Login, v.MT5Server, v.MT5Password, v.TelegramChatID, v.TelegramBotToken, v.TelegramEnabled, v.DiscordWebhook, v.DiscordEnabled))
}

type integrationScanner interface{ Scan(...any) error }

func scanIntegration(row integrationScanner) (v IntegrationRecord, err error) {
	err = row.Scan(&v.MT5Login, &v.MT5Server, &v.MT5Password, &v.TelegramChatID, &v.TelegramBotToken, &v.TelegramEnabled, &v.DiscordWebhook, &v.DiscordEnabled)
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
	out.Telegram.ChatID = v.TelegramChatID
	out.Telegram.BotTokenConfigured = len(v.TelegramBotToken) > 0
	out.Telegram.Enabled = v.TelegramEnabled
	out.Discord.WebhookConfigured = len(v.DiscordWebhook) > 0
	out.Discord.Enabled = v.DiscordEnabled
	out.DeliveryToken = box.IssueDeliveryToken(userID)
	return out
}

func (h *Handler) WithIntegrations(store IntegrationStore, box *SecretBox, workerSecret string) *Handler {
	h.integrationStore = store
	h.secretBox = box
	h.workerSecret = workerSecret
	return h
}
func (h *Handler) registerIntegrationRoutes(router fiber.Router) {
	router.Get("/settings/integrations", h.requireAuth, h.getIntegrations)
	router.Put("/settings/integrations", h.requireAuth, h.putIntegrations)
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
	if req.Discord.WebhookURL != "" && !validDiscordWebhook(req.Discord.WebhookURL) {
		return fiber.NewError(400, "Discord webhook must be an official HTTPS webhook URL")
	}
	v, err := h.integrationStore.Get(c.Context(), userID(c))
	if err != nil {
		return fiber.ErrInternalServerError
	}
	v.MT5Login = strings.TrimSpace(req.MT5.Login)
	v.MT5Server = strings.TrimSpace(req.MT5.Server)
	v.TelegramChatID = strings.TrimSpace(req.Telegram.ChatID)
	v.TelegramEnabled = req.Telegram.Enabled
	v.DiscordEnabled = req.Discord.Enabled
	if req.MT5.ClearPassword {
		v.MT5Password = nil
	} else if req.MT5.Password != "" {
		v.MT5Password, err = h.secretBox.Seal(req.MT5.Password)
	}
	if req.Telegram.ClearBotToken {
		v.TelegramBotToken = nil
	} else if req.Telegram.BotToken != "" {
		v.TelegramBotToken, err = h.secretBox.Seal(req.Telegram.BotToken)
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
	if err := h.sendConfigured(v, channel, "Trading terminal test message"); err != nil {
		return fiber.NewError(502, err.Error())
	}
	return c.JSON(fiber.Map{"ok": true, "channel": channel})
}

type integrationDeliveryRequest struct {
	Message struct {
		Symbol, Condition, Note   string
		TargetPrice, TriggerPrice float64
		TriggeredAt               int64
	} `json:"message"`
	Channels struct{ Telegram, Discord bool } `json:"channels"`
}

type workerDeliveryRequest struct {
	DeliveryToken string `json:"deliveryToken"`
	Message       struct {
		Symbol, Condition, Note   string
		TargetPrice, TriggerPrice float64
		TriggeredAt               int64
	} `json:"message"`
	Channels struct{ Telegram, Discord bool } `json:"channels"`
}

func (h *Handler) deliverIntegration(c *fiber.Ctx) error {
	var in integrationDeliveryRequest
	if err := json.Unmarshal(c.Body(), &in); err != nil || in.Message.Symbol == "" {
		return fiber.NewError(400, "invalid alert message")
	}
	v, err := h.integrationStore.Get(c.Context(), userID(c))
	if err != nil {
		return fiber.ErrInternalServerError
	}
	return c.JSON(fiber.Map{"ok": true, "results": h.deliverResults(v, in)})
}

func (h *Handler) workerDeliverIntegration(c *fiber.Ctx) error {
	if h.workerSecret != "" && !hmac.Equal([]byte(c.Get("x-push-worker-secret")), []byte(h.workerSecret)) {
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
	in.Message.Symbol = raw.Message.Symbol
	in.Message.Condition = raw.Message.Condition
	in.Message.Note = raw.Message.Note
	in.Message.TargetPrice = raw.Message.TargetPrice
	in.Message.TriggerPrice = raw.Message.TriggerPrice
	in.Message.TriggeredAt = raw.Message.TriggeredAt
	in.Channels.Telegram = raw.Channels.Telegram
	in.Channels.Discord = raw.Channels.Discord
	return c.JSON(fiber.Map{"ok": true, "results": h.deliverResults(v, in)})
}

func (h *Handler) deliverResults(v IntegrationRecord, in integrationDeliveryRequest) []fiber.Map {
	text := fmt.Sprintf("Trading alert triggered\n%s %s %.8g\nTrigger price: %.8g\nTime: %s", in.Message.Symbol, in.Message.Condition, in.Message.TargetPrice, in.Message.TriggerPrice, time.UnixMilli(in.Message.TriggeredAt).UTC().Format(time.RFC3339))
	if in.Message.Note != "" {
		text += "\nNote: " + in.Message.Note
	}
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
		if e != nil || url == "" {
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
		return errors.New("delivery rejected")
	}
	return nil
}
