package middleware

import (
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/requestid"
	"github.com/rs/zerolog/log"
)

// Logging emits one structured zerolog line per request, preserving the fields
// the previous net/http middleware logged (method, path, status, latency) and
// adding the request id from the requestid middleware.
func Logging() fiber.Handler {
	return func(c fiber.Ctx) error {
		start := time.Now()

		err := c.Next()

		// On error the central ErrorHandler runs after this middleware unwinds,
		// so the response status isn't set yet — derive it from the error.
		status := requestStatus(c.Response().StatusCode(), err)

		event := log.Info()
		if id := requestid.FromContext(c); id != "" {
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

func requestStatus(responseStatus int, err error) int {
	if err == nil {
		return responseStatus
	}
	if apiErr, ok := err.(interface{ HTTPStatus() int }); ok {
		return apiErr.HTTPStatus()
	}
	if fe, ok := err.(*fiber.Error); ok {
		return fe.Code
	}
	return fiber.StatusInternalServerError
}
