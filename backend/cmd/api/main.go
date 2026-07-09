package main

import (
	"context"
	"fmt"
	stdlog "log"
	"os"
	"os/signal"
	"syscall"

	"github.com/rs/zerolog/log"
	"github.com/smc-trading-terminal/backend/internal/auth"
	"github.com/smc-trading-terminal/backend/internal/config"
	"github.com/smc-trading-terminal/backend/internal/db"
	"github.com/smc-trading-terminal/backend/internal/db/gen"
	"github.com/smc-trading-terminal/backend/internal/drawings"
	"github.com/smc-trading-terminal/backend/internal/httpserver"
	"github.com/smc-trading-terminal/backend/internal/indicators"
	"github.com/smc-trading-terminal/backend/internal/mt5stream"
	"github.com/smc-trading-terminal/backend/internal/pineruntime"
	"github.com/smc-trading-terminal/backend/internal/pinescripts"
	"github.com/smc-trading-terminal/backend/internal/settings"
	"github.com/smc-trading-terminal/backend/internal/users"
	"github.com/smc-trading-terminal/backend/internal/watchlists"
	"github.com/smc-trading-terminal/backend/internal/workspace"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		stdlog.Fatalf("config error: %v", err)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	mt5Service := mt5stream.NewService(mt5stream.Config{
		Enabled:        cfg.MT5StreamAPIEnabled,
		BridgeURL:      cfg.MT5BridgeWSURL,
		DialTimeout:    cfg.MT5BridgeDialTimeout,
		ReadLimitBytes: cfg.MT5BridgeReadLimitBytes,
		ReconnectMin:   cfg.MT5BridgeReconnectMin,
		ReconnectMax:   cfg.MT5BridgeReconnectMax,
	})
	mt5Service.Start(ctx)
	mt5Handler := mt5stream.NewHandler(mt5Service)
	pineRuntimeHandler := pineruntime.NewHandler()

	// Connect to Postgres when a URL is configured. In local dev without a DB,
	// the server still boots and /health/ready reports the DB as unconfigured.
	var pool *db.Pool
	if cfg.DatabaseURL != "" {
		pool, err = db.New(ctx, cfg.DatabaseURL)
		if err != nil {
			stdlog.Fatalf("database error: %v", err)
		}
		defer pool.Close()
		log.Info().Msg("connected to database")
	} else {
		log.Warn().Msg("DATABASE_URL not set; starting without a database (readiness will report unconfigured)")
	}

	// Assemble the auth stack only when both a database and a Firebase service
	// account are available. Protected workspace routes use the same middleware
	// and stay unmounted when auth cannot be assembled.
	var authHandler *auth.Handler
	var settingsHandler *settings.Handler
	var watchlistsHandler *watchlists.Handler
	var drawingsHandler *drawings.Handler
	var indicatorsHandler *indicators.Handler
	var pineScriptsHandler *pinescripts.Handler
	var workspaceHandler *workspace.Handler
	var pineScriptsStore *pinescripts.Repo
	if pool != nil {
		pineScriptsStore = pinescripts.NewRepo(pool.Pool)
		pineScriptsHandler = pinescripts.NewHandler(pineScriptsStore, nil)
	}
	switch {
	case pool == nil:
		log.Warn().Msg("protected api routes disabled: no database configured")
	case !cfg.FirebaseConfigured():
		log.Warn().Msg("protected api routes disabled: Firebase service account not configured")
	default:
		verifier, verr := auth.NewVerifier(ctx, cfg)
		if verr != nil {
			stdlog.Fatalf("auth init error: %v", verr)
		}
		tokens := auth.NewTokenService(cfg)
		sessions := auth.NewSessionService(auth.NewPgSessionStore(gen.New(pool.Pool)), cfg)
		svc := auth.NewService(verifier, users.NewRepo(pool.Pool), sessions, tokens)
		authHandler = auth.NewHandler(svc, tokens, cfg)

		requireAuth := auth.RequireAuth(tokens)
		settingsStore := settings.NewRepo(pool.Pool)
		settingsHandler = settings.NewHandler(settingsStore, requireAuth)
		watchlistsStore := watchlists.NewRepo(pool.Pool)
		watchlistsHandler = watchlists.NewHandler(watchlistsStore, requireAuth)
		drawingsStore := drawings.NewRepo(pool.Pool)
		drawingsHandler = drawings.NewHandler(drawingsStore, requireAuth)
		indicatorsStore := indicators.NewRepo(pool.Pool)
		indicatorsHandler = indicators.NewHandler(indicatorsStore, requireAuth)
		pineScriptsHandler = pinescripts.NewHandler(pineScriptsStore, requireAuth)
		workspaceHandler = workspace.NewHandler(settingsStore, watchlistsStore, drawingsStore, indicatorsStore, pineScriptsStore, requireAuth)
		log.Info().Msg("protected api routes enabled")
	}

	srv := httpserver.New(
		cfg,
		pool,
		authHandler,
		settingsHandler,
		watchlistsHandler,
		drawingsHandler,
		indicatorsHandler,
		pineScriptsHandler,
		workspaceHandler,
		mt5Handler,
		pineRuntimeHandler,
	)

	if err := srv.Start(ctx); err != nil {
		stdlog.Fatalf("server error: %v", err)
	}

	fmt.Println("shutdown complete")
}
