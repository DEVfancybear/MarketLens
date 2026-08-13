package execution

import (
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/limiter"
	"github.com/marketlens/backend/internal/auth"
)

const (
	executionRequestRateLimitMax            = 1200
	executionRequestRateLimitWindow         = time.Minute
	executionMutationRateLimitMax           = 180
	executionMutationRateLimitWindow        = time.Minute
	executionTradingRateLimitMax            = 60
	executionTradingRateLimitWindow         = time.Minute
	executionPairingRateLimitMax            = 10
	executionPairingRateLimitWindow         = 5 * time.Minute
	executionConnectorRateLimitMax          = 6
	executionConnectorRateLimitWindow       = 5 * time.Minute
	executionConnectorWorkerRateLimitMax    = 30
	executionConnectorWorkerRateLimitWindow = time.Minute
)

func newExecutionRateLimiter(maximum int, window time.Duration) fiber.Handler {
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
				"too many execution requests",
			)
		},
	})
}
