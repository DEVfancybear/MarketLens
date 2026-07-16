package alerts

import (
	"fmt"
	"math"
	"time"
)

const (
	targetBeforeDomain = "before-domain"
	targetExpired      = "expired"
	targetInvalid      = "invalid"
)

type technicalTargetAt struct {
	Active bool
	Lower  float64
	Upper  float64
	Reason string
}

type technicalEvaluation struct {
	Triggered   bool
	TargetPrice float64
	Active      bool
	Reason      string
}

func normalizeEpochSeconds(value float64) float64 {
	if value >= 100_000_000_000 {
		return value / 1000
	}
	return value
}

func normalizeEvidencePoint(point TechnicalEvidencePoint) (TechnicalEvidencePoint, bool) {
	point.Timestamp = normalizeEpochSeconds(point.Timestamp)
	if !validPrice(point.Price) || point.Timestamp <= 0 || math.IsNaN(point.Timestamp) ||
		math.IsInf(point.Timestamp, 0) || point.Timestamp > 253_402_300_799 {
		return TechnicalEvidencePoint{}, false
	}
	return point, true
}

func normalizeTriggerInput(input TriggerInput) (TriggerInput, error) {
	if input.Current == nil {
		return TriggerInput{}, fmt.Errorf("%w: current market evidence is required", ErrBadRequest)
	}
	current, ok := normalizeEvidencePoint(*input.Current)
	if !ok {
		return TriggerInput{}, fmt.Errorf("%w: current market evidence is invalid", ErrBadRequest)
	}
	input.Current = &current
	if input.Previous != nil {
		previous, ok := normalizeEvidencePoint(*input.Previous)
		if !ok || previous.Timestamp > current.Timestamp {
			return TriggerInput{}, fmt.Errorf("%w: previous market evidence is invalid or out of order", ErrBadRequest)
		}
		input.Previous = &previous
	}
	if input.ArmingRevision <= 0 {
		return TriggerInput{}, fmt.Errorf("%w: armingRevision is required", ErrBadRequest)
	}
	if input.TriggerPrice != nil && !validPrice(*input.TriggerPrice) {
		return TriggerInput{}, fmt.Errorf("%w: triggerPrice must be greater than zero", ErrBadRequest)
	}
	if input.TargetPrice != nil && !validPrice(*input.TargetPrice) {
		return TriggerInput{}, fmt.Errorf("%w: targetPrice must be greater than zero", ErrBadRequest)
	}
	return input, nil
}

func lineTargetAt(target *DynamicLineTarget, marketTime float64) technicalTargetAt {
	if target == nil {
		return technicalTargetAt{Reason: targetInvalid}
	}
	timestamp := normalizeEpochSeconds(marketTime)
	start := float64(target.A.Time)
	end := float64(target.B.Time)
	if !finite(timestamp) || !finite(start) || !finite(end) ||
		!validPrice(target.A.Price) || !validPrice(target.B.Price) || start == end {
		return technicalTargetAt{Reason: targetInvalid}
	}

	direction := math.Copysign(1, end-start)
	if target.Domain == "segment" {
		if timestamp < math.Min(start, end) {
			return technicalTargetAt{Reason: targetBeforeDomain}
		}
		if timestamp > math.Max(start, end) {
			return technicalTargetAt{Reason: targetExpired}
		}
	} else if target.Domain == "ray" && (timestamp-start)*direction < 0 {
		if direction > 0 {
			return technicalTargetAt{Reason: targetBeforeDomain}
		}
		return technicalTargetAt{Reason: targetExpired}
	}

	ratio := (timestamp - start) / (end - start)
	price := target.A.Price + (target.B.Price-target.A.Price)*ratio
	if target.Interpolation == "log" {
		price = math.Exp(math.Log(target.A.Price) +
			(math.Log(target.B.Price)-math.Log(target.A.Price))*ratio)
	}
	if !validPrice(price) {
		return technicalTargetAt{Reason: targetInvalid}
	}
	return technicalTargetAt{Active: true, Lower: price, Upper: price}
}

func targetAt(target *TechnicalAlertTarget, marketTime float64) technicalTargetAt {
	if target == nil {
		return technicalTargetAt{Reason: targetInvalid}
	}
	if target.Kind == "fixed-price" {
		if target.Price == nil || !validPrice(*target.Price) {
			return technicalTargetAt{Reason: targetInvalid}
		}
		return technicalTargetAt{Active: true, Lower: *target.Price, Upper: *target.Price}
	}
	if target.Kind == "dynamic-line" {
		if target.A == nil || target.B == nil {
			return technicalTargetAt{Reason: targetInvalid}
		}
		return lineTargetAt(&DynamicLineTarget{
			Version: target.Version, Kind: target.Kind, A: *target.A, B: *target.B,
			Domain: target.Domain, Interpolation: target.Interpolation,
		}, marketTime)
	}
	if target.Kind != "dynamic-channel" {
		return technicalTargetAt{Reason: targetInvalid}
	}
	a := lineTargetAt(target.BoundaryA, marketTime)
	if !a.Active {
		return a
	}
	b := lineTargetAt(target.BoundaryB, marketTime)
	if !b.Active {
		return b
	}
	return technicalTargetAt{
		Active: true,
		Lower:  math.Min(a.Lower, b.Lower),
		Upper:  math.Max(a.Upper, b.Upper),
	}
}

func signedDistance(price, boundaryPrice float64) float64 {
	return price - boundaryPrice
}

func channelLocation(price, lower, upper float64) string {
	if price < lower {
		return "below"
	}
	if price > upper {
		return "above"
	}
	return "inside"
}

func boundaryForChannel(target *TechnicalAlertTarget, current technicalTargetAt, price float64) float64 {
	if target.Operator == "cross-upper-up" || target.Operator == "cross-upper-down" {
		return current.Upper
	}
	if target.Operator == "cross-lower-up" || target.Operator == "cross-lower-down" {
		return current.Lower
	}
	if math.Abs(price-current.Lower) <= math.Abs(price-current.Upper) {
		return current.Lower
	}
	return current.Upper
}

// evaluateTechnicalAlert intentionally mirrors the TypeScript evaluator. It
// has no database, clock, chart, or transport dependencies so cross-language
// golden vectors can lock the formulas and equality rules.
func evaluateTechnicalAlert(
	condition string,
	target *TechnicalAlertTarget,
	previous *TechnicalEvidencePoint,
	current TechnicalEvidencePoint,
) technicalEvaluation {
	current, ok := normalizeEvidencePoint(current)
	if !ok {
		return technicalEvaluation{Reason: targetInvalid}
	}
	currentTarget := targetAt(target, current.Timestamp)
	if !currentTarget.Active {
		return technicalEvaluation{Reason: currentTarget.Reason}
	}

	if target.Kind != "dynamic-channel" {
		targetPrice := currentTarget.Lower
		if condition == "above" {
			return technicalEvaluation{Triggered: current.Price >= targetPrice, TargetPrice: targetPrice, Active: true}
		}
		if condition == "below" {
			return technicalEvaluation{Triggered: current.Price <= targetPrice, TargetPrice: targetPrice, Active: true}
		}
		if previous == nil {
			return technicalEvaluation{TargetPrice: targetPrice, Active: true}
		}
		before, ok := normalizeEvidencePoint(*previous)
		if !ok {
			return technicalEvaluation{TargetPrice: targetPrice, Active: true}
		}
		previousTarget := targetAt(target, before.Timestamp)
		if !previousTarget.Active {
			return technicalEvaluation{TargetPrice: targetPrice, Active: true}
		}
		previousDistance := signedDistance(before.Price, previousTarget.Lower)
		currentDistance := signedDistance(current.Price, targetPrice)
		triggered := condition == "crossUp" && previousDistance < 0 && currentDistance >= 0
		if condition == "crossDown" {
			triggered = previousDistance > 0 && currentDistance <= 0
		}
		return technicalEvaluation{Triggered: triggered, TargetPrice: targetPrice, Active: true}
	}

	targetPrice := boundaryForChannel(target, currentTarget, current.Price)
	currentLocation := channelLocation(current.Price, currentTarget.Lower, currentTarget.Upper)
	if target.Operator == "inside" {
		return technicalEvaluation{Triggered: currentLocation == "inside", TargetPrice: targetPrice, Active: true}
	}
	if target.Operator == "outside" {
		return technicalEvaluation{Triggered: currentLocation != "inside", TargetPrice: targetPrice, Active: true}
	}
	if previous == nil {
		return technicalEvaluation{TargetPrice: targetPrice, Active: true}
	}
	beforePoint, ok := normalizeEvidencePoint(*previous)
	if !ok {
		return technicalEvaluation{TargetPrice: targetPrice, Active: true}
	}
	previousTarget := targetAt(target, beforePoint.Timestamp)
	if !previousTarget.Active {
		return technicalEvaluation{TargetPrice: targetPrice, Active: true}
	}
	previousLocation := channelLocation(beforePoint.Price, previousTarget.Lower, previousTarget.Upper)
	if target.Operator == "enter" || target.Operator == "exit" {
		triggered := previousLocation != "inside" && currentLocation == "inside"
		if target.Operator == "exit" {
			triggered = previousLocation == "inside" && currentLocation != "inside"
		}
		return technicalEvaluation{Triggered: triggered, TargetPrice: targetPrice, Active: true}
	}

	upper := target.Operator == "cross-upper-up" || target.Operator == "cross-upper-down"
	boundaryBefore := previousTarget.Lower
	boundaryNow := currentTarget.Lower
	if upper {
		boundaryBefore = previousTarget.Upper
		boundaryNow = currentTarget.Upper
	}
	beforeDistance := signedDistance(beforePoint.Price, boundaryBefore)
	currentDistance := signedDistance(current.Price, boundaryNow)
	triggered := (target.Operator == "cross-upper-up" || target.Operator == "cross-lower-up") &&
		beforeDistance < 0 && currentDistance >= 0
	if target.Operator == "cross-upper-down" || target.Operator == "cross-lower-down" {
		triggered = beforeDistance > 0 && currentDistance <= 0
	}
	return technicalEvaluation{Triggered: triggered, TargetPrice: boundaryNow, Active: true}
}

func fixedTechnicalTarget(price float64) *TechnicalAlertTarget {
	return &TechnicalAlertTarget{Version: 1, Kind: "fixed-price", Price: &price}
}

func evidenceTimestamp(value float64) time.Time {
	seconds, fraction := math.Modf(normalizeEpochSeconds(value))
	return time.Unix(int64(seconds), int64(math.Round(fraction*float64(time.Second)))).UTC()
}

func nearlyEqual(a, b float64) bool {
	scale := math.Max(1, math.Max(math.Abs(a), math.Abs(b)))
	return math.Abs(a-b) <= 1e-9*scale
}

func finite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}
