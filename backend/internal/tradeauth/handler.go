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

	"github.com/smc-trading-terminal/backend/internal/auth"
)

type Handler struct {
	service         *Service
	requireAuth     fiber.Handler
	requireActive   fiber.Handler
	ceremonyLimit   fiber.Handler
	enrollmentLimit fiber.Handler
}

func NewHandler(
	service *Service,
	requireAuth fiber.Handler,
	requireActive fiber.Handler,
) *Handler {
	return &Handler{
		service:         service,
		requireAuth:     requireAuth,
		requireActive:   requireActive,
		ceremonyLimit:   newUserRateLimiter(120, time.Minute),
		enrollmentLimit: newUserRateLimiter(10, 10*time.Minute),
	}
}

func (h *Handler) Register(router fiber.Router) {
	router.Get("/execution/passkeys", h.requireAuth, h.requireActive, h.list)
	router.Post("/execution/passkeys/register/options", h.requireAuth, h.enrollmentLimit, h.requireActive, h.beginRegistration)
	router.Post("/execution/passkeys/register/verify", h.requireAuth, h.enrollmentLimit, h.requireActive, h.finishRegistration)
	router.Post("/execution/authorizations/options", h.requireAuth, h.ceremonyLimit, h.requireActive, h.beginAuthorization)
	router.Post("/execution/authorizations/verify", h.requireAuth, h.ceremonyLimit, h.requireActive, h.finishAuthorization)
}

func (h *Handler) list(c fiber.Ctx) error {
	items, err := h.service.ListCredentials(c.Context(), userID(c))
	if err != nil {
		return serviceError(err)
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.JSON(fiber.Map{"passkeys": items})
}

func (h *Handler) beginRegistration(c fiber.Ctx) error {
	var request struct {
		IDToken string `json:"idToken"`
	}
	if err := decodeStrict(c.Body(), &request); err != nil ||
		strings.TrimSpace(request.IDToken) == "" ||
		len(request.IDToken) > auth.MaxIDTokenLength {
		return fiber.NewError(fiber.StatusBadRequest, "valid idToken is required")
	}
	result, err := h.service.BeginRegistration(
		c.Context(), userID(c), sessionID(c), request.IDToken,
	)
	if err != nil {
		return serviceError(err)
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.JSON(result)
}

func (h *Handler) finishRegistration(c fiber.Ctx) error {
	var request struct {
		ChallengeID string          `json:"challengeId"`
		Label       string          `json:"label"`
		Credential  json.RawMessage `json:"credential"`
	}
	if err := decodeStrict(c.Body(), &request); err != nil ||
		!validChallengeID(request.ChallengeID) ||
		len(request.Credential) == 0 {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	result, err := h.service.FinishRegistration(
		c.Context(), userID(c), sessionID(c), request.ChallengeID,
		request.Label, request.Credential,
	)
	if err != nil {
		return serviceError(err)
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.Status(fiber.StatusCreated).JSON(result)
}

func (h *Handler) beginAuthorization(c fiber.Ctx) error {
	var request struct {
		Operation string          `json:"operation"`
		Payload   json.RawMessage `json:"payload"`
	}
	if err := decodeStrict(c.Body(), &request); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	result, err := h.service.BeginAuthorization(
		c.Context(), userID(c), sessionID(c), request.Operation, request.Payload,
	)
	if err != nil {
		return serviceError(err)
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.JSON(result)
}

func (h *Handler) finishAuthorization(c fiber.Ctx) error {
	var request struct {
		ChallengeID string          `json:"challengeId"`
		Operation   string          `json:"operation"`
		Payload     json.RawMessage `json:"payload"`
		Credential  json.RawMessage `json:"credential"`
	}
	if err := decodeStrict(c.Body(), &request); err != nil ||
		!validChallengeID(request.ChallengeID) ||
		len(request.Credential) == 0 {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	result, err := h.service.FinishAuthorization(
		c.Context(), userID(c), sessionID(c), request.ChallengeID,
		request.Operation, request.Payload, request.Credential,
	)
	if err != nil {
		return serviceError(err)
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.JSON(result)
}

func userID(c fiber.Ctx) string {
	value, _ := c.Locals(auth.LocalUserID).(string)
	return value
}

func sessionID(c fiber.Ctx) string {
	value, _ := c.Locals(auth.LocalSessionID).(string)
	return value
}

func validChallengeID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for _, character := range value {
		if (character >= '0' && character <= '9') ||
			(character >= 'a' && character <= 'f') ||
			character == '-' {
			continue
		}
		return false
	}
	return true
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
	case errors.Is(err, ErrPasskeyRequired):
		return fiber.NewError(fiber.StatusPreconditionRequired, "trade passkey required")
	case errors.Is(err, ErrCeremonyRejected), errors.Is(err, ErrAuthorizationRejected):
		return fiber.NewError(fiber.StatusForbidden, "passkey verification failed")
	default:
		log.Error().Err(err).Msg("passkey service request failed")
		return fiber.NewError(fiber.StatusInternalServerError, "passkey service unavailable")
	}
}
