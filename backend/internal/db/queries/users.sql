-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1;

-- name: CreateUser :one
INSERT INTO users (email, email_verified, display_name, photo_url)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: UpdateUserProfile :one
UPDATE users
SET display_name   = $2,
    photo_url      = $3,
    email_verified = $4,
    last_login_at  = now()
WHERE id = $1
RETURNING *;

-- name: TouchUserLastLogin :exec
UPDATE users SET last_login_at = now() WHERE id = $1;
