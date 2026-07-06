-- name: CreateSession :one
INSERT INTO sessions (user_id, refresh_token_hash, user_agent, ip, expires_at)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetSessionByHash :one
SELECT * FROM sessions WHERE refresh_token_hash = $1;

-- name: TouchSession :exec
UPDATE sessions SET last_used_at = now() WHERE id = $1;

-- name: RevokeSession :exec
UPDATE sessions SET revoked_at = now()
WHERE id = $1 AND revoked_at IS NULL;

-- name: RevokeAllUserSessions :exec
UPDATE sessions SET revoked_at = now()
WHERE user_id = $1 AND revoked_at IS NULL;
