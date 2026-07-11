package journal

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Run against a migrated disposable/dev database. The dedicated variable keeps
// ordinary unit tests from mutating DATABASE_URL implicitly.
func TestRepoIntegrationJournalAndScreenshotLifecycle(t *testing.T) {
	databaseURL := os.Getenv("JOURNAL_INTEGRATION_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("JOURNAL_INTEGRATION_DATABASE_URL is not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	email := fmt.Sprintf("journal-integration-%d@example.test", time.Now().UnixNano())
	var userID string
	if err := pool.QueryRow(ctx, `INSERT INTO users (email) VALUES ($1) RETURNING id`, email).Scan(&userID); err != nil {
		t.Fatalf("create user: %v", err)
	}
	storageKey := fmt.Sprintf("users/%s/journal/integration.png", userID)
	defer pool.Exec(context.Background(), `DELETE FROM object_deletion_queue WHERE storage_key=$1`, storageKey)
	defer pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, userID)

	repo := NewRepo(pool)
	pnl, rr, risk, exit := 100.0, 2.0, 50.0, 1.11
	exitTime := time.Now().UTC()
	input := CreateInput{ClientID: "journal-integration-1", Symbol: "EURUSD", Side: "long",
		EntryTime: exitTime.Add(-time.Hour), ExitTime: &exitTime, EntryPrice: 1.1, ExitPrice: &exit,
		Quantity: 1, PnL: &pnl, RR: &rr, RiskAmount: &risk, Tags: []string{"breakout"}}
	created, err := repo.Create(ctx, userID, input)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	input.Notes = "idempotent update"
	duplicate, err := repo.Create(ctx, userID, input)
	if err != nil {
		t.Fatalf("idempotent create: %v", err)
	}
	if duplicate.ID != created.ID || duplicate.Notes != input.Notes {
		t.Fatalf("upsert mismatch: first=%+v second=%+v", created, duplicate)
	}

	items, err := repo.List(ctx, userID, ListFilter{Symbol: "EURUSD", Tag: "breakout", Limit: 10})
	if err != nil || len(items) != 1 {
		t.Fatalf("filtered list items=%+v err=%v", items, err)
	}
	notes, tags := "reviewed", []string{"reviewed"}
	updated, err := repo.Update(ctx, userID, input.ClientID, UpdateInput{Notes: &notes, Tags: &tags})
	if err != nil || updated.Notes != notes || len(updated.Tags) != 1 {
		t.Fatalf("update=%+v err=%v", updated, err)
	}

	width, height, size := 1280, 720, int64(12345)
	shot, err := repo.CreateScreenshot(ctx, userID, ScreenshotInput{JournalEntryID: input.ClientID,
		Phase: "before", StorageKey: storageKey, Width: &width, Height: &height, SizeBytes: &size, ContentType: "image/png"})
	if err != nil {
		t.Fatalf("create screenshot: %v", err)
	}
	fetched, err := repo.Get(ctx, userID, input.ClientID)
	if err != nil || len(fetched.Screenshots) != 1 || fetched.Screenshots[0].ID != shot.ID {
		t.Fatalf("entry screenshots=%+v err=%v", fetched.Screenshots, err)
	}

	if err := repo.Delete(ctx, userID, input.ClientID); err != nil {
		t.Fatalf("delete entry: %v", err)
	}
	if _, err := repo.GetScreenshot(ctx, userID, shot.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("screenshot after cascade err=%v", err)
	}
	var queued bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM object_deletion_queue WHERE storage_key=$1)`, storageKey).Scan(&queued); err != nil || !queued {
		t.Fatalf("blob cleanup queue queued=%v err=%v", queued, err)
	}
}
