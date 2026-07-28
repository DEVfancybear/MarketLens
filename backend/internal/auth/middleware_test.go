package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v3"
)

type fakeSessionActivityChecker struct {
	active    bool
	err       error
	sessionID string
	userID    string
}

func (f *fakeSessionActivityChecker) IsActive(
	_ context.Context,
	sessionID string,
	userID string,
) (bool, error) {
	f.sessionID = sessionID
	f.userID = userID
	return f.active, f.err
}

func activeSessionTestApp(
	checker SessionActivityChecker,
	populateLocals bool,
) *fiber.App {
	app := fiber.New()
	app.Post(
		"/sensitive",
		func(c fiber.Ctx) error {
			if populateLocals {
				c.Locals(LocalUserID, "user-1")
				c.Locals(LocalSessionID, "session-1")
			}
			return c.Next()
		},
		RequireActiveSession(checker),
		func(c fiber.Ctx) error { return c.SendStatus(fiber.StatusNoContent) },
	)
	return app
}

func TestRequireActiveSessionAllowsExactLiveSession(t *testing.T) {
	checker := &fakeSessionActivityChecker{active: true}
	response, err := activeSessionTestApp(checker, true).Test(
		httptest.NewRequest(http.MethodPost, "/sensitive", nil),
	)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("status=%d, want 204", response.StatusCode)
	}
	if checker.userID != "user-1" || checker.sessionID != "session-1" {
		t.Fatalf("checked user=%q session=%q", checker.userID, checker.sessionID)
	}
}

func TestRequireActiveSessionRejectsRevokedOrMissingSession(t *testing.T) {
	for _, test := range []struct {
		name           string
		populateLocals bool
	}{
		{name: "revoked", populateLocals: true},
		{name: "missing locals", populateLocals: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			response, err := activeSessionTestApp(
				&fakeSessionActivityChecker{active: false},
				test.populateLocals,
			).Test(httptest.NewRequest(http.MethodPost, "/sensitive", nil))
			if err != nil {
				t.Fatalf("request: %v", err)
			}
			defer response.Body.Close()
			if response.StatusCode != http.StatusUnauthorized {
				t.Fatalf("status=%d, want 401", response.StatusCode)
			}
		})
	}
}

func TestRequireActiveSessionFailsClosedWhenStoreIsUnavailable(t *testing.T) {
	response, err := activeSessionTestApp(
		&fakeSessionActivityChecker{err: errors.New("database unavailable")},
		true,
	).Test(httptest.NewRequest(http.MethodPost, "/sensitive", nil))
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status=%d, want 503", response.StatusCode)
	}
}
