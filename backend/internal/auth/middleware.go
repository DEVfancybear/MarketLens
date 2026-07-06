package auth

import "github.com/gofiber/fiber/v2"

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
	return func(c *fiber.Ctx) error {
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
