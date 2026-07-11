package layouts

import (
	"encoding/json"
	"errors"
	"time"
)

var (
	ErrNotFound   = errors.New("layouts: not found")
	ErrBadRequest = errors.New("layouts: bad request")
)

// Layout stores a complete, opaque frontend chart workspace snapshot.
type Layout struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Symbol    string          `json:"symbol,omitempty"`
	Timeframe string          `json:"timeframe,omitempty"`
	State     json.RawMessage `json:"state"`
	IsDefault bool            `json:"isDefault"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

type Write struct {
	Name      string          `json:"name"`
	Symbol    string          `json:"symbol,omitempty"`
	Timeframe string          `json:"timeframe,omitempty"`
	State     json.RawMessage `json:"state"`
	IsDefault bool            `json:"isDefault"`
}
