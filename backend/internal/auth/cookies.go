package auth

import (
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/marketlens/backend/internal/config"
)

const (
	// AccessCookieName carries the short-lived access JWT; sent on every API call.
	AccessCookieName = "access_token"
	// RefreshCookieName carries the opaque refresh token; scoped to the auth
	// routes so it is only sent where it is actually needed.
	RefreshCookieName = "refresh_token"

	accessCookiePath  = "/"
	refreshCookiePath = "/api/v1/auth"

	// The execution package validates and owns this cookie. Auth logout also
	// expires it so signing out cannot leave a browser trade session unlocked.
	tradeUnlockCookieName         = "trade_unlock"
	hardenedTradeUnlockCookieName = "__Host-trade_unlock"
	tradeUnlockCookiePath         = "/api/v1/execution"
)

// SetAuthCookies writes the access + refresh tokens as hardened cookies:
// HttpOnly, SameSite=Strict, and Secure according to the environment/configured
// override. Max-Age mirrors each token's TTL.
func SetAuthCookies(c fiber.Ctx, cfg config.Config, access, refresh string) {
	secure := cfg.AuthCookiesSecure()

	c.Cookie(&fiber.Cookie{
		Name:     AccessCookieName,
		Value:    access,
		Path:     accessCookiePath,
		MaxAge:   int(cfg.AuthAccessTTL.Seconds()),
		HTTPOnly: true,
		Secure:   secure,
		SameSite: "Strict",
	})
	c.Cookie(&fiber.Cookie{
		Name:     RefreshCookieName,
		Value:    refresh,
		Path:     refreshCookiePath,
		MaxAge:   int(cfg.AuthRefreshTTL.Seconds()),
		HTTPOnly: true,
		Secure:   secure,
		SameSite: "Strict",
	})
}

// ClearAuthCookies expires both auth cookies and the browser trade unlock.
// Path/flags must match the originals for the browser to overwrite them.
func ClearAuthCookies(c fiber.Ctx, cfg config.Config) {
	secure := cfg.AuthCookiesSecure()
	expired := time.Now().Add(-time.Hour)

	c.Cookie(&fiber.Cookie{
		Name:     AccessCookieName,
		Value:    "",
		Path:     accessCookiePath,
		MaxAge:   -1,
		Expires:  expired,
		HTTPOnly: true,
		Secure:   secure,
		SameSite: "Strict",
	})
	c.Cookie(&fiber.Cookie{
		Name:     RefreshCookieName,
		Value:    "",
		Path:     refreshCookiePath,
		MaxAge:   -1,
		Expires:  expired,
		HTTPOnly: true,
		Secure:   secure,
		SameSite: "Strict",
	})
	tradeCookieName := tradeUnlockCookieName
	tradeCookiePath := tradeUnlockCookiePath
	if secure {
		tradeCookieName = hardenedTradeUnlockCookieName
		tradeCookiePath = "/"
	}
	c.Cookie(&fiber.Cookie{
		Name:     tradeCookieName,
		Value:    "",
		Path:     tradeCookiePath,
		MaxAge:   -1,
		Expires:  expired,
		HTTPOnly: true,
		Secure:   secure,
		SameSite: "Strict",
	})
}
