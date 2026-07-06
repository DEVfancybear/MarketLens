// Package db owns the PostgreSQL connection pool and (via generated code in
// internal/db/gen) the type-safe queries. It holds no domain logic.
package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Pool wraps a pgx connection pool. It is safe for concurrent use.
type Pool struct {
	*pgxpool.Pool
}

// New builds a pgx pool from a Postgres connection URL and verifies it with a
// Ping before returning. The caller owns Close().
func New(ctx context.Context, databaseURL string) (*Pool, error) {
	if databaseURL == "" {
		return nil, fmt.Errorf("db: DATABASE_URL is empty")
	}

	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("db: parse config: %w", err)
	}

	// Sensible pool defaults; tune via the URL query string if needed.
	cfg.MaxConns = 10
	cfg.MinConns = 0
	cfg.MaxConnLifetime = time.Hour
	cfg.MaxConnIdleTime = 30 * time.Minute
	cfg.HealthCheckPeriod = time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("db: create pool: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("db: ping: %w", err)
	}

	return &Pool{Pool: pool}, nil
}

// Ping verifies a live connection can be acquired from the pool. Used by the
// readiness probe.
func (p *Pool) Ping(ctx context.Context) error {
	return p.Pool.Ping(ctx)
}

// Close releases all pooled connections.
func (p *Pool) Close() {
	p.Pool.Close()
}
