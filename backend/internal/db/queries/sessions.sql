-- name: CreateSession :one
INSERT INTO sessions (user_id, refresh_token_hash, user_agent, ip, expires_at)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetSessionByHash :one
SELECT * FROM sessions WHERE refresh_token_hash = $1;

-- name: RotateSession :one
WITH current_session AS (
  SELECT id, user_id
  FROM sessions
  WHERE sessions.refresh_token_hash = sqlc.arg(old_refresh_hash)
    AND sessions.revoked_at IS NULL
    AND sessions.expires_at > sqlc.arg(rotated_at)
  FOR UPDATE
),
revoked AS (
  UPDATE sessions AS s
  SET revoked_at = sqlc.arg(rotated_at)
  FROM current_session AS current
  WHERE s.id = current.id
    AND s.revoked_at IS NULL
  RETURNING s.user_id
)
INSERT INTO sessions (
  user_id,
  refresh_token_hash,
  user_agent,
  ip,
  expires_at
)
SELECT
  user_id,
  sqlc.arg(new_refresh_hash),
  sqlc.narg(user_agent),
  sqlc.narg(ip),
  sqlc.arg(expires_at)
FROM revoked
RETURNING *;

-- name: TouchSession :exec
UPDATE sessions SET last_used_at = now() WHERE id = $1;

-- name: RevokeSession :execrows
UPDATE sessions SET revoked_at = now()
WHERE id = $1 AND revoked_at IS NULL;

-- name: RevokeAllUserSessions :exec
UPDATE sessions SET revoked_at = now()
WHERE user_id = $1 AND revoked_at IS NULL;
