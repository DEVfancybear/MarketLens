package health

import (
	"time"

	"github.com/gofiber/fiber/v2"
)

type HealthResponse struct {
	Status    string `json:"status"`
	Timestamp string `json:"timestamp"`
}

func RegisterRoutes(app *fiber.App) {
	app.Get("/health", handleHealth)
}

func handleHealth(c *fiber.Ctx) error {
	return c.JSON(HealthResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	})
}
