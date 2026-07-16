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
	if duplicate.ArmingRevision != created.ArmingRevision+1 {
		t.Fatalf("arming revision should advance on price change: created=%d duplicate=%d", created.ArmingRevision, duplicate.ArmingRevision)
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

	fixedEvidence := TriggerInput{
		ArmingRevision: patched.ArmingRevision,
		Previous:       &TechnicalEvidencePoint{Price: 1.129, Timestamp: 1_750_000_000},
		Current:        &TechnicalEvidencePoint{Price: 1.131, Timestamp: 1_750_000_001},
	}
	_, _, err = repo.Trigger(ctx, userID, created.ClientID, fixedEvidence)
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("disabled trigger error = %v, want ErrBadRequest", err)
	}
	enabled = true
	patched, err = repo.Patch(ctx, userID, created.ClientID, PatchInput{Enabled: &enabled})
	if err != nil {
		t.Fatalf("enable alert: %v", err)
	}

	triggered, event, err := repo.Trigger(ctx, userID, created.ClientID, fixedEvidence)
	if err != nil {
		t.Fatalf("trigger alert: %v", err)
	}
	if triggered.Status != "triggered" || event.AlertID != created.ClientID {
		t.Fatalf("unexpected trigger: alert=%+v event=%+v", triggered, event)
	}
	if triggered.ArmingRevision != patched.ArmingRevision {
		t.Fatalf("trigger changed arming revision: before=%d after=%d", patched.ArmingRevision, triggered.ArmingRevision)
	}
	if !event.TriggeredAt.Equal(evidenceTimestamp(fixedEvidence.Current.Timestamp)) {
		t.Fatalf("event triggeredAt = %v, want evidence time", event.TriggeredAt)
	}
	_, _, err = repo.Trigger(ctx, userID, created.ClientID, fixedEvidence)
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

	dynamicTarget := &TechnicalAlertTarget{
		Version:       1,
		Kind:          "dynamic-line",
		A:             &TechnicalAlertPoint{Time: 1_750_000_000, Price: 1.12},
		B:             &TechnicalAlertPoint{Time: 1_750_003_600, Price: 1.13},
		Domain:        "ray",
		Interpolation: "linear",
	}
	dynamic, err := repo.Create(ctx, userID, CreateInput{
		ClientID:        "alert-dynamic-integration-1",
		Symbol:          "EURUSD",
		Condition:       "crossUp",
		Price:           1.125,
		TechnicalTarget: dynamicTarget,
	})
	if err != nil {
		t.Fatalf("create dynamic alert: %v", err)
	}
	if dynamic.TechnicalTarget == nil || dynamic.TechnicalTarget.Domain != "ray" {
		t.Fatalf("dynamic target did not round trip on create: %+v", dynamic)
	}
	note := "notification-only edit"
	notificationEdit, err := repo.Patch(ctx, userID, dynamic.ClientID, PatchInput{Note: &note})
	if err != nil {
		t.Fatalf("patch dynamic notification metadata: %v", err)
	}
	if notificationEdit.ArmingRevision != dynamic.ArmingRevision {
		t.Fatalf("notification edit re-armed alert: before=%d after=%d", dynamic.ArmingRevision, notificationEdit.ArmingRevision)
	}
	dynamic = notificationEdit
	dynamicRetry, err := repo.Create(ctx, userID, CreateInput{
		ClientID: "alert-dynamic-integration-1", Symbol: "EURUSD", Condition: "crossUp", Price: 1.126,
	})
	if err != nil {
		t.Fatalf("retry dynamic alert without target: %v", err)
	}
	if dynamicRetry.ID != dynamic.ID || dynamicRetry.TechnicalTarget == nil {
		t.Fatalf("idempotent upsert should preserve technical target: %+v", dynamicRetry)
	}
	items, err := repo.List(ctx, userID, "active")
	if err != nil {
		t.Fatalf("list dynamic alerts: %v", err)
	}
	foundDynamic := false
	for _, item := range items {
		if item.ClientID == dynamic.ClientID {
			foundDynamic = item.TechnicalTarget != nil && item.TechnicalTarget.Kind == "dynamic-line"
		}
	}
	if !foundDynamic {
		t.Fatalf("list did not preserve dynamic technical target: %+v", items)
	}
	patchedTarget := *dynamicTarget
	patchedTarget.Domain = "infinite"
	dynamic, err = repo.Patch(ctx, userID, dynamic.ClientID, PatchInput{
		TechnicalTarget: &patchedTarget,
	})
	if err != nil {
		t.Fatalf("patch dynamic technical target: %v", err)
	}
	if dynamic.TechnicalTarget == nil || dynamic.TechnicalTarget.Domain != "infinite" {
		t.Fatalf("patched dynamic target did not round trip: %+v", dynamic.TechnicalTarget)
	}
	_, _, err = repo.Trigger(ctx, userID, dynamic.ClientID, TriggerInput{
		ArmingRevision: dynamic.ArmingRevision,
		Current:        &TechnicalEvidencePoint{Price: 1.141, Timestamp: 1_750_007_200},
	})
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("dynamic cross trigger without previous evidence error = %v, want ErrBadRequest", err)
	}
	evaluatedTarget := 1.14
	triggerPrice := 1.141
	_, dynamicEvent, err := repo.Trigger(ctx, userID, dynamic.ClientID, TriggerInput{
		TriggerPrice:   &triggerPrice,
		TargetPrice:    &evaluatedTarget,
		ArmingRevision: dynamic.ArmingRevision,
		Previous:       &TechnicalEvidencePoint{Price: 1.139, Timestamp: 1_750_007_100},
		Current:        &TechnicalEvidencePoint{Price: triggerPrice, Timestamp: 1_750_007_200},
	})
	if err != nil {
		t.Fatalf("trigger dynamic alert: %v", err)
	}
	if dynamicEvent.TargetPrice != evaluatedTarget {
		t.Fatalf("dynamic event target price = %v, want %v", dynamicEvent.TargetPrice, evaluatedTarget)
	}
	if err := repo.Delete(ctx, userID, dynamic.ClientID); err != nil {
		t.Fatalf("delete dynamic alert: %v", err)
	}

	expiring, err := repo.Create(ctx, userID, CreateInput{
		ClientID: "alert-expiration-integration-1", Symbol: "EURUSD", Condition: "above", Price: 1.2,
	})
	if err != nil {
		t.Fatalf("create expiring alert: %v", err)
	}
	expiredStatus := "expired"
	expired, err := repo.Patch(ctx, userID, expiring.ClientID, PatchInput{Status: &expiredStatus})
	if err != nil {
		t.Fatalf("expire alert: %v", err)
	}
	if expired.Status != "expired" || expired.ArmingRevision != expiring.ArmingRevision {
		t.Fatalf("unexpected expired alert: %+v", expired)
	}
	expiredItems, err := repo.List(ctx, userID, "expired")
	if err != nil || len(expiredItems) != 1 || expiredItems[0].ID != expiring.ID {
		t.Fatalf("expired list = %+v, err=%v", expiredItems, err)
	}
	snapshot, err := repo.Snapshot(ctx, userID)
	if err != nil || len(snapshot.ExpiredAlerts) != 1 || snapshot.ExpiredAlerts[0].ID != expiring.ID {
		t.Fatalf("expired snapshot = %+v, err=%v", snapshot.ExpiredAlerts, err)
	}
	activeStatus := "active"
	rearmed, err := repo.Patch(ctx, userID, expiring.ClientID, PatchInput{Status: &activeStatus})
	if err != nil || rearmed.ArmingRevision != expired.ArmingRevision+1 {
		t.Fatalf("rearm expired alert = %+v, err=%v", rearmed, err)
	}
	if err := repo.Delete(ctx, userID, expiring.ClientID); err != nil {
		t.Fatalf("delete expiring alert: %v", err)
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
