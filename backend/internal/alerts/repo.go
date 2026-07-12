package alerts

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store interface {
	List(ctx context.Context, userID, status string) ([]Alert, error)
	Create(ctx context.Context, userID string, input CreateInput) (Alert, error)
	Patch(ctx context.Context, userID, ref string, input PatchInput) (Alert, error)
	Delete(ctx context.Context, userID, ref string) error
	Trigger(ctx context.Context, userID, ref string, triggerPrice float64) (Alert, Event, error)
	ListEvents(ctx context.Context, userID, ref string, limit int) ([]Event, error)
	ListHistory(ctx context.Context, userID string, limit int) ([]Event, error)
	ClearHistory(ctx context.Context, userID string) error
	Snapshot(ctx context.Context, userID string) (Snapshot, error)
	UpsertPushToken(ctx context.Context, userID string, input PushTokenInput) (PushToken, error)
	DeletePushToken(ctx context.Context, userID, token string) error
}

type Repo struct {
	pool *pgxpool.Pool
}

func NewRepo(pool *pgxpool.Pool) *Repo {
	return &Repo{pool: pool}
}

var _ Store = (*Repo)(nil)

func (r *Repo) List(ctx context.Context, userID, status string) ([]Alert, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return nil, err
	}
	status = strings.TrimSpace(status)
	if status != "" && status != "active" && status != "triggered" {
		return nil, fmt.Errorf("%w: unsupported status %q", ErrBadRequest, status)
	}
	rows, err := r.pool.Query(ctx, `
SELECT id, COALESCE(client_id, ''), symbol, condition::text, price, COALESCE(note, ''),
       status::text, enabled, locked, recurring, sound, browser, push, telegram, discord,
       trigger_price, triggered_at, created_at, updated_at, source
FROM alerts
WHERE user_id = $1 AND ($2::text = '' OR status::text = $2::text)
ORDER BY created_at DESC, id`, uid, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Alert{}
	for rows.Next() {
		item, _, err := scanAlert(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (r *Repo) Create(ctx context.Context, userID string, input CreateInput) (Alert, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return Alert{}, err
	}
	input, err = normalizeCreate(input)
	if err != nil {
		return Alert{}, err
	}
	channels := *input.Channels
	if input.ClientID != "" {
		item, _, err := scanAlert(r.pool.QueryRow(ctx, `
INSERT INTO alerts (
  user_id, client_id, symbol, condition, price, note, enabled, locked, recurring,
  sound, browser, push, telegram, discord, source
)
VALUES ($1, NULLIF($2, ''), $3, $4, $5, NULLIF($6, ''), $7, $8, $9, $10, $11, $12, $13, $14, $15)
ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL DO UPDATE SET
  symbol = EXCLUDED.symbol,
  condition = EXCLUDED.condition,
  price = EXCLUDED.price,
  note = EXCLUDED.note,
  enabled = EXCLUDED.enabled,
  locked = EXCLUDED.locked,
  recurring = EXCLUDED.recurring,
  sound = EXCLUDED.sound,
  browser = EXCLUDED.browser,
  push = EXCLUDED.push,
  telegram = EXCLUDED.telegram,
  discord = EXCLUDED.discord,
  source = COALESCE(alerts.source, EXCLUDED.source),
  updated_at = now()
RETURNING id, COALESCE(client_id, ''), symbol, condition::text, price, COALESCE(note, ''),
          status::text, enabled, locked, recurring, sound, browser, push, telegram, discord,
          trigger_price, triggered_at, created_at, updated_at, source`,
			uid, input.ClientID, input.Symbol, input.Condition, input.Price, input.Note,
			*input.Enabled, input.Locked, input.Recurring, channels.Sound, channels.Browser,
			channels.Push, channels.Telegram, channels.Discord, input.Source))
		return item, err
	}

	item, _, err := scanAlert(r.pool.QueryRow(ctx, `
INSERT INTO alerts (
  user_id, symbol, condition, price, note, enabled, locked, recurring,
  sound, browser, push, telegram, discord, source
)
VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6, $7, $8, $9, $10, $11, $12, $13, $14)
RETURNING id, COALESCE(client_id, ''), symbol, condition::text, price, COALESCE(note, ''),
          status::text, enabled, locked, recurring, sound, browser, push, telegram, discord,
          trigger_price, triggered_at, created_at, updated_at, source`,
		uid, input.Symbol, input.Condition, input.Price, input.Note, *input.Enabled,
		input.Locked, input.Recurring, channels.Sound, channels.Browser, channels.Push,
		channels.Telegram, channels.Discord, input.Source))
	return item, err
}

func (r *Repo) Patch(ctx context.Context, userID, ref string, input PatchInput) (Alert, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return Alert{}, err
	}
	input, err = normalizePatch(input)
	if err != nil {
		return Alert{}, err
	}
	refUUID, refClientID := splitRef(ref)
	var note string
	noteSet := input.Note != nil
	if noteSet {
		note = *input.Note
	}
	var channels ChannelPatch
	if input.Channels != nil {
		channels = *input.Channels
	}
	item, _, err := scanAlert(r.pool.QueryRow(ctx, `
UPDATE alerts SET
  symbol = COALESCE($4::text, symbol),
  condition = COALESCE($5::alert_condition, condition),
  price = COALESCE($6::numeric, price),
  note = CASE WHEN $7::boolean THEN NULLIF($8::text, '') ELSE note END,
  status = COALESCE($9::alert_status, status),
  enabled = COALESCE($10::boolean, enabled),
  locked = COALESCE($11::boolean, locked),
  recurring = COALESCE($12::boolean, recurring),
  sound = COALESCE($13::boolean, sound),
  browser = COALESCE($14::boolean, browser),
  push = COALESCE($15::boolean, push),
  telegram = COALESCE($16::boolean, telegram),
  discord = COALESCE($17::boolean, discord),
  trigger_price = CASE WHEN $9::text = 'active' THEN NULL ELSE trigger_price END,
  triggered_at = CASE WHEN $9::text = 'active' THEN NULL ELSE triggered_at END,
  updated_at = now()
WHERE user_id = $1
  AND (($2::uuid IS NOT NULL AND id = $2::uuid) OR ($3::text <> '' AND client_id = $3::text))
RETURNING id, COALESCE(client_id, ''), symbol, condition::text, price, COALESCE(note, ''),
          status::text, enabled, locked, recurring, sound, browser, push, telegram, discord,
          trigger_price, triggered_at, created_at, updated_at, source`,
		uid, refUUID, refClientID, input.Symbol, input.Condition, input.Price, noteSet, note,
		input.Status, input.Enabled, input.Locked, input.Recurring, channels.Sound,
		channels.Browser, channels.Push, channels.Telegram, channels.Discord))
	if errors.Is(err, pgx.ErrNoRows) {
		return Alert{}, ErrNotFound
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
DELETE FROM alerts
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

func (r *Repo) Trigger(ctx context.Context, userID, ref string, triggerPrice float64) (Alert, Event, error) {
	if !validPrice(triggerPrice) {
		return Alert{}, Event{}, fmt.Errorf("%w: triggerPrice must be greater than zero", ErrBadRequest)
	}
	uid, err := parseUUID(userID)
	if err != nil {
		return Alert{}, Event{}, err
	}
	refUUID, refClientID := splitRef(ref)
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Alert{}, Event{}, err
	}
	defer tx.Rollback(ctx)

	var selectedAlertID pgtype.UUID
	var condition string
	var targetPrice float64
	var enabled bool
	var status string
	err = tx.QueryRow(ctx, `
SELECT id, condition::text, price, enabled, status::text
FROM alerts
WHERE user_id = $1
  AND (($2::uuid IS NOT NULL AND id = $2::uuid) OR ($3::text <> '' AND client_id = $3::text))
FOR UPDATE`, uid, refUUID, refClientID).Scan(
		&selectedAlertID,
		&condition,
		&targetPrice,
		&enabled,
		&status,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Alert{}, Event{}, ErrNotFound
	}
	if err != nil {
		return Alert{}, Event{}, err
	}
	if !enabled || status != "active" {
		return Alert{}, Event{}, fmt.Errorf(
			"%w: only enabled active alerts can be triggered",
			ErrBadRequest,
		)
	}
	if !validTriggerPrice(condition, targetPrice, triggerPrice) {
		return Alert{}, Event{}, fmt.Errorf(
			"%w: triggerPrice is on the wrong side of the alert target",
			ErrBadRequest,
		)
	}

	item, alertID, err := scanAlert(tx.QueryRow(ctx, `
UPDATE alerts SET
  status = CASE WHEN recurring THEN 'active'::alert_status ELSE 'triggered'::alert_status END,
  trigger_price = $3,
  triggered_at = now()
WHERE user_id = $1 AND id = $2
RETURNING id, COALESCE(client_id, ''), symbol, condition::text, price, COALESCE(note, ''),
          status::text, enabled, locked, recurring, sound, browser, push, telegram, discord,
          trigger_price, triggered_at, created_at, updated_at, source`,
		uid, selectedAlertID, triggerPrice))
	if errors.Is(err, pgx.ErrNoRows) {
		return Alert{}, Event{}, ErrNotFound
	}
	if err != nil {
		return Alert{}, Event{}, err
	}

	event, err := scanEvent(tx.QueryRow(ctx, `
INSERT INTO alert_events (
  alert_id, alert_ref, user_id, symbol, condition, target_price, trigger_price
)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, alert_ref, symbol, condition::text, target_price, trigger_price, triggered_at, delivered`,
		alertID, alertRef(item), uid, item.Symbol, item.Condition, item.Price, triggerPrice))
	if err != nil {
		return Alert{}, Event{}, err
	}
	if _, err := tx.Exec(ctx, `
DELETE FROM alert_events
WHERE user_id = $1 AND id NOT IN (
  SELECT id FROM alert_events WHERE user_id = $1 ORDER BY triggered_at DESC, id DESC LIMIT $2
)`, uid, MaxHistory); err != nil {
		return Alert{}, Event{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Alert{}, Event{}, err
	}
	return item, event, nil
}

func (r *Repo) ListEvents(ctx context.Context, userID, ref string, limit int) ([]Event, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return nil, err
	}
	refUUID, refClientID := splitRef(ref)
	limit = normalizeLimit(limit)
	rows, err := r.pool.Query(ctx, `
SELECT ae.id, ae.alert_ref, ae.symbol, ae.condition::text,
       ae.target_price, ae.trigger_price, ae.triggered_at, ae.delivered
FROM alert_events ae
WHERE ae.user_id = $1
  AND (($2::uuid IS NOT NULL AND ae.alert_id = $2::uuid) OR ($3::text <> '' AND ae.alert_ref = $3::text))
ORDER BY ae.triggered_at DESC, ae.id DESC
LIMIT $4`, uid, refUUID, refClientID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectEvents(rows)
}

func (r *Repo) ListHistory(ctx context.Context, userID string, limit int) ([]Event, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return nil, err
	}
	limit = normalizeLimit(limit)
	rows, err := r.pool.Query(ctx, `
SELECT ae.id, ae.alert_ref, ae.symbol, ae.condition::text,
       ae.target_price, ae.trigger_price, ae.triggered_at, ae.delivered
FROM alert_events ae
WHERE ae.user_id = $1
ORDER BY ae.triggered_at DESC, ae.id DESC
LIMIT $2`, uid, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectEvents(rows)
}

func (r *Repo) ClearHistory(ctx context.Context, userID string) error {
	uid, err := parseUUID(userID)
	if err != nil {
		return err
	}
	_, err = r.pool.Exec(ctx, `DELETE FROM alert_events WHERE user_id = $1`, uid)
	return err
}

func (r *Repo) Snapshot(ctx context.Context, userID string) (Snapshot, error) {
	items, err := r.List(ctx, userID, "")
	if err != nil {
		return Snapshot{}, err
	}
	history, err := r.ListHistory(ctx, userID, MaxHistory)
	if err != nil {
		return Snapshot{}, err
	}
	snapshot := Snapshot{
		Alerts:          []Alert{},
		TriggeredAlerts: []Alert{},
		History:         history,
	}
	for _, item := range items {
		if item.Status == "triggered" {
			snapshot.TriggeredAlerts = append(snapshot.TriggeredAlerts, item)
		} else {
			snapshot.Alerts = append(snapshot.Alerts, item)
		}
	}
	return snapshot, nil
}

func (r *Repo) UpsertPushToken(ctx context.Context, userID string, input PushTokenInput) (PushToken, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return PushToken{}, err
	}
	input, err = normalizePushToken(input)
	if err != nil {
		return PushToken{}, err
	}
	return scanPushToken(r.pool.QueryRow(ctx, `
INSERT INTO push_tokens (user_id, fcm_token, platform, permission)
VALUES ($1, $2, $3, $4)
ON CONFLICT (fcm_token) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  platform = EXCLUDED.platform,
  permission = EXCLUDED.permission,
  last_seen_at = now()
RETURNING id, fcm_token, platform::text, COALESCE(permission, ''), created_at, last_seen_at`,
		uid, input.FCMToken, input.Platform, input.Permission))
}

func (r *Repo) DeletePushToken(ctx context.Context, userID, token string) error {
	uid, err := parseUUID(userID)
	if err != nil {
		return err
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return fmt.Errorf("%w: token is required", ErrBadRequest)
	}
	tag, err := r.pool.Exec(ctx, `DELETE FROM push_tokens WHERE user_id = $1 AND fcm_token = $2`, uid, token)
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

func scanAlert(row rowScanner) (Alert, pgtype.UUID, error) {
	var id pgtype.UUID
	var item Alert
	err := row.Scan(
		&id, &item.ClientID, &item.Symbol, &item.Condition, &item.Price, &item.Note,
		&item.Status, &item.Enabled, &item.Locked, &item.Recurring,
		&item.Channels.Sound, &item.Channels.Browser, &item.Channels.Push,
		&item.Channels.Telegram, &item.Channels.Discord, &item.TriggerPrice,
		&item.TriggeredAt, &item.CreatedAt, &item.UpdatedAt, &item.Source,
	)
	if err != nil {
		return Alert{}, pgtype.UUID{}, err
	}
	item.ID = uuidString(id)
	return item, id, nil
}

func scanEvent(row rowScanner) (Event, error) {
	var id pgtype.UUID
	var item Event
	if err := row.Scan(
		&id, &item.AlertID, &item.Symbol, &item.Condition, &item.TargetPrice,
		&item.TriggerPrice, &item.TriggeredAt, &item.Delivered,
	); err != nil {
		return Event{}, err
	}
	item.ID = uuidString(id)
	return item, nil
}

func collectEvents(rows pgx.Rows) ([]Event, error) {
	out := []Event{}
	for rows.Next() {
		item, err := scanEvent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func scanPushToken(row rowScanner) (PushToken, error) {
	var id pgtype.UUID
	var item PushToken
	if err := row.Scan(
		&id, &item.FCMToken, &item.Platform, &item.Permission,
		&item.CreatedAt, &item.LastSeenAt,
	); err != nil {
		return PushToken{}, err
	}
	item.ID = uuidString(id)
	return item, nil
}

func normalizeLimit(limit int) int {
	if limit <= 0 || limit > MaxHistory {
		return MaxHistory
	}
	return limit
}

func alertRef(item Alert) string {
	if item.ClientID != "" {
		return item.ClientID
	}
	return item.ID
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

func parseUUID(value string) (pgtype.UUID, error) {
	var id pgtype.UUID
	if err := id.Scan(strings.TrimSpace(value)); err != nil {
		return pgtype.UUID{}, fmt.Errorf("alerts: invalid id: %w", err)
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
