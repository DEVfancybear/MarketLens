-- name: LockReplayDatasetChecksum :exec
SELECT pg_advisory_xact_lock(hashtextextended($1, 0));

-- name: GetReadyReplayDatasetByChecksum :one
SELECT * FROM replay_datasets
WHERE checksum_sha256 = $1 AND status = 'ready'
LIMIT 1;

-- name: CreateReplayDataset :one
INSERT INTO replay_datasets (
  provider, symbol, data_kind, source_timeframe, base_interval_seconds,
  snapshot_at, source_meta
) VALUES ($1, $2, 'bars', $3, $4, $5, $6)
RETURNING *;

-- name: CreateReplayDatasetBar :exec
INSERT INTO replay_dataset_bars (
  dataset_id, seq, open_time, interval_seconds, open, high, low, close, volume, complete
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);

-- name: MarkReplayDatasetReady :one
UPDATE replay_datasets SET
  first_time = $2, last_time = $3, row_count = $4,
  checksum_sha256 = $5, status = 'ready', last_error = NULL, ready_at = now()
WHERE id = $1
RETURNING *;

-- name: CreateReplaySession :one
INSERT INTO replay_sessions (
  user_id, status, mode, speed, replay_interval_seconds,
  start_time, simulated_time, end_time, pause_reason, config
) VALUES ($1, 'paused', $2, $3, $4, $5, $5, $6, 'created', $7)
RETURNING *;

-- name: CreateReplayTrack :one
INSERT INTO replay_tracks (
  session_id, dataset_id, slot, symbol, provider, chart_timeframe,
  cursor_seq, visible_through
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: GetReplaySessionForUser :one
SELECT * FROM replay_sessions WHERE id = $1 AND user_id = $2;

-- name: ListReplayTracksForSession :many
SELECT t.*, d.data_kind, d.source_timeframe, d.base_interval_seconds,
       d.first_time, d.last_time, d.snapshot_at, d.row_count,
       d.checksum_sha256, d.status AS dataset_status
FROM replay_tracks t
JOIN replay_datasets d ON d.id = t.dataset_id
WHERE t.session_id = $1
ORDER BY t.slot;

-- name: CloseReplaySessionForUser :one
UPDATE replay_sessions SET
  status = 'closed', pause_reason = 'closed', closed_at = now(), version = version + 1
WHERE id = $1 AND user_id = $2 AND status <> 'closed'
RETURNING *;

-- name: DeleteExpiredReplaySessions :execrows
DELETE FROM replay_sessions
WHERE id IN (
  SELECT candidate.id FROM replay_sessions candidate
  WHERE candidate.status IN ('closed', 'failed')
    AND COALESCE(candidate.closed_at, candidate.updated_at) < $1
  ORDER BY COALESCE(candidate.closed_at, candidate.updated_at)
  LIMIT $2
);

-- name: DeleteUnusedReplayDatasets :execrows
DELETE FROM replay_datasets d
WHERE d.id IN (
  SELECT candidate.id FROM replay_datasets candidate
  WHERE candidate.updated_at < $1
    AND NOT EXISTS (SELECT 1 FROM replay_tracks t WHERE t.dataset_id = candidate.id)
  ORDER BY candidate.updated_at
  LIMIT $2
);
