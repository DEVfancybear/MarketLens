package auth

import (
	"errors"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/smc-trading-terminal/backend/internal/config"
)

func testTokenService(ttl time.Duration) *TokenService {
	return NewTokenService(config.Config{
		AuthJWTSecret: "test-secret-at-least-32-bytes-long-xxxx",
		AuthAccessTTL: ttl,
	})
}

func TestMintParseAccess_RoundTrip(t *testing.T) {
	ts := testTokenService(15 * time.Minute)

	tok, err := ts.MintAccess("user-1", "sess-1")
	if err != nil {
		t.Fatalf("mint: %v", err)
	}

	claims, err := ts.ParseAccess(tok)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if claims.UserID != "user-1" || claims.SessionID != "sess-1" {
		t.Fatalf("claims mismatch: %+v", claims)
	}
}

func TestParseAccess_Expired(t *testing.T) {
	ts := testTokenService(-1 * time.Minute) // already expired

	tok, err := ts.MintAccess("user-1", "sess-1")
	if err != nil {
		t.Fatalf("mint: %v", err)
	}

	if _, err := ts.ParseAccess(tok); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("want ErrUnauthorized for expired token, got %v", err)
	}
}

func TestParseAccess_WrongSecret(t *testing.T) {
	tok, err := testTokenService(15*time.Minute).MintAccess("user-1", "sess-1")
	if err != nil {
		t.Fatalf("mint: %v", err)
	}

	other := NewTokenService(config.Config{
		AuthJWTSecret: "a-completely-different-secret-value-yyyy",
		AuthAccessTTL: 15 * time.Minute,
	})
	if _, err := other.ParseAccess(tok); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("want ErrUnauthorized for wrong secret, got %v", err)
	}
}

func TestParseAccess_RejectsNoneAlg(t *testing.T) {
	// A token signed with "none" must be rejected (alg-confusion guard).
	tok := jwt.NewWithClaims(jwt.SigningMethodNone, jwt.RegisteredClaims{
		Subject:   "user-1",
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
	})
	signed, err := tok.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatalf("sign none: %v", err)
	}

	if _, err := testTokenService(15 * time.Minute).ParseAccess(signed); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("want ErrUnauthorized for none-alg token, got %v", err)
	}
}

func TestParseAccess_RejectsForeignAudienceWithValidSignature(t *testing.T) {
	ts := testTokenService(15 * time.Minute)
	claims := accessTokenClaims{
		SessionID: "sess-1",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    accessTokenIssuer,
			Subject:   "user-1",
			Audience:  jwt.ClaimStrings{"another-service"},
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(ts.secret)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if _, err := ts.ParseAccess(signed); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("want ErrUnauthorized for foreign audience, got %v", err)
	}
}
