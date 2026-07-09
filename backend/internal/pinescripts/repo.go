package pinescripts

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store interface {
	List(ctx context.Context, userID string) ([]Script, error)
	Get(ctx context.Context, userID, ref string) (Script, error)
	Save(ctx context.Context, userID string, input ScriptWrite) (Script, error)
	Replace(ctx context.Context, userID, ref string, input ScriptWrite) (Script, error)
	Delete(ctx context.Context, userID, ref string) error
}

type Repo struct {
	pool *pgxpool.Pool
}

func NewRepo(pool *pgxpool.Pool) *Repo {
	return &Repo{pool: pool}
}

var _ Store = (*Repo)(nil)

func (r *Repo) List(ctx context.Context, userID string) ([]Script, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return nil, err
	}
	rows, err := r.pool.Query(ctx, `
SELECT id, name, '' AS source_code, favorite, meta, COALESCE(client_id, ''), created_at, updated_at
FROM pine_scripts
WHERE user_id = $1
ORDER BY favorite DESC, updated_at DESC, created_at DESC, id`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Script{}
	for rows.Next() {
		item, err := scanScript(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (r *Repo) Get(ctx context.Context, userID, ref string) (Script, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return Script{}, err
	}
	refUUID, refClientID := splitRef(ref)
	item, err := scanScript(r.pool.QueryRow(ctx, `
SELECT id, name, source_code, favorite, meta, COALESCE(client_id, ''), created_at, updated_at
FROM pine_scripts
WHERE user_id = $1
  AND (($2::uuid IS NOT NULL AND id = $2::uuid) OR ($3::text <> '' AND client_id = $3::text))`,
		uid, refUUID, refClientID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Script{}, ErrNotFound
	}
	return item, err
}

func (r *Repo) Save(ctx context.Context, userID string, input ScriptWrite) (Script, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return Script{}, err
	}
	normalized, err := normalizeCreate(input)
	if err != nil {
		return Script{}, err
	}
	if normalized.ClientID != "" {
		return scanScript(r.pool.QueryRow(ctx, `
INSERT INTO pine_scripts (user_id, name, source_code, favorite, meta, client_id)
VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''))
ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL DO UPDATE
SET name = EXCLUDED.name,
    source_code = EXCLUDED.source_code,
    favorite = EXCLUDED.favorite,
    meta = EXCLUDED.meta,
    updated_at = now()
RETURNING id, name, source_code, favorite, meta, COALESCE(client_id, ''), created_at, updated_at`,
			uid, *normalized.Name, *normalized.SourceCode, boolOrDefault(normalized.Favorite), normalized.Meta, normalized.ClientID))
	}
	return scanScript(r.pool.QueryRow(ctx, `
INSERT INTO pine_scripts (user_id, name, source_code, favorite, meta)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, name, source_code, favorite, meta, COALESCE(client_id, ''), created_at, updated_at`,
		uid, *normalized.Name, *normalized.SourceCode, boolOrDefault(normalized.Favorite), normalized.Meta))
}

func (r *Repo) Replace(ctx context.Context, userID, ref string, input ScriptWrite) (Script, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return Script{}, err
	}
	normalized, err := normalizePatch(input)
	if err != nil {
		return Script{}, err
	}
	refUUID, refClientID := splitRef(ref)
	item, err := scanScript(r.pool.QueryRow(ctx, `
UPDATE pine_scripts
SET name = COALESCE(NULLIF($4, ''), name),
    source_code = COALESCE($5, source_code),
    favorite = COALESCE($6, favorite),
    meta = COALESCE($7::jsonb, meta),
    client_id = COALESCE(NULLIF($8, ''), client_id),
    updated_at = now()
WHERE user_id = $1
  AND (($2::uuid IS NOT NULL AND id = $2::uuid) OR ($3::text <> '' AND client_id = $3::text))
RETURNING id, name, source_code, favorite, meta, COALESCE(client_id, ''), created_at, updated_at`,
		uid,
		refUUID,
		refClientID,
		stringOrNil(normalized.Name),
		stringOrNil(normalized.SourceCode),
		normalized.Favorite,
		nullableJSON(normalized.Meta),
		normalized.ClientID,
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return Script{}, ErrNotFound
	}
	return item, err
}

func (r *Repo) Delete(ctx context.Context, userID, ref string) error {
	uid, err := parseUUID(userID)
	if err != nil {
		return err
	}
	refUUID, refClientID := splitRef(ref)
	tag, err := r.pool.Exec(ctx, `
DELETE FROM pine_scripts
WHERE user_id = $1
  AND (($2::uuid IS NOT NULL AND id = $2::uuid) OR ($3::text <> '' AND client_id = $3::text))`,
		uid, refUUID, refClientID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanScript(row rowScanner) (Script, error) {
	var id pgtype.UUID
	var item Script
	err := row.Scan(
		&id,
		&item.Name,
		&item.SourceCode,
		&item.Favorite,
		&item.Meta,
		&item.ClientID,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	if err != nil {
		return Script{}, err
	}
	item.ID = uuidString(id)
	if len(item.Meta) == 0 {
		item.Meta = json.RawMessage(`{}`)
	}
	return item, nil
}

func normalizeCreate(input ScriptWrite) (ScriptWrite, error) {
	input, err := normalizeCommon(input, true)
	if err != nil {
		return ScriptWrite{}, err
	}
	if input.Name == nil || strings.TrimSpace(*input.Name) == "" {
		return ScriptWrite{}, fmt.Errorf("%w: name is required", ErrBadRequest)
	}
	if input.SourceCode == nil {
		return ScriptWrite{}, fmt.Errorf("%w: sourceCode is required", ErrBadRequest)
	}
	name := strings.TrimSpace(*input.Name)
	input.Name = &name
	return input, nil
}

func normalizePatch(input ScriptWrite) (ScriptWrite, error) {
	input, err := normalizeCommon(input, false)
	if err != nil {
		return ScriptWrite{}, err
	}
	if input.Name != nil {
		name := strings.TrimSpace(*input.Name)
		if name == "" {
			return ScriptWrite{}, fmt.Errorf("%w: name cannot be empty", ErrBadRequest)
		}
		input.Name = &name
	}
	return input, nil
}

func normalizeCommon(input ScriptWrite, defaultMeta bool) (ScriptWrite, error) {
	input.ClientID = strings.TrimSpace(input.ClientID)
	if input.SourceCode != nil && len([]byte(*input.SourceCode)) > MaxSourceBytes {
		return ScriptWrite{}, fmt.Errorf("%w: sourceCode exceeds 64KB", ErrBadRequest)
	}
	if defaultMeta && len(input.Meta) == 0 {
		input.Meta = json.RawMessage(`{}`)
	}
	if len(input.Meta) > 0 && !json.Valid(input.Meta) {
		return ScriptWrite{}, fmt.Errorf("%w: meta must be json", ErrBadRequest)
	}
	return input, nil
}

func boolOrDefault(value *bool) bool {
	if value == nil {
		return false
	}
	return *value
}

func stringOrNil(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullableJSON(value json.RawMessage) any {
	if len(value) == 0 {
		return nil
	}
	return value
}

func splitRef(ref string) (*pgtype.UUID, string) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil, ""
	}
	if uuid, err := parseUUID(ref); err == nil {
		return &uuid, ""
	}
	return nil, ref
}

func parseUUID(s string) (pgtype.UUID, error) {
	var u pgtype.UUID
	if err := u.Scan(strings.TrimSpace(s)); err != nil {
		return pgtype.UUID{}, fmt.Errorf("pine scripts: invalid id: %w", err)
	}
	return u, nil
}

func uuidString(u pgtype.UUID) string {
	v, err := u.Value()
	if err != nil || v == nil {
		return ""
	}
	s, _ := v.(string)
	return s
}
