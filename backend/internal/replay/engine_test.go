package replay

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"
)

type fakeRuntimeStore struct {
	mu       sync.Mutex
	snapshot SessionSnapshot
	results  map[string]CommandResult
	events   []EventEnvelope
}

func newFakeRuntimeStore() *fakeRuntimeStore {
	return &fakeRuntimeStore{snapshot: SessionSnapshot{
		ID: "session", Status: "paused", Version: 1, Speed: 1, ReplayIntervalSeconds: 60,
		Tracks: []TrackSnapshot{{ID: "track", CursorSeq: 1, VisibleThrough: time.Now().UTC()}},
	}, results: map[string]CommandResult{}}
}

func (f *fakeRuntimeStore) ApplyCommand(_ context.Context, _, _ string, input CommandInput) (CommandResult, []EventEnvelope, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if result, ok := f.results[input.IdempotencyKey]; ok {
		result.Duplicate = true
		return result, nil, nil
	}
	if input.ExpectedVersion != nil && *input.ExpectedVersion != f.snapshot.Version {
		return CommandResult{}, nil, &VersionConflictError{CurrentVersion: f.snapshot.Version}
	}
	changed := false
	switch input.Type {
	case "play":
		if f.snapshot.Status == "paused" {
			f.snapshot.Status = "playing"
			changed = true
		}
	case "pause", "__pause_no_subscribers", "__pause_server_restart":
		if f.snapshot.Status == "playing" {
			f.snapshot.Status = "paused"
			changed = true
		}
	case "__clock_step":
		if f.snapshot.Status == "playing" {
			f.snapshot.Tracks[0].CursorSeq++
			f.snapshot.Tracks[0].VisibleThrough = f.snapshot.Tracks[0].VisibleThrough.Add(time.Minute)
			f.snapshot.SimulatedTime = f.snapshot.Tracks[0].VisibleThrough
			changed = true
		}
	}
	var events []EventEnvelope
	if changed {
		f.snapshot.Version++
		f.snapshot.LastEventSeq++
		payload, _ := json.Marshal(map[string]any{"status": f.snapshot.Status})
		event := EventEnvelope{SessionID: f.snapshot.ID, EventSeq: f.snapshot.LastEventSeq, Version: f.snapshot.Version,
			SimulatedTime: f.snapshot.SimulatedTime, Type: "state.changed", Payload: payload}
		f.events = append(f.events, event)
		events = []EventEnvelope{event}
	}
	result := CommandResult{CommandID: input.IdempotencyKey, Status: "applied", Snapshot: f.snapshot}
	f.results[input.IdempotencyKey] = result
	return result, events, nil
}
func (f *fakeRuntimeStore) Get(context.Context, string, string) (SessionSnapshot, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.snapshot, nil
}
func (f *fakeRuntimeStore) Events(context.Context, string, string, int64, int32) ([]EventEnvelope, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]EventEnvelope(nil), f.events...), nil
}
func (f *fakeRuntimeStore) VerifyLatestCheckpoint(context.Context, string, string) error { return nil }
func (f *fakeRuntimeStore) PlayingSessions(context.Context) ([][2]string, error)         { return nil, nil }
func (f *fakeRuntimeStore) RenewActorLease(context.Context, string, string, time.Time) (bool, error) {
	return true, nil
}
func (f *fakeRuntimeStore) ReleaseActorLease(context.Context, string, string) error { return nil }

func TestEngineSerializesAndDeduplicatesCommands(t *testing.T) {
	store := newFakeRuntimeStore()
	engine := NewEngine(store, time.Hour)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := engine.Start(ctx); err != nil {
		t.Fatal(err)
	}
	version := int64(1)
	input := CommandInput{IdempotencyKey: "play-1", ExpectedVersion: &version, Type: "play"}
	first, err := engine.Command(ctx, "user", "session", input)
	if err != nil {
		t.Fatal(err)
	}
	second, err := engine.Command(ctx, "user", "session", input)
	if err != nil {
		t.Fatal(err)
	}
	if first.Snapshot.Version != 2 || !second.Duplicate || second.Snapshot.Version != 2 {
		t.Fatalf("first=%#v second=%#v", first, second)
	}
}

func TestEngineNormalizesCommandEnvelope(t *testing.T) {
	store := newFakeRuntimeStore()
	engine := NewEngine(store, time.Hour)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := engine.Start(ctx); err != nil {
		t.Fatal(err)
	}
	version := int64(1)
	if _, err := engine.Command(ctx, "user", "session", CommandInput{
		IdempotencyKey: "  play-normalized  ", ExpectedVersion: &version, Type: " play ",
	}); err != nil {
		t.Fatal(err)
	}
	duplicate, err := engine.Command(ctx, "user", "session", CommandInput{
		IdempotencyKey: "play-normalized", ExpectedVersion: &version, Type: "play",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !duplicate.Duplicate {
		t.Fatal("trimmed idempotency key did not resolve to the original command")
	}
}

func TestEngineDuplicateHistoricalCommandDoesNotRegressActorSnapshot(t *testing.T) {
	store := newFakeRuntimeStore()
	engine := NewEngine(store, time.Hour)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := engine.Start(ctx); err != nil {
		t.Fatal(err)
	}
	version := int64(1)
	if _, err := engine.Command(ctx, "user", "session", CommandInput{
		IdempotencyKey: "historical-play", ExpectedVersion: &version, Type: "play",
	}); err != nil {
		t.Fatal(err)
	}
	version = 2
	if _, err := engine.Command(ctx, "user", "session", CommandInput{
		IdempotencyKey: "current-pause", ExpectedVersion: &version, Type: "pause",
	}); err != nil {
		t.Fatal(err)
	}
	version = 1
	duplicate, err := engine.Command(ctx, "user", "session", CommandInput{
		IdempotencyKey: "historical-play", ExpectedVersion: &version, Type: "play",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !duplicate.Duplicate || duplicate.Snapshot.Status != "playing" {
		t.Fatalf("expected stored historical result, got %#v", duplicate)
	}
	actor, err := engine.actor(ctx, "user", "session")
	if err != nil {
		t.Fatal(err)
	}
	if actor.snapshot.Status != "paused" {
		t.Fatalf("duplicate regressed actor snapshot to %s", actor.snapshot.Status)
	}
}

func TestEnginePausesAfterLastSubscriberGrace(t *testing.T) {
	store := newFakeRuntimeStore()
	engine := NewEngine(store, 20*time.Millisecond)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := engine.Start(ctx); err != nil {
		t.Fatal(err)
	}
	_, sub, err := engine.Subscribe(ctx, "user", "session")
	if err != nil {
		t.Fatal(err)
	}
	version := int64(1)
	if _, err := engine.Command(ctx, "user", "session", CommandInput{IdempotencyKey: "play-1", ExpectedVersion: &version, Type: "play"}); err != nil {
		t.Fatal(err)
	}
	sub.Close()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		snapshot, _ := store.Get(ctx, "user", "session")
		if snapshot.Status == "paused" {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("session did not pause after the last subscriber disconnected")
}

func TestEngineConcurrentExpectedVersionAllowsOneMutation(t *testing.T) {
	store := newFakeRuntimeStore()
	engine := NewEngine(store, time.Hour)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := engine.Start(ctx); err != nil {
		t.Fatal(err)
	}
	version := int64(1)
	errorsCh := make(chan error, 2)
	for _, key := range []string{"play-a", "play-b"} {
		go func(idempotencyKey string) {
			_, err := engine.Command(ctx, "user", "session", CommandInput{
				IdempotencyKey: idempotencyKey, ExpectedVersion: &version, Type: "play",
			})
			errorsCh <- err
		}(key)
	}
	successes, conflicts := 0, 0
	for range 2 {
		err := <-errorsCh
		switch {
		case err == nil:
			successes++
		case errors.Is(err, ErrVersionConflict):
			conflicts++
		default:
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("successes=%d conflicts=%d", successes, conflicts)
	}
}
