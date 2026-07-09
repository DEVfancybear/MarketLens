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
	ListPublic(ctx context.Context, query string) ([]PublicScript, error)
	GetPublic(ctx context.Context, ref string) (PublicScript, error)
	Publish(ctx context.Context, userID, ref string, input PublishRequest) (PublicScript, error)
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

func (r *Repo) ListPublic(ctx context.Context, query string) ([]PublicScript, error) {
	query = strings.TrimSpace(query)
	rows, err := r.pool.Query(ctx, `
SELECT p.id,
       p.script_id,
       p.name,
       p.source_code,
       p.user_id,
       COALESCE(NULLIF(u.display_name, ''), u.email, 'Unknown') AS author,
       p.boosts,
       p.meta,
       p.created_at,
       p.updated_at
FROM public_pine_scripts p
JOIN users u ON u.id = p.user_id
WHERE $1::text = ''
   OR p.name ILIKE '%' || $1 || '%'
   OR COALESCE(NULLIF(u.display_name, ''), u.email, '') ILIKE '%' || $1 || '%'
ORDER BY p.boosts DESC, p.updated_at DESC, p.created_at DESC, p.id
LIMIT 100`, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []PublicScript{}
	for rows.Next() {
		item, err := scanPublicScript(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (r *Repo) GetPublic(ctx context.Context, ref string) (PublicScript, error) {
	refUUID, refScriptID := splitRef(ref)
	item, err := scanPublicScript(r.pool.QueryRow(ctx, `
SELECT p.id,
       p.script_id,
       p.name,
       p.source_code,
       p.user_id,
       COALESCE(NULLIF(u.display_name, ''), u.email, 'Unknown') AS author,
       p.boosts,
       p.meta,
       p.created_at,
       p.updated_at
FROM public_pine_scripts p
JOIN users u ON u.id = p.user_id
WHERE ($1::uuid IS NOT NULL AND p.id = $1::uuid)
   OR ($2::text <> '' AND p.script_id::text = $2::text)`,
		refUUID, refScriptID))
	if errors.Is(err, pgx.ErrNoRows) {
		return PublicScript{}, ErrNotFound
	}
	return item, err
}

func (r *Repo) Publish(ctx context.Context, userID, ref string, input PublishRequest) (PublicScript, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return PublicScript{}, err
	}
	refUUID, refClientID := splitRef(ref)
	name := ""
	if input.Name != nil {
		name = strings.TrimSpace(*input.Name)
	}
	item, err := scanPublicScript(r.pool.QueryRow(ctx, `
WITH source AS (
  SELECT id, user_id, name, source_code, meta
  FROM pine_scripts
  WHERE user_id = $1
    AND (($2::uuid IS NOT NULL AND id = $2::uuid) OR ($3::text <> '' AND client_id = $3::text))
),
upserted AS (
  INSERT INTO public_pine_scripts (script_id, user_id, name, source_code, meta)
  SELECT id, user_id, COALESCE(NULLIF($4, ''), name), source_code, meta
  FROM source
  ON CONFLICT (script_id) DO UPDATE
  SET name = EXCLUDED.name,
      source_code = EXCLUDED.source_code,
      meta = EXCLUDED.meta,
      updated_at = now()
  RETURNING id, script_id, name, source_code, user_id, boosts, meta, created_at, updated_at
)
SELECT p.id,
       p.script_id,
       p.name,
       p.source_code,
       p.user_id,
       COALESCE(NULLIF(u.display_name, ''), u.email, 'Unknown') AS author,
       p.boosts,
       p.meta,
       p.created_at,
       p.updated_at
FROM upserted p
JOIN users u ON u.id = p.user_id`, uid, refUUID, refClientID, name))
	if errors.Is(err, pgx.ErrNoRows) {
		return PublicScript{}, ErrNotFound
	}
	return item, err
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

func scanPublicScript(row rowScanner) (PublicScript, error) {
	var id pgtype.UUID
	var scriptID pgtype.UUID
	var authorID pgtype.UUID
	var item PublicScript
	err := row.Scan(
		&id,
		&scriptID,
		&item.Name,
		&item.SourceCode,
		&authorID,
		&item.Author,
		&item.Boosts,
		&item.Meta,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	if err != nil {
		return PublicScript{}, err
	}
	item.ID = uuidString(id)
	item.ScriptID = uuidString(scriptID)
	item.AuthorID = uuidString(authorID)
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
