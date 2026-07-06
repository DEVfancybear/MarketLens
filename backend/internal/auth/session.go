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
	RevokeSession(ctx context.Context, sessionID string) error
	RevokeAllUserSessions(ctx context.Context, userID string) error
}

// CreatedSession is returned when a session is created or rotated. RefreshToken
// is the raw opaque token — returned exactly once, never persisted.
type CreatedSession struct {
	SessionID    string
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
		return CreatedSession{}, fmt.Errorf("%w: unknown refresh token", ErrUnauthorized)
	}

	if sess.RevokedAt != nil {
		// A revoked token being replayed means it was stolen or double-used.
		// Revoke every active session for the user (session family).
		_ = s.store.RevokeAllUserSessions(ctx, sess.UserID)
		return CreatedSession{}, ErrSessionReuse
	}

	if !sess.ExpiresAt.IsZero() && s.now().After(sess.ExpiresAt) {
		_ = s.store.RevokeSession(ctx, sess.ID)
		return CreatedSession{}, fmt.Errorf("%w: refresh token expired", ErrUnauthorized)
	}

	if err := s.store.RevokeSession(ctx, sess.ID); err != nil {
		return CreatedSession{}, err
	}
	return s.mint(ctx, sess.UserID, userAgent, ip)
}

// Revoke revokes a single session (logout on this device).
func (s *SessionService) Revoke(ctx context.Context, sessionID string) error {
	return s.store.RevokeSession(ctx, sessionID)
}

// RevokeAll revokes every active session for a user (sign out everywhere).
func (s *SessionService) RevokeAll(ctx context.Context, userID string) error {
	return s.store.RevokeAllUserSessions(ctx, userID)
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
