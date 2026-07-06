package main

import (
	"context"
	"fmt"
	stdlog "log"
	"os"
	"os/signal"
	"syscall"

	"github.com/rs/zerolog/log"
	"github.com/smc-trading-terminal/backend/internal/config"
	"github.com/smc-trading-terminal/backend/internal/db"
	"github.com/smc-trading-terminal/backend/internal/httpserver"
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

	srv := httpserver.New(cfg, pool)

	if err := srv.Start(ctx); err != nil {
		stdlog.Fatalf("server error: %v", err)
	}

	fmt.Println("shutdown complete")
}
