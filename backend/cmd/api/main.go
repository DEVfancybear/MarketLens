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
	"github.com/smc-trading-terminal/backend/internal/users"
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
	// account are available. Otherwise the /api/v1/auth routes stay unmounted.
	var authHandler *auth.Handler
	switch {
	case pool == nil:
		log.Warn().Msg("auth routes disabled: no database configured")
	case !cfg.FirebaseConfigured():
		log.Warn().Msg("auth routes disabled: Firebase service account not configured")
	default:
		verifier, verr := auth.NewVerifier(ctx, cfg)
		if verr != nil {
			stdlog.Fatalf("auth init error: %v", verr)
		}
		tokens := auth.NewTokenService(cfg)
		sessions := auth.NewSessionService(auth.NewPgSessionStore(gen.New(pool.Pool)), cfg)
		svc := auth.NewService(verifier, users.NewRepo(pool.Pool), sessions, tokens)
		authHandler = auth.NewHandler(svc, tokens, cfg)
		log.Info().Msg("auth routes enabled")
	}

	srv := httpserver.New(cfg, pool, authHandler)

	if err := srv.Start(ctx); err != nil {
		stdlog.Fatalf("server error: %v", err)
	}

	fmt.Println("shutdown complete")
}
