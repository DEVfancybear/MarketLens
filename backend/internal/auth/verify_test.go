package auth

import (
	"context"
	"errors"
	"testing"

	fbauth "firebase.google.com/go/v4/auth"
)

// fakeVerifier lets us exercise the claim-mapping / error handling without real
// Firebase credentials or network access.
type fakeVerifier struct {
	tok *fbauth.Token
	err error
}

func (f fakeVerifier) VerifyIDTokenAndCheckRevoked(_ context.Context, _ string) (*fbauth.Token, error) {
	return f.tok, f.err
}

func TestVerifyGoogleToken_EmptyToken(t *testing.T) {
	v := &Verifier{client: fakeVerifier{}}

	id, err := v.VerifyGoogleToken(context.Background(), "")
	if !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("want ErrUnauthorized, got %v", err)
	}
	if id != (Identity{}) {
		t.Fatalf("want zero Identity on failure, got %+v", id)
	}
}

func TestVerifyGoogleToken_VerificationError(t *testing.T) {
	// A malformed/expired token surfaces from the client as an error; we must
	// never leak a partial identity.
	v := &Verifier{client: fakeVerifier{err: errors.New("token is expired")}}

	id, err := v.VerifyGoogleToken(context.Background(), "malformed.jwt.here")
	if !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("want ErrUnauthorized, got %v", err)
	}
	if id != (Identity{}) {
		t.Fatalf("want zero Identity on failure, got %+v", id)
	}
}

func TestVerifyGoogleToken_IdentityProviderUnavailable(t *testing.T) {
	v := &Verifier{client: fakeVerifier{err: context.DeadlineExceeded}}

	id, err := v.VerifyGoogleToken(context.Background(), "valid-shape-token")
	if !errors.Is(err, ErrIdentityProviderUnavailable) {
		t.Fatalf("want ErrIdentityProviderUnavailable, got %v", err)
	}
	if errors.Is(err, ErrUnauthorized) {
		t.Fatalf("provider outage must not be classified as unauthorized: %v", err)
	}
	if id != (Identity{}) {
		t.Fatalf("want zero Identity on failure, got %+v", id)
	}
}

func TestVerifyGoogleToken_MapsClaims(t *testing.T) {
	tok := &fbauth.Token{
		UID: "firebase-uid-123",
		Claims: map[string]interface{}{
			"email":          "trader@example.com",
			"email_verified": true,
			"name":           "Test Trader",
			"picture":        "https://example.com/p.png",
		},
	}
	tok.Firebase.Identities = map[string]interface{}{
		"google.com": []interface{}{"google-sub-999"},
	}
	tok.Firebase.SignInProvider = "google.com"

	v := &Verifier{client: fakeVerifier{tok: tok}}

	id, err := v.VerifyGoogleToken(context.Background(), "valid")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	want := Identity{
		UID:           "firebase-uid-123",
		ProviderUID:   "google-sub-999",
		Email:         "trader@example.com",
		EmailVerified: true,
		Name:          "Test Trader",
		PhotoURL:      "https://example.com/p.png",
	}
	if id != want {
		t.Fatalf("identity mismatch\n got: %+v\nwant: %+v", id, want)
	}
}

func TestVerifyGoogleToken_RejectsMissingGoogleIdentity(t *testing.T) {
	tok := &fbauth.Token{
		UID:    "firebase-uid-abc",
		Claims: map[string]interface{}{"email": "x@example.com", "email_verified": true},
	}
	tok.Firebase.SignInProvider = "google.com"

	v := &Verifier{client: fakeVerifier{tok: tok}}
	id, err := v.VerifyGoogleToken(context.Background(), "valid")
	if !errors.Is(err, ErrUnauthorized) || id != (Identity{}) {
		t.Fatalf("want rejected zero identity, got id=%+v err=%v", id, err)
	}
}

func TestVerifyGoogleToken_RejectsNonGoogleOrUnverifiedIdentity(t *testing.T) {
	tests := []struct {
		name       string
		provider   string
		emailValid bool
	}{
		{name: "non Google provider", provider: "password", emailValid: true},
		{name: "unverified email", provider: "google.com", emailValid: false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			tok := &fbauth.Token{
				UID: "firebase-uid-abc",
				Claims: map[string]interface{}{
					"email":          "x@example.com",
					"email_verified": tc.emailValid,
				},
			}
			tok.Firebase.SignInProvider = tc.provider
			tok.Firebase.Identities = map[string]interface{}{
				"google.com": []interface{}{"google-sub"},
			}
			v := &Verifier{client: fakeVerifier{tok: tok}}
			id, err := v.VerifyGoogleToken(context.Background(), "valid")
			if !errors.Is(err, ErrUnauthorized) || id != (Identity{}) {
				t.Fatalf("want rejected zero identity, got id=%+v err=%v", id, err)
			}
		})
	}
}

func TestVerifyGoogleToken_RejectsOversizedTokenBeforeVerification(t *testing.T) {
	v := &Verifier{client: fakeVerifier{tok: &fbauth.Token{UID: "should-not-be-used"}}}
	id, err := v.VerifyGoogleToken(context.Background(), string(make([]byte, MaxIDTokenLength+1)))
	if !errors.Is(err, ErrUnauthorized) || id != (Identity{}) {
		t.Fatalf("want rejected zero identity, got id=%+v err=%v", id, err)
	}
}
