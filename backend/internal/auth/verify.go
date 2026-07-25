package auth

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"

	"google.golang.org/api/googleapi"
)

const (
	MaxIDTokenLength          = 16_384
	firebaseVerificationLimit = 8 * time.Second
)

// ErrUnauthorized is returned for any ID token that fails verification —
// expired, malformed, wrong audience/provider, unverified, or empty. The HTTP layer maps it
// to 401 with a generic message; the wrapped detail is for server logs only.
var ErrUnauthorized = errors.New("unauthorized")

// ErrIdentityProviderUnavailable distinguishes a transient Firebase Admin RPC
// failure from a bad/revoked identity so callers can return a retryable 503
// without weakening verification.
var ErrIdentityProviderUnavailable = errors.New("identity provider unavailable")

// Identity is the verified subset of a Firebase/Google ID token's claims. It is
// only ever returned fully populated — a verification failure yields the zero
// value plus an error, never a partial identity.
type Identity struct {
	UID           string // Firebase Auth uid (auth_identities.firebase_uid)
	ProviderUID   string // Google 'sub' / stable provider id (auth_identities.provider_uid)
	Email         string
	EmailVerified bool
	Name          string
	PhotoURL      string
}

// VerifyGoogleToken verifies a Firebase ID token and maps its claims to an
// Identity. Any failure returns ErrUnauthorized (wrapping the underlying cause).
func (v *Verifier) VerifyGoogleToken(ctx context.Context, idToken string) (Identity, error) {
	idToken = strings.TrimSpace(idToken)
	if idToken == "" || len(idToken) > MaxIDTokenLength {
		return Identity{}, fmt.Errorf("%w: empty token", ErrUnauthorized)
	}

	verifyCtx, cancel := context.WithTimeout(ctx, firebaseVerificationLimit)
	defer cancel()
	tok, err := v.client.VerifyIDTokenAndCheckRevoked(verifyCtx, idToken)
	if err != nil {
		if identityProviderUnavailable(err) {
			return Identity{}, fmt.Errorf("%w: %v", ErrIdentityProviderUnavailable, err)
		}
		return Identity{}, fmt.Errorf("%w: %v", ErrUnauthorized, err)
	}

	if tok.UID == "" || tok.Firebase.SignInProvider != "google.com" {
		return Identity{}, fmt.Errorf("%w: token is not a Google sign-in", ErrUnauthorized)
	}

	id := Identity{UID: tok.UID, ProviderUID: firstIdentity(tok.Firebase.Identities, "google.com")}
	if s, ok := tok.Claims["email"].(string); ok {
		id.Email = s
	}
	if b, ok := tok.Claims["email_verified"].(bool); ok {
		id.EmailVerified = b
	}
	if s, ok := tok.Claims["name"].(string); ok {
		id.Name = s
	}
	if s, ok := tok.Claims["picture"].(string); ok {
		id.PhotoURL = s
	}

	if id.ProviderUID == "" || id.Email == "" || !id.EmailVerified {
		return Identity{}, fmt.Errorf("%w: incomplete or unverified Google identity", ErrUnauthorized)
	}

	return id, nil
}

func identityProviderUnavailable(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return true
	}
	var networkError net.Error
	if errors.As(err, &networkError) {
		return true
	}
	var apiError *googleapi.Error
	return errors.As(err, &apiError) && (apiError.Code == 429 || apiError.Code >= 500)
}

// firstIdentity extracts the first provider subject id from a token's
// firebase.identities block: identities[provider] is a []interface{} of subs.
func firstIdentity(identities map[string]interface{}, provider string) string {
	raw, ok := identities[provider]
	if !ok {
		return ""
	}
	list, ok := raw.([]interface{})
	if !ok || len(list) == 0 {
		return ""
	}
	s, _ := list[0].(string)
	return s
}
