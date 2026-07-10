package alerts

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Run with ALERTS_INTEGRATION_DATABASE_URL set to a migrated disposable/dev
// database. The explicit variable prevents ordinary unit tests from mutating a
// configured production DATABASE_URL by accident.
func TestRepoIntegrationAlertLifecycleAndPushToken(t *testing.T) {
	databaseURL := os.Getenv("ALERTS_INTEGRATION_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("ALERTS_INTEGRATION_DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	email := fmt.Sprintf("alerts-integration-%d@example.test", time.Now().UnixNano())
	var userID string
	if err := pool.QueryRow(ctx, `INSERT INTO users (email) VALUES ($1) RETURNING id`, email).Scan(&userID); err != nil {
		t.Fatalf("create test user: %v", err)
	}
	defer pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)

	repo := NewRepo(pool)
	created, err := repo.Create(ctx, userID, CreateInput{
		ClientID:  "alert-integration-1",
		Symbol:    "EURUSD",
		Condition: "crossUp",
		Price:     1.12,
		Channels:  &Channels{Sound: true, Push: true},
	})
	if err != nil {
		t.Fatalf("create alert: %v", err)
	}
	duplicate, err := repo.Create(ctx, userID, CreateInput{
		ClientID:  "alert-integration-1",
		Symbol:    "EURUSD",
		Condition: "crossUp",
		Price:     1.125,
	})
	if err != nil {
		t.Fatalf("idempotent create: %v", err)
	}
	if duplicate.ID != created.ID || duplicate.Price != 1.125 {
		t.Fatalf("create should upsert same row: created=%+v duplicate=%+v", created, duplicate)
	}

	enabled := false
	price := 1.13
	patched, err := repo.Patch(ctx, userID, created.ClientID, PatchInput{
		Price:   &price,
		Enabled: &enabled,
	})
	if err != nil {
		t.Fatalf("patch alert: %v", err)
	}
	if patched.Enabled || patched.Price != price {
		t.Fatalf("unexpected patch result: %+v", patched)
	}

	_, _, err = repo.Trigger(ctx, userID, created.ClientID, 1.131)
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("disabled trigger error = %v, want ErrBadRequest", err)
	}
	enabled = true
	patched, err = repo.Patch(ctx, userID, created.ClientID, PatchInput{Enabled: &enabled})
	if err != nil {
		t.Fatalf("enable alert: %v", err)
	}

	triggered, event, err := repo.Trigger(ctx, userID, created.ClientID, 1.131)
	if err != nil {
		t.Fatalf("trigger alert: %v", err)
	}
	if triggered.Status != "triggered" || event.AlertID != created.ClientID {
		t.Fatalf("unexpected trigger: alert=%+v event=%+v", triggered, event)
	}
	if !triggered.UpdatedAt.Equal(patched.UpdatedAt) {
		t.Fatalf("trigger changed arming revision: before=%v after=%v", patched.UpdatedAt, triggered.UpdatedAt)
	}
	_, _, err = repo.Trigger(ctx, userID, created.ClientID, 1.131)
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("duplicate one-time trigger error = %v, want ErrBadRequest", err)
	}
	if err := repo.Delete(ctx, userID, created.ClientID); err != nil {
		t.Fatalf("delete alert: %v", err)
	}
	history, err := repo.ListHistory(ctx, userID, MaxHistory)
	if err != nil {
		t.Fatalf("list retained history: %v", err)
	}
	if len(history) != 1 || history[0].AlertID != created.ClientID {
		t.Fatalf("history should survive alert delete: %+v", history)
	}

	token, err := repo.UpsertPushToken(ctx, userID, PushTokenInput{
		FCMToken:   "integration-token",
		Platform:   "web",
		Permission: "granted",
	})
	if err != nil {
		t.Fatalf("upsert token: %v", err)
	}
	updatedToken, err := repo.UpsertPushToken(ctx, userID, PushTokenInput{
		FCMToken:   "integration-token",
		Platform:   "web",
		Permission: "default",
	})
	if err != nil {
		t.Fatalf("refresh token: %v", err)
	}
	if updatedToken.ID != token.ID || updatedToken.Permission != "default" {
		t.Fatalf("token should update in place: before=%+v after=%+v", token, updatedToken)
	}
	if err := repo.DeletePushToken(ctx, userID, "integration-token"); err != nil {
		t.Fatalf("delete token: %v", err)
	}
}
