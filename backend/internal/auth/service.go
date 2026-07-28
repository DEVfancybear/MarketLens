package auth

import (
	"context"
	"errors"
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

// resolveGoogleUser verifies the Firebase ID token and resolves its canonical
// backend user without opening a new backend session.
func (s *Service) resolveGoogleUser(ctx context.Context, idToken string) (User, bool, error) {
	identity, err := s.verifier.VerifyGoogleToken(ctx, idToken)
	if err != nil {
		return User{}, false, err // ErrUnauthorized
	}

	user, isNew, err := s.users.UpsertFromIdentity(ctx, identity)
	if err != nil {
		return User{}, false, err
	}
	return user, isNew, nil
}

// openSession creates a backend session for an already-verified user.
func (s *Service) openSession(
	ctx context.Context,
	user User,
	isNew bool,
	userAgent, ip string,
) (LoginResult, error) {
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

// LoginWithGoogle verifies the Firebase ID token, upserts the user, opens a
// session, and mints an access token.
func (s *Service) LoginWithGoogle(ctx context.Context, idToken, userAgent, ip string) (LoginResult, error) {
	user, isNew, err := s.resolveGoogleUser(ctx, idToken)
	if err != nil {
		return LoginResult{}, err
	}
	return s.openSession(ctx, user, isNew, userAgent, ip)
}

// EnsureGoogleSession establishes a backend session for the supplied Firebase
// identity without the client's former me -> refresh -> login probe sequence.
// A valid access cookie is reused only when it belongs to the same Firebase
// user. Otherwise a matching refresh cookie is rotated, with a new session
// created only as the final fallback.
func (s *Service) EnsureGoogleSession(
	ctx context.Context,
	idToken, rawAccess, rawRefresh, userAgent, ip string,
) (LoginResult, error) {
	user, isNew, err := s.resolveGoogleUser(ctx, idToken)
	if err != nil {
		return LoginResult{}, err
	}

	if rawAccess != "" {
		claims, parseErr := s.tokens.ParseAccess(rawAccess)
		if parseErr == nil && claims.UserID == user.ID {
			return LoginResult{User: user, IsNewUser: isNew}, nil
		}
	}

	if rawRefresh != "" {
		rotated, rotateErr := s.sessions.Rotate(ctx, rawRefresh, userAgent, ip)
		switch {
		case rotateErr == nil && rotated.UserID == user.ID:
			access, mintErr := s.tokens.MintAccess(rotated.UserID, rotated.SessionID)
			if mintErr != nil {
				return LoginResult{}, mintErr
			}
			return LoginResult{
				User:         user,
				IsNewUser:    isNew,
				AccessToken:  access,
				RefreshToken: rotated.RefreshToken,
			}, nil
		case rotateErr == nil:
			// The browser changed Firebase accounts while retaining another
			// user's refresh cookie. Revoke the just-rotated session before
			// opening the correct user's session.
			if revokeErr := s.sessions.Revoke(ctx, rotated.SessionID); revokeErr != nil {
				return LoginResult{}, revokeErr
			}
		case !errors.Is(rotateErr, ErrUnauthorized) && !errors.Is(rotateErr, ErrSessionReuse):
			return LoginResult{}, rotateErr
		}
	}

	return s.openSession(ctx, user, isNew, userAgent, ip)
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
	if _, err := s.users.GetUser(ctx, sess.UserID); err != nil {
		// Rotation already created a descendant session. Revoke it when the
		// account is disabled/deleted or the user lookup fails so it cannot be
		// retried into a usable access token later.
		_ = s.sessions.Revoke(ctx, sess.SessionID)
		if errors.Is(err, ErrUnauthorized) {
			return TokenPair{}, err
		}
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

// VerifyUserIdentity requires a live Firebase proof for the exact backend user.
// Trade-security changes use this second bearer proof so a copied backend
// cookie alone cannot change the user's execution protection.
func (s *Service) VerifyUserIdentity(ctx context.Context, idToken, userID string) (User, error) {
	user, _, err := s.resolveGoogleUser(ctx, idToken)
	if err != nil {
		return User{}, err
	}
	if user.ID != userID {
		return User{}, ErrUnauthorized
	}
	return user, nil
}
