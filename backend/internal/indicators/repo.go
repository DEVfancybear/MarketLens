package indicators

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
	List(ctx context.Context, userID string) ([]IndicatorPreset, error)
	Save(ctx context.Context, userID string, input IndicatorWrite) (IndicatorPreset, error)
	Replace(ctx context.Context, userID, ref string, input IndicatorWrite) (IndicatorPreset, error)
	Delete(ctx context.Context, userID, ref string) error
}

type Repo struct {
	pool *pgxpool.Pool
}

func NewRepo(pool *pgxpool.Pool) *Repo {
	return &Repo{pool: pool}
}

var _ Store = (*Repo)(nil)

func (r *Repo) List(ctx context.Context, userID string) ([]IndicatorPreset, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return nil, err
	}
	rows, err := r.pool.Query(ctx, `
SELECT id, indicator_type, script_id, config, visible, position, COALESCE(client_id, ''), created_at, updated_at
FROM indicator_presets
WHERE user_id = $1
ORDER BY position, created_at, id`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []IndicatorPreset{}
	for rows.Next() {
		item, err := scanPreset(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (r *Repo) Save(ctx context.Context, userID string, input IndicatorWrite) (IndicatorPreset, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return IndicatorPreset{}, err
	}
	input, err = normalizeWrite(input)
	if err != nil {
		return IndicatorPreset{}, err
	}
	scriptID := nullableUUID(input.ScriptID)
	if input.ClientID != "" {
		return scanPreset(r.pool.QueryRow(ctx, `
INSERT INTO indicator_presets (user_id, indicator_type, script_id, config, visible, position, client_id)
VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''))
ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL DO UPDATE
SET indicator_type = EXCLUDED.indicator_type,
    script_id = EXCLUDED.script_id,
    config = EXCLUDED.config,
    visible = EXCLUDED.visible,
    position = EXCLUDED.position,
    updated_at = now()
RETURNING id, indicator_type, script_id, config, visible, position, COALESCE(client_id, ''), created_at, updated_at`,
			uid, input.IndicatorType, scriptID, input.Config, *input.Visible, input.Position, input.ClientID))
	}
	return scanPreset(r.pool.QueryRow(ctx, `
INSERT INTO indicator_presets (user_id, indicator_type, script_id, config, visible, position)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, indicator_type, script_id, config, visible, position, COALESCE(client_id, ''), created_at, updated_at`,
		uid, input.IndicatorType, scriptID, input.Config, *input.Visible, input.Position))
}

func (r *Repo) Replace(ctx context.Context, userID, ref string, input IndicatorWrite) (IndicatorPreset, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return IndicatorPreset{}, err
	}
	input, err = normalizeWrite(input)
	if err != nil {
		return IndicatorPreset{}, err
	}
	refUUID, refClientID := splitRef(ref)
	preset, err := scanPreset(r.pool.QueryRow(ctx, `
UPDATE indicator_presets
SET indicator_type = $4,
    script_id = $5,
    config = $6,
    visible = $7,
    position = $8,
    client_id = COALESCE(NULLIF($9, ''), client_id),
    updated_at = now()
WHERE user_id = $1
  AND (($2::uuid IS NOT NULL AND id = $2::uuid) OR ($3::text <> '' AND client_id = $3::text))
RETURNING id, indicator_type, script_id, config, visible, position, COALESCE(client_id, ''), created_at, updated_at`,
		uid, refUUID, refClientID, input.IndicatorType, nullableUUID(input.ScriptID), input.Config, *input.Visible, input.Position, input.ClientID))
	if errors.Is(err, pgx.ErrNoRows) {
		return IndicatorPreset{}, ErrNotFound
	}
	return preset, err
}

func (r *Repo) Delete(ctx context.Context, userID, ref string) error {
	uid, err := parseUUID(userID)
	if err != nil {
		return err
	}
	refUUID, refClientID := splitRef(ref)
	tag, err := r.pool.Exec(ctx, `
DELETE FROM indicator_presets
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

func scanPreset(row rowScanner) (IndicatorPreset, error) {
	var id pgtype.UUID
	var scriptID pgtype.UUID
	var item IndicatorPreset
	err := row.Scan(
		&id,
		&item.IndicatorType,
		&scriptID,
		&item.Config,
		&item.Visible,
		&item.Position,
		&item.ClientID,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	if err != nil {
		return IndicatorPreset{}, err
	}
	item.ID = uuidString(id)
	if scriptID.Valid {
		item.ScriptID = uuidString(scriptID)
	}
	if len(item.Config) == 0 {
		item.Config = json.RawMessage(`{}`)
	}
	return item, nil
}

func normalizeWrite(input IndicatorWrite) (IndicatorWrite, error) {
	input.IndicatorType = strings.ToUpper(strings.TrimSpace(input.IndicatorType))
	input.ClientID = strings.TrimSpace(input.ClientID)
	input.ScriptID = strings.TrimSpace(input.ScriptID)
	if input.IndicatorType == "" {
		return IndicatorWrite{}, fmt.Errorf("%w: indicatorType is required", ErrBadRequest)
	}
	if len(input.Config) == 0 {
		input.Config = json.RawMessage(`{}`)
	}
	if !json.Valid(input.Config) {
		return IndicatorWrite{}, fmt.Errorf("%w: config must be json", ErrBadRequest)
	}
	if input.Visible == nil {
		visible := true
		input.Visible = &visible
	}
	return input, nil
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

func nullableUUID(value string) *pgtype.UUID {
	if value == "" {
		return nil
	}
	u, err := parseUUID(value)
	if err != nil {
		return nil
	}
	return &u
}

func parseUUID(s string) (pgtype.UUID, error) {
	var u pgtype.UUID
	if err := u.Scan(strings.TrimSpace(s)); err != nil {
		return pgtype.UUID{}, fmt.Errorf("indicators: invalid id: %w", err)
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
