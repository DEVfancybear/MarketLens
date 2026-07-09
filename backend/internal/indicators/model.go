package indicators

import (
	"encoding/json"
	"errors"
	"time"
)

var (
	ErrNotFound   = errors.New("indicators: not found")
	ErrBadRequest = errors.New("indicators: bad request")
)

// IndicatorPreset is server metadata around the opaque frontend
// IndicatorConfig payload. clientID is the frontend IndicatorConfig.id and is
// used so repeated create/update attempts converge instead of duplicating rows.
type IndicatorPreset struct {
	ID            string          `json:"id"`
	IndicatorType string          `json:"indicatorType"`
	ScriptID      string          `json:"scriptId,omitempty"`
	Config        json.RawMessage `json:"config"`
	Visible       bool            `json:"visible"`
	Position      int             `json:"position"`
	ClientID      string          `json:"clientId,omitempty"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
}

type IndicatorWrite struct {
	IndicatorType string          `json:"indicatorType"`
	ScriptID      string          `json:"scriptId,omitempty"`
	Config        json.RawMessage `json:"config"`
	Visible       *bool           `json:"visible,omitempty"`
	Position      int             `json:"position"`
	ClientID      string          `json:"clientId,omitempty"`
}
