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
func (f fakeRuntimeBars) ListReplayDatasetBarsThroughSeq(_ context.Context, arg gen.ListReplayDatasetBarsThroughSeqParams) ([]gen.ReplayDatasetBar, error) {
	var out []gen.ReplayDatasetBar
	for _, bar := range f.bars {
		if bar.Seq <= arg.Seq {
			out = append(out, bar)
		}
	}
	return out, nil
}
func (f fakeRuntimeBars) ListReplayDatasetBarsBySeqRange(_ context.Context, arg gen.ListReplayDatasetBarsBySeqRangeParams) ([]gen.ReplayDatasetBar, error) {
	var out []gen.ReplayDatasetBar
	for _, bar := range f.bars {
		if bar.Seq > arg.Seq && bar.Seq <= arg.Seq_2 {
			out = append(out, bar)
		}
	}
	return out, nil
}

func runtimeFixture() (fakeRuntimeBars, gen.ReplaySession, gen.ListReplayTracksForSessionForUpdateRow) {
	start := time.Unix(1_700_000_000, 0).UTC()
	bars := make([]gen.ReplayDatasetBar, 6)
	for i := range bars {
		bars[i] = gen.ReplayDatasetBar{Seq: int64(i), OpenTime: timestamp(start.Add(time.Duration(i) * time.Minute)), IntervalSeconds: 60,
			Open: numeric(float64(i + 1)), High: numeric(float64(i + 2)), Low: numeric(float64(i)),
			Close: numeric(float64(i) + 1.5), Volume: numeric(10)}
	}
	session := gen.ReplaySession{Status: gen.ReplaySessionStatusPaused, Speed: numeric(1), ReplayIntervalSeconds: 60,
		StartTime: bars[1].OpenTime, SimulatedTime: bars[1].OpenTime}
	track := gen.ListReplayTracksForSessionForUpdateRow{
		CursorSeq: 1, VisibleThrough: bars[1].OpenTime, RowCount: int32(len(bars)), BaseIntervalSeconds: 60,
		FirstTime: bars[0].OpenTime, LastTime: bars[len(bars)-1].OpenTime, DatasetID: pgtype.UUID{Bytes: [16]byte{1}, Valid: true}, ChartTimeframe: "1m",
	}
	return fakeRuntimeBars{bars: bars}, session, track
}

func TestRuntimeOneReplayIntervalProcessesEveryBaseRow(t *testing.T) {
	bars, session, track := runtimeFixture()
	session.ReplayIntervalSeconds = 180
	track.ChartTimeframe = "15m"
	drafts, changed, err := applyRuntimeTransition(context.Background(), bars, &session, &track, CommandInput{Type: "step", Payload: []byte(`{"count":1}`)})
	if err != nil {
		t.Fatal(err)
	}
	if !changed || track.CursorSeq != 4 || session.SimulatedTime.Time != bars.bars[4].OpenTime.Time {
		t.Fatalf("session=%#v track=%#v", session, track)
	}
	upserts := 0
	for _, draft := range drafts {
		if draft.typ == "track.bar.upsert" {
			upserts++
		}
	}
	state, err := parseAggregateState(track.AggregateState)
	if err != nil || state.LastSourceSeq != 4 || upserts != 1 {
		t.Fatalf("state=%#v upserts=%d drafts=%#v err=%v", state, upserts, drafts, err)
	}
}

func TestRuntimeFastClockEmitsOneOrderedBarBatch(t *testing.T) {
	bars, session, track := runtimeFixture()
	session.Status = gen.ReplaySessionStatusPlaying
	drafts, changed, err := applyRuntimeTransition(context.Background(), bars, &session, &track, CommandInput{
		Type: "__clock_step", Payload: []byte(`{"count":3}`),
	})
	if err != nil || !changed {
		t.Fatalf("changed=%t err=%v", changed, err)
	}
	batches, upserts := 0, 0
	for _, draft := range drafts {
		switch draft.typ {
		case "track.bars.batch":
			batches++
			payload := draft.payload.(map[string]any)
			if got := len(payload["bars"].([]ReplayBar)); got != 3 {
				t.Fatalf("batch bars=%d", got)
			}
		case "track.bar.upsert":
			upserts++
		}
	}
	if batches != 1 || upserts != 0 || track.CursorSeq != 4 {
		t.Fatalf("batches=%d upserts=%d cursor=%d drafts=%#v", batches, upserts, track.CursorSeq, drafts)
	}
}

func TestRuntimeSynchronizedStepAdvancesEveryTrackAtOneBarrier(t *testing.T) {
	bars, session, first := runtimeFixture()
	second := first
	first.ID = pgtype.UUID{Bytes: [16]byte{11}, Valid: true}
	second.ID = pgtype.UUID{Bytes: [16]byte{12}, Valid: true}
	second.ChartTimeframe = "5m"
	tracks := []gen.ListReplayTracksForSessionForUpdateRow{first, second}
	drafts, changed, err := applyRuntimeTransitionTracks(context.Background(), bars, &session, tracks, CommandInput{
		Type: "step", Payload: []byte(`{"count":2}`),
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !changed || tracks[0].CursorSeq != 3 || tracks[1].CursorSeq != 3 || !session.SimulatedTime.Time.Equal(bars.bars[3].OpenTime.Time) {
		t.Fatalf("session=%#v tracks=%#v", session, tracks)
	}
	cursorEvents := 0
	for _, draft := range drafts {
		if draft.typ == "cursor.advanced" {
			cursorEvents++
		}
	}
	if cursorEvents != 2 {
		t.Fatalf("expected a cursor event per track, got %#v", drafts)
	}
}

func TestRuntimeSynchronizedAutoIntervalUsesEveryTrack(t *testing.T) {
	_, session, first := runtimeFixture()
	first.ChartTimeframe = "15m"
	second := first
	second.ChartTimeframe = "1H"
	tracks := []gen.ListReplayTracksForSessionForUpdateRow{first, second}
	_, changed, err := applySynchronizedReplayInterval(&session, tracks, CommandInput{
		Type: "set_replay_interval", Payload: []byte(`{"replayInterval":"auto"}`),
	})
	if err != nil || !changed || session.ReplayIntervalSeconds != 900 {
		t.Fatalf("interval=%d changed=%t err=%v", session.ReplayIntervalSeconds, changed, err)
	}
}

func TestRuntimeSynchronizedBarrierDoesNotFabricateBarsAcrossMarketGap(t *testing.T) {
	bars, session, first := runtimeFixture()
	for i := 2; i < len(bars.bars); i++ {
		bars.bars[i].OpenTime = timestamp(session.SimulatedTime.Time.Add(time.Duration(i+3) * time.Minute))
	}
	first.LastTime = bars.bars[len(bars.bars)-1].OpenTime
	second := first
	first.ID = pgtype.UUID{Bytes: [16]byte{21}, Valid: true}
	second.ID = pgtype.UUID{Bytes: [16]byte{22}, Valid: true}
	tracks := []gen.ListReplayTracksForSessionForUpdateRow{first, second}
	drafts, changed, err := applyRuntimeTransitionTracks(context.Background(), bars, &session, tracks, CommandInput{
		Type: "step", Payload: []byte(`{"count":1}`),
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !changed || tracks[0].CursorSeq != 1 || tracks[1].CursorSeq != 1 {
		t.Fatalf("market gap fabricated a cursor: %#v", tracks)
	}
	if len(drafts) != 1 || drafts[0].typ != "state.changed" {
		t.Fatalf("market gap emitted candle events: %#v", drafts)
	}
}

func TestRuntimeSetReplayIntervalValidatesChartDivisibility(t *testing.T) {
	bars, session, track := runtimeFixture()
	track.ChartTimeframe = "15m"
	_, changed, err := applyRuntimeTransition(context.Background(), bars, &session, &track, CommandInput{
		Type: "set_replay_interval", Payload: []byte(`{"replayInterval":"5m"}`),
	})
	if err != nil || !changed || session.ReplayIntervalSeconds != 300 {
		t.Fatalf("interval=%d changed=%t err=%v", session.ReplayIntervalSeconds, changed, err)
	}
	_, _, err = applyRuntimeTransition(context.Background(), bars, &session, &track, CommandInput{
		Type: "set_replay_interval", Payload: []byte(`{"replayInterval":"4H"}`),
	})
	if !errors.Is(err, ErrUnsupportedReplayInterval) {
		t.Fatalf("expected unsupported interval, got %v", err)
	}
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
	if len(drafts) != 4 || drafts[len(drafts)-1].typ != "cursor.advanced" {
		t.Fatalf("events=%#v", drafts)
	}
}

func TestRuntimeClockCompletesAtDatasetEnd(t *testing.T) {
	bars, session, track := runtimeFixture()
	session.Status = gen.ReplaySessionStatusPlaying
	track.CursorSeq = int64(len(bars.bars) - 2)
	track.VisibleThrough = bars.bars[len(bars.bars)-2].OpenTime
	session.SimulatedTime = track.VisibleThrough
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
