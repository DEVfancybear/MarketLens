package tradeauth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	recoveryCodeDigits      = 6
	recoveryCodeTTL         = 10 * time.Minute
	recoverySendCooldown    = time.Minute
	recoveryMaxFailedChecks = 5
)

type RecoveryEmailSender interface {
	SendTradePasswordRecoveryCode(
		ctx context.Context,
		email, code string,
		expiresAt time.Time,
	) error
}

type RecoveryChallenge struct {
	MaskedEmail string `json:"maskedEmail"`
	ExpiresAtMS int64  `json:"expiresAtMs"`
}

func (s *Service) RequestPasswordRecovery(
	ctx context.Context,
	userID, idToken string,
) (RecoveryChallenge, error) {
	if s.recoveryEmail == nil || len(s.recoveryHashKey) < 32 {
		return RecoveryChallenge{}, ErrRecoveryUnavailable
	}
	user, err := s.identity.VerifyUserIdentity(ctx, idToken, userID)
	if err != nil {
		return RecoveryChallenge{}, err
	}
	email := strings.TrimSpace(user.Email)
	if !user.EmailVerified || email == "" {
		return RecoveryChallenge{}, ErrRecoveryEmailUnverified
	}

	var configured bool
	if err = s.pool.QueryRow(ctx, `
		SELECT password_hash IS NOT NULL
		FROM trade_security_settings
		WHERE user_id = $1::uuid
	`, userID).Scan(&configured); errors.Is(err, pgx.ErrNoRows) || !configured {
		return RecoveryChallenge{}, ErrPasswordNotConfigured
	} else if err != nil {
		return RecoveryChallenge{}, err
	}

	code, err := generateRecoveryCode()
	if err != nil {
		return RecoveryChallenge{}, err
	}
	codeHash := recoveryCodeHash(s.recoveryHashKey, userID, code)
	now := s.now().UTC()
	expiresAt := now.Add(recoveryCodeTTL)
	var stored bool
	err = s.pool.QueryRow(ctx, `
		INSERT INTO trade_password_recovery_codes
			(user_id, code_hash, failed_attempts, sent_at, expires_at)
		VALUES ($1::uuid, $2, 0, $3, $4)
		ON CONFLICT (user_id) DO UPDATE
		SET code_hash = EXCLUDED.code_hash,
		    failed_attempts = 0,
		    sent_at = EXCLUDED.sent_at,
		    expires_at = EXCLUDED.expires_at
		WHERE trade_password_recovery_codes.sent_at <= $5
		RETURNING TRUE
	`, userID, codeHash, now, expiresAt, now.Add(-recoverySendCooldown)).Scan(&stored)
	if errors.Is(err, pgx.ErrNoRows) {
		return RecoveryChallenge{}, ErrRecoveryCooldown
	}
	if err != nil || !stored {
		return RecoveryChallenge{}, err
	}

	if err = s.recoveryEmail.SendTradePasswordRecoveryCode(
		ctx,
		email,
		code,
		expiresAt,
	); err != nil {
		// Delete only this challenge. A concurrent, newer request must remain valid.
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = s.pool.Exec(cleanupCtx, `
			DELETE FROM trade_password_recovery_codes
			WHERE user_id = $1::uuid AND code_hash = $2
		`, userID, codeHash)
		return RecoveryChallenge{}, fmt.Errorf("%w: %v", ErrRecoveryUnavailable, err)
	}

	return RecoveryChallenge{
		MaskedEmail: maskEmail(email),
		ExpiresAtMS: expiresAt.UnixMilli(),
	}, nil
}

func (s *Service) ConfirmPasswordRecovery(
	ctx context.Context,
	userID, idToken, code, newPassword string,
) (SecurityStatus, error) {
	if s.recoveryEmail == nil || len(s.recoveryHashKey) < 32 {
		return SecurityStatus{}, ErrRecoveryUnavailable
	}
	if !validRecoveryCode(code) {
		return SecurityStatus{}, ErrRecoveryCodeInvalid
	}
	if err := validateTradePassword(newPassword); err != nil {
		return SecurityStatus{}, err
	}
	user, err := s.identity.VerifyUserIdentity(ctx, idToken, userID)
	if err != nil {
		return SecurityStatus{}, err
	}
	if !user.EmailVerified || strings.TrimSpace(user.Email) == "" {
		return SecurityStatus{}, ErrRecoveryEmailUnverified
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return SecurityStatus{}, err
	}
	defer tx.Rollback(ctx)

	var storedHash []byte
	var failedAttempts int
	var expiresAt time.Time
	err = tx.QueryRow(ctx, `
		SELECT code_hash, failed_attempts, expires_at
		FROM trade_password_recovery_codes
		WHERE user_id = $1::uuid
		FOR UPDATE
	`, userID).Scan(&storedHash, &failedAttempts, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return SecurityStatus{}, ErrRecoveryCodeInvalid
	}
	if err != nil {
		return SecurityStatus{}, err
	}
	now := s.now().UTC()
	if !expiresAt.After(now) {
		if _, err = tx.Exec(ctx, `
			DELETE FROM trade_password_recovery_codes WHERE user_id = $1::uuid
		`, userID); err != nil {
			return SecurityStatus{}, err
		}
		if err = tx.Commit(ctx); err != nil {
			return SecurityStatus{}, err
		}
		return SecurityStatus{}, ErrRecoveryCodeExpired
	}

	actualHash := recoveryCodeHash(s.recoveryHashKey, userID, code)
	if subtle.ConstantTimeCompare(storedHash, actualHash) != 1 {
		failedAttempts++
		if failedAttempts >= recoveryMaxFailedChecks {
			if _, err = tx.Exec(ctx, `
				DELETE FROM trade_password_recovery_codes WHERE user_id = $1::uuid
			`, userID); err != nil {
				return SecurityStatus{}, err
			}
		} else if _, err = tx.Exec(ctx, `
			UPDATE trade_password_recovery_codes
			SET failed_attempts = $2
			WHERE user_id = $1::uuid
		`, userID, failedAttempts); err != nil {
			return SecurityStatus{}, err
		}
		if err = tx.Commit(ctx); err != nil {
			return SecurityStatus{}, err
		}
		if failedAttempts >= recoveryMaxFailedChecks {
			return SecurityStatus{}, ErrRecoveryAttemptsExceeded
		}
		return SecurityStatus{}, ErrRecoveryCodeInvalid
	}

	newHash, err := hashTradePassword(newPassword)
	if err != nil {
		return SecurityStatus{}, err
	}
	var enabled bool
	err = tx.QueryRow(ctx, `
		UPDATE trade_security_settings
		SET password_hash = $2, failed_attempts = 0, locked_until = NULL
		WHERE user_id = $1::uuid AND password_hash IS NOT NULL
		RETURNING enabled
	`, userID, newHash).Scan(&enabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return SecurityStatus{}, ErrPasswordNotConfigured
	}
	if err != nil {
		return SecurityStatus{}, err
	}
	if _, err = tx.Exec(ctx, `
		DELETE FROM trade_password_recovery_codes WHERE user_id = $1::uuid
	`, userID); err != nil {
		return SecurityStatus{}, err
	}
	if _, err = tx.Exec(ctx, `
		DELETE FROM trade_unlock_sessions WHERE user_id = $1::uuid
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
	return SecurityStatus{Enabled: enabled, Configured: true}, nil
}

func generateRecoveryCode() (string, error) {
	upperBound := big.NewInt(1_000_000)
	number, err := rand.Int(rand.Reader, upperBound)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%0*d", recoveryCodeDigits, number.Int64()), nil
}

func validRecoveryCode(code string) bool {
	if len(code) != recoveryCodeDigits {
		return false
	}
	for _, character := range code {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

func recoveryCodeHash(key []byte, userID, code string) []byte {
	hash := hmac.New(sha256.New, key)
	_, _ = hash.Write([]byte("marketlens:trade-password-recovery:v1\x00"))
	_, _ = hash.Write([]byte(userID))
	_, _ = hash.Write([]byte{0})
	_, _ = hash.Write([]byte(code))
	return hash.Sum(nil)
}

func maskEmail(email string) string {
	at := strings.LastIndexByte(email, '@')
	if at <= 0 || at == len(email)-1 {
		return "***"
	}
	local := []rune(email[:at])
	visible := "*"
	if len(local) > 0 {
		visible = string(local[0]) + strings.Repeat("*", min(3, max(1, len(local)-1)))
	}
	return visible + email[at:]
}
