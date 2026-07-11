package journal

import (
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
)

var (
	ErrNotFound   = errors.New("journal: not found")
	ErrBadRequest = errors.New("journal: bad request")
)

const (
	DefaultLimit = 50
	MaxLimit     = 100
	MaxNotesLen  = 20_000
	MaxTags      = 50
)

type Screenshot struct {
	ID             string    `json:"id"`
	JournalEntryID string    `json:"journalEntryId"`
	Phase          string    `json:"phase"`
	StorageKey     string    `json:"storageKey,omitempty"`
	Width          *int      `json:"width,omitempty"`
	Height         *int      `json:"height,omitempty"`
	SizeBytes      *int64    `json:"sizeBytes,omitempty"`
	ContentType    string    `json:"contentType"`
	CreatedAt      time.Time `json:"createdAt"`
}

type Entry struct {
	ID          string       `json:"id"`
	ClientID    string       `json:"clientId,omitempty"`
	Symbol      string       `json:"symbol"`
	Side        string       `json:"side"`
	EntryTime   time.Time    `json:"entryTime"`
	ExitTime    *time.Time   `json:"exitTime,omitempty"`
	EntryPrice  float64      `json:"entryPrice"`
	ExitPrice   *float64     `json:"exitPrice,omitempty"`
	Quantity    float64      `json:"quantity"`
	PnL         *float64     `json:"pnl,omitempty"`
	RR          *float64     `json:"rr,omitempty"`
	RiskAmount  *float64     `json:"riskAmount,omitempty"`
	Notes       string       `json:"notes,omitempty"`
	Tags        []string     `json:"tags"`
	PositionID  *string      `json:"positionId,omitempty"`
	Screenshots []Screenshot `json:"screenshots"`
	CreatedAt   time.Time    `json:"createdAt"`
	UpdatedAt   time.Time    `json:"updatedAt"`
}

type CreateInput struct {
	ClientID   string     `json:"clientId"`
	Symbol     string     `json:"symbol"`
	Side       string     `json:"side"`
	EntryTime  time.Time  `json:"entryTime"`
	ExitTime   *time.Time `json:"exitTime"`
	EntryPrice float64    `json:"entryPrice"`
	ExitPrice  *float64   `json:"exitPrice"`
	Quantity   float64    `json:"quantity"`
	PnL        *float64   `json:"pnl"`
	RR         *float64   `json:"rr"`
	RiskAmount *float64   `json:"riskAmount"`
	Notes      string     `json:"notes"`
	Tags       []string   `json:"tags"`
	PositionID *string    `json:"positionId"`
}

type UpdateInput struct {
	Symbol     *string    `json:"symbol"`
	Side       *string    `json:"side"`
	EntryTime  *time.Time `json:"entryTime"`
	ExitTime   *time.Time `json:"exitTime"`
	EntryPrice *float64   `json:"entryPrice"`
	ExitPrice  *float64   `json:"exitPrice"`
	Quantity   *float64   `json:"quantity"`
	PnL        *float64   `json:"pnl"`
	RR         *float64   `json:"rr"`
	RiskAmount *float64   `json:"riskAmount"`
	Notes      *string    `json:"notes"`
	Tags       *[]string  `json:"tags"`
}

type ListFilter struct {
	Symbol string
	Tag    string
	Before *time.Time
	Limit  int
}

type ScreenshotInput struct {
	JournalEntryID string `json:"journalEntryId"`
	Phase          string `json:"phase"`
	StorageKey     string `json:"storageKey"`
	Width          *int   `json:"width"`
	Height         *int   `json:"height"`
	SizeBytes      *int64 `json:"sizeBytes"`
	ContentType    string `json:"contentType"`
}

type UploadURLInput struct {
	ContentType string `json:"contentType"`
}

func normalizeCreate(in CreateInput) (CreateInput, error) {
	in.ClientID = strings.TrimSpace(in.ClientID)
	in.Symbol = strings.TrimSpace(in.Symbol)
	in.Side = strings.ToLower(strings.TrimSpace(in.Side))
	in.Notes = strings.TrimSpace(in.Notes)
	in.Tags = normalizeTags(in.Tags)
	if in.Symbol == "" || len(in.Symbol) > 80 {
		return CreateInput{}, fmt.Errorf("%w: symbol is required and must be at most 80 characters", ErrBadRequest)
	}
	if in.Side != "long" && in.Side != "short" {
		return CreateInput{}, fmt.Errorf("%w: side must be long or short", ErrBadRequest)
	}
	if in.EntryTime.IsZero() {
		return CreateInput{}, fmt.Errorf("%w: entryTime is required", ErrBadRequest)
	}
	if !positive(in.EntryPrice) || !positive(in.Quantity) {
		return CreateInput{}, fmt.Errorf("%w: entryPrice and quantity must be greater than zero", ErrBadRequest)
	}
	if in.ExitPrice != nil && !positive(*in.ExitPrice) {
		return CreateInput{}, fmt.Errorf("%w: exitPrice must be greater than zero", ErrBadRequest)
	}
	if in.RiskAmount != nil && (!finite(*in.RiskAmount) || *in.RiskAmount < 0) {
		return CreateInput{}, fmt.Errorf("%w: riskAmount cannot be negative", ErrBadRequest)
	}
	if (in.PnL != nil && !finite(*in.PnL)) || (in.RR != nil && !finite(*in.RR)) {
		return CreateInput{}, fmt.Errorf("%w: pnl and rr must be finite", ErrBadRequest)
	}
	if len(in.Notes) > MaxNotesLen || len(in.Tags) > MaxTags {
		return CreateInput{}, fmt.Errorf("%w: notes or tags exceed the allowed limit", ErrBadRequest)
	}
	return in, nil
}

func normalizeUpdate(in UpdateInput) (UpdateInput, error) {
	base := CreateInput{Symbol: "placeholder", Side: "long", EntryTime: time.Now(), EntryPrice: 1, Quantity: 1}
	if in.Symbol != nil {
		base.Symbol = *in.Symbol
	}
	if in.Side != nil {
		base.Side = *in.Side
	}
	if in.EntryTime != nil {
		base.EntryTime = *in.EntryTime
	}
	if in.EntryPrice != nil {
		base.EntryPrice = *in.EntryPrice
	}
	if in.Quantity != nil {
		base.Quantity = *in.Quantity
	}
	base.ExitTime, base.ExitPrice, base.PnL, base.RR, base.RiskAmount = in.ExitTime, in.ExitPrice, in.PnL, in.RR, in.RiskAmount
	if in.Notes != nil {
		base.Notes = *in.Notes
	}
	if in.Tags != nil {
		base.Tags = *in.Tags
	}
	normalized, err := normalizeCreate(base)
	if err != nil {
		return UpdateInput{}, err
	}
	if in.Symbol != nil {
		in.Symbol = &normalized.Symbol
	}
	if in.Side != nil {
		in.Side = &normalized.Side
	}
	if in.Notes != nil {
		in.Notes = &normalized.Notes
	}
	if in.Tags != nil {
		in.Tags = &normalized.Tags
	}
	return in, nil
}

func normalizeScreenshot(in ScreenshotInput) (ScreenshotInput, error) {
	in.JournalEntryID = strings.TrimSpace(in.JournalEntryID)
	in.StorageKey = strings.TrimLeft(strings.TrimSpace(in.StorageKey), "/")
	in.ContentType = strings.ToLower(strings.TrimSpace(in.ContentType))
	if in.ContentType == "" {
		in.ContentType = "image/png"
	}
	if in.JournalEntryID == "" || in.StorageKey == "" || strings.Contains(in.StorageKey, "..") {
		return ScreenshotInput{}, fmt.Errorf("%w: journalEntryId and storageKey are required", ErrBadRequest)
	}
	if in.Phase != "before" && in.Phase != "after-entry" && in.Phase != "after-exit" {
		return ScreenshotInput{}, fmt.Errorf("%w: invalid screenshot phase", ErrBadRequest)
	}
	if !strings.HasPrefix(in.ContentType, "image/") {
		return ScreenshotInput{}, fmt.Errorf("%w: contentType must be an image", ErrBadRequest)
	}
	if (in.Width != nil && *in.Width <= 0) || (in.Height != nil && *in.Height <= 0) || (in.SizeBytes != nil && *in.SizeBytes < 0) {
		return ScreenshotInput{}, fmt.Errorf("%w: invalid screenshot dimensions or size", ErrBadRequest)
	}
	return in, nil
}

func normalizeTags(tags []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(tags))
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag == "" {
			continue
		}
		if len(tag) > 80 {
			tag = tag[:80]
		}
		if _, ok := seen[tag]; ok {
			continue
		}
		seen[tag] = struct{}{}
		out = append(out, tag)
	}
	return out
}

func finite(value float64) bool   { return !math.IsNaN(value) && !math.IsInf(value, 0) }
func positive(value float64) bool { return value > 0 && finite(value) }
func normalizeLimit(limit int) int {
	if limit <= 0 {
		return DefaultLimit
	}
	if limit > MaxLimit {
		return MaxLimit
	}
	return limit
}
