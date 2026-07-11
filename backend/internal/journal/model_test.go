package journal

import (
	"errors"
	"math"
	"strings"
	"testing"
	"time"
)

func validCreateInput() CreateInput {
	pnl, rr, risk, exit := 125.5, 2.51, 50.0, 1.105
	exitTime := time.Date(2026, 7, 11, 2, 0, 0, 0, time.UTC)
	return CreateInput{
		ClientID: " journal-local-1 ", Symbol: " EURUSD ", Side: " LONG ",
		EntryTime: time.Date(2026, 7, 11, 1, 0, 0, 0, time.UTC), ExitTime: &exitTime,
		EntryPrice: 1.1, ExitPrice: &exit, Quantity: 1, PnL: &pnl, RR: &rr,
		RiskAmount: &risk, Notes: " breakout ", Tags: []string{" A ", "A", ""},
	}
}

func TestNormalizeCreate(t *testing.T) {
	got, err := normalizeCreate(validCreateInput())
	if err != nil {
		t.Fatal(err)
	}
	if got.ClientID != "journal-local-1" || got.Symbol != "EURUSD" || got.Side != "long" {
		t.Fatalf("unexpected normalized identity: %+v", got)
	}
	if got.Notes != "breakout" || len(got.Tags) != 1 || got.Tags[0] != "A" {
		t.Fatalf("unexpected normalized metadata: notes=%q tags=%v", got.Notes, got.Tags)
	}
}

func TestNormalizeCreateRejectsInvalidTradeFields(t *testing.T) {
	tests := []struct {
		name string
		edit func(*CreateInput)
	}{
		{"missing symbol", func(in *CreateInput) { in.Symbol = "" }},
		{"invalid side", func(in *CreateInput) { in.Side = "buy" }},
		{"missing time", func(in *CreateInput) { in.EntryTime = time.Time{} }},
		{"zero entry", func(in *CreateInput) { in.EntryPrice = 0 }},
		{"nan quantity", func(in *CreateInput) { in.Quantity = math.NaN() }},
		{"negative risk", func(in *CreateInput) { value := -1.0; in.RiskAmount = &value }},
		{"long notes", func(in *CreateInput) { in.Notes = strings.Repeat("x", MaxNotesLen+1) }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			in := validCreateInput()
			tt.edit(&in)
			_, err := normalizeCreate(in)
			if !errors.Is(err, ErrBadRequest) {
				t.Fatalf("error=%v, want ErrBadRequest", err)
			}
		})
	}
}

func TestNormalizeScreenshot(t *testing.T) {
	width, height := 1280, 720
	got, err := normalizeScreenshot(ScreenshotInput{
		JournalEntryID: " journal-1 ", Phase: "before", StorageKey: "/users/u/shot.png",
		Width: &width, Height: &height,
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.StorageKey != "users/u/shot.png" || got.ContentType != "image/png" {
		t.Fatalf("unexpected normalized screenshot: %+v", got)
	}
	for _, in := range []ScreenshotInput{
		{JournalEntryID: "journal-1", Phase: "during", StorageKey: "users/u/shot.png"},
		{JournalEntryID: "journal-1", Phase: "before", StorageKey: "../shot.png"},
		{JournalEntryID: "journal-1", Phase: "before", StorageKey: "users/u/shot.png", ContentType: "text/plain"},
	} {
		if _, err := normalizeScreenshot(in); !errors.Is(err, ErrBadRequest) {
			t.Fatalf("input=%+v error=%v, want ErrBadRequest", in, err)
		}
	}
}

func TestNormalizeLimit(t *testing.T) {
	if normalizeLimit(0) != DefaultLimit || normalizeLimit(MaxLimit+1) != MaxLimit || normalizeLimit(25) != 25 {
		t.Fatal("limit normalization does not enforce defaults and cap")
	}
}
