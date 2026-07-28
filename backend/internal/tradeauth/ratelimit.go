package tradeauth

import (
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/limiter"

	"github.com/smc-trading-terminal/backend/internal/auth"
)

func newUserRateLimiter(maximum int, window time.Duration) fiber.Handler {
	return limiter.New(limiter.Config{
		Max:        maximum,
		Expiration: window,
		KeyGenerator: func(c fiber.Ctx) string {
			userID, _ := c.Locals(auth.LocalUserID).(string)
			return userID
		},
		LimitReached: func(c fiber.Ctx) error {
			return fiber.NewError(
				fiber.StatusTooManyRequests,
				"too many passkey requests",
			)
		},
	})
}
