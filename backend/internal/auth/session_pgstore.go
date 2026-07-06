package auth

import (
	"context"
	"net/netip"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/smc-trading-terminal/backend/internal/db/gen"
)

// PgSessionStore adapts the sqlc-generated queries to the domain SessionStore
// interface, converting between pgx types and plain Go types. This is the
// production store; unit tests use a fake instead.
type PgSessionStore struct {
	q *gen.Queries
}

func NewPgSessionStore(q *gen.Queries) *PgSessionStore {
	return &PgSessionStore{q: q}
}

// Compile-time assertion that the adapter satisfies the interface.
var _ SessionStore = (*PgSessionStore)(nil)

func (p *PgSessionStore) CreateSession(ctx context.Context, params CreateSessionParams) (Session, error) {
	uid, err := toPgUUID(params.UserID)
	if err != nil {
		return Session{}, err
	}
	row, err := p.q.CreateSession(ctx, gen.CreateSessionParams{
		UserID:           uid,
		RefreshTokenHash: params.RefreshHash,
		UserAgent:        nullString(params.UserAgent),
		Ip:               parseIP(params.IP),
		ExpiresAt:        pgTimestamptz(params.ExpiresAt),
	})
	if err != nil {
		return Session{}, err
	}
	return toDomainSession(row), nil
}

func (p *PgSessionStore) GetSessionByHash(ctx context.Context, refreshHash string) (Session, error) {
	row, err := p.q.GetSessionByHash(ctx, refreshHash)
	if err != nil {
		return Session{}, err
	}
	return toDomainSession(row), nil
}

func (p *PgSessionStore) RevokeSession(ctx context.Context, sessionID string) error {
	uid, err := toPgUUID(sessionID)
	if err != nil {
		return err
	}
	return p.q.RevokeSession(ctx, uid)
}

func (p *PgSessionStore) RevokeAllUserSessions(ctx context.Context, userID string) error {
	uid, err := toPgUUID(userID)
	if err != nil {
		return err
	}
	return p.q.RevokeAllUserSessions(ctx, uid)
}

func toDomainSession(s gen.Session) Session {
	var revoked *time.Time
	if s.RevokedAt.Valid {
		t := s.RevokedAt.Time
		revoked = &t
	}
	return Session{
		ID:        fromPgUUID(s.ID),
		UserID:    fromPgUUID(s.UserID),
		ExpiresAt: fromPgTimestamptz(s.ExpiresAt),
		RevokedAt: revoked,
	}
}

func toPgUUID(s string) (pgtype.UUID, error) {
	var u pgtype.UUID
	if err := u.Scan(s); err != nil {
		return pgtype.UUID{}, err
	}
	return u, nil
}

func fromPgUUID(u pgtype.UUID) string {
	v, err := u.Value()
	if err != nil || v == nil {
		return ""
	}
	s, _ := v.(string)
	return s
}

func pgTimestamptz(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}

func fromPgTimestamptz(t pgtype.Timestamptz) time.Time {
	if !t.Valid {
		return time.Time{}
	}
	return t.Time
}

func nullString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func parseIP(s string) *netip.Addr {
	if s == "" {
		return nil
	}
	addr, err := netip.ParseAddr(s)
	if err != nil {
		return nil
	}
	return &addr
}
