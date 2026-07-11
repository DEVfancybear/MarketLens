package layouts

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Run against a migrated disposable/dev database. The dedicated variable
// prevents ordinary test runs from mutating DATABASE_URL accidentally.
func TestRepoIntegrationSingleDefaultLifecycle(t *testing.T) {
	databaseURL := os.Getenv("LAYOUTS_INTEGRATION_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("LAYOUTS_INTEGRATION_DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	email := fmt.Sprintf("layouts-integration-%d@example.test", time.Now().UnixNano())
	var userID string
	if err := pool.QueryRow(ctx, `INSERT INTO users (email) VALUES ($1) RETURNING id`, email).Scan(&userID); err != nil {
		t.Fatalf("create test user: %v", err)
	}
	defer pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)

	repo := NewRepo(pool)
	first, err := repo.Create(ctx, userID, Write{
		Name: "London", Symbol: "EURUSD", Timeframe: "15m",
		State: json.RawMessage(`{"version":1,"drawings":[]}`), IsDefault: true,
	})
	if err != nil {
		t.Fatalf("create first layout: %v", err)
	}
	second, err := repo.Create(ctx, userID, Write{
		Name: "New York", Symbol: "XAUUSD", Timeframe: "5m",
		State: json.RawMessage(`{"version":1,"indicators":[]}`), IsDefault: false,
	})
	if err != nil {
		t.Fatalf("create second layout: %v", err)
	}
	second, err = repo.Update(ctx, userID, second.ID, Write{
		Name: second.Name, Symbol: second.Symbol, Timeframe: second.Timeframe,
		State: second.State, IsDefault: true,
	})
	if err != nil {
		t.Fatalf("make second default: %v", err)
	}

	items, err := repo.List(ctx, userID)
	if err != nil {
		t.Fatalf("list layouts: %v", err)
	}
	defaults := 0
	for _, item := range items {
		if item.IsDefault {
			defaults++
		}
	}
	if defaults != 1 || len(items) != 2 || items[0].ID != second.ID || !items[0].IsDefault {
		t.Fatalf("want exactly second layout as default, got %+v", items)
	}
	if items[1].ID != first.ID || items[1].IsDefault {
		t.Fatalf("first layout should no longer be default: %+v", items[1])
	}

	if err := repo.Delete(ctx, userID, second.ID); err != nil {
		t.Fatalf("delete second layout: %v", err)
	}
	items, err = repo.List(ctx, userID)
	if err != nil || len(items) != 1 || items[0].IsDefault {
		t.Fatalf("delete must not implicitly promote another default: items=%+v err=%v", items, err)
	}
}
