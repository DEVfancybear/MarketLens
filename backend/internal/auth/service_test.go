package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/marketlens/backend/internal/config"
)

type mappedVerifier map[string]Identity

func (v mappedVerifier) VerifyGoogleToken(_ context.Context, token string) (Identity, error) {
	identity, ok := v[token]
	if !ok {
		return Identity{}, ErrUnauthorized
	}
	return identity, nil
}

type mappedUserRepo struct {
	byProvider map[string]User
	disabled   map[string]bool
}

func (r *mappedUserRepo) UpsertFromIdentity(_ context.Context, identity Identity) (User, bool, error) {
	user, ok := r.byProvider[identity.ProviderUID]
	if !ok || r.disabled[user.ID] {
		return User{}, false, ErrUnauthorized
	}
	return user, false, nil
}

func (r *mappedUserRepo) GetUser(_ context.Context, userID string) (User, error) {
	for _, user := range r.byProvider {
		if user.ID == userID && !r.disabled[userID] {
			return user, nil
		}
	}
	return User{}, ErrUnauthorized
}

func testAuthService(t *testing.T) (*Service, *fakeSessionStore, *mappedUserRepo) {
	t.Helper()
	cfg := config.Config{
		AuthJWTSecret:  "test-secret-at-least-32-bytes-long-xx",
		AuthAccessTTL:  15 * time.Minute,
		AuthRefreshTTL: 30 * 24 * time.Hour,
	}
	store := newFakeStore()
	repo := &mappedUserRepo{
		byProvider: map[string]User{
			"google-a": {ID: "user-a", Email: "a@example.com"},
			"google-b": {ID: "user-b", Email: "b@example.com"},
		},
		disabled: map[string]bool{},
	}
	verifier := mappedVerifier{
		"token-a": {UID: "firebase-a", ProviderUID: "google-a", Email: "a@example.com", EmailVerified: true},
		"token-b": {UID: "firebase-b", ProviderUID: "google-b", Email: "b@example.com", EmailVerified: true},
	}
	tokens := NewTokenService(cfg)
	sessions := NewSessionService(store, cfg)
	return NewService(verifier, repo, sessions, tokens), store, repo
}

func TestEnsureGoogleSession_DoesNotReuseAnotherFirebaseUsersCookies(t *testing.T) {
	svc, store, _ := testAuthService(t)
	first, err := svc.LoginWithGoogle(context.Background(), "token-a", "agent", "ip")
	if err != nil {
		t.Fatalf("login A: %v", err)
	}

	switched, err := svc.EnsureGoogleSession(
		context.Background(),
		"token-b",
		first.AccessToken,
		first.RefreshToken,
		"agent",
		"ip",
	)
	if err != nil {
		t.Fatalf("switch to B: %v", err)
	}
	if switched.User.ID != "user-b" {
		t.Fatalf("session user = %q, want user-b", switched.User.ID)
	}
	claims, err := svc.tokens.ParseAccess(switched.AccessToken)
	if err != nil || claims.UserID != "user-b" {
		t.Fatalf("access claims = %+v, err=%v", claims, err)
	}
	if store.seq != 3 {
		t.Fatalf("created sessions = %d, want original + rotated/revoked + user B", store.seq)
	}
	if store.byID["sess-2"].RevokedAt == nil {
		t.Fatal("cross-user rotated session was not revoked")
	}
}

func TestRefreshRejectsDisabledBackendUser(t *testing.T) {
	svc, store, repo := testAuthService(t)
	first, err := svc.LoginWithGoogle(context.Background(), "token-a", "agent", "ip")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	repo.disabled["user-a"] = true

	if _, err := svc.Refresh(context.Background(), first.RefreshToken, "agent", "ip"); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("want ErrUnauthorized, got %v", err)
	}
	if store.seq != 2 || store.byID["sess-2"].RevokedAt == nil {
		t.Fatal("refresh descendant for disabled user must be revoked")
	}
}
