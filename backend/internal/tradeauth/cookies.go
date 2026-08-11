package tradeauth

import (
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/marketlens/backend/internal/config"
)

const (
	tradeUnlockCookieName         = "trade_unlock"
	hardenedTradeUnlockCookieName = "__Host-trade_unlock"
	tradeUnlockCookiePath         = "/api/v1/execution"
)

func tradeUnlockCookieScope(cfg config.Config) (name, path string) {
	if cfg.AuthCookiesSecure() {
		// __Host- prevents Domain scoping or subdomain cookie injection. The
		// browser requires Secure and Path=/ for this prefix.
		return hardenedTradeUnlockCookieName, "/"
	}
	return tradeUnlockCookieName, tradeUnlockCookiePath
}

func setTradeUnlockCookie(c fiber.Ctx, cfg config.Config, token string) {
	name, path := tradeUnlockCookieScope(cfg)
	c.Cookie(&fiber.Cookie{
		Name:     name,
		Value:    token,
		Path:     path,
		HTTPOnly: true,
		Secure:   cfg.AuthCookiesSecure(),
		SameSite: "Strict",
		// Intentionally omit Max-Age and Expires. This is a browser-session
		// cookie shared by tabs and removed on normal browser shutdown.
	})
}

func clearTradeUnlockCookie(c fiber.Ctx, cfg config.Config) {
	name, path := tradeUnlockCookieScope(cfg)
	c.Cookie(&fiber.Cookie{
		Name:     name,
		Value:    "",
		Path:     path,
		MaxAge:   -1,
		Expires:  time.Now().Add(-time.Hour),
		HTTPOnly: true,
		Secure:   cfg.AuthCookiesSecure(),
		SameSite: "Strict",
	})
}
