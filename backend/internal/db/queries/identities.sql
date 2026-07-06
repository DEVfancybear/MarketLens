-- name: GetIdentityByProvider :one
SELECT * FROM auth_identities
WHERE provider = $1 AND provider_uid = $2;

-- name: CreateIdentity :one
INSERT INTO auth_identities (user_id, provider, provider_uid, firebase_uid, raw_profile)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: UpdateIdentityProfile :one
UPDATE auth_identities
SET firebase_uid = $2,
    raw_profile  = $3
WHERE id = $1
RETURNING *;
