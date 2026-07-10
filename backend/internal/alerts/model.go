package alerts

import (
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
)

var (
	ErrNotFound   = errors.New("alerts: not found")
	ErrBadRequest = errors.New("alerts: bad request")
)

const (
	MaxHistory  = 200
	MaxNoteLen  = 500
	MaxTokenLen = 4096
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

type Alert struct {
	ID           string     `json:"id"`
	ClientID     string     `json:"clientId,omitempty"`
	Symbol       string     `json:"symbol"`
	Condition    string     `json:"condition"`
	Price        float64    `json:"price"`
	Note         string     `json:"note,omitempty"`
	Status       string     `json:"status"`
	Enabled      bool       `json:"enabled"`
	Locked       bool       `json:"locked"`
	Recurring    bool       `json:"recurring"`
	Channels     Channels   `json:"channels"`
	TriggerPrice *float64   `json:"triggerPrice,omitempty"`
	TriggeredAt  *time.Time `json:"triggeredAt,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
}

type Event struct {
	ID           string    `json:"id"`
	AlertID      string    `json:"alertId"`
	Symbol       string    `json:"symbol"`
	Condition    string    `json:"condition"`
	TargetPrice  float64   `json:"targetPrice"`
	TriggerPrice float64   `json:"triggerPrice"`
	TriggeredAt  time.Time `json:"triggeredAt"`
	Delivered    bool      `json:"delivered"`
}

type Snapshot struct {
	Alerts          []Alert `json:"alerts"`
	TriggeredAlerts []Alert `json:"triggeredAlerts"`
	History         []Event `json:"history"`
}

type CreateInput struct {
	ClientID  string    `json:"clientId"`
	Symbol    string    `json:"symbol"`
	Condition string    `json:"condition"`
	Price     float64   `json:"price"`
	Note      string    `json:"note"`
	Recurring bool      `json:"recurring"`
	Enabled   *bool     `json:"enabled"`
	Locked    bool      `json:"locked"`
	Channels  *Channels `json:"channels"`
}

type PatchInput struct {
	Symbol    *string       `json:"symbol"`
	Condition *string       `json:"condition"`
	Price     *float64      `json:"price"`
	Note      *string       `json:"note"`
	Status    *string       `json:"status"`
	Enabled   *bool         `json:"enabled"`
	Locked    *bool         `json:"locked"`
	Recurring *bool         `json:"recurring"`
	Channels  *ChannelPatch `json:"channels"`
}

type TriggerInput struct {
	TriggerPrice float64 `json:"triggerPrice"`
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
		if value != "active" {
			return PatchInput{}, fmt.Errorf("%w: status patch only supports active; use the trigger endpoint", ErrBadRequest)
		}
		input.Status = &value
	}
	return input, nil
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
