package layouts

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
	List(ctx context.Context, userID string) ([]Layout, error)
	Create(ctx context.Context, userID string, input Write) (Layout, error)
	Update(ctx context.Context, userID, id string, input Write) (Layout, error)
	Delete(ctx context.Context, userID, id string) error
}

type Repo struct{ pool *pgxpool.Pool }

func NewRepo(pool *pgxpool.Pool) *Repo { return &Repo{pool: pool} }

var _ Store = (*Repo)(nil)

func (r *Repo) List(ctx context.Context, userID string) ([]Layout, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return nil, err
	}
	rows, err := r.pool.Query(ctx, `
SELECT id, name, COALESCE(symbol, ''), COALESCE(timeframe, ''), state, is_default, created_at, updated_at
FROM layouts
WHERE user_id = $1
ORDER BY is_default DESC, updated_at DESC, id`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []Layout{}
	for rows.Next() {
		item, scanErr := scanLayout(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *Repo) Create(ctx context.Context, userID string, input Write) (Layout, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return Layout{}, err
	}
	input, err = normalizeWrite(input)
	if err != nil {
		return Layout{}, err
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Layout{}, err
	}
	defer tx.Rollback(ctx)
	if input.IsDefault {
		if _, err = tx.Exec(ctx, `UPDATE layouts SET is_default = false, updated_at = now() WHERE user_id = $1 AND is_default`, uid); err != nil {
			return Layout{}, err
		}
	}
	item, err := scanLayout(tx.QueryRow(ctx, `
INSERT INTO layouts (user_id, name, symbol, timeframe, state, is_default)
VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''), $5, $6)
RETURNING id, name, COALESCE(symbol, ''), COALESCE(timeframe, ''), state, is_default, created_at, updated_at`,
		uid, input.Name, input.Symbol, input.Timeframe, input.State, input.IsDefault))
	if err != nil {
		return Layout{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Layout{}, err
	}
	return item, nil
}

func (r *Repo) Update(ctx context.Context, userID, id string, input Write) (Layout, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return Layout{}, err
	}
	layoutID, err := parseUUID(id)
	if err != nil {
		return Layout{}, fmt.Errorf("%w: invalid layout id", ErrBadRequest)
	}
	input, err = normalizeWrite(input)
	if err != nil {
		return Layout{}, err
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Layout{}, err
	}
	defer tx.Rollback(ctx)
	if input.IsDefault {
		if _, err = tx.Exec(ctx, `UPDATE layouts SET is_default = false, updated_at = now() WHERE user_id = $1 AND is_default AND id <> $2`, uid, layoutID); err != nil {
			return Layout{}, err
		}
	}
	item, err := scanLayout(tx.QueryRow(ctx, `
UPDATE layouts
SET name = $3, symbol = NULLIF($4, ''), timeframe = NULLIF($5, ''), state = $6, is_default = $7, updated_at = now()
WHERE user_id = $1 AND id = $2
RETURNING id, name, COALESCE(symbol, ''), COALESCE(timeframe, ''), state, is_default, created_at, updated_at`,
		uid, layoutID, input.Name, input.Symbol, input.Timeframe, input.State, input.IsDefault))
	if errors.Is(err, pgx.ErrNoRows) {
		return Layout{}, ErrNotFound
	}
	if err != nil {
		return Layout{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Layout{}, err
	}
	return item, nil
}

func (r *Repo) Delete(ctx context.Context, userID, id string) error {
	uid, err := parseUUID(userID)
	if err != nil {
		return err
	}
	layoutID, err := parseUUID(id)
	if err != nil {
		return fmt.Errorf("%w: invalid layout id", ErrBadRequest)
	}
	tag, err := r.pool.Exec(ctx, `DELETE FROM layouts WHERE user_id = $1 AND id = $2`, uid, layoutID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

type rowScanner interface{ Scan(dest ...any) error }

func scanLayout(row rowScanner) (Layout, error) {
	var id pgtype.UUID
	var item Layout
	if err := row.Scan(&id, &item.Name, &item.Symbol, &item.Timeframe, &item.State, &item.IsDefault, &item.CreatedAt, &item.UpdatedAt); err != nil {
		return Layout{}, err
	}
	item.ID = uuidString(id)
	if len(item.State) == 0 {
		item.State = json.RawMessage(`{}`)
	}
	return item, nil
}

func normalizeWrite(input Write) (Write, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Symbol = strings.TrimSpace(input.Symbol)
	input.Timeframe = strings.TrimSpace(input.Timeframe)
	if input.Name == "" {
		return Write{}, fmt.Errorf("%w: name is required", ErrBadRequest)
	}
	if len(input.Name) > 120 {
		return Write{}, fmt.Errorf("%w: name is too long", ErrBadRequest)
	}
	if len(input.State) == 0 {
		input.State = json.RawMessage(`{}`)
	}
	if !json.Valid(input.State) {
		return Write{}, fmt.Errorf("%w: state must be json", ErrBadRequest)
	}
	return input, nil
}

func parseUUID(value string) (pgtype.UUID, error) {
	var id pgtype.UUID
	if err := id.Scan(strings.TrimSpace(value)); err != nil {
		return pgtype.UUID{}, fmt.Errorf("layouts: invalid id: %w", err)
	}
	return id, nil
}

func uuidString(id pgtype.UUID) string {
	value, err := id.Value()
	if err != nil || value == nil {
		return ""
	}
	result, _ := value.(string)
	return result
}
