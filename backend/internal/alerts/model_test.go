package alerts

import (
	"encoding/json"
	"errors"
	"math"
	"strings"
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
	expired := " expired "
	normalized, err := normalizePatch(PatchInput{Status: &expired})
	if err != nil || normalized.Status == nil || *normalized.Status != "expired" {
		t.Fatalf("expired status patch = %+v, %v", normalized, err)
	}
}

func TestNormalizePatchValidatesTechnicalTarget(t *testing.T) {
	target := &TechnicalAlertTarget{
		Version:       1,
		Kind:          " dynamic-line ",
		A:             &TechnicalAlertPoint{Time: 1_750_000_000, Price: 1.12},
		B:             &TechnicalAlertPoint{Time: 1_750_003_600, Price: 1.13},
		Domain:        " ray ",
		Interpolation: " linear ",
	}
	patched, err := normalizePatch(PatchInput{TechnicalTarget: target})
	if err != nil {
		t.Fatalf("normalize technical target patch: %v", err)
	}
	if patched.TechnicalTarget == nil || patched.TechnicalTarget.Kind != "dynamic-line" ||
		patched.TechnicalTarget.Domain != "ray" {
		t.Fatalf("technical target patch was not normalized: %+v", patched.TechnicalTarget)
	}

	invalid := &TechnicalAlertTarget{Version: 1, Kind: "dynamic-line"}
	if _, err := normalizePatch(PatchInput{TechnicalTarget: invalid}); !errors.Is(err, ErrBadRequest) {
		t.Fatalf("invalid technical target patch error = %v, want ErrBadRequest", err)
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

func TestTechnicalAlertTargetValidation(t *testing.T) {
	fixedPrice := 1.125
	fixed, err := normalizeCreate(CreateInput{
		Symbol: "EURUSD", Condition: "above", Price: fixedPrice,
		TechnicalTarget: &TechnicalAlertTarget{Version: 1, Kind: " fixed-price ", Price: &fixedPrice},
	})
	if err != nil {
		t.Fatalf("normalize fixed target: %v", err)
	}
	if fixed.TechnicalTarget.Kind != "fixed-price" {
		t.Fatalf("fixed kind was not normalized: %+v", fixed.TechnicalTarget)
	}

	line := &TechnicalAlertTarget{
		Version:       1,
		Kind:          "dynamic-line",
		A:             &TechnicalAlertPoint{Time: 1_750_000_000, Price: 1.12},
		B:             &TechnicalAlertPoint{Time: 1_750_003_600, Price: 1.13},
		Domain:        " segment ",
		Interpolation: " linear ",
	}
	dynamic, err := normalizeCreate(CreateInput{
		Symbol: "EURUSD", Condition: "crossUp", Price: 1.125, TechnicalTarget: line,
	})
	if err != nil {
		t.Fatalf("normalize dynamic line: %v", err)
	}
	if dynamic.TechnicalTarget.Domain != "segment" || dynamic.TechnicalTarget.Interpolation != "linear" {
		t.Fatalf("line values were not normalized: %+v", dynamic.TechnicalTarget)
	}

	channel := &TechnicalAlertTarget{
		Version:   1,
		Kind:      "dynamic-channel",
		BoundaryA: testDynamicBoundary(1.12, 1.13, "segment", "linear"),
		BoundaryB: testDynamicBoundary(1.10, 1.11, "segment", "linear"),
		Operator:  "enter",
	}
	if err := validateTechnicalTarget(channel); err != nil {
		t.Fatalf("validate dynamic channel: %v", err)
	}
}

func TestTechnicalAlertTargetRejectsUnsafeGeometry(t *testing.T) {
	tests := []struct {
		name   string
		target *TechnicalAlertTarget
	}{
		{name: "unknown version", target: &TechnicalAlertTarget{Version: 2, Kind: "dynamic-line"}},
		{name: "unknown kind", target: &TechnicalAlertTarget{Version: 1, Kind: "moving-average"}},
		{name: "missing anchor", target: &TechnicalAlertTarget{
			Version: 1, Kind: "dynamic-line", A: &TechnicalAlertPoint{Time: 1, Price: 1},
			Domain: "segment", Interpolation: "linear",
		}},
		{name: "equal anchor time", target: &TechnicalAlertTarget{
			Version: 1, Kind: "dynamic-line",
			A: &TechnicalAlertPoint{Time: 1, Price: 1}, B: &TechnicalAlertPoint{Time: 1, Price: 2},
			Domain: "segment", Interpolation: "linear",
		}},
		{name: "non finite price", target: &TechnicalAlertTarget{
			Version: 1, Kind: "dynamic-line",
			A: &TechnicalAlertPoint{Time: 1, Price: math.NaN()}, B: &TechnicalAlertPoint{Time: 2, Price: 2},
			Domain: "segment", Interpolation: "linear",
		}},
		{name: "invalid domain", target: &TechnicalAlertTarget{
			Version: 1, Kind: "dynamic-line",
			A: &TechnicalAlertPoint{Time: 1, Price: 1}, B: &TechnicalAlertPoint{Time: 2, Price: 2},
			Domain: "viewport", Interpolation: "linear",
		}},
		{name: "channel boundary mismatch", target: &TechnicalAlertTarget{
			Version: 1, Kind: "dynamic-channel", Operator: "inside",
			BoundaryA: testDynamicBoundary(1, 2, "segment", "linear"),
			BoundaryB: testDynamicBoundary(0.5, 1.5, "infinite", "linear"),
		}},
		{name: "channel time anchors mismatch", target: &TechnicalAlertTarget{
			Version: 1, Kind: "dynamic-channel", Operator: "inside",
			BoundaryA: testDynamicBoundary(1, 2, "segment", "linear"),
			BoundaryB: &DynamicLineTarget{
				Version: 1, Kind: "dynamic-line",
				A:      TechnicalAlertPoint{Time: 1_750_000_001, Price: 0.5},
				B:      TechnicalAlertPoint{Time: 1_750_003_600, Price: 1.5},
				Domain: "segment", Interpolation: "linear",
			},
		}},
		{name: "channel nonparallel", target: &TechnicalAlertTarget{
			Version: 1, Kind: "dynamic-channel", Operator: "inside",
			BoundaryA: testDynamicBoundary(1, 2, "segment", "linear"),
			BoundaryB: testDynamicBoundary(0.5, 1.6, "segment", "linear"),
		}},
		{name: "invalid channel operator", target: &TechnicalAlertTarget{
			Version: 1, Kind: "dynamic-channel", Operator: "touch",
			BoundaryA: testDynamicBoundary(1, 2, "segment", "linear"),
			BoundaryB: testDynamicBoundary(0.5, 1.5, "segment", "linear"),
		}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if err := validateTechnicalTarget(tc.target); !errors.Is(err, ErrBadRequest) {
				t.Fatalf("error = %v, want ErrBadRequest", err)
			}
		})
	}
}

func TestTechnicalAlertTargetJSONIsBoundedAndStrict(t *testing.T) {
	var target TechnicalAlertTarget
	if err := json.Unmarshal([]byte(`{"version":1,"kind":"fixed-price","price":1,"prise":1}`), &target); err == nil {
		t.Fatal("unknown target fields must be rejected")
	}
	oversized := `{"version":1,"kind":"fixed-price","price":1,"padding":"` +
		strings.Repeat("x", MaxTechnicalTargetBytes) + `"}`
	if err := json.Unmarshal([]byte(oversized), &target); err == nil {
		t.Fatal("oversized target must be rejected")
	}
}

func testDynamicBoundary(aPrice, bPrice float64, domain, interpolation string) *DynamicLineTarget {
	return &DynamicLineTarget{
		Version:       1,
		Kind:          "dynamic-line",
		A:             TechnicalAlertPoint{Time: 1_750_000_000, Price: aPrice},
		B:             TechnicalAlertPoint{Time: 1_750_003_600, Price: bPrice},
		Domain:        domain,
		Interpolation: interpolation,
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
