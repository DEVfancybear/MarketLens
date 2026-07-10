package replay

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/smc-trading-terminal/backend/internal/db/gen"
)

type fakeRuntimeBars struct{ bars []gen.ReplayDatasetBar }

func (f fakeRuntimeBars) GetReplayDatasetBarBySeq(_ context.Context, arg gen.GetReplayDatasetBarBySeqParams) (gen.ReplayDatasetBar, error) {
	for _, bar := range f.bars {
		if bar.Seq == arg.Seq {
			return bar, nil
		}
	}
	return gen.ReplayDatasetBar{}, errors.New("bar not found")
}
func (f fakeRuntimeBars) FindReplayDatasetBarAtOrBefore(_ context.Context, arg gen.FindReplayDatasetBarAtOrBeforeParams) (gen.ReplayDatasetBar, error) {
	var selected gen.ReplayDatasetBar
	found := false
	for _, bar := range f.bars {
		if !bar.OpenTime.Time.After(arg.OpenTime.Time) && (!found || bar.OpenTime.Time.After(selected.OpenTime.Time)) {
			selected, found = bar, true
		}
	}
	if !found {
		return gen.ReplayDatasetBar{}, errors.New("bar not found")
	}
	return selected, nil
}

func runtimeFixture() (fakeRuntimeBars, gen.ReplaySession, gen.ListReplayTracksForSessionForUpdateRow) {
	start := time.Unix(1_700_000_000, 0).UTC()
	bars := make([]gen.ReplayDatasetBar, 6)
	for i := range bars {
		bars[i] = gen.ReplayDatasetBar{Seq: int64(i), OpenTime: timestamp(start.Add(time.Duration(i) * time.Minute)), IntervalSeconds: 60}
	}
	session := gen.ReplaySession{Status: gen.ReplaySessionStatusPaused, Speed: numeric(1), StartTime: bars[1].OpenTime, SimulatedTime: bars[1].OpenTime}
	track := gen.ListReplayTracksForSessionForUpdateRow{
		CursorSeq: 1, VisibleThrough: bars[1].OpenTime, RowCount: int32(len(bars)), BaseIntervalSeconds: 60,
		FirstTime: bars[0].OpenTime, LastTime: bars[len(bars)-1].OpenTime, DatasetID: pgtype.UUID{Bytes: [16]byte{1}, Valid: true},
	}
	return fakeRuntimeBars{bars: bars}, session, track
}

func TestRuntimeStepProcessesRequestedRowsInOneCommand(t *testing.T) {
	bars, session, track := runtimeFixture()
	drafts, changed, err := applyRuntimeTransition(context.Background(), bars, &session, &track, CommandInput{Type: "step", Payload: []byte(`{"count":3}`)})
	if err != nil {
		t.Fatal(err)
	}
	if !changed || track.CursorSeq != 4 || session.SimulatedTime.Time != bars.bars[4].OpenTime.Time {
		t.Fatalf("session=%#v track=%#v", session, track)
	}
	if len(drafts) != 1 || drafts[0].typ != "cursor.advanced" {
		t.Fatalf("events=%#v", drafts)
	}
}

func TestRuntimeClockCompletesAtDatasetEnd(t *testing.T) {
	bars, session, track := runtimeFixture()
	session.Status = gen.ReplaySessionStatusPlaying
	track.CursorSeq = int64(len(bars.bars) - 2)
	track.VisibleThrough = bars.bars[len(bars.bars)-2].OpenTime
	_, changed, err := applyRuntimeTransition(context.Background(), bars, &session, &track, CommandInput{Type: "__clock_step"})
	if err != nil {
		t.Fatal(err)
	}
	if !changed || session.Status != gen.ReplaySessionStatusCompleted || track.CursorSeq != int64(len(bars.bars)-1) {
		t.Fatalf("session=%#v cursor=%d", session, track.CursorSeq)
	}
}

func TestRuntimeSeekUsesBarAtOrBefore(t *testing.T) {
	bars, session, track := runtimeFixture()
	target := bars.bars[3].OpenTime.Time.Add(59 * time.Second)
	_, changed, err := applyRuntimeTransition(context.Background(), bars, &session, &track, CommandInput{Type: "seek", Payload: []byte(`{"time":"` + target.Format(time.RFC3339) + `"}`)})
	if err != nil {
		t.Fatal(err)
	}
	if !changed || track.CursorSeq != 3 {
		t.Fatalf("cursor=%d changed=%t", track.CursorSeq, changed)
	}
}

func TestRuntimeRejectsInvalidSpeed(t *testing.T) {
	bars, session, track := runtimeFixture()
	_, _, err := applyRuntimeTransition(context.Background(), bars, &session, &track, CommandInput{Type: "set_speed", Payload: []byte(`{"speed":0}`)})
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("expected bad request, got %v", err)
	}
}

func TestRuntimeStepStopsAtConfiguredEndTime(t *testing.T) {
	bars, session, track := runtimeFixture()
	session.EndTime = bars.bars[3].OpenTime
	drafts, changed, err := applyRuntimeTransition(context.Background(), bars, &session, &track, CommandInput{Type: "step", Payload: []byte(`{"count":100}`)})
	if err != nil {
		t.Fatal(err)
	}
	if !changed || track.CursorSeq != 3 || session.Status != gen.ReplaySessionStatusCompleted {
		t.Fatalf("cursor=%d status=%s events=%#v", track.CursorSeq, session.Status, drafts)
	}
}

func TestClaimRuntimeActorRejectsAnotherActiveOwner(t *testing.T) {
	owner := "api-a"
	session := gen.ReplaySession{
		Status:          gen.ReplaySessionStatusPlaying,
		ActorOwner:      &owner,
		ActorLeaseUntil: timestamp(time.Now().UTC().Add(time.Minute)),
	}
	_, err := claimRuntimeActor(&session, CommandInput{
		Type: "pause", ActorOwner: "api-b", ActorLeaseUntil: time.Now().UTC().Add(time.Minute),
	})
	if !errors.Is(err, ErrSessionBusy) {
		t.Fatalf("expected session busy, got %v", err)
	}
	if session.ActorOwner == nil || *session.ActorOwner != "api-a" {
		t.Fatalf("active owner changed: %#v", session.ActorOwner)
	}
}

func TestClaimRuntimeActorTakesOverExpiredLease(t *testing.T) {
	owner := "api-a"
	leaseUntil := time.Now().UTC().Add(time.Minute)
	session := gen.ReplaySession{
		Status:          gen.ReplaySessionStatusPlaying,
		ActorOwner:      &owner,
		ActorLeaseUntil: timestamp(time.Now().UTC().Add(-time.Minute)),
	}
	changed, err := claimRuntimeActor(&session, CommandInput{
		Type: "pause", ActorOwner: "api-b", ActorLeaseUntil: leaseUntil,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !changed || session.ActorOwner == nil || *session.ActorOwner != "api-b" || !session.ActorLeaseUntil.Time.Equal(leaseUntil) {
		t.Fatalf("lease was not transferred: %#v", session)
	}
}
