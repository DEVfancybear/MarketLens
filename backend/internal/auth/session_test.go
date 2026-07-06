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
		return Session{}, errors.New("not found")
	}
	return *f.byID[id], nil
}

func (f *fakeSessionStore) RevokeSession(_ context.Context, id string) error {
	if s, ok := f.byID[id]; ok && s.RevokedAt == nil {
		now := time.Now()
		s.RevokedAt = &now
	}
	return nil
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
