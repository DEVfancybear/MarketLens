package alerts

import (
	"math"
	"testing"
)

func TestTargetAtGoldenDomainsAndInterpolation(t *testing.T) {
	line := evaluatorLine(100, 100, 200, 200, "segment", "linear")
	assertTargetAt(t, line, 150, true, 150, "")
	assertTargetAt(t, line, 99, false, 0, targetBeforeDomain)
	assertTargetAt(t, line, 201, false, 0, targetExpired)

	line.Domain = "ray"
	assertTargetAt(t, line, 99, false, 0, targetBeforeDomain)
	assertTargetAt(t, line, 250, true, 250, "")

	line.A, line.B = line.B, line.A
	assertTargetAt(t, line, 150, true, 150, "")
	assertTargetAt(t, line, 201, false, 0, targetExpired)

	logLine := evaluatorLine(100, 100, 200, 400, "infinite", "log")
	assertTargetAt(t, logLine, 150, true, 200, "")
}

func TestEvaluateTechnicalAlertGoldenMovingLineAndMilliseconds(t *testing.T) {
	line := evaluatorLine(1_700_000_100, 100, 1_700_000_200, 200, "infinite", "linear")
	previous := &TechnicalEvidencePoint{Price: 145, Timestamp: 1_700_000_150_000}
	current := TechnicalEvidencePoint{Price: 165, Timestamp: 1_700_000_160_000}
	result := evaluateTechnicalAlert("crossUp", line, previous, current)
	if !result.Active || !result.Triggered || !nearlyEqual(result.TargetPrice, 160) {
		t.Fatalf("crossUp result = %+v, want active trigger at 160", result)
	}

	moving := evaluatorLine(100, 100, 200, 200, "infinite", "linear")
	result = evaluateTechnicalAlert(
		"crossDown",
		moving,
		&TechnicalEvidencePoint{Timestamp: 150, Price: 160},
		TechnicalEvidencePoint{Timestamp: 160, Price: 155},
	)
	if !result.Triggered || result.TargetPrice != 160 {
		t.Fatalf("moving-boundary crossDown = %+v", result)
	}
}

func TestEvaluateTechnicalAlertGoldenFixedEqualityRules(t *testing.T) {
	price := 120.0
	target := &TechnicalAlertTarget{Version: 1, Kind: "fixed-price", Price: &price}
	tests := []struct {
		condition string
		before    float64
		current   float64
	}{
		{condition: "above", before: 119, current: 120},
		{condition: "below", before: 121, current: 120},
		{condition: "crossUp", before: 119, current: 120},
		{condition: "crossDown", before: 121, current: 120},
	}
	for _, tc := range tests {
		result := evaluateTechnicalAlert(
			tc.condition,
			target,
			&TechnicalEvidencePoint{Timestamp: 150, Price: tc.before},
			TechnicalEvidencePoint{Timestamp: 160, Price: tc.current},
		)
		if !result.Active || !result.Triggered || result.TargetPrice != price {
			t.Fatalf("%s equality result = %+v", tc.condition, result)
		}
	}
}

func TestNearlyEqualAcceptsNumericScaleRounding(t *testing.T) {
	if !nearlyEqual(0.000012345, 0.00001235) {
		t.Fatal("numeric(20,8) rounding should not reject a low-priced target")
	}
	if nearlyEqual(0.00001235, 0.00001236) {
		t.Fatal("a full numeric(20,8) price step must remain unequal")
	}
}

func TestEvaluateTechnicalAlertGoldenChannelOperators(t *testing.T) {
	lower := evaluatorLine(100, 100, 200, 100, "infinite", "linear")
	upper := evaluatorLine(100, 120, 200, 120, "infinite", "linear")
	tests := []struct {
		operator string
		before   float64
		current  float64
		want     bool
	}{
		{operator: "enter", before: 90, current: 110, want: true},
		{operator: "exit", before: 110, current: 130, want: true},
		{operator: "inside", before: 90, current: 110, want: true},
		{operator: "outside", before: 110, current: 130, want: true},
		{operator: "cross-lower-up", before: 90, current: 105, want: true},
		{operator: "cross-lower-down", before: 110, current: 95, want: true},
		{operator: "cross-upper-up", before: 110, current: 125, want: true},
		{operator: "cross-upper-down", before: 130, current: 115, want: true},
	}
	for _, tc := range tests {
		t.Run(tc.operator, func(t *testing.T) {
			target := &TechnicalAlertTarget{
				Version: 1, Kind: "dynamic-channel", BoundaryA: asBoundary(lower),
				BoundaryB: asBoundary(upper), Operator: tc.operator,
			}
			result := evaluateTechnicalAlert(
				"crossUp", target,
				&TechnicalEvidencePoint{Timestamp: 150, Price: tc.before},
				TechnicalEvidencePoint{Timestamp: 160, Price: tc.current},
			)
			if result.Triggered != tc.want || !result.Active {
				t.Fatalf("result = %+v, want triggered=%v", result, tc.want)
			}
		})
	}

	for _, operator := range []string{"enter", "exit"} {
		target := &TechnicalAlertTarget{
			Version: 1, Kind: "dynamic-channel", BoundaryA: asBoundary(lower),
			BoundaryB: asBoundary(upper), Operator: operator,
		}
		result := evaluateTechnicalAlert(
			"crossUp", target,
			&TechnicalEvidencePoint{Timestamp: 150, Price: 90},
			TechnicalEvidencePoint{Timestamp: 160, Price: 130},
		)
		if result.Triggered {
			t.Fatalf("channel jump must not invent %s: %+v", operator, result)
		}
	}
}

func TestNormalizeTriggerInputRejectsMissingStaleAndOutOfOrderEvidence(t *testing.T) {
	valid := TriggerInput{
		ArmingRevision: 7,
		Previous:       &TechnicalEvidencePoint{Price: 99, Timestamp: 101},
		Current:        &TechnicalEvidencePoint{Price: 101, Timestamp: 100},
	}
	if _, err := normalizeTriggerInput(valid); err == nil {
		t.Fatal("decreasing evidence timestamps must be rejected")
	}
	valid.Previous.Timestamp = 99
	valid.ArmingRevision = 0
	if _, err := normalizeTriggerInput(valid); err == nil {
		t.Fatal("missing arming revision must be rejected")
	}
	valid.ArmingRevision = 7
	valid.Current = nil
	if _, err := normalizeTriggerInput(valid); err == nil {
		t.Fatal("missing current evidence must be rejected")
	}
}

func assertTargetAt(t *testing.T, target *TechnicalAlertTarget, timestamp float64, active bool, price float64, reason string) {
	t.Helper()
	got := targetAt(target, timestamp)
	if got.Active != active || got.Reason != reason || (active && math.Abs(got.Lower-price) > 1e-9) {
		t.Fatalf("targetAt(%v) = %+v, want active=%v price=%v reason=%q", timestamp, got, active, price, reason)
	}
}

func evaluatorLine(aTime float64, aPrice float64, bTime float64, bPrice float64, domain, interpolation string) *TechnicalAlertTarget {
	return &TechnicalAlertTarget{
		Version: 1, Kind: "dynamic-line",
		A:      &TechnicalAlertPoint{Time: aTime, Price: aPrice},
		B:      &TechnicalAlertPoint{Time: bTime, Price: bPrice},
		Domain: domain, Interpolation: interpolation,
	}
}

func asBoundary(line *TechnicalAlertTarget) *DynamicLineTarget {
	return &DynamicLineTarget{
		Version: line.Version, Kind: line.Kind, A: *line.A, B: *line.B,
		Domain: line.Domain, Interpolation: line.Interpolation,
	}
}
