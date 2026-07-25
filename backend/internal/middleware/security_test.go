package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v3"
)

func TestRequireAllowedOrigin(t *testing.T) {
	app := fiber.New()
	app.Use(RequireAllowedOrigin([]string{"https://app.example.com"}))
	app.Post("/change", func(c fiber.Ctx) error { return c.SendStatus(http.StatusNoContent) })

	for _, tc := range []struct {
		name, origin, cookie string
		want                 int
	}{
		{name: "allowed browser", origin: "https://app.example.com", want: http.StatusNoContent},
		{name: "cross site blocked", origin: "https://evil.example", want: http.StatusForbidden},
		{name: "worker without origin", want: http.StatusNoContent},
		{name: "cookie mutation without origin blocked", cookie: "access_token=secret", want: http.StatusForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/change", nil)
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			if tc.cookie != "" {
				req.Header.Set("Cookie", tc.cookie)
			}
			res, err := app.Test(req)
			if err != nil {
				t.Fatal(err)
			}
			if res.StatusCode != tc.want {
				t.Fatalf("status = %d, want %d", res.StatusCode, tc.want)
			}
		})
	}
}

func TestSecurityHeaders(t *testing.T) {
	app := fiber.New()
	app.Use(SecurityHeaders())
	app.Get("/", func(c fiber.Ctx) error { return c.SendString("ok") })
	res, err := app.Test(httptest.NewRequest(http.MethodGet, "/", nil))
	if err != nil {
		t.Fatal(err)
	}
	if got := res.Header.Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q", got)
	}
	if got := res.Header.Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q", got)
	}
}

func TestRequireAllowedOriginBlocksCrossOriginWebSocket(t *testing.T) {
	app := fiber.New()
	app.Use(RequireAllowedOrigin([]string{"https://app.example.com"}))
	app.Get("/stream", func(c fiber.Ctx) error { return c.SendStatus(http.StatusSwitchingProtocols) })
	req := httptest.NewRequest(http.MethodGet, "/stream", nil)
	req.Header.Set("Origin", "https://evil.example")
	req.Header.Set("Upgrade", "websocket")
	res, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", res.StatusCode, http.StatusForbidden)
	}
}
