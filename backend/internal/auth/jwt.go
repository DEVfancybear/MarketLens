package auth

import (
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/smc-trading-terminal/backend/internal/config"
)

const (
	accessTokenIssuer   = "tradingterminal-api"
	accessTokenAudience = "tradingterminal-web"
	maxAccessTokenLen   = 8_192
)

// AccessClaims is the verified payload of a backend access token.
type AccessClaims struct {
	UserID    string
	SessionID string
}

// accessTokenClaims is the on-the-wire JWT shape: sub=user id, sid=session id,
// plus standard iat/exp (AUTH.md §3).
type accessTokenClaims struct {
	SessionID string `json:"sid"`
	jwt.RegisteredClaims
}

// TokenService mints and parses stateless HS256 access tokens.
type TokenService struct {
	secret    []byte
	accessTTL time.Duration
}

// NewTokenService builds a TokenService from config (AUTH_JWT_SECRET / AUTH_ACCESS_TTL).
func NewTokenService(cfg config.Config) *TokenService {
	return &TokenService{
		secret:    []byte(cfg.AuthJWTSecret),
		accessTTL: cfg.AuthAccessTTL,
	}
}

// MintAccess signs a short-lived access token for the given user + session.
func (t *TokenService) MintAccess(userID, sessionID string) (string, error) {
	now := time.Now()
	claims := accessTokenClaims{
		SessionID: sessionID,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    accessTokenIssuer,
			Subject:   userID,
			Audience:  jwt.ClaimStrings{accessTokenAudience},
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(t.accessTTL)),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := tok.SignedString(t.secret)
	if err != nil {
		return "", fmt.Errorf("auth: sign access token: %w", err)
	}
	return signed, nil
}

// ParseAccess validates an access token (signature, HS256 method, expiry) and
// returns its claims. Any failure — bad signature, wrong method, expired,
// missing claims — returns ErrUnauthorized.
func (t *TokenService) ParseAccess(tokenString string) (AccessClaims, error) {
	tokenString = strings.TrimSpace(tokenString)
	if tokenString == "" || len(tokenString) > maxAccessTokenLen {
		return AccessClaims{}, fmt.Errorf("%w: invalid token length", ErrUnauthorized)
	}
	var claims accessTokenClaims
	_, err := jwt.ParseWithClaims(tokenString, &claims,
		func(*jwt.Token) (interface{}, error) { return t.secret, nil },
		jwt.WithValidMethods([]string{"HS256"}),
		jwt.WithIssuer(accessTokenIssuer),
		jwt.WithAudience(accessTokenAudience),
		jwt.WithIssuedAt(),
	)
	if err != nil {
		return AccessClaims{}, fmt.Errorf("%w: %v", ErrUnauthorized, err)
	}
	if claims.Subject == "" || claims.SessionID == "" {
		return AccessClaims{}, fmt.Errorf("%w: missing claims", ErrUnauthorized)
	}
	return AccessClaims{UserID: claims.Subject, SessionID: claims.SessionID}, nil
}
