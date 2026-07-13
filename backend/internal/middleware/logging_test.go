package middleware

import (
	"errors"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/smc-trading-terminal/backend/internal/apierror"
)

func TestRequestStatusUsesTransportAwareErrorStatus(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want int
	}{
		{name: "api error", err: apierror.New(422, "data_point_unavailable", "unavailable"), want: 422},
		{name: "fiber error", err: fiber.NewError(404, "missing"), want: 404},
		{name: "unknown error", err: errors.New("boom"), want: 500},
		{name: "response status", want: 204},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := requestStatus(204, tt.err); got != tt.want {
				t.Fatalf("status=%d want=%d", got, tt.want)
			}
		})
	}
}
