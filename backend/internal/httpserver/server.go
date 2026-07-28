package httpserver

import (
	"context"
	"fmt"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/cors"
	"github.com/gofiber/fiber/v3/middleware/recover"
	"github.com/gofiber/fiber/v3/middleware/requestid"
	"github.com/rs/zerolog/log"
	"github.com/smc-trading-terminal/backend/internal/alerts"
	"github.com/smc-trading-terminal/backend/internal/auth"
	"github.com/smc-trading-terminal/backend/internal/config"
	"github.com/smc-trading-terminal/backend/internal/db"
	"github.com/smc-trading-terminal/backend/internal/drawings"
	"github.com/smc-trading-terminal/backend/internal/execution"
	"github.com/smc-trading-terminal/backend/internal/health"
	"github.com/smc-trading-terminal/backend/internal/indicators"
	"github.com/smc-trading-terminal/backend/internal/journal"
	"github.com/smc-trading-terminal/backend/internal/layouts"
	"github.com/smc-trading-terminal/backend/internal/middleware"
	"github.com/smc-trading-terminal/backend/internal/mt5stream"
	"github.com/smc-trading-terminal/backend/internal/pineruntime"
	"github.com/smc-trading-terminal/backend/internal/pinescripts"
	"github.com/smc-trading-terminal/backend/internal/replay"
	"github.com/smc-trading-terminal/backend/internal/settings"
	"github.com/smc-trading-terminal/backend/internal/simtrading"
	"github.com/smc-trading-terminal/backend/internal/timenavigation"
	"github.com/smc-trading-terminal/backend/internal/tradeauth"
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
	alertsHandler *alerts.Handler,
	layoutsHandler *layouts.Handler,
	workspaceHandler *workspace.Handler,
	journalHandler *journal.Handler,
	simTradingHandler *simtrading.Handler,
	executionHandler *execution.Handler,
	tradeAuthHandler *tradeauth.Handler,
	replayHandler *replay.Handler,
	mt5Handler *mt5stream.Handler,
	pineRuntimeHandler *pineruntime.Handler,
) *Server {
	app := fiber.New(fiber.Config{
		AppName:   "smc-trading-backend",
		BodyLimit: 8 * 1024 * 1024,
		// All request bodies handled by this API are JSON or WebSocket frames.
		// Avoid fasthttp's eager multipart parsing on an unsupported media path.
		DisablePreParseMultipartForm: true,
		ReadTimeout:                  10 * time.Second,
		// Leave response overhead above the verifier's 30 second hard budget.
		WriteTimeout: 40 * time.Second,
		IdleTimeout:  60 * time.Second,
		ErrorHandler: errorHandler,
	})

	// Order matters: request-id first so it is available to the logger and
	// recover (which turns a panic into a 500 through ErrorHandler).
	app.Use(requestid.New())
	app.Use(recover.New())
	app.Use(middleware.Logging())
	app.Use(middleware.SecurityHeaders())
	app.Use(middleware.RequireAllowedOrigin(cfg.CORSAllowedOrigins))
	app.Use(cors.New(cors.Config{
		AllowOrigins:     cfg.CORSAllowedOrigins,
		AllowCredentials: true,
		AllowMethods: []string{
			fiber.MethodGet,
			fiber.MethodPost,
			fiber.MethodPut,
			fiber.MethodPatch,
			fiber.MethodDelete,
			fiber.MethodOptions,
		},
		AllowHeaders: []string{
			fiber.HeaderContentType,
			fiber.HeaderAuthorization,
			"X-Trade-Authorization",
		},
	}))

	// Avoid the typed-nil interface trap: pass a nil Pinger (not a non-nil
	// interface wrapping a nil *db.Pool) when no pool is configured.
	var pinger health.Pinger
	if pool != nil {
		pinger = pool
	}
	health.RegisterRoutes(app, pinger)
	if executionHandler != nil {
		executionHandler.RegisterPublic(app)
	}

	api := app.Group("/api/v1")
	timenavigation.RegisterRoutes(api, cfg.ChartTimeZone)
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
	if alertsHandler != nil {
		alertsHandler.Register(api)
	}
	if layoutsHandler != nil {
		layoutsHandler.Register(api)
	}
	if workspaceHandler != nil {
		workspaceHandler.Register(api)
	}
	if journalHandler != nil {
		journalHandler.Register(api)
	}
	if simTradingHandler != nil {
		simTradingHandler.Register(api)
	}
	if executionHandler != nil {
		executionHandler.Register(api)
	}
	if tradeAuthHandler != nil {
		tradeAuthHandler.Register(api)
	}
	if replayHandler != nil {
		replayHandler.Register(api)
	}
	if mt5Handler != nil {
		mt5Handler.Register(api)
	}
	if pineRuntimeHandler != nil {
		pineRuntimeHandler.Register(api)
	}

	return &Server{cfg: cfg, app: app}
}

func (s *Server) Start(ctx context.Context) error {
	addr := fmt.Sprintf(":%d", s.cfg.Port)
	log.Info().Int("port", s.cfg.Port).Str("env", s.cfg.Env).Msg("starting HTTP server")
	return s.app.Listen(addr, fiber.ListenConfig{
		DisableStartupMessage: true,
		GracefulContext:       ctx,
		ShutdownTimeout:       10 * time.Second,
	})
}
