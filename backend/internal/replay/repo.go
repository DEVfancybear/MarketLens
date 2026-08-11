package replay

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/marketlens/backend/internal/db/gen"
)

type Repo struct {
	pool    *pgxpool.Pool
	queries *gen.Queries
}

func NewRepo(pool *pgxpool.Pool) *Repo { return &Repo{pool: pool, queries: gen.New(pool)} }

func (r *Repo) Prepare(ctx context.Context, userID string, prepared PreparedSession) (SessionSnapshot, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return SessionSnapshot{}, err
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return SessionSnapshot{}, err
	}
	defer tx.Rollback(ctx)
	q := r.queries.WithTx(tx)
	datasets := make([]gen.ReplayDataset, 0, len(prepared.Tracks))
	for _, track := range prepared.Tracks {
		if err := q.LockReplayDatasetChecksum(ctx, track.Checksum); err != nil {
			return SessionSnapshot{}, err
		}
		checksum := track.Checksum
		dataset, err := q.GetReadyReplayDatasetByChecksum(ctx, &checksum)
		if errors.Is(err, pgx.ErrNoRows) {
			dataset, err = q.CreateReplayDataset(ctx, gen.CreateReplayDatasetParams{
				Provider: track.Provider, Symbol: track.Symbol, SourceTimeframe: track.SourceTimeframe,
				BaseIntervalSeconds: int32(track.IntervalSeconds), SnapshotAt: timestamp(track.SnapshotAt), SourceMeta: track.SourceMeta,
			})
			if err != nil {
				return SessionSnapshot{}, err
			}
			copied, err := tx.CopyFrom(
				ctx,
				pgx.Identifier{"replay_dataset_bars"},
				[]string{"dataset_id", "seq", "open_time", "interval_seconds", "open", "high", "low", "close", "volume", "complete"},
				pgx.CopyFromSlice(len(track.Bars), func(seq int) ([]any, error) {
					bar := track.Bars[seq]
					return []any{
						dataset.ID, int64(seq), timestamp(bar.Time), int32(track.IntervalSeconds),
						numeric(bar.Open), numeric(bar.High), numeric(bar.Low), numeric(bar.Close), numeric(bar.Volume), true,
					}, nil
				}),
			)
			if err != nil {
				return SessionSnapshot{}, err
			}
			if copied != int64(len(track.Bars)) {
				return SessionSnapshot{}, fmt.Errorf("replay: copied %d of %d dataset bars", copied, len(track.Bars))
			}
			dataset, err = q.MarkReplayDatasetReady(ctx, gen.MarkReplayDatasetReadyParams{
				ID: dataset.ID, FirstTime: timestamp(track.Bars[0].Time), LastTime: timestamp(track.Bars[len(track.Bars)-1].Time),
				RowCount: int32(len(track.Bars)), ChecksumSha256: &checksum,
			})
		}
		if err != nil {
			return SessionSnapshot{}, err
		}
		datasets = append(datasets, dataset)
	}
	session, err := q.CreateReplaySession(ctx, gen.CreateReplaySessionParams{
		UserID: uid, Mode: gen.ReplaySessionMode(prepared.Mode), Speed: numeric(prepared.Speed),
		ReplayIntervalSeconds: int32(prepared.ReplayIntervalSeconds), StartTime: timestamp(prepared.StartTime),
		EndTime: optionalTimestamp(prepared.EndTime), Config: prepared.Config,
	})
	if err != nil {
		return SessionSnapshot{}, err
	}
	for i, track := range prepared.Tracks {
		_, err = q.CreateReplayTrack(ctx, gen.CreateReplayTrackParams{
			SessionID: session.ID, DatasetID: datasets[i].ID, Slot: int16(track.Slot), Symbol: track.Symbol,
			Provider: track.Provider, ChartTimeframe: track.ChartTimeframe, CursorSeq: track.CursorSeq,
			VisibleThrough: timestamp(track.VisibleThrough), AggregateState: track.AggregateState,
		})
		if err != nil {
			return SessionSnapshot{}, err
		}
	}
	if err := insertReplayAccount(ctx, tx, session.ID, prepared.Trading); err != nil {
		return SessionSnapshot{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return SessionSnapshot{}, err
	}
	snapshot, err := r.getByIDs(ctx, uid, session.ID)
	if err != nil {
		return SessionSnapshot{}, err
	}
	initialBarsBySlot := make(map[int][]ReplayBar, len(prepared.Tracks))
	for _, track := range prepared.Tracks {
		initialBarsBySlot[track.Slot] = track.InitialBars
	}
	for index := range snapshot.Tracks {
		if bars, ok := initialBarsBySlot[snapshot.Tracks[index].Slot]; ok {
			snapshot.Tracks[index].InitialBars = append([]ReplayBar(nil), bars...)
		}
	}
	return snapshot, nil
}

func (r *Repo) Get(ctx context.Context, userID, sessionID string) (SessionSnapshot, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return SessionSnapshot{}, err
	}
	sid, err := parseUUID(sessionID)
	if err != nil {
		return SessionSnapshot{}, ErrNotFound
	}
	return r.getByIDs(ctx, uid, sid)
}

func (r *Repo) Bars(ctx context.Context, userID, sessionID, trackID, requestedTimeframe string) (RevealedBarsSnapshot, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return RevealedBarsSnapshot{}, err
	}
	sid, err := parseUUID(sessionID)
	if err != nil {
		return RevealedBarsSnapshot{}, ErrNotFound
	}
	tid, err := parseUUID(trackID)
	if err != nil {
		return RevealedBarsSnapshot{}, ErrNotFound
	}
	track, err := r.queries.GetReplayTrackForUser(ctx, gen.GetReplayTrackForUserParams{ID: tid, SessionID: sid, UserID: uid})
	if errors.Is(err, pgx.ErrNoRows) {
		return RevealedBarsSnapshot{}, ErrNotFound
	}
	if err != nil {
		return RevealedBarsSnapshot{}, err
	}
	chartTimeframe := track.ChartTimeframe
	if strings.TrimSpace(requestedTimeframe) != "" {
		normalized, seconds, ok := normalizeTimeframe(requestedTimeframe)
		if !ok || seconds < int(track.BaseIntervalSeconds) {
			return RevealedBarsSnapshot{}, fmt.Errorf("%w: %q cannot be aggregated from %s", ErrUnsupportedReplayInterval, requestedTimeframe, track.SourceTimeframe)
		}
		chartTimeframe = normalized
	}
	rows, err := r.queries.ListReplayDatasetBarsThroughSeq(ctx, gen.ListReplayDatasetBarsThroughSeqParams{
		DatasetID: track.DatasetID, Seq: track.CursorSeq,
	})
	if err != nil {
		return RevealedBarsSnapshot{}, err
	}
	source := make([]sourceBar, 0, len(rows))
	for _, row := range rows {
		source = append(source, sourceBarFromRow(row))
	}
	bars, _, err := aggregateRevealedBars(chartTimeframe, source)
	if err != nil {
		return RevealedBarsSnapshot{}, err
	}
	return RevealedBarsSnapshot{
		SessionID: sessionID, TrackID: trackID, ChartTimeframe: chartTimeframe,
		CursorSeq: track.CursorSeq, VisibleThrough: track.VisibleThrough.Time, Bars: bars,
	}, nil
}

func sourceBarFromRow(row gen.ReplayDatasetBar) sourceBar {
	open, _ := row.Open.Float64Value()
	high, _ := row.High.Float64Value()
	low, _ := row.Low.Float64Value()
	closeValue, _ := row.Close.Float64Value()
	volume, _ := row.Volume.Float64Value()
	return sourceBar{Seq: row.Seq, Time: row.OpenTime.Time, IntervalSeconds: int(row.IntervalSeconds),
		Open: open.Float64, High: high.Float64, Low: low.Float64, Close: closeValue.Float64, Volume: volume.Float64}
}

func (r *Repo) Close(ctx context.Context, userID, sessionID string) (SessionSnapshot, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return SessionSnapshot{}, err
	}
	sid, err := parseUUID(sessionID)
	if err != nil {
		return SessionSnapshot{}, ErrNotFound
	}
	_, err = r.queries.CloseReplaySessionForUser(ctx, gen.CloseReplaySessionForUserParams{ID: sid, UserID: uid})
	if errors.Is(err, pgx.ErrNoRows) {
		// DELETE is idempotent for an already closed, owned session.
		return r.getByIDs(ctx, uid, sid)
	}
	if err != nil {
		return SessionSnapshot{}, err
	}
	return r.getByIDs(ctx, uid, sid)
}

func (r *Repo) Report(ctx context.Context, userID, sessionID string) (ReplayReport, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return ReplayReport{}, err
	}
	sid, err := parseUUID(sessionID)
	if err != nil {
		return ReplayReport{}, ErrNotFound
	}
	if _, err := r.queries.GetReplaySessionForUser(ctx, gen.GetReplaySessionForUserParams{ID: sid, UserID: uid}); errors.Is(err, pgx.ErrNoRows) {
		return ReplayReport{}, ErrNotFound
	} else if err != nil {
		return ReplayReport{}, err
	}
	return buildReplayReport(ctx, r.pool, sid)
}

func (r *Repo) Fork(ctx context.Context, userID, sessionID string, target time.Time) (SessionSnapshot, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return SessionSnapshot{}, err
	}
	sid, err := parseUUID(sessionID)
	if err != nil {
		return SessionSnapshot{}, ErrNotFound
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return SessionSnapshot{}, err
	}
	defer tx.Rollback(ctx)
	q := r.queries.WithTx(tx)
	source, err := q.GetReplaySessionForUser(ctx, gen.GetReplaySessionForUserParams{ID: sid, UserID: uid})
	if errors.Is(err, pgx.ErrNoRows) {
		return SessionSnapshot{}, ErrNotFound
	}
	if err != nil {
		return SessionSnapshot{}, err
	}
	tracks, err := q.ListReplayTracksForSession(ctx, sid)
	if err != nil {
		return SessionSnapshot{}, err
	}
	if len(tracks) < 1 || len(tracks) > 4 {
		return SessionSnapshot{}, fmt.Errorf("%w: fork requires between one and four tracks", ErrBadRequest)
	}
	if target.After(source.SimulatedTime.Time) {
		return SessionSnapshot{}, &DataUnavailableError{FirstAvailable: source.StartTime.Time, LastAvailable: source.SimulatedTime.Time}
	}
	trackWindows := make([]forkTrackWindow, len(tracks))
	for i, track := range tracks {
		trackWindows[i] = forkTrackWindow{
			FirstAvailable: track.FirstTime.Time,
			ChartTimeframe: track.ChartTimeframe,
			Slot:           int(track.Slot),
			Symbol:         track.Symbol,
		}
	}
	resolvedTarget, err := resolveForkTarget(target, source.SimulatedTime.Time, trackWindows)
	if err != nil {
		return SessionSnapshot{}, err
	}
	type forkTrackState struct {
		selected  gen.ReplayDatasetBar
		aggregate aggregateState
		bars      []ReplayBar
	}
	states := make([]forkTrackState, len(tracks))
	for i, track := range tracks {
		selected, selectErr := q.FindReplayDatasetBarAtOrBefore(ctx, gen.FindReplayDatasetBarAtOrBeforeParams{DatasetID: track.DatasetID, OpenTime: timestamp(resolvedTarget)})
		if errors.Is(selectErr, pgx.ErrNoRows) {
			return SessionSnapshot{}, &DataUnavailableError{
				FirstAvailable: track.FirstTime.Time,
				LastAvailable:  source.SimulatedTime.Time,
				Slot:           int(track.Slot),
				Symbol:         track.Symbol,
				ChartTimeframe: track.ChartTimeframe,
			}
		}
		if selectErr != nil {
			return SessionSnapshot{}, selectErr
		}
		rows, rowsErr := q.ListReplayDatasetBarsThroughSeq(ctx, gen.ListReplayDatasetBarsThroughSeqParams{DatasetID: track.DatasetID, Seq: selected.Seq})
		if rowsErr != nil {
			return SessionSnapshot{}, rowsErr
		}
		bars := make([]sourceBar, 0, len(rows))
		for _, row := range rows {
			bars = append(bars, sourceBarFromRow(row))
		}
		revealedBars, aggregate, aggregateErr := aggregateRevealedBars(track.ChartTimeframe, bars)
		if aggregateErr != nil {
			return SessionSnapshot{}, aggregateErr
		}
		states[i] = forkTrackState{selected: selected, aggregate: aggregate, bars: revealedBars}
	}
	forked, err := q.CreateReplaySession(ctx, gen.CreateReplaySessionParams{
		UserID: uid, Mode: source.Mode, Speed: source.Speed, ReplayIntervalSeconds: source.ReplayIntervalSeconds,
		StartTime: timestamp(resolvedTarget), EndTime: source.EndTime, Config: source.Config,
	})
	if err != nil {
		return SessionSnapshot{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE replay_sessions SET generation=$2 WHERE id=$1`, forked.ID, source.Generation+1); err != nil {
		return SessionSnapshot{}, err
	}
	for i, track := range tracks {
		if _, err := q.CreateReplayTrack(ctx, gen.CreateReplayTrackParams{
			SessionID: forked.ID, DatasetID: track.DatasetID, Slot: track.Slot, Symbol: track.Symbol,
			Provider: track.Provider, ChartTimeframe: track.ChartTimeframe, CursorSeq: states[i].selected.Seq,
			VisibleThrough: states[i].selected.OpenTime, AggregateState: marshalAggregateState(states[i].aggregate),
		}); err != nil {
			return SessionSnapshot{}, err
		}
	}
	var prepared PreparedTrading
	var commission []byte
	err = tx.QueryRow(ctx, `SELECT starting_equity::float8,base_currency,commission_model FROM replay_accounts WHERE session_id=$1`, sid).Scan(&prepared.StartingEquity, &prepared.BaseCurrency, &commission)
	if err == nil {
		prepared.Commission = commission
		if err := insertReplayAccount(ctx, tx, forked.ID, &prepared); err != nil {
			return SessionSnapshot{}, err
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return SessionSnapshot{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return SessionSnapshot{}, err
	}
	snapshot, err := r.getByIDs(ctx, uid, forked.ID)
	if err != nil {
		return SessionSnapshot{}, err
	}
	initialBarsBySlot := make(map[int][]ReplayBar, len(tracks))
	for index, track := range tracks {
		initialBarsBySlot[int(track.Slot)] = states[index].bars
	}
	for index := range snapshot.Tracks {
		if bars, ok := initialBarsBySlot[snapshot.Tracks[index].Slot]; ok {
			snapshot.Tracks[index].InitialBars = append([]ReplayBar(nil), bars...)
		}
	}
	return snapshot, nil
}

type forkTrackWindow struct {
	FirstAvailable time.Time
	ChartTimeframe string
	Slot           int
	Symbol         string
}

// resolveForkTarget maps a chart bucket timestamp back to the first source row
// that can represent it. A prepared dataset may begin part-way through its
// first chart bucket (for example, 08:12 source data renders as the 08:00 15m
// candle). That candle is selectable in the client, so a fork at its bucket
// timestamp must start at 08:12 instead of rejecting a visible data point.
// Targets in an earlier bucket remain unavailable.
func resolveForkTarget(target, lastAvailable time.Time, tracks []forkTrackWindow) (time.Time, error) {
	target = target.UTC()
	resolved := target
	for _, track := range tracks {
		first := track.FirstAvailable.UTC()
		if !target.Before(first) {
			continue
		}
		targetBucket, _, err := replayBucket(target, track.ChartTimeframe)
		if err != nil {
			return time.Time{}, err
		}
		firstBucket, _, err := replayBucket(first, track.ChartTimeframe)
		if err != nil {
			return time.Time{}, err
		}
		if !targetBucket.Equal(firstBucket) {
			return time.Time{}, &DataUnavailableError{
				FirstAvailable: first,
				LastAvailable:  lastAvailable.UTC(),
				Slot:           track.Slot,
				Symbol:         track.Symbol,
				ChartTimeframe: track.ChartTimeframe,
			}
		}
		if first.After(resolved) {
			resolved = first
		}
	}
	if resolved.After(lastAvailable) {
		return time.Time{}, &DataUnavailableError{FirstAvailable: target, LastAvailable: lastAvailable.UTC()}
	}
	return resolved, nil
}

func (r *Repo) getByIDs(ctx context.Context, uid, sid pgtype.UUID) (SessionSnapshot, error) {
	session, err := r.queries.GetReplaySessionForUser(ctx, gen.GetReplaySessionForUserParams{ID: sid, UserID: uid})
	if errors.Is(err, pgx.ErrNoRows) {
		return SessionSnapshot{}, ErrNotFound
	}
	if err != nil {
		return SessionSnapshot{}, err
	}
	tracks, err := r.queries.ListReplayTracksForSession(ctx, sid)
	if err != nil {
		return SessionSnapshot{}, err
	}
	out := sessionSnapshot(session)
	out.Tracks = make([]TrackSnapshot, 0, len(tracks))
	for _, track := range tracks {
		out.Tracks = append(out.Tracks, snapshotTrack(track))
	}
	out.Trading, err = loadTradingSnapshot(ctx, r.pool, sid)
	if err != nil {
		return SessionSnapshot{}, err
	}
	return out, nil
}

func snapshotTrack(track gen.ListReplayTracksForSessionRow) TrackSnapshot {
	checksum := ""
	if track.ChecksumSha256 != nil {
		checksum = *track.ChecksumSha256
	}
	return TrackSnapshot{
		ID: uuidString(track.ID), Slot: int(track.Slot), Symbol: track.Symbol, Provider: track.Provider,
		MarketCalendar: marketCalendarFor(track.Provider, track.Symbol),
		ChartTimeframe: track.ChartTimeframe, CursorSeq: track.CursorSeq, VisibleThrough: track.VisibleThrough.Time,
		Dataset: DatasetSnapshot{ID: uuidString(track.DatasetID), DataKind: string(track.DataKind), SourceTimeframe: track.SourceTimeframe,
			BaseIntervalSeconds: int(track.BaseIntervalSeconds), FirstAvailableTime: track.FirstTime.Time, LastAvailableTime: track.LastTime.Time,
			SnapshotAt: track.SnapshotAt.Time, RowCount: int(track.RowCount), ChecksumSHA256: checksum, Status: string(track.DatasetStatus)},
	}
}

func (r *Repo) Cleanup(ctx context.Context, sessionCutoff, datasetCutoff time.Time, limit int32) (CleanupResult, error) {
	if limit <= 0 {
		limit = 100
	}
	sessions, err := r.queries.DeleteExpiredReplaySessions(ctx, gen.DeleteExpiredReplaySessionsParams{ClosedAt: timestamp(sessionCutoff), Limit: limit})
	if err != nil {
		return CleanupResult{}, err
	}
	datasets, err := r.queries.DeleteUnusedReplayDatasets(ctx, gen.DeleteUnusedReplayDatasetsParams{UpdatedAt: timestamp(datasetCutoff), Limit: limit})
	return CleanupResult{Sessions: sessions, Datasets: datasets}, err
}

func sessionSnapshot(row gen.ReplaySession) SessionSnapshot {
	speed, _ := row.Speed.Float64Value()
	out := SessionSnapshot{ID: uuidString(row.ID), Status: string(row.Status), Mode: string(row.Mode), Generation: int(row.Generation), Version: row.Version,
		LastEventSeq: row.NextEventSeq - 1,
		Speed:        speed.Float64, ReplayIntervalSeconds: int(row.ReplayIntervalSeconds), StartTime: row.StartTime.Time, SimulatedTime: row.SimulatedTime.Time,
		Tracks: []TrackSnapshot{}, CreatedAt: row.CreatedAt.Time, UpdatedAt: row.UpdatedAt.Time}
	if row.EndTime.Valid {
		value := row.EndTime.Time
		out.EndTime = &value
	}
	if row.ClosedAt.Valid {
		value := row.ClosedAt.Time
		out.ClosedAt = &value
	}
	if row.PauseReason != nil {
		out.PauseReason = *row.PauseReason
	}
	return out
}

func parseUUID(value string) (pgtype.UUID, error) {
	var id pgtype.UUID
	if err := id.Scan(strings.TrimSpace(value)); err != nil {
		return id, fmt.Errorf("%w: invalid id", ErrBadRequest)
	}
	return id, nil
}
func uuidString(id pgtype.UUID) string {
	value, _ := id.Value()
	text, _ := value.(string)
	return text
}
func timestamp(value time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: value.UTC(), Valid: true}
}
func optionalTimestamp(value *time.Time) pgtype.Timestamptz {
	if value == nil {
		return pgtype.Timestamptz{}
	}
	return timestamp(*value)
}
func numeric(value float64) pgtype.Numeric {
	var out pgtype.Numeric
	_ = out.Scan(strconv.FormatFloat(value, 'g', -1, 64))
	return out
}

var _ SessionStore = (*Repo)(nil)
