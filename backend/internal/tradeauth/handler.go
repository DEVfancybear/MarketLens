package tradeauth

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/rs/zerolog/log"

	"github.com/marketlens/backend/internal/auth"
	"github.com/marketlens/backend/internal/config"
)

type Handler struct {
	service              *Service
	cfg                  config.Config
	requireAuth          fiber.Handler
	requireActive        fiber.Handler
	authorizationLimit   fiber.Handler
	configurationLimiter fiber.Handler
	recoveryRequestLimit fiber.Handler
	recoveryConfirmLimit fiber.Handler
}

func NewHandler(
	service *Service,
	requireAuth fiber.Handler,
	requireActive fiber.Handler,
	cfg config.Config,
) *Handler {
	return &Handler{
		service:              service,
		cfg:                  cfg,
		requireAuth:          requireAuth,
		requireActive:        requireActive,
		authorizationLimit:   newUserRateLimiter(120, time.Minute),
		configurationLimiter: newUserRateLimiter(10, 10*time.Minute),
		recoveryRequestLimit: newUserRateLimiter(3, 15*time.Minute),
		recoveryConfirmLimit: newUserRateLimiter(10, 15*time.Minute),
	}
}

func (h *Handler) Register(router fiber.Router) {
	router.Get(
		"/execution/trade-security",
		h.requireAuth,
		h.requireActive,
		h.status,
	)
	router.Put(
		"/execution/trade-security",
		h.requireAuth,
		h.configurationLimiter,
		h.requireActive,
		h.configure,
	)
	router.Post(
		"/execution/authorizations",
		h.requireAuth,
		h.authorizationLimit,
		h.requireActive,
		h.authorize,
	)
	router.Delete(
		"/execution/trade-security/unlock",
		h.requireAuth,
		h.requireActive,
		h.lock,
	)
	router.Post(
		"/execution/trade-security/recovery",
		h.requireAuth,
		h.recoveryRequestLimit,
		h.requireActive,
		h.requestRecovery,
	)
	router.Post(
		"/execution/trade-security/recovery/confirm",
		h.requireAuth,
		h.recoveryConfirmLimit,
		h.requireActive,
		h.confirmRecovery,
	)
}

func (h *Handler) status(c fiber.Ctx) error {
	result, err := h.service.Status(
		c.Context(),
		userID(c),
		sessionID(c),
		c.Cookies(h.unlockCookieName()),
	)
	if err != nil {
		return serviceError(err)
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.JSON(result)
}

func (h *Handler) configure(c fiber.Ctx) error {
	var request struct {
		Enabled         bool   `json:"enabled"`
		Password        string `json:"password"`
		CurrentPassword string `json:"currentPassword"`
		IDToken         string `json:"idToken"`
	}
	if err := decodeStrict(c.Body(), &request); err != nil ||
		strings.TrimSpace(request.IDToken) == "" ||
		len(request.IDToken) > auth.MaxIDTokenLength ||
		len(request.Password) > maxTradePasswordBytes ||
		len(request.CurrentPassword) > maxTradePasswordBytes {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	result, err := h.service.Configure(
		c.Context(),
		userID(c),
		request.IDToken,
		request.Enabled,
		request.Password,
		request.CurrentPassword,
	)
	if err != nil {
		return serviceError(err)
	}
	clearTradeUnlockCookie(c, h.cfg)
	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.JSON(result)
}

func (h *Handler) authorize(c fiber.Ctx) error {
	var request struct {
		Operation string          `json:"operation"`
		Payload   json.RawMessage `json:"payload"`
		Password  string          `json:"password"`
	}
	if err := decodeStrict(c.Body(), &request); err != nil ||
		len(request.Password) > maxTradePasswordBytes {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	result, err := h.service.Authorize(
		c.Context(),
		userID(c),
		sessionID(c),
		request.Operation,
		request.Payload,
		request.Password,
		c.Cookies(h.unlockCookieName()),
	)
	if err != nil {
		return serviceError(err)
	}
	if result.UnlockToken != "" {
		setTradeUnlockCookie(c, h.cfg, result.UnlockToken)
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.JSON(result)
}

func (h *Handler) lock(c fiber.Ctx) error {
	if err := h.service.Lock(c.Context(), userID(c), sessionID(c)); err != nil {
		return serviceError(err)
	}
	clearTradeUnlockCookie(c, h.cfg)
	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.JSON(fiber.Map{"ok": true})
}

func (h *Handler) requestRecovery(c fiber.Ctx) error {
	var request struct {
		IDToken string `json:"idToken"`
	}
	if err := decodeStrict(c.Body(), &request); err != nil ||
		strings.TrimSpace(request.IDToken) == "" ||
		len(request.IDToken) > auth.MaxIDTokenLength {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	result, err := h.service.RequestPasswordRecovery(
		c.Context(),
		userID(c),
		request.IDToken,
	)
	if err != nil {
		return serviceError(err)
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.JSON(result)
}

func (h *Handler) confirmRecovery(c fiber.Ctx) error {
	var request struct {
		IDToken  string `json:"idToken"`
		Code     string `json:"code"`
		Password string `json:"password"`
	}
	if err := decodeStrict(c.Body(), &request); err != nil ||
		strings.TrimSpace(request.IDToken) == "" ||
		len(request.IDToken) > auth.MaxIDTokenLength ||
		len(request.Code) != recoveryCodeDigits ||
		len(request.Password) > maxTradePasswordBytes {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	result, err := h.service.ConfirmPasswordRecovery(
		c.Context(),
		userID(c),
		request.IDToken,
		request.Code,
		request.Password,
	)
	if err != nil {
		return serviceError(err)
	}
	clearTradeUnlockCookie(c, h.cfg)
	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.JSON(result)
}

func (h *Handler) unlockCookieName() string {
	name, _ := tradeUnlockCookieScope(h.cfg)
	return name
}

func userID(c fiber.Ctx) string {
	value, _ := c.Locals(auth.LocalUserID).(string)
	return value
}

func sessionID(c fiber.Ctx) string {
	value, _ := c.Locals(auth.LocalSessionID).(string)
	return value
}

func decodeStrict(body []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}

func serviceError(err error) error {
	switch {
	case errors.Is(err, auth.ErrUnauthorized):
		return fiber.NewError(fiber.StatusUnauthorized, "unauthorized")
	case errors.Is(err, ErrPasswordRequired):
		return fiber.NewError(fiber.StatusPreconditionRequired, "trade password required")
	case errors.Is(err, ErrPasswordInvalid):
		return fiber.NewError(fiber.StatusForbidden, "trade password verification failed")
	case errors.Is(err, ErrPasswordLocked):
		return fiber.NewError(fiber.StatusTooManyRequests, "trade password temporarily locked")
	case errors.Is(err, ErrPasswordNotConfigured):
		return fiber.NewError(fiber.StatusConflict, "set a trade password before enabling protection")
	case errors.Is(err, ErrPasswordPolicy):
		return fiber.NewError(
			fiber.StatusBadRequest,
			"trade password must be 8-128 characters and not commonly used",
		)
	case errors.Is(err, ErrAuthorizationRejected):
		return fiber.NewError(fiber.StatusBadRequest, "invalid trade authorization request")
	case errors.Is(err, ErrRecoveryUnavailable):
		return fiber.NewError(fiber.StatusServiceUnavailable, "trade password recovery email is unavailable")
	case errors.Is(err, ErrRecoveryEmailUnverified):
		return fiber.NewError(fiber.StatusConflict, "a verified account email is required")
	case errors.Is(err, ErrRecoveryCooldown):
		return fiber.NewError(fiber.StatusTooManyRequests, "wait before requesting another confirmation code")
	case errors.Is(err, ErrRecoveryCodeInvalid):
		return fiber.NewError(fiber.StatusForbidden, "confirmation code is invalid")
	case errors.Is(err, ErrRecoveryCodeExpired):
		return fiber.NewError(fiber.StatusGone, "confirmation code has expired")
	case errors.Is(err, ErrRecoveryAttemptsExceeded):
		return fiber.NewError(fiber.StatusTooManyRequests, "request a new confirmation code")
	default:
		log.Error().Err(err).Msg("trade authorization service request failed")
		return fiber.NewError(fiber.StatusInternalServerError, "trade authorization service unavailable")
	}
}
