package settings

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/rs/zerolog/log"

	"github.com/smc-trading-terminal/backend/internal/mt5verify"
)

type MT5Verifier = mt5verify.AccountVerifier
type MT5VerifyCredentials = mt5verify.Credentials
type MT5VerifyResult = mt5verify.Result
type MT5AccountSummary = mt5verify.AccountSummary

func (h *Handler) WithMT5Verifier(verifier MT5Verifier) *Handler {
	h.mt5Verifier = verifier
	h.mt5VerifierUnavailableCode = ""
	h.mt5VerifierUnavailableMessage = ""
	return h
}

func (h *Handler) WithMT5VerifierUnavailable(code, message string) *Handler {
	h.mt5Verifier = nil
	h.mt5VerifierUnavailableCode = strings.TrimSpace(code)
	h.mt5VerifierUnavailableMessage = strings.TrimSpace(message)
	return h
}

func (h *Handler) verifyMT5Integration(c *fiber.Ctx) error {
	if h.mt5Verifier == nil {
		code := h.mt5VerifierUnavailableCode
		if code == "" {
			code = "MT5_VERIFIER_UNAVAILABLE"
		}
		message := h.mt5VerifierUnavailableMessage
		if message == "" {
			message = "MT5 verifier is not configured"
		}
		return mt5VerificationError(c, fiber.StatusServiceUnavailable, code, message)
	}

	uid := userID(c)
	record, err := h.integrationStore.Get(c.Context(), uid)
	if err != nil {
		return fiber.ErrInternalServerError
	}

	login := strings.TrimSpace(record.MT5Login)
	server := strings.TrimSpace(record.MT5Server)
	if login == "" || server == "" || len(record.MT5Password) == 0 {
		return mt5VerificationError(c, fiber.StatusBadRequest, "MT5_CREDENTIALS_INCOMPLETE", "MT5 login, server, and password are required")
	}
	parsedLogin, err := strconv.ParseUint(login, 10, 64)
	if err != nil || parsedLogin == 0 {
		return mt5VerificationError(c, fiber.StatusBadRequest, "MT5_LOGIN_INVALID", "MT5 login must be a positive integer")
	}

	password, err := h.secretBox.Open(record.MT5Password)
	if err != nil {
		return fiber.ErrInternalServerError
	}
	if password == "" {
		return mt5VerificationError(c, fiber.StatusBadRequest, "MT5_CREDENTIALS_INCOMPLETE", "MT5 login, server, and password are required")
	}

	result, err := h.mt5Verifier.Verify(c.Context(), MT5VerifyCredentials{
		Login:    login,
		Server:   server,
		Password: password,
	})
	if err != nil {
		log.Warn().Err(err).Msg("MT5 credential verification failed")
		if errors.Is(err, context.DeadlineExceeded) {
			return mt5VerificationError(c, fiber.StatusGatewayTimeout, "MT5_VERIFICATION_TIMEOUT", "MT5 verification timed out; confirm the dedicated broker terminal and exact server name, then try again")
		}
		return mt5VerificationError(c, fiber.StatusBadGateway, "MT5_VERIFICATION_UNAVAILABLE", "MT5 verification could not be completed")
	}
	if !result.Verified {
		unchanged, clearErr := h.integrationStore.ClearMT5Verified(
			c.Context(), uid, login, server, record.MT5Password,
		)
		if clearErr != nil {
			return fiber.ErrInternalServerError
		}
		if !unchanged {
			return mt5VerificationError(c, fiber.StatusConflict, "MT5_CREDENTIALS_CHANGED", "MT5 credentials changed during verification; verify the saved account again")
		}
		code := strings.TrimSpace(result.Code)
		if code == "" {
			code = "MT5_VERIFICATION_FAILED"
		}
		message := strings.TrimSpace(result.Message)
		if message == "" {
			message = "MT5 login failed"
		}
		return mt5VerificationError(c, fiber.StatusUnprocessableEntity, code, message)
	}
	if result.Account == nil {
		return mt5VerificationError(c, fiber.StatusBadGateway, "MT5_ACCOUNT_UNAVAILABLE", "MT5 verification returned no account")
	}

	verifiedAt := time.Now().UTC()
	record, unchanged, err := h.integrationStore.MarkMT5Verified(
		c.Context(), uid, login, server, record.MT5Password, verifiedAt,
	)
	if err != nil {
		return fiber.ErrInternalServerError
	}
	if !unchanged {
		return mt5VerificationError(c, fiber.StatusConflict, "MT5_CREDENTIALS_CHANGED", "MT5 credentials changed during verification; verify the saved account again")
	}

	return c.JSON(fiber.Map{
		"ok":      true,
		"mt5":     integrationView(record, uid, h.secretBox).MT5,
		"account": result.Account,
	})
}

func mt5VerificationError(c *fiber.Ctx, status int, code, message string) error {
	return c.Status(status).JSON(fiber.Map{
		"ok": false,
		"error": fiber.Map{
			"code":    code,
			"message": message,
		},
	})
}
