package middleware

import (
	"net/url"
	"strings"

	"github.com/gofiber/fiber/v3"
)

// SecurityHeaders applies browser hardening to every API response. CSP is left
// to the frontend because this service returns JSON and websocket traffic only.
func SecurityHeaders() fiber.Handler {
	return func(c fiber.Ctx) error {
		c.Set(fiber.HeaderXContentTypeOptions, "nosniff")
		c.Set(fiber.HeaderXFrameOptions, "DENY")
		c.Set(fiber.HeaderReferrerPolicy, "no-referrer")
		c.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		c.Set(fiber.HeaderCacheControl, "no-store")
		return c.Next()
	}
}

// RequireAllowedOrigin is CSRF protection for cookie-authenticated mutations.
// CORS controls whether a browser exposes a response; it does not stop a
// browser from sending a cross-origin form request. Non-browser clients that do
// not send Origin remain supported for workers and health tooling, but an
// unsafe request carrying browser cookies must always prove its origin.
func RequireAllowedOrigin(origins []string) fiber.Handler {
	allowed := make(map[string]struct{}, len(origins))
	for _, raw := range origins {
		if normalized := normalizeOrigin(raw); normalized != "" {
			allowed[normalized] = struct{}{}
		}
	}

	return func(c fiber.Ctx) error {
		isWebSocket := strings.EqualFold(strings.TrimSpace(c.Get(fiber.HeaderUpgrade)), "websocket")
		if isSafeMethod(c.Method()) && !isWebSocket {
			return c.Next()
		}
		raw := strings.TrimSpace(c.Get(fiber.HeaderOrigin))
		if raw == "" {
			if strings.TrimSpace(c.Get(fiber.HeaderCookie)) != "" {
				return fiber.NewError(fiber.StatusForbidden, "origin required")
			}
			return c.Next()
		}
		if _, ok := allowed[normalizeOrigin(raw)]; !ok {
			return fiber.NewError(fiber.StatusForbidden, "origin not allowed")
		}
		return c.Next()
	}
}

func normalizeOrigin(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return ""
	}
	return strings.ToLower(u.Scheme) + "://" + strings.ToLower(u.Host)
}

func isSafeMethod(method string) bool {
	switch method {
	case fiber.MethodGet, fiber.MethodHead, fiber.MethodOptions:
		return true
	default:
		return false
	}
}
