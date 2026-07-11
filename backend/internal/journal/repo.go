package journal

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
)

type Store interface {
	List(context.Context, string, ListFilter) ([]Entry, error)
	Get(context.Context, string, string) (Entry, error)
	Create(context.Context, string, CreateInput) (Entry, error)
	Update(context.Context, string, string, UpdateInput) (Entry, error)
	Delete(context.Context, string, string) error
	CreateScreenshot(context.Context, string, ScreenshotInput) (Screenshot, error)
	GetScreenshot(context.Context, string, string) (Screenshot, error)
	DeleteScreenshot(context.Context, string, string) error
}

type Repo struct{ pool *pgxpool.Pool }

func NewRepo(pool *pgxpool.Pool) *Repo { return &Repo{pool: pool} }

const entryColumns = `
id, COALESCE(client_id, ''), symbol, side::text, entry_time, exit_time,
entry_price, exit_price, quantity, pnl, rr, risk_amount, COALESCE(notes, ''), tags,
position_id, created_at, updated_at`

func (r *Repo) List(ctx context.Context, userID string, filter ListFilter) ([]Entry, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return nil, err
	}
	filter.Symbol = strings.TrimSpace(filter.Symbol)
	filter.Tag = strings.TrimSpace(filter.Tag)
	rows, err := r.pool.Query(ctx, `SELECT `+entryColumns+`
FROM journal_entries
WHERE user_id = $1
  AND ($2::text = '' OR symbol = $2)
  AND ($3::text = '' OR $3 = ANY(tags))
  AND ($4::timestamptz IS NULL OR entry_time < $4)
ORDER BY entry_time DESC, id DESC
LIMIT $5`, uid, filter.Symbol, filter.Tag, filter.Before, normalizeLimit(filter.Limit))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Entry{}
	for rows.Next() {
		item, err := scanEntry(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := r.attachScreenshots(ctx, uid, items); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *Repo) Get(ctx context.Context, userID, ref string) (Entry, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return Entry{}, err
	}
	id, clientID := splitRef(ref)
	item, err := scanEntry(r.pool.QueryRow(ctx, `SELECT `+entryColumns+`
FROM journal_entries WHERE user_id = $1
AND (($2::uuid IS NOT NULL AND id = $2) OR ($3::text <> '' AND client_id = $3))`, uid, id, clientID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Entry{}, ErrNotFound
	}
	if err != nil {
		return Entry{}, err
	}
	items := []Entry{item}
	if err := r.attachScreenshots(ctx, uid, items); err != nil {
		return Entry{}, err
	}
	return items[0], nil
}

func (r *Repo) Create(ctx context.Context, userID string, in CreateInput) (Entry, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return Entry{}, err
	}
	in, err = normalizeCreate(in)
	if err != nil {
		return Entry{}, err
	}
	var positionID any
	if in.PositionID != nil && strings.TrimSpace(*in.PositionID) != "" {
		parsed, parseErr := parseUUID(*in.PositionID)
		if parseErr != nil {
			return Entry{}, fmt.Errorf("%w: invalid positionId", ErrBadRequest)
		}
		positionID = parsed
	}
	query := `INSERT INTO journal_entries
(user_id, client_id, symbol, side, entry_time, exit_time, entry_price, exit_price,
 quantity, pnl, rr, risk_amount, notes, tags, position_id)
VALUES ($1, NULLIF($2, ''), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULLIF($13, ''), $14, $15)`
	if in.ClientID != "" {
		query += ` ON CONFLICT (user_id, client_id) DO UPDATE SET
symbol=EXCLUDED.symbol, side=EXCLUDED.side, entry_time=EXCLUDED.entry_time,
exit_time=EXCLUDED.exit_time, entry_price=EXCLUDED.entry_price, exit_price=EXCLUDED.exit_price,
quantity=EXCLUDED.quantity, pnl=EXCLUDED.pnl, rr=EXCLUDED.rr, risk_amount=EXCLUDED.risk_amount,
notes=EXCLUDED.notes, tags=EXCLUDED.tags, position_id=EXCLUDED.position_id, updated_at=now()`
	}
	query += ` RETURNING ` + entryColumns
	return scanEntry(r.pool.QueryRow(ctx, query, uid, in.ClientID, in.Symbol, in.Side,
		in.EntryTime, in.ExitTime, in.EntryPrice, in.ExitPrice, in.Quantity, in.PnL, in.RR,
		in.RiskAmount, in.Notes, in.Tags, positionID))
}

func (r *Repo) Update(ctx context.Context, userID, ref string, in UpdateInput) (Entry, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return Entry{}, err
	}
	in, err = normalizeUpdate(in)
	if err != nil {
		return Entry{}, err
	}
	id, clientID := splitRef(ref)
	var notes string
	if in.Notes != nil {
		notes = *in.Notes
	}
	var tags []string
	if in.Tags != nil {
		tags = *in.Tags
	}
	item, err := scanEntry(r.pool.QueryRow(ctx, `UPDATE journal_entries SET
symbol=COALESCE($4::text, symbol), side=COALESCE($5::trade_side, side),
entry_time=COALESCE($6::timestamptz, entry_time), exit_time=COALESCE($7::timestamptz, exit_time),
entry_price=COALESCE($8::numeric, entry_price), exit_price=COALESCE($9::numeric, exit_price),
quantity=COALESCE($10::numeric, quantity), pnl=COALESCE($11::numeric, pnl),
rr=COALESCE($12::numeric, rr), risk_amount=COALESCE($13::numeric, risk_amount),
notes=CASE WHEN $14::boolean THEN NULLIF($15::text, '') ELSE notes END,
tags=CASE WHEN $16::boolean THEN $17::text[] ELSE tags END, updated_at=now()
WHERE user_id=$1 AND (($2::uuid IS NOT NULL AND id=$2) OR ($3::text <> '' AND client_id=$3))
RETURNING `+entryColumns, uid, id, clientID, in.Symbol, in.Side, in.EntryTime, in.ExitTime,
		in.EntryPrice, in.ExitPrice, in.Quantity, in.PnL, in.RR, in.RiskAmount,
		in.Notes != nil, notes, in.Tags != nil, tags))
	if errors.Is(err, pgx.ErrNoRows) {
		return Entry{}, ErrNotFound
	}
	return item, err
}

func (r *Repo) Delete(ctx context.Context, userID, ref string) error {
	uid, err := parseUUID(userID)
	if err != nil {
		return err
	}
	id, clientID := splitRef(ref)
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `SELECT s.storage_key FROM screenshots s JOIN journal_entries j ON j.id=s.journal_entry_id
WHERE j.user_id=$1 AND (($2::uuid IS NOT NULL AND j.id=$2) OR ($3::text <> '' AND j.client_id=$3))`, uid, id, clientID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			rows.Close()
			return err
		}
		log.Info().Str("storage_key", key).Msg("enqueueing journal screenshot blob deletion")
	}
	rows.Close()
	tag, err := tx.Exec(ctx, `DELETE FROM journal_entries WHERE user_id=$1
AND (($2::uuid IS NOT NULL AND id=$2) OR ($3::text <> '' AND client_id=$3))`, uid, id, clientID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return tx.Commit(ctx)
}

func (r *Repo) CreateScreenshot(ctx context.Context, userID string, in ScreenshotInput) (Screenshot, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return Screenshot{}, err
	}
	in, err = normalizeScreenshot(in)
	if err != nil {
		return Screenshot{}, err
	}
	if !strings.HasPrefix(in.StorageKey, "users/"+userID+"/") {
		return Screenshot{}, fmt.Errorf("%w: storageKey does not belong to the current user", ErrBadRequest)
	}
	entryID, clientID := splitRef(in.JournalEntryID)
	item, err := scanScreenshot(r.pool.QueryRow(ctx, `INSERT INTO screenshots
(user_id, journal_entry_id, phase, storage_key, width, height, size_bytes, content_type)
SELECT $1, j.id, $4, $5, $6, $7, $8, $9 FROM journal_entries j
WHERE j.user_id=$1 AND (($2::uuid IS NOT NULL AND j.id=$2) OR ($3::text <> '' AND j.client_id=$3))
RETURNING id, journal_entry_id, phase::text, storage_key, width, height, size_bytes, content_type, created_at`,
		uid, entryID, clientID, in.Phase, in.StorageKey, in.Width, in.Height, in.SizeBytes, in.ContentType))
	if errors.Is(err, pgx.ErrNoRows) {
		return Screenshot{}, ErrNotFound
	}
	return item, err
}

func (r *Repo) GetScreenshot(ctx context.Context, userID, id string) (Screenshot, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return Screenshot{}, err
	}
	shotID, err := parseUUID(id)
	if err != nil {
		return Screenshot{}, ErrNotFound
	}
	item, err := scanScreenshot(r.pool.QueryRow(ctx, `SELECT id, journal_entry_id, phase::text,
storage_key, width, height, size_bytes, content_type, created_at FROM screenshots
WHERE user_id=$1 AND id=$2`, uid, shotID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Screenshot{}, ErrNotFound
	}
	return item, err
}

func (r *Repo) DeleteScreenshot(ctx context.Context, userID, id string) error {
	item, err := r.GetScreenshot(ctx, userID, id)
	if err != nil {
		return err
	}
	log.Info().Str("storage_key", item.StorageKey).Msg("enqueueing screenshot blob deletion")
	uid, _ := parseUUID(userID)
	shotID, _ := parseUUID(id)
	tag, err := r.pool.Exec(ctx, `DELETE FROM screenshots WHERE user_id=$1 AND id=$2`, uid, shotID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repo) attachScreenshots(ctx context.Context, userID pgtype.UUID, items []Entry) error {
	if len(items) == 0 {
		return nil
	}
	ids := make([]pgtype.UUID, 0, len(items))
	index := make(map[string]int, len(items))
	for i := range items {
		id, err := parseUUID(items[i].ID)
		if err != nil {
			return err
		}
		ids = append(ids, id)
		index[items[i].ID] = i
		items[i].Screenshots = []Screenshot{}
	}
	rows, err := r.pool.Query(ctx, `SELECT id, journal_entry_id, phase::text, storage_key,
width, height, size_bytes, content_type, created_at FROM screenshots
WHERE user_id=$1 AND journal_entry_id=ANY($2::uuid[]) ORDER BY created_at, id`, userID, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		shot, err := scanScreenshot(rows)
		if err != nil {
			return err
		}
		if i, ok := index[shot.JournalEntryID]; ok {
			items[i].Screenshots = append(items[i].Screenshots, shot)
		}
	}
	return rows.Err()
}

type rowScanner interface{ Scan(...any) error }

func scanEntry(row rowScanner) (Entry, error) {
	var item Entry
	var id, positionID pgtype.UUID
	err := row.Scan(&id, &item.ClientID, &item.Symbol, &item.Side, &item.EntryTime, &item.ExitTime,
		&item.EntryPrice, &item.ExitPrice, &item.Quantity, &item.PnL, &item.RR, &item.RiskAmount,
		&item.Notes, &item.Tags, &positionID, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		return Entry{}, err
	}
	item.ID = uuidString(id)
	item.Screenshots = []Screenshot{}
	if positionID.Valid {
		value := uuidString(positionID)
		item.PositionID = &value
	}
	return item, nil
}

func scanScreenshot(row rowScanner) (Screenshot, error) {
	var item Screenshot
	var id, entryID pgtype.UUID
	if err := row.Scan(&id, &entryID, &item.Phase, &item.StorageKey, &item.Width, &item.Height,
		&item.SizeBytes, &item.ContentType, &item.CreatedAt); err != nil {
		return Screenshot{}, err
	}
	item.ID, item.JournalEntryID = uuidString(id), uuidString(entryID)
	return item, nil
}

func splitRef(ref string) (*pgtype.UUID, string) {
	ref = strings.TrimSpace(ref)
	if id, err := parseUUID(ref); err == nil {
		return &id, ""
	}
	return nil, ref
}

func parseUUID(value string) (pgtype.UUID, error) {
	var id pgtype.UUID
	if err := id.Scan(strings.TrimSpace(value)); err != nil {
		return pgtype.UUID{}, fmt.Errorf("journal: invalid id: %w", err)
	}
	return id, nil
}

func uuidString(id pgtype.UUID) string {
	value, err := id.Value()
	if err != nil || value == nil {
		return ""
	}
	text, _ := value.(string)
	return text
}
