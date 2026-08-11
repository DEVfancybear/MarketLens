// Command migrate applies or rolls back the golang-migrate SQL migrations in
// backend/migrations against DATABASE_URL.
//
// Usage:
//
//	migrate up [N]      apply all pending migrations (or N steps up)
//	migrate down [N]    roll back N migrations (default 1; "down all" for everything)
//	migrate version     print the current schema version + dirty flag
//	migrate force <V>   set the version and clear the dirty flag (recovery)
package main

import (
	"errors"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5" // registers the "pgx5" scheme
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/joho/godotenv"
	"github.com/marketlens/backend/migrations"
)

func main() {
	_ = godotenv.Load()

	args := os.Args[1:]
	if len(args) == 0 {
		usage()
	}
	cmd := args[0]

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("migrate: DATABASE_URL is not set")
	}

	src, err := iofs.New(migrations.FS, ".")
	if err != nil {
		log.Fatalf("migrate: load sources: %v", err)
	}

	m, err := migrate.NewWithSourceInstance("iofs", src, toPgx5URL(dbURL))
	if err != nil {
		log.Fatalf("migrate: init: %v", err)
	}
	defer m.Close()

	switch cmd {
	case "up":
		err = runSteps(m, args[1:], true)
	case "down":
		err = runSteps(m, args[1:], false)
	case "version":
		printVersion(m)
		return
	case "force":
		if len(args) < 2 {
			log.Fatal("migrate: force requires a version")
		}
		v, perr := strconv.Atoi(args[1])
		if perr != nil {
			log.Fatalf("migrate: bad version %q: %v", args[1], perr)
		}
		err = m.Force(v)
	default:
		usage()
	}

	if err != nil && !errors.Is(err, migrate.ErrNoChange) {
		log.Fatalf("migrate: %s failed: %v", cmd, err)
	}
	fmt.Printf("migrate: %s ok\n", cmd)
}

// runSteps applies migrations in the given direction. With no count, up runs
// everything and down rolls back a single step (safer default than "all").
// "down all" rolls the whole schema back.
func runSteps(m *migrate.Migrate, rest []string, up bool) error {
	if len(rest) > 0 {
		if !up && rest[0] == "all" {
			return m.Down()
		}
		n, err := strconv.Atoi(rest[0])
		if err != nil {
			return fmt.Errorf("bad step count %q: %w", rest[0], err)
		}
		if !up {
			n = -n
		}
		return m.Steps(n)
	}
	if up {
		return m.Up()
	}
	return m.Steps(-1)
}

func printVersion(m *migrate.Migrate) {
	v, dirty, err := m.Version()
	if err != nil {
		if errors.Is(err, migrate.ErrNilVersion) {
			fmt.Println("migrate: no migrations applied")
			return
		}
		log.Fatalf("migrate: version: %v", err)
	}
	fmt.Printf("migrate: version=%d dirty=%t\n", v, dirty)
}

// toPgx5URL rewrites a standard postgres:// URL to the pgx5:// scheme that the
// golang-migrate pgx/v5 driver registers.
func toPgx5URL(u string) string {
	for _, prefix := range []string{"postgres://", "postgresql://"} {
		if strings.HasPrefix(u, prefix) {
			return "pgx5://" + strings.TrimPrefix(u, prefix)
		}
	}
	return u
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: migrate <up [N] | down [N|all] | version | force V>")
	os.Exit(2)
}
