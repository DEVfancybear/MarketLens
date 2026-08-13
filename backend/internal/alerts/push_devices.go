package alerts

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const pushDeviceColumns = `
fcm_token, user_id, COALESCE(delivery_token, ''), notification_time_zone,
alerts, settings_push, settings_telegram, settings_discord,
last_prices, alert_state, created_at, updated_at, state_version`

func (r *Repo) firebaseUserID(ctx context.Context, firebaseUID string) (pgtype.UUID, error) {
	firebaseUID = strings.TrimSpace(firebaseUID)
	if firebaseUID == "" {
		return pgtype.UUID{}, fmt.Errorf("%w: firebaseUid is required", ErrBadRequest)
	}
	var uid pgtype.UUID
	err := r.pool.QueryRow(ctx, `
SELECT user_id
FROM auth_identities
WHERE firebase_uid = $1`, firebaseUID).Scan(&uid)
	if errors.Is(err, pgx.ErrNoRows) {
		return pgtype.UUID{}, ErrNotFound
	}
	return uid, err
}

func (r *Repo) EnsurePushDevice(
	ctx context.Context,
	firebaseUID, token string,
) (PushDevice, error) {
	uid, err := r.firebaseUserID(ctx, firebaseUID)
	if err != nil {
		return PushDevice{}, err
	}
	token = strings.TrimSpace(token)
	if token == "" || len(token) > MaxTokenLen {
		return PushDevice{}, fmt.Errorf("%w: push device token is invalid", ErrBadRequest)
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return PushDevice{}, err
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, `
INSERT INTO push_tokens (user_id, fcm_token, platform, permission)
VALUES ($1, $2, 'web', 'granted')
ON CONFLICT (fcm_token) DO NOTHING`, uid, token)
	if err != nil {
		return PushDevice{}, err
	}

	device, owner, err := scanPushDeviceWithOwner(tx.QueryRow(ctx, `
SELECT `+pushDeviceColumns+`
FROM push_tokens
WHERE fcm_token = $1
FOR UPDATE`, token))
	if err != nil {
		return PushDevice{}, err
	}
	if owner != uuidString(uid) {
		return PushDevice{}, fmt.Errorf("%w: push token belongs to another user", ErrConflict)
	}
	if err := tx.Commit(ctx); err != nil {
		return PushDevice{}, err
	}
	return device, nil
}

func (r *Repo) GetPushDevice(
	ctx context.Context,
	firebaseUID, token string,
) (PushDevice, error) {
	var (
		device PushDevice
		err    error
	)
	if strings.TrimSpace(firebaseUID) == "" {
		device, _, err = scanPushDeviceWithOwner(r.pool.QueryRow(ctx, `
SELECT `+pushDeviceColumns+`
FROM push_tokens
WHERE fcm_token = $1`, strings.TrimSpace(token)))
	} else {
		uid, resolveErr := r.firebaseUserID(ctx, firebaseUID)
		if resolveErr != nil {
			return PushDevice{}, resolveErr
		}
		device, _, err = scanPushDeviceWithOwner(r.pool.QueryRow(ctx, `
SELECT `+pushDeviceColumns+`
FROM push_tokens
WHERE user_id = $1 AND fcm_token = $2`, uid, strings.TrimSpace(token)))
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return PushDevice{}, ErrNotFound
	}
	return device, err
}

func (r *Repo) ListPushDevices(ctx context.Context) ([]PushDevice, error) {
	rows, err := r.pool.Query(ctx, `
SELECT `+pushDeviceColumns+`
FROM push_tokens
WHERE settings_push
   OR settings_telegram
   OR settings_discord
   OR alerts <> '[]'::jsonb
   OR alert_state <> '{}'::jsonb
ORDER BY updated_at, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	devices := []PushDevice{}
	for rows.Next() {
		device, _, scanErr := scanPushDeviceWithOwner(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		devices = append(devices, device)
	}
	return devices, rows.Err()
}

func (r *Repo) PutPushDevice(
	ctx context.Context,
	input PushDevicePutInput,
) (PushDevice, error) {
	device, err := normalizePushDevice(input.Device)
	if err != nil {
		return PushDevice{}, err
	}
	if input.ExpectedVersion <= 0 || device.Version != input.ExpectedVersion {
		return PushDevice{}, fmt.Errorf("%w: push device version is stale", ErrConflict)
	}

	var uid any
	if strings.TrimSpace(input.FirebaseUID) != "" {
		resolved, resolveErr := r.firebaseUserID(ctx, input.FirebaseUID)
		if resolveErr != nil {
			return PushDevice{}, resolveErr
		}
		uid = resolved
	}

	var updated PushDevice
	err = r.pool.QueryRow(ctx, `
UPDATE push_tokens SET
  delivery_token = NULLIF($3, ''),
  notification_time_zone = $4,
  alerts = $5,
  settings_push = $6,
  settings_telegram = $7,
  settings_discord = $8,
  last_prices = $9,
  alert_state = $10,
  state_version = state_version + 1,
  updated_at = now()
WHERE fcm_token = $1
  AND state_version = $2
  AND ($11::uuid IS NULL OR user_id = $11)
RETURNING fcm_token, state_version`,
		device.Token,
		input.ExpectedVersion,
		device.DeliveryToken,
		device.NotificationTimeZone,
		device.Alerts,
		device.SettingsPush,
		device.SettingsTelegram,
		device.SettingsDiscord,
		device.LastPrices,
		device.AlertState,
		uid,
	).Scan(&updated.Token, &updated.Version)
	if errors.Is(err, pgx.ErrNoRows) {
		return PushDevice{}, fmt.Errorf("%w: push device changed concurrently", ErrConflict)
	}
	return updated, err
}

func (r *Repo) DeletePushDevice(
	ctx context.Context,
	firebaseUID, token string,
) error {
	uid, err := r.firebaseUserID(ctx, firebaseUID)
	if err != nil {
		return err
	}
	_, err = r.pool.Exec(ctx, `
DELETE FROM push_tokens
WHERE user_id = $1 AND fcm_token = $2`, uid, strings.TrimSpace(token))
	if err != nil {
		return err
	}
	// Unregister is intentionally idempotent. A missing row can mean the same
	// request already succeeded or the browser rotated its FCM token.
	return nil
}

func scanPushDeviceWithOwner(row rowScanner) (PushDevice, string, error) {
	var (
		device    PushDevice
		uid       pgtype.UUID
		createdAt time.Time
		updatedAt time.Time
	)
	err := row.Scan(
		&device.Token,
		&uid,
		&device.DeliveryToken,
		&device.NotificationTimeZone,
		&device.Alerts,
		&device.SettingsPush,
		&device.SettingsTelegram,
		&device.SettingsDiscord,
		&device.LastPrices,
		&device.AlertState,
		&createdAt,
		&updatedAt,
		&device.Version,
	)
	if err != nil {
		return PushDevice{}, "", err
	}
	device.UserID = uuidString(uid)
	device.CreatedAt = createdAt.UnixMilli()
	device.UpdatedAt = updatedAt.UnixMilli()
	return device, device.UserID, nil
}
