package auth

import (
	"context"
	"time"
)

// User is the public user model returned to clients. It is defined here (not in
// the users package) so the auth service can reference it without importing
// users — the users repo depends on auth, not the other way around.
type User struct {
	ID            string
	Email         string
	DisplayName   string
	PhotoURL      string
	EmailVerified bool
	CreatedAt     time.Time
}

// UserUpserter is the persistence surface the auth service needs. Implemented by
// internal/users.Repo; faked in tests.
type UserUpserter interface {
	// UpsertFromIdentity finds or creates the user for a verified identity,
	// returning the user and whether they were newly registered.
	UpsertFromIdentity(ctx context.Context, id Identity) (User, bool, error)
	// GetUser loads a user by id (for /auth/me).
	GetUser(ctx context.Context, userID string) (User, error)
}

// tokenVerifier is the ID-token verification surface (satisfied by *Verifier).
type tokenVerifier interface {
	VerifyGoogleToken(ctx context.Context, idToken string) (Identity, error)
}

// Service orchestrates the login/refresh/logout flows over the verifier, the
// user repo, and the session/token services. It holds no HTTP concerns.
type Service struct {
	verifier tokenVerifier
	users    UserUpserter
	sessions *SessionService
	tokens   *TokenService
}

func NewService(verifier tokenVerifier, users UserUpserter, sessions *SessionService, tokens *TokenService) *Service {
	return &Service{verifier: verifier, users: users, sessions: sessions, tokens: tokens}
}

// LoginResult is the outcome of a Google login/register.
type LoginResult struct {
	User         User
	IsNewUser    bool
	AccessToken  string
	RefreshToken string
}

// LoginWithGoogle verifies the Firebase ID token, upserts the user, opens a
// session, and mints an access token.
func (s *Service) LoginWithGoogle(ctx context.Context, idToken, userAgent, ip string) (LoginResult, error) {
	identity, err := s.verifier.VerifyGoogleToken(ctx, idToken)
	if err != nil {
		return LoginResult{}, err // ErrUnauthorized
	}

	user, isNew, err := s.users.UpsertFromIdentity(ctx, identity)
	if err != nil {
		return LoginResult{}, err
	}

	sess, err := s.sessions.Create(ctx, user.ID, userAgent, ip)
	if err != nil {
		return LoginResult{}, err
	}

	access, err := s.tokens.MintAccess(user.ID, sess.SessionID)
	if err != nil {
		return LoginResult{}, err
	}

	return LoginResult{
		User:         user,
		IsNewUser:    isNew,
		AccessToken:  access,
		RefreshToken: sess.RefreshToken,
	}, nil
}

// TokenPair is a freshly issued access + refresh token pair.
type TokenPair struct {
	AccessToken  string
	RefreshToken string
}

// Refresh rotates the refresh token and mints a new access token. On reuse the
// session family is revoked (ErrSessionReuse) by the session service.
func (s *Service) Refresh(ctx context.Context, rawRefresh, userAgent, ip string) (TokenPair, error) {
	sess, err := s.sessions.Rotate(ctx, rawRefresh, userAgent, ip)
	if err != nil {
		return TokenPair{}, err
	}
	access, err := s.tokens.MintAccess(sess.UserID, sess.SessionID)
	if err != nil {
		return TokenPair{}, err
	}
	return TokenPair{AccessToken: access, RefreshToken: sess.RefreshToken}, nil
}

// Logout revokes the current session.
func (s *Service) Logout(ctx context.Context, sessionID string) error {
	return s.sessions.Revoke(ctx, sessionID)
}

// RevokeAllSessions signs the user out of every device.
func (s *Service) RevokeAllSessions(ctx context.Context, userID string) error {
	return s.sessions.RevokeAll(ctx, userID)
}

// GetUser loads the current user (for /auth/me).
func (s *Service) GetUser(ctx context.Context, userID string) (User, error) {
	return s.users.GetUser(ctx, userID)
}
