package middleware

import (
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/rs/zerolog/log"
)

// Logging emits one structured zerolog line per request, preserving the fields
// the previous net/http middleware logged (method, path, status, latency) and
// adding the request id from the requestid middleware.
func Logging() fiber.Handler {
	return func(c *fiber.Ctx) error {
		start := time.Now()

		err := c.Next()

		// On error the central ErrorHandler runs after this middleware unwinds,
		// so the response status isn't set yet — derive it from the error.
		status := c.Response().StatusCode()
		if err != nil {
			if fe, ok := err.(*fiber.Error); ok {
				status = fe.Code
			} else {
				status = fiber.StatusInternalServerError
			}
		}

		event := log.Info()
		if id, ok := c.Locals("requestid").(string); ok && id != "" {
			event = event.Str("request_id", id)
		}
		event.
			Str("method", c.Method()).
			Str("path", c.Path()).
			Int("status", status).
			Dur("latency", time.Since(start)).
			Msg("request")

		return err
	}
}
