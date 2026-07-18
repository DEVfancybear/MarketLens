package alerts

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"strings"
	"time"
)

var (
	ErrNotFound         = errors.New("alerts: not found")
	ErrBadRequest       = errors.New("alerts: bad request")
	ErrAlreadyTriggered = fmt.Errorf("%w: trigger already persisted", ErrBadRequest)
)

const (
	MaxHistory  = 200
	MaxNoteLen  = 500
	MaxTokenLen = 4096
	// MaxTechnicalTargetBytes bounds the immutable geometry snapshot accepted at
	// the API boundary. The version-1 DTO is intentionally small; this leaves
	// room for future optional metadata without accepting arbitrary JSON blobs.
	MaxTechnicalTargetBytes = 16 * 1024
)

type Channels struct {
	Sound    bool `json:"sound"`
	Browser  bool `json:"browser"`
	Push     bool `json:"push"`
	Telegram bool `json:"telegram"`
	Discord  bool `json:"discord"`
}

type ChannelPatch struct {
	Sound    *bool `json:"sound"`
	Browser  *bool `json:"browser"`
	Push     *bool `json:"push"`
	Telegram *bool `json:"telegram"`
	Discord  *bool `json:"discord"`
}

type AlertSource struct {
	Kind        string `json:"kind"`
	DrawingID   string `json:"drawingId"`
	DrawingTool string `json:"drawingTool"`
	TargetID    string `json:"targetId"`
	TargetLabel string `json:"targetLabel"`
	SnapshotAt  int64  `json:"snapshotAt"`
}

// TechnicalAlertPoint is an immutable chart-time/data-price coordinate. Time
// uses the same UTC epoch contract as drawing anchors; it is not a receive-time
// cursor or a viewport pixel coordinate.
type TechnicalAlertPoint struct {
	Time  int64   `json:"time"`
	Price float64 `json:"price"`
}

// DynamicLineTarget is also used as each complete boundary of a channel. Kind
// and Version are repeated in nested channel boundaries so every boundary is a
// self-describing, independently evaluable snapshot.
type DynamicLineTarget struct {
	Version       int                 `json:"version"`
	Kind          string              `json:"kind"`
	A             TechnicalAlertPoint `json:"a"`
	B             TechnicalAlertPoint `json:"b"`
	Domain        string              `json:"domain"`
	Interpolation string              `json:"interpolation"`
}

// TechnicalAlertTarget is the versioned persistence union for fixed prices,
// moving lines, and channels. Fields that do not belong to the selected Kind
// are rejected by validation rather than silently changing its interpretation.
type TechnicalAlertTarget struct {
	Version       int                  `json:"version"`
	Kind          string               `json:"kind"`
	Price         *float64             `json:"price,omitempty"`
	A             *TechnicalAlertPoint `json:"a,omitempty"`
	B             *TechnicalAlertPoint `json:"b,omitempty"`
	Domain        string               `json:"domain,omitempty"`
	Interpolation string               `json:"interpolation,omitempty"`
	BoundaryA     *DynamicLineTarget   `json:"boundaryA,omitempty"`
	BoundaryB     *DynamicLineTarget   `json:"boundaryB,omitempty"`
	Operator      string               `json:"operator,omitempty"`
}

// UnmarshalJSON keeps technical_target bounded and rejects misspelled or
// unversioned geometry fields instead of persisting an unevaluable snapshot.
func (target *TechnicalAlertTarget) UnmarshalJSON(data []byte) error {
	if len(data) > MaxTechnicalTargetBytes {
		return fmt.Errorf("technicalTarget exceeds %d bytes", MaxTechnicalTargetBytes)
	}
	type targetAlias TechnicalAlertTarget
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var decoded targetAlias
	if err := decoder.Decode(&decoded); err != nil {
		return err
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return err
	}
	*target = TechnicalAlertTarget(decoded)
	return nil
}

type Alert struct {
	ID              string                `json:"id"`
	ClientID        string                `json:"clientId,omitempty"`
	Symbol          string                `json:"symbol"`
	Condition       string                `json:"condition"`
	Price           float64               `json:"price"`
	Note            string                `json:"note,omitempty"`
	Status          string                `json:"status"`
	Enabled         bool                  `json:"enabled"`
	Locked          bool                  `json:"locked"`
	Recurring       bool                  `json:"recurring"`
	Channels        Channels              `json:"channels"`
	TriggerPrice    *float64              `json:"triggerPrice,omitempty"`
	TriggeredAt     *time.Time            `json:"triggeredAt,omitempty"`
	CreatedAt       time.Time             `json:"createdAt"`
	UpdatedAt       time.Time             `json:"updatedAt"`
	Source          *AlertSource          `json:"source,omitempty"`
	TechnicalTarget *TechnicalAlertTarget `json:"technicalTarget,omitempty"`
	ArmingRevision  int64                 `json:"armingRevision"`
}

type Event struct {
	ID             string    `json:"id"`
	AlertID        string    `json:"alertId"`
	Symbol         string    `json:"symbol"`
	Condition      string    `json:"condition"`
	TargetPrice    float64   `json:"targetPrice"`
	TriggerPrice   float64   `json:"triggerPrice"`
	TriggeredAt    time.Time `json:"triggeredAt"`
	Delivered      bool      `json:"delivered"`
	ArmingRevision int64     `json:"armingRevision"`
}

type Snapshot struct {
	Alerts          []Alert `json:"alerts"`
	TriggeredAlerts []Alert `json:"triggeredAlerts"`
	ExpiredAlerts   []Alert `json:"expiredAlerts"`
	History         []Event `json:"history"`
}

type CreateInput struct {
	ClientID        string                `json:"clientId"`
	Symbol          string                `json:"symbol"`
	Condition       string                `json:"condition"`
	Price           float64               `json:"price"`
	Note            string                `json:"note"`
	Recurring       bool                  `json:"recurring"`
	Enabled         *bool                 `json:"enabled"`
	Locked          bool                  `json:"locked"`
	Channels        *Channels             `json:"channels"`
	Source          *AlertSource          `json:"source"`
	TechnicalTarget *TechnicalAlertTarget `json:"technicalTarget"`
}

type PatchInput struct {
	Symbol          *string               `json:"symbol"`
	Condition       *string               `json:"condition"`
	Price           *float64              `json:"price"`
	Note            *string               `json:"note"`
	Status          *string               `json:"status"`
	Enabled         *bool                 `json:"enabled"`
	Locked          *bool                 `json:"locked"`
	Recurring       *bool                 `json:"recurring"`
	Channels        *ChannelPatch         `json:"channels"`
	TechnicalTarget *TechnicalAlertTarget `json:"technicalTarget"`
}

type TriggerInput struct {
	// TriggerPrice and TargetPrice are retained as compatibility claims only.
	// The repository never trusts them: it verifies either value, when present,
	// against Current and the immutable technical target respectively.
	TriggerPrice   *float64                `json:"triggerPrice,omitempty"`
	TargetPrice    *float64                `json:"targetPrice,omitempty"`
	Previous       *TechnicalEvidencePoint `json:"previous,omitempty"`
	Current        *TechnicalEvidencePoint `json:"current"`
	ArmingRevision int64                   `json:"armingRevision"`
}

// TechnicalEvidencePoint is a market observation used to verify a trigger.
// Timestamp is UTC epoch seconds. Fractional seconds are allowed so browser and
// worker evaluators do not lose ordering information when normalizing feeds.
type TechnicalEvidencePoint struct {
	Price     float64 `json:"price"`
	Timestamp float64 `json:"timestamp"`
}

type PushToken struct {
	ID         string    `json:"id"`
	FCMToken   string    `json:"fcmToken"`
	Platform   string    `json:"platform"`
	Permission string    `json:"permission"`
	CreatedAt  time.Time `json:"createdAt"`
	LastSeenAt time.Time `json:"lastSeenAt"`
}

type PushTokenInput struct {
	FCMToken   string `json:"fcmToken"`
	Platform   string `json:"platform"`
	Permission string `json:"permission"`
}

func normalizeCreate(input CreateInput) (CreateInput, error) {
	input.ClientID = strings.TrimSpace(input.ClientID)
	input.Symbol = strings.TrimSpace(input.Symbol)
	input.Condition = strings.TrimSpace(input.Condition)
	input.Note = strings.TrimSpace(input.Note)
	if input.Symbol == "" {
		return CreateInput{}, fmt.Errorf("%w: symbol is required", ErrBadRequest)
	}
	if !validCondition(input.Condition) {
		return CreateInput{}, fmt.Errorf("%w: unsupported condition %q", ErrBadRequest, input.Condition)
	}
	if !validPrice(input.Price) {
		return CreateInput{}, fmt.Errorf("%w: price must be greater than zero", ErrBadRequest)
	}
	if len(input.Note) > MaxNoteLen {
		return CreateInput{}, fmt.Errorf("%w: note exceeds %d characters", ErrBadRequest, MaxNoteLen)
	}
	if input.Enabled == nil {
		enabled := true
		input.Enabled = &enabled
	}
	if input.Channels == nil {
		input.Channels = &Channels{Sound: true}
	}
	if err := validateAlertSource(input.Source); err != nil {
		return CreateInput{}, err
	}
	if err := validateTechnicalTarget(input.TechnicalTarget); err != nil {
		return CreateInput{}, err
	}
	return input, nil
}

func normalizePatch(input PatchInput) (PatchInput, error) {
	if input.Symbol != nil {
		value := strings.TrimSpace(*input.Symbol)
		if value == "" {
			return PatchInput{}, fmt.Errorf("%w: symbol cannot be empty", ErrBadRequest)
		}
		input.Symbol = &value
	}
	if input.Condition != nil {
		value := strings.TrimSpace(*input.Condition)
		if !validCondition(value) {
			return PatchInput{}, fmt.Errorf("%w: unsupported condition %q", ErrBadRequest, value)
		}
		input.Condition = &value
	}
	if input.Price != nil && !validPrice(*input.Price) {
		return PatchInput{}, fmt.Errorf("%w: price must be greater than zero", ErrBadRequest)
	}
	if input.Note != nil {
		value := strings.TrimSpace(*input.Note)
		if len(value) > MaxNoteLen {
			return PatchInput{}, fmt.Errorf("%w: note exceeds %d characters", ErrBadRequest, MaxNoteLen)
		}
		input.Note = &value
	}
	if input.Status != nil {
		value := strings.TrimSpace(*input.Status)
		if value != "active" && value != "expired" {
			return PatchInput{}, fmt.Errorf("%w: status patch only supports active or expired; use the trigger endpoint for triggered", ErrBadRequest)
		}
		input.Status = &value
	}
	if err := validateTechnicalTarget(input.TechnicalTarget); err != nil {
		return PatchInput{}, err
	}
	return input, nil
}

func validateAlertSource(source *AlertSource) error {
	if source == nil {
		return nil
	}
	source.Kind = strings.TrimSpace(source.Kind)
	source.DrawingID = strings.TrimSpace(source.DrawingID)
	source.DrawingTool = strings.TrimSpace(source.DrawingTool)
	source.TargetID = strings.TrimSpace(source.TargetID)
	source.TargetLabel = strings.TrimSpace(source.TargetLabel)
	if source.Kind != "drawing" || source.DrawingID == "" || source.DrawingTool == "" ||
		source.TargetID == "" || source.TargetLabel == "" || source.SnapshotAt <= 0 {
		return fmt.Errorf("%w: drawing alert source is invalid", ErrBadRequest)
	}
	return nil
}

func validateTechnicalTarget(target *TechnicalAlertTarget) error {
	if target == nil {
		return nil
	}
	target.Kind = strings.TrimSpace(target.Kind)
	target.Domain = strings.TrimSpace(target.Domain)
	target.Interpolation = strings.TrimSpace(target.Interpolation)
	target.Operator = strings.TrimSpace(target.Operator)
	if target.Version != 1 {
		return fmt.Errorf("%w: technicalTarget version must be 1", ErrBadRequest)
	}
	switch target.Kind {
	case "fixed-price":
		if target.Price == nil || !validPrice(*target.Price) || target.A != nil || target.B != nil ||
			target.Domain != "" || target.Interpolation != "" || target.BoundaryA != nil ||
			target.BoundaryB != nil || target.Operator != "" {
			return fmt.Errorf("%w: fixed-price technicalTarget is invalid", ErrBadRequest)
		}
	case "dynamic-line":
		if target.Price != nil || target.A == nil || target.B == nil || target.BoundaryA != nil ||
			target.BoundaryB != nil || target.Operator != "" {
			return fmt.Errorf("%w: dynamic-line technicalTarget is invalid", ErrBadRequest)
		}
		line := DynamicLineTarget{
			Version: target.Version, Kind: target.Kind, A: *target.A, B: *target.B,
			Domain: target.Domain, Interpolation: target.Interpolation,
		}
		if err := validateDynamicLineTarget(&line); err != nil {
			return err
		}
		target.Domain = line.Domain
		target.Interpolation = line.Interpolation
	case "dynamic-channel":
		if target.Price != nil || target.A != nil || target.B != nil || target.Domain != "" ||
			target.Interpolation != "" || target.BoundaryA == nil || target.BoundaryB == nil ||
			!validChannelOperator(target.Operator) {
			return fmt.Errorf("%w: dynamic-channel technicalTarget is invalid", ErrBadRequest)
		}
		if err := validateDynamicLineTarget(target.BoundaryA); err != nil {
			return fmt.Errorf("%w: boundaryA: %v", ErrBadRequest, err)
		}
		if err := validateDynamicLineTarget(target.BoundaryB); err != nil {
			return fmt.Errorf("%w: boundaryB: %v", ErrBadRequest, err)
		}
		if target.BoundaryA.Domain != target.BoundaryB.Domain ||
			target.BoundaryA.Interpolation != target.BoundaryB.Interpolation {
			return fmt.Errorf("%w: channel boundaries must share domain and interpolation", ErrBadRequest)
		}
		if target.BoundaryA.A.Time != target.BoundaryB.A.Time ||
			target.BoundaryA.B.Time != target.BoundaryB.B.Time ||
			!parallelChannelSlopes(target.BoundaryA, target.BoundaryB) {
			return fmt.Errorf("%w: channel boundaries must use the same time anchors and be parallel", ErrBadRequest)
		}
	default:
		return fmt.Errorf("%w: unsupported technicalTarget kind %q", ErrBadRequest, target.Kind)
	}
	return nil
}

func parallelChannelSlopes(a, b *DynamicLineTarget) bool {
	price := func(value float64) float64 { return value }
	if a.Interpolation == "log" {
		price = math.Log
	}
	aSlope := (price(a.B.Price) - price(a.A.Price)) / float64(a.B.Time-a.A.Time)
	bSlope := (price(b.B.Price) - price(b.A.Price)) / float64(b.B.Time-b.A.Time)
	scale := math.Max(1, math.Max(math.Abs(aSlope), math.Abs(bSlope)))
	const float64Epsilon = 2.220446049250313e-16
	tolerance := float64Epsilon * 64 * scale
	return math.Abs(aSlope-bSlope) <= tolerance
}

func validateDynamicLineTarget(target *DynamicLineTarget) error {
	if target == nil || target.Version != 1 || strings.TrimSpace(target.Kind) != "dynamic-line" {
		return fmt.Errorf("%w: dynamic line version and kind are invalid", ErrBadRequest)
	}
	target.Kind = "dynamic-line"
	target.Domain = strings.TrimSpace(target.Domain)
	target.Interpolation = strings.TrimSpace(target.Interpolation)
	if target.A.Time <= 0 || target.B.Time <= 0 || target.A.Time == target.B.Time ||
		!validPrice(target.A.Price) || !validPrice(target.B.Price) {
		return fmt.Errorf("%w: dynamic line anchors are invalid", ErrBadRequest)
	}
	if target.Domain != "segment" && target.Domain != "ray" && target.Domain != "infinite" {
		return fmt.Errorf("%w: unsupported dynamic line domain %q", ErrBadRequest, target.Domain)
	}
	if target.Interpolation != "linear" && target.Interpolation != "log" {
		return fmt.Errorf("%w: unsupported dynamic line interpolation %q", ErrBadRequest, target.Interpolation)
	}
	return nil
}

func validChannelOperator(operator string) bool {
	switch operator {
	case "cross-upper-up", "cross-upper-down", "cross-lower-up", "cross-lower-down",
		"enter", "exit", "inside", "outside":
		return true
	default:
		return false
	}
}

func ensureJSONEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("technicalTarget contains multiple JSON values")
		}
		return err
	}
	return nil
}

func normalizePushToken(input PushTokenInput) (PushTokenInput, error) {
	input.FCMToken = strings.TrimSpace(input.FCMToken)
	input.Platform = strings.ToLower(strings.TrimSpace(input.Platform))
	input.Permission = strings.ToLower(strings.TrimSpace(input.Permission))
	if input.FCMToken == "" {
		return PushTokenInput{}, fmt.Errorf("%w: fcmToken is required", ErrBadRequest)
	}
	if len(input.FCMToken) > MaxTokenLen {
		return PushTokenInput{}, fmt.Errorf("%w: fcmToken is too long", ErrBadRequest)
	}
	if input.Platform == "" {
		input.Platform = "web"
	}
	if input.Platform != "web" && input.Platform != "android" && input.Platform != "ios" {
		return PushTokenInput{}, fmt.Errorf("%w: unsupported platform %q", ErrBadRequest, input.Platform)
	}
	if input.Permission != "granted" && input.Permission != "denied" && input.Permission != "default" {
		return PushTokenInput{}, fmt.Errorf("%w: unsupported permission %q", ErrBadRequest, input.Permission)
	}
	return input, nil
}

func validCondition(condition string) bool {
	switch condition {
	case "above", "below", "crossUp", "crossDown":
		return true
	default:
		return false
	}
}

func validPrice(price float64) bool {
	return price > 0 && !math.IsNaN(price) && !math.IsInf(price, 0)
}

func validTriggerPrice(condition string, target, trigger float64) bool {
	if !validPrice(target) || !validPrice(trigger) {
		return false
	}
	if condition == "above" || condition == "crossUp" {
		return trigger >= target
	}
	if condition == "below" || condition == "crossDown" {
		return trigger <= target
	}
	return false
}
