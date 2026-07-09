package pinescripts

import (
	"encoding/json"
	"errors"
	"time"
)

const MaxSourceBytes = 64 * 1024

var (
	ErrNotFound   = errors.New("pine scripts: not found")
	ErrBadRequest = errors.New("pine scripts: bad request")
)

// Script is the saved Pine-like source model. List responses omit SourceCode so
// the script browser remains light; get/create/update responses include it.
type Script struct {
	ID         string          `json:"id"`
	Name       string          `json:"name"`
	SourceCode string          `json:"sourceCode,omitempty"`
	Favorite   bool            `json:"favorite"`
	Meta       json.RawMessage `json:"meta,omitempty"`
	ClientID   string          `json:"clientId,omitempty"`
	CreatedAt  time.Time       `json:"createdAt"`
	UpdatedAt  time.Time       `json:"updatedAt"`
}

type ScriptWrite struct {
	Name       *string         `json:"name,omitempty"`
	SourceCode *string         `json:"sourceCode,omitempty"`
	Favorite   *bool           `json:"favorite,omitempty"`
	Meta       json.RawMessage `json:"meta,omitempty"`
	ClientID   string          `json:"clientId,omitempty"`
}

// PublicScript is a published Pine script visible in the unauthenticated
// indicator store. Store rows intentionally include sourceCode so the frontend
// can add a public script to the chart without a second private lookup.
type PublicScript struct {
	ID         string          `json:"id"`
	ScriptID   string          `json:"scriptId"`
	Name       string          `json:"name"`
	SourceCode string          `json:"sourceCode"`
	AuthorID   string          `json:"authorId"`
	Author     string          `json:"author"`
	Boosts     int             `json:"boosts"`
	Meta       json.RawMessage `json:"meta,omitempty"`
	CreatedAt  time.Time       `json:"createdAt"`
	UpdatedAt  time.Time       `json:"updatedAt"`
}

type PublishRequest struct {
	Name *string `json:"name,omitempty"`
}
