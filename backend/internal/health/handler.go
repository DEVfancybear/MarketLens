package health

import (
	"context"
	"time"

	"github.com/gofiber/fiber/v3"
)

// Pinger is the subset of the DB pool the readiness probe needs. Keeping it an
// interface lets health stay decoupled from pgx (and lets the probe report
// "not ready" when no pool is configured).
type Pinger interface {
	Ping(ctx context.Context) error
}

type HealthResponse struct {
	Status    string `json:"status"`
	Timestamp string `json:"timestamp"`
}

type ReadyResponse struct {
	Ready     bool   `json:"ready"`
	Database  string `json:"database"` // "up" | "down" | "unconfigured"
	Timestamp string `json:"timestamp"`
}

// RegisterRoutes mounts liveness (/health, DB-free) and readiness
// (/health/ready, pings the DB). db may be nil when no pool is configured.
func RegisterRoutes(app *fiber.App, db Pinger) {
	app.Get("/health", handleHealth)
	app.Get("/health/ready", readinessHandler(db))
}

func handleHealth(c fiber.Ctx) error {
	return c.JSON(HealthResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	})
}

func readinessHandler(db Pinger) fiber.Handler {
	return func(c fiber.Ctx) error {
		now := time.Now().UTC().Format(time.RFC3339)

		if db == nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(ReadyResponse{
				Ready:     false,
				Database:  "unconfigured",
				Timestamp: now,
			})
		}

		ctx, cancel := context.WithTimeout(c.Context(), 2*time.Second)
		defer cancel()
		if err := db.Ping(ctx); err != nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(ReadyResponse{
				Ready:     false,
				Database:  "down",
				Timestamp: now,
			})
		}

		return c.JSON(ReadyResponse{
			Ready:     true,
			Database:  "up",
			Timestamp: now,
		})
	}
}
