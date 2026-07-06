package watchlists

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store is the persistence surface used by the HTTP handler and sync bootstrap.
// Every method is scoped by userID; ownership is enforced in SQL, never trusted
// from the client.
type Store interface {
	List(ctx context.Context, userID string) ([]Watchlist, error)
	Create(ctx context.Context, userID, name string) (Watchlist, error)
	Update(ctx context.Context, userID, id string, name *string, position *int) (Watchlist, error)
	Delete(ctx context.Context, userID, id string) error
	AddSymbol(ctx context.Context, userID, id, symbol string) (Watchlist, error)
	RemoveSymbol(ctx context.Context, userID, id, symbol string) (Watchlist, error)
}

type Repo struct {
	pool *pgxpool.Pool
}

func NewRepo(pool *pgxpool.Pool) *Repo {
	return &Repo{pool: pool}
}

var _ Store = (*Repo)(nil)

func (r *Repo) List(ctx context.Context, userID string) ([]Watchlist, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return nil, err
	}

	rows, err := r.pool.Query(ctx, `
SELECT id, name, position FROM watchlists
WHERE user_id = $1
ORDER BY position, created_at`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	lists := []Watchlist{}
	indexByID := map[string]int{}
	for rows.Next() {
		var id pgtype.UUID
		var w Watchlist
		if err := rows.Scan(&id, &w.Name, &w.Position); err != nil {
			return nil, err
		}
		w.ID = uuidString(id)
		w.Symbols = []string{}
		indexByID[w.ID] = len(lists)
		lists = append(lists, w)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// One extra query loads every symbol for the user's lists (avoids N+1).
	srows, err := r.pool.Query(ctx, `
SELECT ws.watchlist_id, ws.symbol
FROM watchlist_symbols ws
JOIN watchlists w ON w.id = ws.watchlist_id
WHERE w.user_id = $1
ORDER BY ws.position, ws.created_at`, uid)
	if err != nil {
		return nil, err
	}
	defer srows.Close()
	for srows.Next() {
		var listID pgtype.UUID
		var symbol string
		if err := srows.Scan(&listID, &symbol); err != nil {
			return nil, err
		}
		if i, ok := indexByID[uuidString(listID)]; ok {
			lists[i].Symbols = append(lists[i].Symbols, symbol)
		}
	}
	return lists, srows.Err()
}

func (r *Repo) Create(ctx context.Context, userID, name string) (Watchlist, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Watchlist{}, fmt.Errorf("%w: name is required", ErrBadRequest)
	}
	uid, err := parseUUID(userID)
	if err != nil {
		return Watchlist{}, err
	}

	var id pgtype.UUID
	var w Watchlist
	err = r.pool.QueryRow(ctx, `
INSERT INTO watchlists (user_id, name, position)
VALUES ($1, $2, COALESCE((SELECT MAX(position) + 1 FROM watchlists WHERE user_id = $1), 0))
RETURNING id, name, position`, uid, name).Scan(&id, &w.Name, &w.Position)
	if err != nil {
		return Watchlist{}, err
	}
	w.ID = uuidString(id)
	w.Symbols = []string{}
	return w, nil
}

func (r *Repo) Update(ctx context.Context, userID, id string, name *string, position *int) (Watchlist, error) {
	if name != nil {
		trimmed := strings.TrimSpace(*name)
		if trimmed == "" {
			return Watchlist{}, fmt.Errorf("%w: name cannot be empty", ErrBadRequest)
		}
		name = &trimmed
	}
	uid, err := parseUUID(userID)
	if err != nil {
		return Watchlist{}, err
	}
	wid, err := parseUUID(id)
	if err != nil {
		return Watchlist{}, ErrNotFound
	}

	tag, err := r.pool.Exec(ctx, `
UPDATE watchlists
SET name = COALESCE($3::text, name),
    position = COALESCE($4::int, position),
    updated_at = now()
WHERE id = $1 AND user_id = $2`, wid, uid, name, position)
	if err != nil {
		return Watchlist{}, err
	}
	if tag.RowsAffected() == 0 {
		return Watchlist{}, ErrNotFound
	}
	return r.load(ctx, uid, wid)
}

func (r *Repo) Delete(ctx context.Context, userID, id string) error {
	uid, err := parseUUID(userID)
	if err != nil {
		return err
	}
	wid, err := parseUUID(id)
	if err != nil {
		return ErrNotFound
	}
	tag, err := r.pool.Exec(ctx, `DELETE FROM watchlists WHERE id = $1 AND user_id = $2`, wid, uid)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repo) AddSymbol(ctx context.Context, userID, id, symbol string) (Watchlist, error) {
	symbol = strings.TrimSpace(symbol)
	if symbol == "" {
		return Watchlist{}, fmt.Errorf("%w: symbol is required", ErrBadRequest)
	}
	uid, wid, err := r.ownedIDs(ctx, userID, id)
	if err != nil {
		return Watchlist{}, err
	}
	// UNIQUE (watchlist_id, symbol) makes adds idempotent.
	if _, err := r.pool.Exec(ctx, `
INSERT INTO watchlist_symbols (watchlist_id, symbol, position)
VALUES ($1, $2, COALESCE((SELECT MAX(position) + 1 FROM watchlist_symbols WHERE watchlist_id = $1), 0))
ON CONFLICT (watchlist_id, symbol) DO NOTHING`, wid, symbol); err != nil {
		return Watchlist{}, err
	}
	return r.load(ctx, uid, wid)
}

func (r *Repo) RemoveSymbol(ctx context.Context, userID, id, symbol string) (Watchlist, error) {
	uid, wid, err := r.ownedIDs(ctx, userID, id)
	if err != nil {
		return Watchlist{}, err
	}
	if _, err := r.pool.Exec(ctx,
		`DELETE FROM watchlist_symbols WHERE watchlist_id = $1 AND symbol = $2`,
		wid, strings.TrimSpace(symbol)); err != nil {
		return Watchlist{}, err
	}
	return r.load(ctx, uid, wid)
}

// ownedIDs parses the ids and confirms the watchlist belongs to the user,
// returning ErrNotFound otherwise (never leaking existence).
func (r *Repo) ownedIDs(ctx context.Context, userID, id string) (pgtype.UUID, pgtype.UUID, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return pgtype.UUID{}, pgtype.UUID{}, err
	}
	wid, err := parseUUID(id)
	if err != nil {
		return pgtype.UUID{}, pgtype.UUID{}, ErrNotFound
	}
	var exists bool
	if err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM watchlists WHERE id = $1 AND user_id = $2)`,
		wid, uid).Scan(&exists); err != nil {
		return pgtype.UUID{}, pgtype.UUID{}, err
	}
	if !exists {
		return pgtype.UUID{}, pgtype.UUID{}, ErrNotFound
	}
	return uid, wid, nil
}

func (r *Repo) load(ctx context.Context, uid, wid pgtype.UUID) (Watchlist, error) {
	var id pgtype.UUID
	var w Watchlist
	err := r.pool.QueryRow(ctx,
		`SELECT id, name, position FROM watchlists WHERE id = $1 AND user_id = $2`,
		wid, uid).Scan(&id, &w.Name, &w.Position)
	if errors.Is(err, pgx.ErrNoRows) {
		return Watchlist{}, ErrNotFound
	}
	if err != nil {
		return Watchlist{}, err
	}
	w.ID = uuidString(id)
	w.Symbols = []string{}

	rows, err := r.pool.Query(ctx,
		`SELECT symbol FROM watchlist_symbols WHERE watchlist_id = $1 ORDER BY position, created_at`, wid)
	if err != nil {
		return Watchlist{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return Watchlist{}, err
		}
		w.Symbols = append(w.Symbols, s)
	}
	return w, rows.Err()
}

func parseUUID(s string) (pgtype.UUID, error) {
	var u pgtype.UUID
	if err := u.Scan(s); err != nil {
		return pgtype.UUID{}, fmt.Errorf("watchlists: invalid id: %w", err)
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
