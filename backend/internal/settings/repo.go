package settings

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store is the persistence surface used by HTTP handlers and sync bootstrap.
type Store interface {
	Get(ctx context.Context, userID string) (Document, error)
	Replace(ctx context.Context, userID string, doc Document) (Document, error)
	Patch(ctx context.Context, userID string, patch Patch) (Document, error)
}

type Repo struct {
	pool *pgxpool.Pool
}

func NewRepo(pool *pgxpool.Pool) *Repo {
	return &Repo{pool: pool}
}

var _ Store = (*Repo)(nil)

func (r *Repo) Get(ctx context.Context, userID string) (Document, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return Document{}, err
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Document{}, err
	}
	defer tx.Rollback(ctx)

	doc, err := ensureAndGet(ctx, tx, uid)
	if err != nil {
		return Document{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Document{}, err
	}
	return doc, nil
}

func (r *Repo) Replace(ctx context.Context, userID string, doc Document) (Document, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return Document{}, err
	}
	doc = NormalizeDocument(doc)

	return scanDocument(r.pool.QueryRow(ctx, `
INSERT INTO user_settings (user_id, ui, smc, chart, notifications)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (user_id) DO UPDATE SET
  ui = EXCLUDED.ui,
  smc = EXCLUDED.smc,
  chart = EXCLUDED.chart,
  notifications = EXCLUDED.notifications,
  updated_at = now()
RETURNING ui, smc, chart, notifications
`, uid, doc.UI, doc.SMC, doc.Chart, doc.Notifications))
}

func (r *Repo) Patch(ctx context.Context, userID string, patch Patch) (Document, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return Document{}, err
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Document{}, err
	}
	defer tx.Rollback(ctx)

	current, err := ensureAndGetForUpdate(ctx, tx, uid)
	if err != nil {
		return Document{}, err
	}
	next, err := ApplyPatch(current, patch)
	if err != nil {
		return Document{}, err
	}

	doc, err := scanDocument(tx.QueryRow(ctx, `
UPDATE user_settings
SET ui = $2, smc = $3, chart = $4, notifications = $5, updated_at = now()
WHERE user_id = $1
RETURNING ui, smc, chart, notifications
`, uid, next.UI, next.SMC, next.Chart, next.Notifications))
	if err != nil {
		return Document{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Document{}, err
	}
	return doc, nil
}

func ensureAndGet(ctx context.Context, tx pgx.Tx, uid pgtype.UUID) (Document, error) {
	if _, err := tx.Exec(ctx, `
INSERT INTO user_settings (user_id)
VALUES ($1)
ON CONFLICT (user_id) DO NOTHING
`, uid); err != nil {
		return Document{}, err
	}
	return scanDocument(tx.QueryRow(ctx, `
SELECT ui, smc, chart, notifications
FROM user_settings
WHERE user_id = $1
`, uid))
}

// Settings patches read and rewrite the complete four-section document. Lock
// the row so concurrent PATCH requests cannot lose an unrelated section that
// committed while this transaction was applying its merge.
func ensureAndGetForUpdate(ctx context.Context, tx pgx.Tx, uid pgtype.UUID) (Document, error) {
	if _, err := tx.Exec(ctx, `
INSERT INTO user_settings (user_id)
VALUES ($1)
ON CONFLICT (user_id) DO NOTHING
`, uid); err != nil {
		return Document{}, err
	}
	return scanDocument(tx.QueryRow(ctx, `
SELECT ui, smc, chart, notifications
FROM user_settings
WHERE user_id = $1
FOR UPDATE
`, uid))
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanDocument(row rowScanner) (Document, error) {
	var doc Document
	if err := row.Scan(&doc.UI, &doc.SMC, &doc.Chart, &doc.Notifications); err != nil {
		return Document{}, err
	}
	return NormalizeDocument(doc), nil
}

func parseUUID(s string) (pgtype.UUID, error) {
	var u pgtype.UUID
	if err := u.Scan(s); err != nil {
		return pgtype.UUID{}, fmt.Errorf("settings: invalid user id: %w", err)
	}
	return u, nil
}
