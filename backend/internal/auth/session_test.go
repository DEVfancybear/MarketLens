package auth

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/smc-trading-terminal/backend/internal/config"
)

// fakeSessionStore is an in-memory SessionStore for testing the service logic.
type fakeSessionStore struct {
	byID           map[string]*Session
	byHash         map[string]string // refreshHash -> session id
	seq            int
	revokeAllCalls int
}

// staleReadStore simulates two rotations that both read the original session
// before either conditional revoke becomes visible.
type staleReadStore struct {
	*fakeSessionStore
	staleHash    string
	staleSession Session
}

func (s *staleReadStore) GetSessionByHash(ctx context.Context, hash string) (Session, error) {
	if hash == s.staleHash {
		return s.staleSession, nil
	}
	return s.fakeSessionStore.GetSessionByHash(ctx, hash)
}

func newFakeStore() *fakeSessionStore {
	return &fakeSessionStore{byID: map[string]*Session{}, byHash: map[string]string{}}
}

func (f *fakeSessionStore) CreateSession(_ context.Context, p CreateSessionParams) (Session, error) {
	f.seq++
	id := fmt.Sprintf("sess-%d", f.seq)
	s := &Session{ID: id, UserID: p.UserID, ExpiresAt: p.ExpiresAt}
	f.byID[id] = s
	f.byHash[p.RefreshHash] = id
	return *s, nil
}

func (f *fakeSessionStore) GetSessionByHash(_ context.Context, hash string) (Session, error) {
	id, ok := f.byHash[hash]
	if !ok {
		return Session{}, errSessionNotFound
	}
	return *f.byID[id], nil
}

func (f *fakeSessionStore) IsSessionActive(
	_ context.Context,
	sessionID string,
	userID string,
	checkedAt time.Time,
) (bool, error) {
	session, ok := f.byID[sessionID]
	return ok &&
		session.UserID == userID &&
		session.RevokedAt == nil &&
		session.ExpiresAt.After(checkedAt), nil
}

func (f *fakeSessionStore) RotateSession(
	ctx context.Context,
	oldRefreshHash string,
	replacement CreateSessionParams,
	_ time.Time,
) (Session, error) {
	id, ok := f.byHash[oldRefreshHash]
	if !ok {
		return Session{}, errSessionNotFound
	}
	old := f.byID[id]
	if old.RevokedAt != nil {
		return Session{}, ErrSessionReuse
	}
	now := time.Now()
	old.RevokedAt = &now
	return f.CreateSession(ctx, replacement)
}

func (f *fakeSessionStore) RevokeSession(_ context.Context, id string) (bool, error) {
	if s, ok := f.byID[id]; ok && s.RevokedAt == nil {
		now := time.Now()
		s.RevokedAt = &now
		return true, nil
	}
	return false, nil
}

func (f *fakeSessionStore) RevokeAllUserSessions(_ context.Context, userID string) error {
	f.revokeAllCalls++
	for _, s := range f.byID {
		if s.UserID == userID && s.RevokedAt == nil {
			now := time.Now()
			s.RevokedAt = &now
		}
	}
	return nil
}

func newTestSessionService(store SessionStore, ttl time.Duration) *SessionService {
	return NewSessionService(store, config.Config{AuthRefreshTTL: ttl})
}

func TestSessionCreate(t *testing.T) {
	store := newFakeStore()
	svc := newTestSessionService(store, 720*time.Hour)

	cs, err := svc.Create(context.Background(), "user-1", "agent", "1.2.3.4")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if cs.RefreshToken == "" || cs.SessionID == "" {
		t.Fatalf("expected token + session id, got %+v", cs)
	}
	// The raw token must not be stored; only its hash keys the row.
	if _, ok := store.byHash[cs.RefreshToken]; ok {
		t.Fatal("raw refresh token must not be stored directly")
	}
	if _, ok := store.byHash[hashToken(cs.RefreshToken)]; !ok {
		t.Fatal("session should be stored under the token hash")
	}
}

func TestSessionIsActiveRejectsRevokedExpiredAndWrongOwner(t *testing.T) {
	store := newFakeStore()
	svc := newTestSessionService(store, time.Hour)
	svc.now = func() time.Time { return time.Unix(10_000, 0) }

	created, err := svc.Create(context.Background(), "user-1", "agent", "ip")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	active, err := svc.IsActive(context.Background(), created.SessionID, "user-1")
	if err != nil || !active {
		t.Fatalf("fresh session active=%v err=%v", active, err)
	}
	if active, _ := svc.IsActive(context.Background(), created.SessionID, "user-2"); active {
		t.Fatal("session must be bound to its exact owner")
	}

	store.byID[created.SessionID].ExpiresAt = svc.now().Add(-time.Second)
	if active, _ := svc.IsActive(context.Background(), created.SessionID, "user-1"); active {
		t.Fatal("expired session must be inactive")
	}

	store.byID[created.SessionID].ExpiresAt = svc.now().Add(time.Hour)
	revokedAt := svc.now()
	store.byID[created.SessionID].RevokedAt = &revokedAt
	if active, _ := svc.IsActive(context.Background(), created.SessionID, "user-1"); active {
		t.Fatal("revoked session must be inactive")
	}
}

func TestSessionRotate_HappyPath(t *testing.T) {
	store := newFakeStore()
	svc := newTestSessionService(store, 720*time.Hour)

	cs, _ := svc.Create(context.Background(), "user-1", "agent", "ip")
	rotated, err := svc.Rotate(context.Background(), cs.RefreshToken, "agent", "ip")
	if err != nil {
		t.Fatalf("rotate: %v", err)
	}
	if rotated.RefreshToken == cs.RefreshToken {
		t.Fatal("rotated token must differ from the old one")
	}
	if rotated.SessionID == cs.SessionID {
		t.Fatal("rotated session id must differ from the old one")
	}
	// Old session must now be revoked.
	old, _ := store.GetSessionByHash(context.Background(), hashToken(cs.RefreshToken))
	if old.RevokedAt == nil {
		t.Fatal("old session should be revoked after rotation")
	}
}

func TestSessionRotate_ReuseRevokesFamily(t *testing.T) {
	store := newFakeStore()
	svc := newTestSessionService(store, 720*time.Hour)

	cs, _ := svc.Create(context.Background(), "user-1", "agent", "ip")
	// First rotation succeeds and revokes the original token.
	rotated, _ := svc.Rotate(context.Background(), cs.RefreshToken, "agent", "ip")

	// Replaying the original (now revoked) token = reuse.
	_, err := svc.Rotate(context.Background(), cs.RefreshToken, "agent", "ip")
	if !errors.Is(err, ErrSessionReuse) {
		t.Fatalf("want ErrSessionReuse, got %v", err)
	}
	if store.revokeAllCalls != 1 {
		t.Fatalf("want family revoked once, got %d calls", store.revokeAllCalls)
	}
	// The good rotated session must also be revoked (whole family down).
	live, _ := store.GetSessionByHash(context.Background(), hashToken(rotated.RefreshToken))
	if live.RevokedAt == nil {
		t.Fatal("family revocation should revoke the active session too")
	}
}

func TestSessionRotate_ConcurrentStaleReadCannotMintSecondDescendant(t *testing.T) {
	base := newFakeStore()
	svc := newTestSessionService(base, 720*time.Hour)
	created, err := svc.Create(context.Background(), "user-1", "agent", "ip")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	original, err := base.GetSessionByHash(context.Background(), hashToken(created.RefreshToken))
	if err != nil {
		t.Fatalf("get original: %v", err)
	}
	stale := &staleReadStore{
		fakeSessionStore: base,
		staleHash:        hashToken(created.RefreshToken),
		staleSession:     original,
	}
	svc.store = stale

	first, err := svc.Rotate(context.Background(), created.RefreshToken, "agent", "ip")
	if err != nil {
		t.Fatalf("first rotate: %v", err)
	}
	if _, err := svc.Rotate(context.Background(), created.RefreshToken, "agent", "ip"); !errors.Is(err, ErrSessionReuse) {
		t.Fatalf("want ErrSessionReuse for concurrent loser, got %v", err)
	}
	if base.seq != 2 {
		t.Fatalf("session count = %d, want one descendant only", base.seq)
	}
	descendant, err := base.GetSessionByHash(context.Background(), hashToken(first.RefreshToken))
	if err != nil || descendant.RevokedAt == nil {
		t.Fatalf("concurrent replay should revoke the active descendant: %+v err=%v", descendant, err)
	}
}

func TestSessionRotate_UnknownToken(t *testing.T) {
	svc := newTestSessionService(newFakeStore(), 720*time.Hour)
	if _, err := svc.Rotate(context.Background(), "does-not-exist", "a", "b"); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("want ErrUnauthorized, got %v", err)
	}
}

func TestSessionRotate_Expired(t *testing.T) {
	store := newFakeStore()
	// Negative TTL → the created session is already expired.
	svc := newTestSessionService(store, -time.Minute)

	cs, _ := svc.Create(context.Background(), "user-1", "agent", "ip")
	_, err := svc.Rotate(context.Background(), cs.RefreshToken, "agent", "ip")
	if !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("want ErrUnauthorized for expired token, got %v", err)
	}
}
