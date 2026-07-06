package httpserver

import (
	"context"
	"fmt"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/gofiber/fiber/v2/middleware/requestid"
	"github.com/rs/zerolog/log"
	"github.com/smc-trading-terminal/backend/internal/config"
	"github.com/smc-trading-terminal/backend/internal/db"
	"github.com/smc-trading-terminal/backend/internal/health"
	"github.com/smc-trading-terminal/backend/internal/middleware"
)

type Server struct {
	cfg config.Config
	app *fiber.App
}

// New builds the Fiber server. pool may be nil (e.g. local dev with no
// DATABASE_URL); the readiness probe then reports the database as unconfigured.
func New(cfg config.Config, pool *db.Pool) *Server {
	app := fiber.New(fiber.Config{
		AppName:               "smc-trading-backend",
		DisableStartupMessage: true,
		ReadTimeout:           10 * time.Second,
		WriteTimeout:          30 * time.Second,
		IdleTimeout:           60 * time.Second,
		ErrorHandler:          errorHandler,
	})

	// Order matters: request-id first so it is available to the logger and
	// recover (which turns a panic into a 500 through ErrorHandler).
	app.Use(requestid.New())
	app.Use(recover.New())
	app.Use(middleware.Logging())

	// Avoid the typed-nil interface trap: pass a nil Pinger (not a non-nil
	// interface wrapping a nil *db.Pool) when no pool is configured.
	var pinger health.Pinger
	if pool != nil {
		pinger = pool
	}
	health.RegisterRoutes(app, pinger)

	return &Server{cfg: cfg, app: app}
}

func (s *Server) Start(ctx context.Context) error {
	errCh := make(chan error, 1)
	addr := fmt.Sprintf(":%d", s.cfg.Port)

	go func() {
		log.Info().Int("port", s.cfg.Port).Str("env", s.cfg.Env).Msg("starting HTTP server")
		// Listen returns nil once ShutdownWithContext completes, so a graceful
		// stop does not surface as an error here.
		if err := s.app.Listen(addr); err != nil {
			errCh <- err
		}
	}()

	select {
	case <-ctx.Done():
		log.Info().Msg("shutting down server...")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return s.app.ShutdownWithContext(shutdownCtx)
	case err := <-errCh:
		return err
	}
}
