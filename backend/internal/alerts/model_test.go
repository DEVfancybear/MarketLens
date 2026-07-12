package alerts

import (
	"errors"
	"testing"
)

func TestNormalizeCreateDefaultsAndValidation(t *testing.T) {
	input, err := normalizeCreate(CreateInput{
		ClientID:  " alert-1 ",
		Symbol:    " EURUSD ",
		Condition: "crossUp",
		Price:     1.125,
	})
	if err != nil {
		t.Fatalf("normalizeCreate: %v", err)
	}
	if input.ClientID != "alert-1" || input.Symbol != "EURUSD" {
		t.Fatalf("unexpected normalized input: %+v", input)
	}
	if input.Enabled == nil || !*input.Enabled {
		t.Fatal("alerts should default enabled")
	}
	if input.Channels == nil || !input.Channels.Sound {
		t.Fatal("alerts should default sound on")
	}

	_, err = normalizeCreate(CreateInput{Symbol: "EURUSD", Condition: "touch", Price: 1})
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("bad condition error = %v, want ErrBadRequest", err)
	}
	_, err = normalizeCreate(CreateInput{Symbol: "EURUSD", Condition: "above", Price: 0})
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("bad price error = %v, want ErrBadRequest", err)
	}
}

func TestNormalizePatchRequiresTriggerEndpointForTriggeredStatus(t *testing.T) {
	status := "triggered"
	_, err := normalizePatch(PatchInput{Status: &status})
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("triggered status error = %v, want ErrBadRequest", err)
	}
}

func TestDrawingAlertSourceValidation(t *testing.T) {
	source := &AlertSource{
		Kind: "drawing", DrawingID: " dw-1 ", DrawingTool: "horizontal",
		TargetID: "point:0", TargetLabel: " Price level ", SnapshotAt: 1750000000000,
	}
	input, err := normalizeCreate(CreateInput{
		Symbol: "EURUSD", Condition: "crossUp", Price: 1.125, Source: source,
	})
	if err != nil {
		t.Fatalf("normalizeCreate drawing source: %v", err)
	}
	if input.Source.DrawingID != "dw-1" || input.Source.TargetLabel != "Price level" {
		t.Fatalf("source was not normalized: %+v", input.Source)
	}
	_, err = normalizeCreate(CreateInput{
		Symbol: "EURUSD", Condition: "crossUp", Price: 1.125,
		Source: &AlertSource{Kind: "drawing"},
	})
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("invalid source error = %v, want ErrBadRequest", err)
	}
}

func TestValidTriggerPriceRequiresCorrectSideOfTarget(t *testing.T) {
	tests := []struct {
		condition string
		target    float64
		trigger   float64
		want      bool
	}{
		{condition: "crossUp", target: 1.14420, trigger: 1.14420, want: true},
		{condition: "crossUp", target: 1.14420, trigger: 1.14412, want: false},
		{condition: "crossDown", target: 1.14372, trigger: 1.14372, want: true},
		{condition: "crossDown", target: 1.14372, trigger: 1.14412, want: false},
	}

	for _, tc := range tests {
		if got := validTriggerPrice(tc.condition, tc.target, tc.trigger); got != tc.want {
			t.Fatalf("validTriggerPrice(%q, %v, %v) = %v, want %v", tc.condition, tc.target, tc.trigger, got, tc.want)
		}
	}
}

func TestNormalizePushToken(t *testing.T) {
	input, err := normalizePushToken(PushTokenInput{
		FCMToken:   " token-1 ",
		Permission: "GRANTED",
	})
	if err != nil {
		t.Fatalf("normalizePushToken: %v", err)
	}
	if input.FCMToken != "token-1" || input.Platform != "web" || input.Permission != "granted" {
		t.Fatalf("unexpected normalized token: %+v", input)
	}
}
