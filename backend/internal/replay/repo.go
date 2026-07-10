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
	"github.com/smc-trading-terminal/backend/internal/db/gen"
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
				Provider: track.Provider, Symbol: track.Symbol, SourceTimeframe: track.ChartTimeframe,
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
			VisibleThrough: timestamp(track.VisibleThrough),
		})
		if err != nil {
			return SessionSnapshot{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return SessionSnapshot{}, err
	}
	return r.getByIDs(ctx, uid, session.ID)
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
	return out, nil
}

func snapshotTrack(track gen.ListReplayTracksForSessionRow) TrackSnapshot {
	checksum := ""
	if track.ChecksumSha256 != nil {
		checksum = *track.ChecksumSha256
	}
	return TrackSnapshot{
		ID: uuidString(track.ID), Slot: int(track.Slot), Symbol: track.Symbol, Provider: track.Provider,
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
