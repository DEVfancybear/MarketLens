package httpserver

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/smc-trading-terminal/backend/internal/apierror"
)

func TestErrorHandlerPreservesTypedAPIErrorCode(t *testing.T) {
	app := fiber.New(fiber.Config{ErrorHandler: errorHandler})
	app.Get("/", func(*fiber.Ctx) error {
		return apierror.New(422, "data_point_unavailable", "unavailable")
	})
	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/", nil))
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 422 || !strings.Contains(string(body), `"code":"data_point_unavailable"`) {
		t.Fatalf("status=%d body=%s", response.StatusCode, body)
	}
}
