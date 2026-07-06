package auth

import (
	"context"
	"errors"
	"fmt"
)

// ErrUnauthorized is returned for any ID token that fails verification —
// expired, malformed, wrong audience, revoked, or empty. The HTTP layer maps it
// to 401 with a generic message; the wrapped detail is for server logs only.
var ErrUnauthorized = errors.New("unauthorized")

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
	if idToken == "" {
		return Identity{}, fmt.Errorf("%w: empty token", ErrUnauthorized)
	}

	tok, err := v.client.VerifyIDToken(ctx, idToken)
	if err != nil {
		return Identity{}, fmt.Errorf("%w: %v", ErrUnauthorized, err)
	}

	id := Identity{
		UID:         tok.UID,
		ProviderUID: firstIdentity(tok.Firebase.Identities, "google.com"),
	}
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

	// ProviderUID must never be empty (it keys auth_identities). Fall back to the
	// Firebase uid when the google identities block is absent.
	if id.ProviderUID == "" {
		id.ProviderUID = tok.UID
	}

	return id, nil
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
