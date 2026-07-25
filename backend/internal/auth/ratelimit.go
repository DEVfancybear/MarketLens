package auth

import (
	"net/netip"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/limiter"
)

const (
	authRateLimitMax    = 120
	authRateLimitWindow = 5 * time.Minute
)

func newAuthRateLimiter() fiber.Handler {
	return limiter.New(limiter.Config{
		Max:        authRateLimitMax,
		Expiration: authRateLimitWindow,
		KeyGenerator: func(c fiber.Ctx) string {
			remote := strings.TrimSpace(c.IP())
			remoteIP, err := netip.ParseAddr(remote)
			if err == nil && remoteIP.IsLoopback() {
				// Production traffic arrives through the loopback Cloudflare
				// tunnel. Cloudflare overwrites this header at the edge; only
				// trust it when the direct peer is loopback.
				if forwarded, parseErr := netip.ParseAddr(strings.TrimSpace(c.Get("CF-Connecting-IP"))); parseErr == nil {
					return forwarded.String()
				}
			}
			return remote
		},
		LimitReached: func(c fiber.Ctx) error {
			return fiber.NewError(fiber.StatusTooManyRequests, "too many authentication attempts")
		},
	})
}
