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

-- name: GetReplayDatasetBarBySeq :one
SELECT * FROM replay_dataset_bars WHERE dataset_id = $1 AND seq = $2;

-- name: FindReplayDatasetBarAtOrBefore :one
SELECT * FROM replay_dataset_bars
WHERE dataset_id = $1 AND open_time <= $2
ORDER BY open_time DESC
LIMIT 1;

-- name: ListReplayEventsForUser :many
SELECT e.* FROM replay_events e
JOIN replay_sessions s ON s.id = e.session_id
WHERE e.session_id = $1 AND s.user_id = $2 AND e.event_seq > $3
ORDER BY e.event_seq
LIMIT $4;

-- name: GetLatestReplayCheckpoint :one
SELECT c.* FROM replay_checkpoints c
JOIN replay_sessions s ON s.id = c.session_id
WHERE c.session_id = $1 AND s.user_id = $2
ORDER BY c.generation DESC, c.event_seq DESC
LIMIT 1;

-- name: ListPlayingReplaySessions :many
SELECT id, user_id FROM replay_sessions WHERE status = 'playing' ORDER BY updated_at;

-- name: TryLockReplaySession :one
SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0))::boolean;

-- name: GetReplaySessionForUserForUpdate :one
SELECT * FROM replay_sessions WHERE id = $1 AND user_id = $2 FOR UPDATE;

-- name: ListReplayTracksForSessionForUpdate :many
SELECT t.*, d.data_kind, d.source_timeframe, d.base_interval_seconds,
       d.first_time, d.last_time, d.snapshot_at, d.row_count,
       d.checksum_sha256, d.status AS dataset_status
FROM replay_tracks t
JOIN replay_datasets d ON d.id = t.dataset_id
WHERE t.session_id = $1
ORDER BY t.slot
FOR UPDATE OF t;

-- name: GetReplayCommandByIdempotency :one
SELECT c.* FROM replay_commands c
JOIN replay_sessions s ON s.id = c.session_id
WHERE c.session_id = $1 AND s.user_id = $2 AND c.idempotency_key = $3;

-- name: NextReplayCommandSeq :one
SELECT COALESCE(MAX(command_seq), 0)::bigint + 1 FROM replay_commands WHERE session_id = $1;

-- name: CreateReplayCommand :one
INSERT INTO replay_commands (
  session_id, command_seq, idempotency_key, expected_version, command_type, payload
) VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: MarkReplayCommandApplied :one
UPDATE replay_commands SET status = 'applied', result = $2, processed_at = now()
WHERE id = $1
RETURNING *;

-- name: MarkReplayCommandRejected :one
UPDATE replay_commands SET status = 'rejected', result = $2, processed_at = now()
WHERE id = $1
RETURNING *;

-- name: UpdateReplayRuntimeSession :one
UPDATE replay_sessions SET
  status = $2,
  version = $3,
  next_event_seq = $4,
  speed = $5,
  simulated_time = $6,
  pause_reason = $7,
  closed_at = $8,
  actor_owner = $9,
  actor_lease_until = $10
WHERE id = $1
RETURNING *;

-- name: UpdateReplayTrackCursor :one
UPDATE replay_tracks SET cursor_seq = $2, visible_through = $3
WHERE id = $1
RETURNING *;

-- name: CreateReplayEvent :one
INSERT INTO replay_events (
  session_id, event_seq, version, event_type, simulated_at, payload
) VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: CreateReplayCheckpoint :one
INSERT INTO replay_checkpoints (
  session_id, generation, event_seq, simulated_time, snapshot, checksum_sha256
) VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;
