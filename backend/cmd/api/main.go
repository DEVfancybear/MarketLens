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
	"github.com/smc-trading-terminal/backend/internal/httpserver"
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
	var workspaceHandler *workspace.Handler
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
		workspaceHandler = workspace.NewHandler(settingsStore, watchlistsStore, requireAuth)
		log.Info().Msg("protected api routes enabled")
	}

	srv := httpserver.New(cfg, pool, authHandler, settingsHandler, watchlistsHandler, workspaceHandler)

	if err := srv.Start(ctx); err != nil {
		stdlog.Fatalf("server error: %v", err)
	}

	fmt.Println("shutdown complete")
}
