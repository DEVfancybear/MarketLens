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
	app, _, _ := newTestAppWithDependencies(isNewUser)
	return app
}

func newTestAppWithDependencies(isNewUser bool) (*fiber.App, *fakeSessionStore, *fakeRepo) {
	cfg := config.Config{
		Env:            "development",
		AuthJWTSecret:  "test-secret-at-least-32-bytes-long-xx",
		AuthAccessTTL:  15 * time.Minute,
		AuthRefreshTTL: 720 * time.Hour,
	}
	tokens := NewTokenService(cfg)
	store := newFakeStore()
	repo := newFakeRepo(isNewUser)
	sessions := NewSessionService(store, cfg)
	svc := NewService(fakeGoogleVerifier{}, repo, sessions, tokens)
	h := NewHandler(svc, tokens, cfg)

	app := fiber.New()
	h.Register(app.Group("/api/v1"))
	return app, store, repo
}

func cookieValue(resp *http.Response, name string) string {
	for _, ck := range resp.Cookies() {
		if ck.Name == name {
			return ck.Value
		}
	}
	return ""
}

func responseCookie(resp *http.Response, name string) *http.Cookie {
	for _, cookie := range resp.Cookies() {
		if cookie.Name == name {
			return cookie
		}
	}
	return nil
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
	if cookie := responseCookie(resp, AccessCookieName); cookie == nil ||
		!cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode {
		t.Fatalf("access cookie is not HttpOnly/SameSite=Strict: %+v", cookie)
	}
	if cookie := responseCookie(resp, RefreshCookieName); cookie == nil ||
		!cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode {
		t.Fatalf("refresh cookie is not HttpOnly/SameSite=Strict: %+v", cookie)
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
	expiredCookies := map[string]bool{
		AccessCookieName:      false,
		RefreshCookieName:     false,
		tradeUnlockCookieName: false,
	}
	for _, cookie := range resp.Cookies() {
		if _, expected := expiredCookies[cookie.Name]; expected && cookie.MaxAge < 0 {
			expiredCookies[cookie.Name] = true
		}
	}
	for name, expired := range expiredCookies {
		if !expired {
			t.Fatalf("logout did not expire %s", name)
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

func TestAuthSession_ReusesThenRotatesWithoutProbeFailures(t *testing.T) {
	app, store, _ := newTestAppWithDependencies(false)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/session",
		strings.NewReader(`{"idToken":"good-token"}`))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("create session status = %d, want 200", resp.StatusCode)
	}
	access := cookieValue(resp, AccessCookieName)
	refresh := cookieValue(resp, RefreshCookieName)
	if access == "" || refresh == "" || store.seq != 1 {
		t.Fatalf("expected one new cookie session, access=%t refresh=%t sessions=%d", access != "", refresh != "", store.seq)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/session",
		strings.NewReader(`{"idToken":"good-token"}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: AccessCookieName, Value: access})
	req.AddCookie(&http.Cookie{Name: RefreshCookieName, Value: refresh})
	resp, _ = app.Test(req)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("reuse session status = %d, want 200", resp.StatusCode)
	}
	if store.seq != 1 {
		t.Fatalf("valid access cookie created an unnecessary session; sessions=%d", store.seq)
	}
	if cookieValue(resp, AccessCookieName) != "" || cookieValue(resp, RefreshCookieName) != "" {
		t.Fatal("valid access reuse should not rewrite auth cookies")
	}

	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/session",
		strings.NewReader(`{"idToken":"good-token"}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: AccessCookieName, Value: "expired-or-invalid"})
	req.AddCookie(&http.Cookie{Name: RefreshCookieName, Value: refresh})
	resp, _ = app.Test(req)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("rotate session status = %d, want 200", resp.StatusCode)
	}
	if cookieValue(resp, AccessCookieName) == "" || cookieValue(resp, RefreshCookieName) == "" {
		t.Fatal("refresh rotation should replace both auth cookies")
	}
	if store.seq != 2 {
		t.Fatalf("refresh rotation sessions=%d, want 2", store.seq)
	}
}

func TestAuthSession_RejectsInvalidOrOversizedFirebaseToken(t *testing.T) {
	app := newTestApp(false)
	for _, tc := range []struct {
		name, token string
		want        int
	}{
		{name: "invalid", token: "nope", want: http.StatusUnauthorized},
		{name: "oversized", token: strings.Repeat("x", MaxIDTokenLength+1), want: http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body, _ := json.Marshal(map[string]string{"idToken": tc.token})
			req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/session", strings.NewReader(string(body)))
			req.Header.Set("Content-Type", "application/json")
			resp, _ := app.Test(req)
			if resp.StatusCode != tc.want {
				t.Fatalf("status = %d, want %d", resp.StatusCode, tc.want)
			}
		})
	}
}

func TestAuthSession_RateLimitsRepeatedAttempts(t *testing.T) {
	app := newTestApp(false)
	for attempt := 0; attempt < authRateLimitMax; attempt++ {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/session",
			strings.NewReader(`{"idToken":"nope"}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("CF-Connecting-IP", "203.0.113.10")
		resp, _ := app.Test(req)
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("attempt %d status = %d, want 401", attempt+1, resp.StatusCode)
		}
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/session",
		strings.NewReader(`{"idToken":"nope"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("CF-Connecting-IP", "203.0.113.10")
	resp, _ := app.Test(req)
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("rate-limited status = %d, want 429", resp.StatusCode)
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

func TestAuthError_IdentityProviderUnavailableIsRetryable(t *testing.T) {
	err := authError(ErrIdentityProviderUnavailable)
	fiberErr, ok := err.(*fiber.Error)
	if !ok || fiberErr.Code != http.StatusServiceUnavailable {
		t.Fatalf("authError = %#v, want Fiber 503", err)
	}
}
