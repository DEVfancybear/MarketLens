package tradeauth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/argon2"

	"github.com/smc-trading-terminal/backend/internal/auth"
	"github.com/smc-trading-terminal/backend/internal/config"
)

const (
	maxTransactionPayloadBytes = 256 * 1024
	minTradePasswordRunes      = 8
	maxTradePasswordRunes      = 128
	maxTradePasswordBytes      = 512

	argonMemoryKiB = 19 * 1024
	argonTime      = 2
	argonThreads   = 1
	argonSaltBytes = 16
	argonKeyBytes  = 32

	tradeUnlockAbsoluteTTL = 12 * time.Hour
	tradeUnlockIdleTTL     = 2 * time.Hour
)

var (
	ErrPasswordRequired       = errors.New("trade password required")
	ErrPasswordInvalid        = errors.New("trade password invalid")
	ErrPasswordLocked         = errors.New("trade password temporarily locked")
	ErrPasswordNotConfigured  = errors.New("trade password not configured")
	ErrPasswordPolicy         = errors.New("trade password does not meet policy")
	ErrAuthorizationRejected  = errors.New("trade authorization rejected")
	commonTradePasswordValues = map[string]struct{}{
		"12345678": {}, "123456789": {}, "1234567890": {},
		"abcdefgh": {}, "admin123": {}, "letmein123": {},
		"password": {}, "password1": {}, "password123": {},
		"qwerty123": {}, "trading123": {}, "welcome123": {},
	}
)

type IdentityVerifier interface {
	VerifyUserIdentity(ctx context.Context, idToken, userID string) (auth.User, error)
}

type Service struct {
	pool             *pgxpool.Pool
	identity         IdentityVerifier
	authorizationTTL time.Duration
	now              func() time.Time
}

type SecurityStatus struct {
	Enabled       bool   `json:"enabled"`
	Configured    bool   `json:"configured"`
	Unlocked      bool   `json:"unlocked"`
	LockedUntilMS *int64 `json:"lockedUntilMs,omitempty"`
}

type Authorization struct {
	Token       string `json:"token"`
	ExpiresAtMS int64  `json:"expiresAtMs"`
	UnlockToken string `json:"-"`
}

func NewService(
	pool *pgxpool.Pool,
	identity IdentityVerifier,
	cfg config.Config,
) *Service {
	return &Service{
		pool:             pool,
		identity:         identity,
		authorizationTTL: cfg.TradeAuthorizationTTL,
		now:              time.Now,
	}
}

func (s *Service) Status(
	ctx context.Context,
	userID, sessionID, rawUnlockToken string,
) (SecurityStatus, error) {
	var enabled bool
	var passwordHash sql.NullString
	var lockedUntil sql.NullTime
	err := s.pool.QueryRow(ctx, `
		SELECT enabled, password_hash, locked_until
		FROM trade_security_settings
		WHERE user_id = $1::uuid
	`, userID).Scan(&enabled, &passwordHash, &lockedUntil)
	if errors.Is(err, pgx.ErrNoRows) {
		return SecurityStatus{}, nil
	}
	if err != nil {
		return SecurityStatus{}, err
	}
	status := securityStatus(enabled, passwordHash.Valid, lockedUntil, s.now())
	if status.Enabled {
		status.Unlocked, err = s.tradeUnlockValid(
			ctx,
			userID,
			sessionID,
			rawUnlockToken,
			s.now().UTC(),
		)
		if err != nil {
			return SecurityStatus{}, err
		}
	}
	return status, nil
}

func (s *Service) Configure(
	ctx context.Context,
	userID, idToken string,
	enabled bool,
	password string,
) (SecurityStatus, error) {
	if _, err := s.identity.VerifyUserIdentity(ctx, idToken, userID); err != nil {
		return SecurityStatus{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return SecurityStatus{}, err
	}
	defer tx.Rollback(ctx)

	var currentHash sql.NullString
	err = tx.QueryRow(ctx, `
		SELECT password_hash
		FROM trade_security_settings
		WHERE user_id = $1::uuid
		FOR UPDATE
	`, userID).Scan(&currentHash)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return SecurityStatus{}, err
	}

	if password != "" {
		hash, hashErr := hashTradePassword(password)
		if hashErr != nil {
			return SecurityStatus{}, hashErr
		}
		currentHash = sql.NullString{String: hash, Valid: true}
	}
	if enabled && !currentHash.Valid {
		return SecurityStatus{}, ErrPasswordNotConfigured
	}

	var passwordHash any
	if currentHash.Valid {
		passwordHash = currentHash.String
	}
	if _, err = tx.Exec(ctx, `
		INSERT INTO trade_security_settings
			(user_id, enabled, password_hash, failed_attempts, locked_until)
		VALUES ($1::uuid, $2, $3, 0, NULL)
		ON CONFLICT (user_id) DO UPDATE
		SET enabled = EXCLUDED.enabled,
		    password_hash = EXCLUDED.password_hash,
		    failed_attempts = 0,
		    locked_until = NULL
	`, userID, enabled, passwordHash); err != nil {
		return SecurityStatus{}, err
	}
	if _, err = tx.Exec(ctx, `
		DELETE FROM trade_unlock_sessions
		WHERE user_id = $1::uuid
	`, userID); err != nil {
		return SecurityStatus{}, err
	}
	if _, err = tx.Exec(ctx, `
		DELETE FROM trade_authorizations
		WHERE user_id = $1::uuid AND consumed_at IS NULL
	`, userID); err != nil {
		return SecurityStatus{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return SecurityStatus{}, err
	}
	return SecurityStatus{Enabled: enabled, Configured: currentHash.Valid}, nil
}

func (s *Service) Authorize(
	ctx context.Context,
	userID, sessionID, operation string,
	payload json.RawMessage,
	password, rawUnlockToken string,
) (Authorization, error) {
	if err := validateOperationPayload(operation, payload); err != nil {
		return Authorization{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Authorization{}, err
	}
	defer tx.Rollback(ctx)

	enabled := false
	failedAttempts := 0
	var passwordHash sql.NullString
	var lockedUntil sql.NullTime
	err = tx.QueryRow(ctx, `
		SELECT enabled, password_hash, failed_attempts, locked_until
		FROM trade_security_settings
		WHERE user_id = $1::uuid
		FOR UPDATE
	`, userID).Scan(&enabled, &passwordHash, &failedAttempts, &lockedUntil)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Authorization{}, err
	}

	method := "disabled"
	unlockToken := ""
	now := s.now().UTC()
	if enabled {
		unlocked, unlockErr := refreshTradeUnlock(
			ctx,
			tx,
			userID,
			sessionID,
			rawUnlockToken,
			now,
		)
		if unlockErr != nil {
			return Authorization{}, unlockErr
		}
		if unlocked {
			method = "session"
		} else {
			method = "password"
			if lockedUntil.Valid && lockedUntil.Time.After(now) {
				return Authorization{}, ErrPasswordLocked
			}
			if password == "" {
				return Authorization{}, ErrPasswordRequired
			}
			if !passwordHash.Valid {
				return Authorization{}, errors.New("tradeauth: enabled trade password has no hash")
			}
			matches, verifyErr := verifyTradePassword(password, passwordHash.String)
			if verifyErr != nil {
				return Authorization{}, fmt.Errorf("tradeauth: verify password hash: %w", verifyErr)
			}
			if !matches {
				failedAttempts++
				lockDuration := passwordLockDuration(failedAttempts)
				var nextLockedUntil any
				if lockDuration > 0 {
					nextLockedUntil = now.Add(lockDuration)
				}
				if _, err = tx.Exec(ctx, `
					UPDATE trade_security_settings
					SET failed_attempts = $2, locked_until = $3
					WHERE user_id = $1::uuid
				`, userID, failedAttempts, nextLockedUntil); err != nil {
					return Authorization{}, err
				}
				if err = tx.Commit(ctx); err != nil {
					return Authorization{}, err
				}
				if lockDuration > 0 {
					return Authorization{}, ErrPasswordLocked
				}
				return Authorization{}, ErrPasswordInvalid
			}
			if _, err = tx.Exec(ctx, `
				UPDATE trade_security_settings
				SET failed_attempts = 0, locked_until = NULL
				WHERE user_id = $1::uuid
			`, userID); err != nil {
				return Authorization{}, err
			}
			var unlockHash []byte
			unlockToken, unlockHash, err = generateAuthorizationToken()
			if err != nil {
				return Authorization{}, err
			}
			if _, err = tx.Exec(ctx, `
				INSERT INTO trade_unlock_sessions
					(user_id, session_id, token_hash, expires_at, last_used_at)
				VALUES ($1::uuid, $2::uuid, $3, $4, $5)
				ON CONFLICT (user_id, session_id) DO UPDATE
				SET token_hash = EXCLUDED.token_hash,
				    expires_at = EXCLUDED.expires_at,
				    last_used_at = EXCLUDED.last_used_at
			`, userID, sessionID, unlockHash, now.Add(tradeUnlockAbsoluteTTL), now); err != nil {
				return Authorization{}, err
			}
		}
	}

	rawToken, tokenHash, err := generateAuthorizationToken()
	if err != nil {
		return Authorization{}, err
	}
	expiresAt := now.Add(s.authorizationTTL)
	if _, err = tx.Exec(ctx, `
		INSERT INTO trade_authorizations
			(user_id, session_id, operation, payload, token_hash, expires_at, verification_method)
		VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5, $6, $7)
	`, userID, sessionID, operation, string(payload), tokenHash, expiresAt, method); err != nil {
		return Authorization{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Authorization{}, err
	}

	_, _ = s.pool.Exec(ctx, `
		DELETE FROM trade_authorizations
		WHERE expires_at < now() - interval '1 hour'
		   OR consumed_at < now() - interval '1 hour'
	`)
	_, _ = s.pool.Exec(ctx, `
		DELETE FROM trade_unlock_sessions
		WHERE expires_at < now()
		   OR last_used_at < now() - interval '2 hours'
	`)
	return Authorization{
		Token:       rawToken,
		ExpiresAtMS: expiresAt.UnixMilli(),
		UnlockToken: unlockToken,
	}, nil
}

func (s *Service) Lock(
	ctx context.Context,
	userID, sessionID string,
) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `
		DELETE FROM trade_unlock_sessions
		WHERE user_id = $1::uuid AND session_id = $2::uuid
	`, userID, sessionID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `
		DELETE FROM trade_authorizations
		WHERE user_id = $1::uuid
		  AND session_id = $2::uuid
		  AND consumed_at IS NULL
	`, userID, sessionID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) tradeUnlockValid(
	ctx context.Context,
	userID, sessionID, rawToken string,
	now time.Time,
) (bool, error) {
	hash, ok := opaqueTokenHash(rawToken)
	if !ok {
		return false, nil
	}
	idleCutoff := now.Add(-tradeUnlockIdleTTL)
	var valid bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM trade_unlock_sessions
			WHERE user_id = $1::uuid
			  AND session_id = $2::uuid
			  AND token_hash = $3
			  AND expires_at > $4
			  AND last_used_at > $5
		)
	`, userID, sessionID, hash, now, idleCutoff).Scan(&valid)
	return valid, err
}

func refreshTradeUnlock(
	ctx context.Context,
	tx pgx.Tx,
	userID, sessionID, rawToken string,
	now time.Time,
) (bool, error) {
	hash, ok := opaqueTokenHash(rawToken)
	if !ok {
		return false, nil
	}
	idleCutoff := now.Add(-tradeUnlockIdleTTL)
	var id string
	err := tx.QueryRow(ctx, `
		UPDATE trade_unlock_sessions
		SET last_used_at = $4
		WHERE user_id = $1::uuid
		  AND session_id = $2::uuid
		  AND token_hash = $3
		  AND expires_at > $4
		  AND last_used_at > $5
		RETURNING id::text
	`, userID, sessionID, hash, now, idleCutoff).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func opaqueTokenHash(raw string) ([]byte, bool) {
	if len(raw) != 43 {
		return nil, false
	}
	for _, character := range []byte(raw) {
		if (character >= 'a' && character <= 'z') ||
			(character >= 'A' && character <= 'Z') ||
			(character >= '0' && character <= '9') ||
			character == '-' || character == '_' {
			continue
		}
		return nil, false
	}
	sum := sha256.Sum256([]byte(raw))
	return sum[:], true
}

func securityStatus(
	enabled, configured bool,
	lockedUntil sql.NullTime,
	now time.Time,
) SecurityStatus {
	status := SecurityStatus{Enabled: enabled, Configured: configured}
	if lockedUntil.Valid && lockedUntil.Time.After(now) {
		value := lockedUntil.Time.UnixMilli()
		status.LockedUntilMS = &value
	}
	return status
}

func validateTradePassword(password string) error {
	if !utf8.ValidString(password) || len(password) > maxTradePasswordBytes {
		return fmt.Errorf("%w: password is too long", ErrPasswordPolicy)
	}
	length := utf8.RuneCountInString(password)
	if length < minTradePasswordRunes || length > maxTradePasswordRunes {
		return fmt.Errorf(
			"%w: password must contain between %d and %d characters",
			ErrPasswordPolicy,
			minTradePasswordRunes,
			maxTradePasswordRunes,
		)
	}
	if _, common := commonTradePasswordValues[strings.ToLower(password)]; common {
		return fmt.Errorf("%w: choose a less common password", ErrPasswordPolicy)
	}
	return nil
}

func hashTradePassword(password string) (string, error) {
	if err := validateTradePassword(password); err != nil {
		return "", err
	}
	salt := make([]byte, argonSaltBytes)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash := argon2.IDKey(
		[]byte(password),
		salt,
		argonTime,
		argonMemoryKiB,
		argonThreads,
		argonKeyBytes,
	)
	return fmt.Sprintf(
		"$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version,
		argonMemoryKiB,
		argonTime,
		argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(hash),
	), nil
}

func verifyTradePassword(password, encoded string) (bool, error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" {
		return false, errors.New("invalid Argon2id encoding")
	}
	version, err := strconv.Atoi(strings.TrimPrefix(parts[2], "v="))
	if err != nil || version != argon2.Version {
		return false, errors.New("unsupported Argon2id version")
	}
	var memory uint32
	var iterations uint32
	var threads uint8
	if _, err = fmt.Sscanf(
		parts[3],
		"m=%d,t=%d,p=%d",
		&memory,
		&iterations,
		&threads,
	); err != nil ||
		memory != argonMemoryKiB ||
		iterations != argonTime ||
		threads != argonThreads {
		return false, errors.New("unexpected Argon2id parameters")
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(salt) != argonSaltBytes {
		return false, errors.New("invalid Argon2id salt")
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(expected) != argonKeyBytes {
		return false, errors.New("invalid Argon2id hash")
	}
	actual := argon2.IDKey(
		[]byte(password),
		salt,
		iterations,
		memory,
		threads,
		uint32(len(expected)),
	)
	return subtle.ConstantTimeCompare(actual, expected) == 1, nil
}

func passwordLockDuration(failedAttempts int) time.Duration {
	if failedAttempts < 5 {
		return 0
	}
	exponent := failedAttempts - 5
	if exponent > 5 {
		exponent = 5
	}
	duration := 30 * time.Second * time.Duration(1<<exponent)
	if duration > 15*time.Minute {
		return 15 * time.Minute
	}
	return duration
}

func validateOperationPayload(operation string, payload json.RawMessage) error {
	if operation != "order" && operation != "command" {
		return fmt.Errorf("%w: invalid operation", ErrAuthorizationRejected)
	}
	if len(payload) == 0 || len(payload) > maxTransactionPayloadBytes || !json.Valid(payload) {
		return fmt.Errorf("%w: invalid payload", ErrAuthorizationRejected)
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(payload, &object); err != nil {
		return fmt.Errorf("%w: payload must be an object", ErrAuthorizationRejected)
	}
	if operation == "order" {
		if len(object) != 2 || len(object["intent"]) == 0 || len(object["targets"]) == 0 {
			return fmt.Errorf("%w: invalid order payload", ErrAuthorizationRejected)
		}
	} else if len(object) != 1 || len(object["command"]) == 0 {
		return fmt.Errorf("%w: invalid command payload", ErrAuthorizationRejected)
	}
	return nil
}

func generateAuthorizationToken() (raw string, hash []byte, err error) {
	value := make([]byte, 32)
	if _, err = rand.Read(value); err != nil {
		return "", nil, err
	}
	raw = base64.RawURLEncoding.EncodeToString(value)
	sum := sha256.Sum256([]byte(raw))
	return raw, sum[:], nil
}
