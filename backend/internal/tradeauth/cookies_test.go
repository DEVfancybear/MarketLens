package tradeauth

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v3"

	"github.com/marketlens/backend/internal/config"
)

func TestTradeUnlockCookieIsHardenedAndNonPersistent(t *testing.T) {
	app := fiber.New()
	app.Get("/set", func(c fiber.Ctx) error {
		setTradeUnlockCookie(c, config.Config{Env: "production"}, "opaque")
		return c.SendStatus(fiber.StatusNoContent)
	})

	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/set", nil))
	if err != nil {
		t.Fatal(err)
	}
	var cookie *http.Cookie
	for _, candidate := range response.Cookies() {
		if candidate.Name == hardenedTradeUnlockCookieName {
			cookie = candidate
			break
		}
	}
	if cookie == nil {
		t.Fatal("trade unlock cookie was not set")
	}
	if !cookie.HttpOnly || !cookie.Secure ||
		cookie.SameSite != http.SameSiteStrictMode {
		t.Fatalf("trade unlock cookie is not hardened: %+v", cookie)
	}
	if cookie.Path != "/" {
		t.Fatalf("cookie path = %q", cookie.Path)
	}
	if cookie.MaxAge != 0 || !cookie.Expires.IsZero() {
		t.Fatalf("trade unlock must be a non-persistent session cookie: %+v", cookie)
	}
}
