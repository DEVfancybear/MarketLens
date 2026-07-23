package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/smc-trading-terminal/backend/internal/config"
)

// fakeGoogleVerifier returns a fixed identity for the token "good-token".
type fakeGoogleVerifier struct{}

func (fakeGoogleVerifier) VerifyGoogleToken(_ context.Context, idToken string) (Identity, error) {
	if idToken != "good-token" {
		return Identity{}, ErrUnauthorized
	}
	return Identity{
		UID:           "uid-1",
		ProviderUID:   "sub-1",
		Email:         "trader@example.com",
		EmailVerified: true,
		Name:          "Jane Trader",
		PhotoURL:      "https://example.com/p.png",
	}, nil
}

// fakeRepo is an in-memory UserUpserter.
type fakeRepo struct {
	isNew bool
	users map[string]User
}

func newFakeRepo(isNew bool) *fakeRepo {
	return &fakeRepo{isNew: isNew, users: map[string]User{}}
}

func (f *fakeRepo) UpsertFromIdentity(_ context.Context, id Identity) (User, bool, error) {
	u := User{
		ID:            "user-1",
		Email:         id.Email,
		DisplayName:   id.Name,
		PhotoURL:      id.PhotoURL,
		EmailVerified: id.EmailVerified,
		CreatedAt:     time.Unix(0, 0).UTC(),
	}
	f.users[u.ID] = u
	return u, f.isNew, nil
}

func (f *fakeRepo) GetUser(_ context.Context, userID string) (User, error) {
	u, ok := f.users[userID]
	if !ok {
		return User{}, ErrUnauthorized
	}
	return u, nil
}

func newTestApp(isNewUser bool) *fiber.App {
	cfg := config.Config{
		Env:            "development",
		AuthJWTSecret:  "test-secret-at-least-32-bytes-long-xx",
		AuthAccessTTL:  15 * time.Minute,
		AuthRefreshTTL: 720 * time.Hour,
	}
	tokens := NewTokenService(cfg)
	sessions := NewSessionService(newFakeStore(), cfg)
	svc := NewService(fakeGoogleVerifier{}, newFakeRepo(isNewUser), sessions, tokens)
	h := NewHandler(svc, tokens, cfg)

	app := fiber.New()
	h.Register(app.Group("/api/v1"))
	return app
}

func cookieValue(resp *http.Response, name string) string {
	for _, ck := range resp.Cookies() {
		if ck.Name == name {
			return ck.Value
		}
	}
	return ""
}

func TestAuthFlow_GoogleLoginMeRefreshLogout(t *testing.T) {
	app := newTestApp(true)

	// 1. POST /auth/google → 200, sets both cookies, returns user + isNewUser.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/google",
		strings.NewReader(`{"idToken":"good-token"}`))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("google: %v", err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("google status = %d, want 200", resp.StatusCode)
	}

	var loginBody struct {
		User      map[string]any `json:"user"`
		IsNewUser bool           `json:"isNewUser"`
	}
	json.NewDecoder(resp.Body).Decode(&loginBody)
	if !loginBody.IsNewUser {
		t.Fatal("want isNewUser=true")
	}
	if loginBody.User["email"] != "trader@example.com" {
		t.Fatalf("unexpected user email: %v", loginBody.User["email"])
	}

	access := cookieValue(resp, AccessCookieName)
	refresh := cookieValue(resp, RefreshCookieName)
	if access == "" || refresh == "" {
		t.Fatalf("expected both cookies, got access=%q refresh=%q", access, refresh)
	}

	// 2. GET /auth/me with the access cookie → 200 user.
	req = httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	req.AddCookie(&http.Cookie{Name: AccessCookieName, Value: access})
	resp, _ = app.Test(req)
	if resp.StatusCode != 200 {
		t.Fatalf("me status = %d, want 200", resp.StatusCode)
	}
	var meBody map[string]any
	json.NewDecoder(resp.Body).Decode(&meBody)
	if meBody["email"] != "trader@example.com" {
		t.Fatalf("me email = %v", meBody["email"])
	}

	// 3. GET /auth/me without a cookie → 401.
	req = httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	resp, _ = app.Test(req)
	if resp.StatusCode != 401 {
		t.Fatalf("me (no cookie) status = %d, want 401", resp.StatusCode)
	}

	// 4. POST /auth/refresh with the refresh cookie → 200, new cookies.
	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", nil)
	req.AddCookie(&http.Cookie{Name: RefreshCookieName, Value: refresh})
	resp, _ = app.Test(req)
	if resp.StatusCode != 200 {
		t.Fatalf("refresh status = %d, want 200", resp.StatusCode)
	}
	if cookieValue(resp, AccessCookieName) == "" {
		t.Fatal("refresh should set a new access cookie")
	}

	// 5. POST /auth/logout with the access cookie → 200 and clears cookies.
	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	req.AddCookie(&http.Cookie{Name: AccessCookieName, Value: access})
	resp, _ = app.Test(req)
	if resp.StatusCode != 200 {
		t.Fatalf("logout status = %d, want 200", resp.StatusCode)
	}
	for _, ck := range resp.Cookies() {
		if ck.Name == AccessCookieName && ck.MaxAge > 0 {
			t.Fatal("logout should expire the access cookie")
		}
	}
}

func TestAuthGoogle_BadToken(t *testing.T) {
	app := newTestApp(false)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/google",
		strings.NewReader(`{"idToken":"nope"}`))
	req.Header.Set("Content-Type", "application/json")
	resp, _ := app.Test(req)
	if resp.StatusCode != 401 {
		t.Fatalf("bad token status = %d, want 401", resp.StatusCode)
	}
}

func TestAuthGoogle_MissingToken(t *testing.T) {
	app := newTestApp(false)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/google",
		strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	resp, _ := app.Test(req)
	if resp.StatusCode != 400 {
		t.Fatalf("missing token status = %d, want 400", resp.StatusCode)
	}
}

func TestAuthRefresh_NoCookie(t *testing.T) {
	app := newTestApp(false)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", nil)
	resp, _ := app.Test(req)
	if resp.StatusCode != 401 {
		t.Fatalf("refresh (no cookie) status = %d, want 401", resp.StatusCode)
	}
}
