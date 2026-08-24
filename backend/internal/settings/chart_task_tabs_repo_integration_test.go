package settings

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Run only against a migrated disposable/dev database. The dedicated variable
// prevents ordinary test runs from mutating DATABASE_URL accidentally.
func TestChartTaskTabsRepoSerializesCompetingRevisions(t *testing.T) {
	databaseURL := os.Getenv("CHART_TASK_TABS_INTEGRATION_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("CHART_TASK_TABS_INTEGRATION_DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	email := fmt.Sprintf("chart-task-tabs-integration-%d@example.test", time.Now().UnixNano())
	var userID string
	if err := pool.QueryRow(ctx, `INSERT INTO users (email) VALUES ($1) RETURNING id`, email).Scan(&userID); err != nil {
		t.Fatalf("create test user: %v", err)
	}
	defer pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)

	repo := NewRepo(pool)
	style := raw(`{"style":"candles"}`)
	if _, err := repo.Patch(ctx, userID, Patch{Chart: &style}); err != nil {
		t.Fatalf("seed unrelated chart settings: %v", err)
	}

	documents := []ChartTaskTabsDocument{
		{
			Version:      1,
			ActiveTaskID: "writer-a",
			Tasks:        []ChartTask{chartTask("writer-a", "scope-a")},
		},
		{
			Version:      1,
			ActiveTaskID: "writer-b",
			Tasks:        []ChartTask{chartTask("writer-b", "scope-b")},
		},
	}

	start := make(chan struct{})
	results := make(chan error, len(documents))
	var writers sync.WaitGroup
	for _, document := range documents {
		document := document
		writers.Add(1)
		go func() {
			defer writers.Done()
			<-start
			_, writeErr := repo.ReplaceChartTaskTabs(ctx, userID, ChartTaskTabsWrite{
				ExpectedRevision: 0,
				Document:         document,
			})
			results <- writeErr
		}()
	}
	close(start)
	writers.Wait()
	close(results)

	successes := 0
	conflicts := 0
	for result := range results {
		switch {
		case result == nil:
			successes++
		case errors.Is(result, ErrChartTaskTabsConflict):
			conflicts++
		default:
			t.Fatalf("unexpected competing write error: %v", result)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("competing writes: successes=%d conflicts=%d, want 1/1", successes, conflicts)
	}

	saved, err := repo.GetChartTaskTabs(ctx, userID)
	if err != nil {
		t.Fatalf("get saved chart task tabs: %v", err)
	}
	if saved.Revision != 1 || len(saved.Tasks) != 1 {
		t.Fatalf("saved task tabs = %#v, want one task at revision 1", saved)
	}
	if saved.ActiveTaskID != "writer-a" && saved.ActiveTaskID != "writer-b" {
		t.Fatalf("saved active task %q is not either competing writer", saved.ActiveTaskID)
	}
	settings, err := repo.Get(ctx, userID)
	if err != nil {
		t.Fatalf("get settings after task write: %v", err)
	}
	if chart := object(t, settings.Chart); chart["style"] != "candles" {
		t.Fatalf("task write replaced unrelated chart settings: %#v", chart)
	}
}
