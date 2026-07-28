package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/smc-trading-terminal/backend/internal/config"
)

// ErrSessionReuse is returned when an already-revoked refresh token is
// presented — treated as theft: the whole session family is revoked. The HTTP
// layer maps it to 401.
var ErrSessionReuse = errors.New("refresh token reuse detected")

var errSessionNotFound = errors.New("refresh session not found")

// Session is the domain view of a refresh-token session row.
type Session struct {
	ID        string
	UserID    string
	ExpiresAt time.Time
	RevokedAt *time.Time // nil = active
}

// CreateSessionParams is the store-facing input for a new session row. The
// refresh token itself is never stored — only its SHA-256 hash.
type CreateSessionParams struct {
	UserID      string
	RefreshHash string
	UserAgent   string
	IP          string
	ExpiresAt   time.Time
}

// SessionStore is the persistence surface the SessionService needs. It is
// deliberately free of pgx types so the service is unit-testable with a fake.
type SessionStore interface {
	CreateSession(ctx context.Context, p CreateSessionParams) (Session, error)
	GetSessionByHash(ctx context.Context, refreshHash string) (Session, error)
	IsSessionActive(ctx context.Context, sessionID, userID string, checkedAt time.Time) (bool, error)
	RotateSession(
		ctx context.Context,
		oldRefreshHash string,
		replacement CreateSessionParams,
		rotatedAt time.Time,
	) (Session, error)
	// RevokeSession returns whether this call changed an active session. A false
	// result lets rotation detect a concurrent replay instead of minting two
	// descendants from one single-use refresh token.
	RevokeSession(ctx context.Context, sessionID string) (bool, error)
	RevokeAllUserSessions(ctx context.Context, userID string) error
}

// CreatedSession is returned when a session is created or rotated. RefreshToken
// is the raw opaque token — returned exactly once, never persisted. UserID lets
// the caller mint an access token after a rotation without a second lookup.
type CreatedSession struct {
	SessionID    string
	UserID       string
	RefreshToken string
	ExpiresAt    time.Time
}

// SessionService manages refresh-token sessions: creation, rotation with reuse
// detection, and revocation. It holds no HTTP concerns.
type SessionService struct {
	store      SessionStore
	refreshTTL time.Duration
	now        func() time.Time
}

func NewSessionService(store SessionStore, cfg config.Config) *SessionService {
	return &SessionService{
		store:      store,
		refreshTTL: cfg.AuthRefreshTTL,
		now:        time.Now,
	}
}

// Create issues a brand-new session for a freshly authenticated user.
func (s *SessionService) Create(ctx context.Context, userID, userAgent, ip string) (CreatedSession, error) {
	return s.mint(ctx, userID, userAgent, ip)
}

// Rotate exchanges a valid refresh token for a new one (single-use tokens).
//   - unknown/expired token → ErrUnauthorized
//   - already-revoked token presented (reuse) → revoke the whole family, ErrSessionReuse
//   - otherwise → revoke the old session, issue a new one
func (s *SessionService) Rotate(ctx context.Context, rawRefresh, userAgent, ip string) (CreatedSession, error) {
	sess, err := s.store.GetSessionByHash(ctx, hashToken(rawRefresh))
	if err != nil {
		if errors.Is(err, errSessionNotFound) {
			return CreatedSession{}, fmt.Errorf("%w: unknown refresh token", ErrUnauthorized)
		}
		return CreatedSession{}, err
	}

	if sess.RevokedAt != nil {
		// A revoked token being replayed means it was stolen or double-used.
		// Revoke every active session for the user (session family).
		_ = s.store.RevokeAllUserSessions(ctx, sess.UserID)
		return CreatedSession{}, ErrSessionReuse
	}

	rotatedAt := s.now()
	if !sess.ExpiresAt.IsZero() && rotatedAt.After(sess.ExpiresAt) {
		_, _ = s.store.RevokeSession(ctx, sess.ID)
		return CreatedSession{}, fmt.Errorf("%w: refresh token expired", ErrUnauthorized)
	}

	raw, err := generateRefreshToken()
	if err != nil {
		return CreatedSession{}, err
	}
	expiresAt := rotatedAt.Add(s.refreshTTL)
	replacement, err := s.store.RotateSession(ctx, hashToken(rawRefresh), CreateSessionParams{
		UserID:      sess.UserID,
		RefreshHash: hashToken(raw),
		UserAgent:   userAgent,
		IP:          ip,
		ExpiresAt:   expiresAt,
	}, rotatedAt)
	if errors.Is(err, ErrSessionReuse) {
		_ = s.store.RevokeAllUserSessions(ctx, sess.UserID)
		return CreatedSession{}, ErrSessionReuse
	}
	if err != nil {
		return CreatedSession{}, err
	}
	return CreatedSession{
		SessionID:    replacement.ID,
		UserID:       replacement.UserID,
		RefreshToken: raw,
		ExpiresAt:    replacement.ExpiresAt,
	}, nil
}

// Revoke revokes a single session (logout on this device).
func (s *SessionService) Revoke(ctx context.Context, sessionID string) error {
	_, err := s.store.RevokeSession(ctx, sessionID)
	return err
}

// RevokeAll revokes every active session for a user (sign out everywhere).
func (s *SessionService) RevokeAll(ctx context.Context, userID string) error {
	return s.store.RevokeAllUserSessions(ctx, userID)
}

// IsActive confirms that the signed access-token subject is still backed by
// the same live server-side session. Sensitive operations use this check so a
// logout, refresh rotation, or administrator revocation takes effect
// immediately instead of waiting for the access JWT to expire.
func (s *SessionService) IsActive(ctx context.Context, sessionID, userID string) (bool, error) {
	if sessionID == "" || userID == "" {
		return false, nil
	}
	return s.store.IsSessionActive(ctx, sessionID, userID, s.now())
}

func (s *SessionService) mint(ctx context.Context, userID, userAgent, ip string) (CreatedSession, error) {
	raw, err := generateRefreshToken()
	if err != nil {
		return CreatedSession{}, err
	}
	expiresAt := s.now().Add(s.refreshTTL)

	sess, err := s.store.CreateSession(ctx, CreateSessionParams{
		UserID:      userID,
		RefreshHash: hashToken(raw),
		UserAgent:   userAgent,
		IP:          ip,
		ExpiresAt:   expiresAt,
	})
	if err != nil {
		return CreatedSession{}, err
	}

	return CreatedSession{
		SessionID:    sess.ID,
		UserID:       sess.UserID,
		RefreshToken: raw,
		ExpiresAt:    sess.ExpiresAt,
	}, nil
}

// generateRefreshToken returns a 256-bit crypto-random URL-safe token.
func generateRefreshToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("auth: generate refresh token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// hashToken returns the hex SHA-256 of a raw token; only this is stored.
func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
