package httpserver

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/gofiber/fiber/v2/middleware/requestid"
	"github.com/rs/zerolog/log"
	"github.com/smc-trading-terminal/backend/internal/auth"
	"github.com/smc-trading-terminal/backend/internal/config"
	"github.com/smc-trading-terminal/backend/internal/db"
	"github.com/smc-trading-terminal/backend/internal/drawings"
	"github.com/smc-trading-terminal/backend/internal/health"
	"github.com/smc-trading-terminal/backend/internal/indicators"
	"github.com/smc-trading-terminal/backend/internal/middleware"
	"github.com/smc-trading-terminal/backend/internal/mt5stream"
	"github.com/smc-trading-terminal/backend/internal/pinescripts"
	"github.com/smc-trading-terminal/backend/internal/settings"
	"github.com/smc-trading-terminal/backend/internal/watchlists"
	"github.com/smc-trading-terminal/backend/internal/workspace"
)

type Server struct {
	cfg config.Config
	app *fiber.App
}

// New builds the Fiber server. pool may be nil (e.g. local dev with no
// DATABASE_URL); the readiness probe then reports the database as unconfigured.
// authHandler may be nil when auth cannot be assembled (no DB or no Firebase
// config) - the protected /api/v1 routes are then simply not mounted.
func New(
	cfg config.Config,
	pool *db.Pool,
	authHandler *auth.Handler,
	settingsHandler *settings.Handler,
	watchlistsHandler *watchlists.Handler,
	drawingsHandler *drawings.Handler,
	indicatorsHandler *indicators.Handler,
	pineScriptsHandler *pinescripts.Handler,
	workspaceHandler *workspace.Handler,
	mt5Handler *mt5stream.Handler,
) *Server {
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
	app.Use(cors.New(cors.Config{
		AllowOrigins:     strings.Join(cfg.CORSAllowedOrigins, ","),
		AllowCredentials: true,
		AllowMethods:     "GET,POST,PUT,PATCH,DELETE,OPTIONS",
		AllowHeaders:     "Content-Type,Authorization",
	}))

	// Avoid the typed-nil interface trap: pass a nil Pinger (not a non-nil
	// interface wrapping a nil *db.Pool) when no pool is configured.
	var pinger health.Pinger
	if pool != nil {
		pinger = pool
	}
	health.RegisterRoutes(app, pinger)

	api := app.Group("/api/v1")
	if authHandler != nil {
		authHandler.Register(api)
	}
	if settingsHandler != nil {
		settingsHandler.Register(api)
	}
	if watchlistsHandler != nil {
		watchlistsHandler.Register(api)
	}
	if drawingsHandler != nil {
		drawingsHandler.Register(api)
	}
	if indicatorsHandler != nil {
		indicatorsHandler.Register(api)
	}
	if pineScriptsHandler != nil {
		pineScriptsHandler.Register(api)
	}
	if workspaceHandler != nil {
		workspaceHandler.Register(api)
	}
	if mt5Handler != nil {
		mt5Handler.Register(api)
	}

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
