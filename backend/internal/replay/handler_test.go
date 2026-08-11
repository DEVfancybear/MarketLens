package replay

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/marketlens/backend/internal/auth"
)

type fakeSessionService struct {
	createUser string
	creates    int
}

func (f *fakeSessionService) Create(_ context.Context, userID string, _ CreateSessionInput) (SessionSnapshot, error) {
	f.createUser = userID
	f.creates++
	return SessionSnapshot{ID: "session", Status: "paused", Tracks: []TrackSnapshot{}}, nil
}
func (f *fakeSessionService) Get(context.Context, string, string) (SessionSnapshot, error) {
	return SessionSnapshot{}, nil
}
func (f *fakeSessionService) Bars(context.Context, string, string, string, string) (RevealedBarsSnapshot, error) {
	return RevealedBarsSnapshot{}, nil
}
func (f *fakeSessionService) Close(context.Context, string, string) (SessionSnapshot, error) {
	return SessionSnapshot{}, nil
}
func (f *fakeSessionService) Report(context.Context, string, string) (ReplayReport, error) {
	return ReplayReport{}, nil
}
func (f *fakeSessionService) Fork(context.Context, string, string, time.Time) (SessionSnapshot, error) {
	return SessionSnapshot{}, nil
}

func TestReplayRoutesRequireAuthBeforeDatasetPreparation(t *testing.T) {
	service := &fakeSessionService{}
	requireAuth := func(c fiber.Ctx) error {
		userID := c.Get("X-Test-User")
		if userID == "" {
			return fiber.NewError(fiber.StatusUnauthorized, "unauthorized")
		}
		c.Locals(auth.LocalUserID, userID)
		return c.Next()
	}
	app := fiber.New()
	NewHandler(service, requireAuth).Register(app.Group("/api/v1"))
	body := `{"start":{"kind":"time","time":"2026-05-01T09:30:00Z"},"tracks":[{"slot":0,"symbol":"EURUSD","chartTimeframe":"15m"}]}`

	unauthorized := httptest.NewRequest(http.MethodPost, "/api/v1/replay/sessions", strings.NewReader(body))
	unauthorized.Header.Set("Content-Type", "application/json")
	response, err := app.Test(unauthorized)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != fiber.StatusUnauthorized || service.creates != 0 {
		t.Fatalf("status=%d creates=%d", response.StatusCode, service.creates)
	}

	authorized := httptest.NewRequest(http.MethodPost, "/api/v1/replay/sessions", strings.NewReader(body))
	authorized.Header.Set("Content-Type", "application/json")
	authorized.Header.Set("X-Test-User", "user-123")
	response, err = app.Test(authorized)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != fiber.StatusAccepted || service.creates != 1 || service.createUser != "user-123" {
		t.Fatalf("status=%d creates=%d user=%q", response.StatusCode, service.creates, service.createUser)
	}
}

func TestReplayDataUnavailableErrorIncludesExactTrackIdentity(t *testing.T) {
	first := time.Date(2024, 8, 5, 2, 11, 0, 0, time.UTC)
	last := time.Date(2024, 8, 8, 13, 39, 0, 0, time.UTC)
	err := replayAPIError(&DataUnavailableError{
		FirstAvailable: first,
		LastAvailable:  last,
		Slot:           0,
		Symbol:         "ADAUSD",
		ChartTimeframe: "15m",
	})
	transport, ok := err.(interface {
		HTTPStatus() int
		ErrorCode() string
		ErrorDetails() any
	})
	if !ok {
		t.Fatalf("transport error type=%T", err)
	}
	if transport.HTTPStatus() != 422 || transport.ErrorCode() != "data_point_unavailable" {
		t.Fatalf("status=%d code=%q", transport.HTTPStatus(), transport.ErrorCode())
	}
	want := map[string]any{
		"firstAvailableTime": first,
		"lastAvailableTime":  last,
		"slot":               0,
		"symbol":             "ADAUSD",
		"chartTimeframe":     "15m",
	}
	if !reflect.DeepEqual(transport.ErrorDetails(), want) {
		t.Fatalf("details=%#v want %#v", transport.ErrorDetails(), want)
	}
}
