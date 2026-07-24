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
	Update(ctx context.Context, userID, id string, name *string, position *int, shared *bool, sortKey *string, sortDir *string) (Watchlist, error)
	Delete(ctx context.Context, userID, id string) error
	SetActive(ctx context.Context, userID, id string) (Watchlist, error)
	ReplaceLayout(ctx context.Context, userID, id string, layout WatchlistLayout) (Watchlist, error)
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
	activeID, err := r.activeWatchlistID(ctx, uid)
	if err != nil {
		return nil, err
	}

	rows, err := r.pool.Query(ctx, `
SELECT id, name, position, shared, sort_key, sort_dir FROM watchlists
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
		if err := rows.Scan(&id, &w.Name, &w.Position, &w.Shared, &w.SortKey, &w.SortDir); err != nil {
			return nil, err
		}
		w.ID = uuidString(id)
		w.Symbols = []string{}
		w.Sections = []WatchlistSection{}
		w.Active = activeID != "" && w.ID == activeID
		indexByID[w.ID] = len(lists)
		lists = append(lists, w)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if activeID == "" && len(lists) > 0 {
		lists[0].Active = true
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
	if err := srows.Err(); err != nil {
		return nil, err
	}

	sectionRows, err := r.pool.Query(ctx, `
SELECT ws.watchlist_id, ws.id, ws.title, ws.symbol_index
FROM watchlist_sections ws
JOIN watchlists w ON w.id = ws.watchlist_id
WHERE w.user_id = $1
ORDER BY ws.position, ws.created_at`, uid)
	if err != nil {
		return nil, err
	}
	defer sectionRows.Close()
	for sectionRows.Next() {
		var listID pgtype.UUID
		var sectionID pgtype.UUID
		var section WatchlistSection
		if err := sectionRows.Scan(&listID, &sectionID, &section.Title, &section.Index); err != nil {
			return nil, err
		}
		if i, ok := indexByID[uuidString(listID)]; ok {
			section.ID = uuidString(sectionID)
			lists[i].Sections = append(lists[i].Sections, section)
		}
	}
	return lists, sectionRows.Err()
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
RETURNING id, name, position, shared, sort_key, sort_dir`, uid, name).Scan(&id, &w.Name, &w.Position, &w.Shared, &w.SortKey, &w.SortDir)
	if err != nil {
		return Watchlist{}, err
	}
	w.ID = uuidString(id)
	w.Symbols = []string{}
	w.Sections = []WatchlistSection{}
	if _, err := r.pool.Exec(ctx, `
INSERT INTO watchlist_preferences (user_id, active_watchlist_id)
VALUES ($1, $2)
ON CONFLICT (user_id) DO UPDATE
SET active_watchlist_id = COALESCE(watchlist_preferences.active_watchlist_id, EXCLUDED.active_watchlist_id),
    updated_at = now()`, uid, id); err != nil {
		return Watchlist{}, err
	}
	activeID, err := r.activeWatchlistID(ctx, uid)
	if err != nil {
		return Watchlist{}, err
	}
	w.Active = activeID == w.ID
	return w, nil
}

func (r *Repo) Update(ctx context.Context, userID, id string, name *string, position *int, shared *bool, sortKey *string, sortDir *string) (Watchlist, error) {
	if name != nil {
		trimmed := strings.TrimSpace(*name)
		if trimmed == "" {
			return Watchlist{}, fmt.Errorf("%w: name cannot be empty", ErrBadRequest)
		}
		name = &trimmed
	}
	if sortKey != nil {
		normalized, ok := normalizeSortKey(*sortKey)
		if !ok {
			return Watchlist{}, fmt.Errorf("%w: invalid sort key", ErrBadRequest)
		}
		sortKey = &normalized
	}
	if sortDir != nil {
		normalized, ok := normalizeSortDir(*sortDir)
		if !ok {
			return Watchlist{}, fmt.Errorf("%w: invalid sort direction", ErrBadRequest)
		}
		sortDir = &normalized
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
    shared = COALESCE($5::boolean, shared),
    sort_key = COALESCE($6::text, sort_key),
    sort_dir = COALESCE($7::text, sort_dir),
    updated_at = now()
WHERE id = $1 AND user_id = $2`, wid, uid, name, position, shared, sortKey, sortDir)
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
	_, err = r.pool.Exec(ctx, `
UPDATE watchlist_preferences
SET active_watchlist_id = (
  SELECT id FROM watchlists
  WHERE user_id = $1
  ORDER BY position, created_at
  LIMIT 1
),
updated_at = now()
WHERE user_id = $1 AND active_watchlist_id IS NULL`, uid)
	if err != nil {
		return err
	}
	return nil
}

func (r *Repo) SetActive(ctx context.Context, userID, id string) (Watchlist, error) {
	uid, wid, err := r.ownedIDs(ctx, userID, id)
	if err != nil {
		return Watchlist{}, err
	}
	if _, err := r.pool.Exec(ctx, `
INSERT INTO watchlist_preferences (user_id, active_watchlist_id)
VALUES ($1, $2)
ON CONFLICT (user_id) DO UPDATE
SET active_watchlist_id = EXCLUDED.active_watchlist_id,
    updated_at = now()`, uid, wid); err != nil {
		return Watchlist{}, err
	}
	return r.load(ctx, uid, wid)
}

func (r *Repo) ReplaceLayout(ctx context.Context, userID, id string, layout WatchlistLayout) (Watchlist, error) {
	symbols := normalizeSymbols(layout.Symbols)
	sections := normalizeSections(layout.Sections, len(symbols))
	uid, err := parseUUID(userID)
	if err != nil {
		return Watchlist{}, err
	}
	wid, err := parseUUID(id)
	if err != nil {
		return Watchlist{}, ErrNotFound
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Watchlist{}, err
	}
	defer tx.Rollback(ctx) // no-op after Commit

	// Replacing a layout is a delete-and-reinsert operation. Serialize it on
	// the parent row so rapid drag/drop writes (or writes from another tab)
	// cannot interleave and collide with UNIQUE (watchlist_id, symbol).
	var lockedID pgtype.UUID
	err = tx.QueryRow(ctx, `
SELECT id
FROM watchlists
WHERE id = $1 AND user_id = $2
FOR UPDATE`, wid, uid).Scan(&lockedID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Watchlist{}, ErrNotFound
	}
	if err != nil {
		return Watchlist{}, err
	}

	if _, err := tx.Exec(ctx, `DELETE FROM watchlist_symbols WHERE watchlist_id = $1`, wid); err != nil {
		return Watchlist{}, err
	}
	for i, symbol := range symbols {
		if _, err := tx.Exec(ctx, `
INSERT INTO watchlist_symbols (watchlist_id, symbol, position)
VALUES ($1, $2, $3)`, wid, symbol, i); err != nil {
			return Watchlist{}, err
		}
	}

	if _, err := tx.Exec(ctx, `DELETE FROM watchlist_sections WHERE watchlist_id = $1`, wid); err != nil {
		return Watchlist{}, err
	}
	for i, section := range sections {
		if _, err := tx.Exec(ctx, `
INSERT INTO watchlist_sections (watchlist_id, title, symbol_index, position)
VALUES ($1, $2, $3, $4)`, wid, section.Title, section.Index, i); err != nil {
			return Watchlist{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return Watchlist{}, err
	}
	return r.load(ctx, uid, wid)
}

func (r *Repo) AddSymbol(ctx context.Context, userID, id, symbol string) (Watchlist, error) {
	symbol = strings.TrimSpace(symbol)
	if symbol == "" {
		return Watchlist{}, fmt.Errorf("%w: symbol is required", ErrBadRequest)
	}
	symbol = strings.ToUpper(symbol)
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
		wid, strings.ToUpper(strings.TrimSpace(symbol))); err != nil {
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
		`SELECT id, name, position, shared, sort_key, sort_dir FROM watchlists WHERE id = $1 AND user_id = $2`,
		wid, uid).Scan(&id, &w.Name, &w.Position, &w.Shared, &w.SortKey, &w.SortDir)
	if errors.Is(err, pgx.ErrNoRows) {
		return Watchlist{}, ErrNotFound
	}
	if err != nil {
		return Watchlist{}, err
	}
	w.ID = uuidString(id)
	w.Symbols = []string{}
	w.Sections = []WatchlistSection{}

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
	if err := rows.Err(); err != nil {
		return Watchlist{}, err
	}

	sectionRows, err := r.pool.Query(ctx,
		`SELECT id, title, symbol_index FROM watchlist_sections WHERE watchlist_id = $1 ORDER BY position, created_at`, wid)
	if err != nil {
		return Watchlist{}, err
	}
	defer sectionRows.Close()
	for sectionRows.Next() {
		var sectionID pgtype.UUID
		var section WatchlistSection
		if err := sectionRows.Scan(&sectionID, &section.Title, &section.Index); err != nil {
			return Watchlist{}, err
		}
		section.ID = uuidString(sectionID)
		w.Sections = append(w.Sections, section)
	}
	if err := sectionRows.Err(); err != nil {
		return Watchlist{}, err
	}

	activeID, err := r.activeWatchlistID(ctx, uid)
	if err != nil {
		return Watchlist{}, err
	}
	w.Active = activeID == w.ID
	return w, nil
}

func (r *Repo) activeWatchlistID(ctx context.Context, uid pgtype.UUID) (string, error) {
	var id pgtype.UUID
	err := r.pool.QueryRow(ctx,
		`SELECT active_watchlist_id FROM watchlist_preferences WHERE user_id = $1`,
		uid).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return uuidString(id), nil
}

func normalizeSymbols(input []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range input {
		symbol := strings.ToUpper(strings.TrimSpace(value))
		if symbol == "" || seen[symbol] {
			continue
		}
		seen[symbol] = true
		out = append(out, symbol)
	}
	return out
}

func normalizeSections(input []WatchlistSection, symbolCount int) []WatchlistSection {
	out := []WatchlistSection{}
	for _, value := range input {
		title := strings.TrimSpace(value.Title)
		if title == "" {
			continue
		}
		index := value.Index
		if index < 0 {
			index = 0
		}
		if index > symbolCount {
			index = symbolCount
		}
		out = append(out, WatchlistSection{
			Title: title,
			Index: index,
		})
	}
	return out
}

func normalizeSortKey(input string) (string, bool) {
	switch strings.TrimSpace(input) {
	case "symbol", "price", "change", "changeAbs", "volume":
		return strings.TrimSpace(input), true
	default:
		return "", false
	}
}

func normalizeSortDir(input string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(input)) {
	case "asc":
		return "asc", true
	case "desc":
		return "desc", true
	default:
		return "", false
	}
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
