package auth

import (
	"context"

	"github.com/gofiber/fiber/v3"
	"github.com/rs/zerolog/log"
)

// Locals keys populated by RequireAuth.
const (
	LocalUserID    = "user_id"
	LocalSessionID = "session_id"
)

// RequireAuth is Fiber middleware that authenticates a request from the
// access_token cookie. On success it stores the user id + session id in
// c.Locals; on any failure it returns 401 (formatted by the central
// ErrorHandler into the standard error envelope).
func RequireAuth(tokens *TokenService) fiber.Handler {
	return func(c fiber.Ctx) error {
		raw := c.Cookies(AccessCookieName)
		if raw == "" {
			return fiber.NewError(fiber.StatusUnauthorized, "unauthorized")
		}
		claims, err := tokens.ParseAccess(raw)
		if err != nil {
			return fiber.NewError(fiber.StatusUnauthorized, "unauthorized")
		}
		c.Locals(LocalUserID, claims.UserID)
		c.Locals(LocalSessionID, claims.SessionID)
		return c.Next()
	}
}

// SessionActivityChecker is the minimum server-side session contract needed
// by sensitive API mutations.
type SessionActivityChecker interface {
	IsActive(ctx context.Context, sessionID, userID string) (bool, error)
}

// RequireActiveSession makes logout and server-side revocation immediate for
// sensitive operations. It must run after RequireAuth, which verifies the JWT
// and populates the exact user/session pair in Fiber locals.
func RequireActiveSession(sessions SessionActivityChecker) fiber.Handler {
	return func(c fiber.Ctx) error {
		userID, userOK := c.Locals(LocalUserID).(string)
		sessionID, sessionOK := c.Locals(LocalSessionID).(string)
		if !userOK || !sessionOK || userID == "" || sessionID == "" {
			return fiber.NewError(fiber.StatusUnauthorized, "unauthorized")
		}
		active, err := sessions.IsActive(c.Context(), sessionID, userID)
		if err != nil {
			log.Error().Err(err).Msg("active session verification failed")
			return fiber.NewError(
				fiber.StatusServiceUnavailable,
				"authentication service unavailable",
			)
		}
		if !active {
			return fiber.NewError(fiber.StatusUnauthorized, "unauthorized")
		}
		return c.Next()
	}
}
