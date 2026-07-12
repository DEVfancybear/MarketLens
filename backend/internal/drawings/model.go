package drawings

import (
	"encoding/json"
	"errors"
	"time"
)

var (
	// ErrNotFound is returned for missing rows and cross-user access. The HTTP
	// layer maps this to 404 to avoid leaking another user's object ids.
	ErrNotFound = errors.New("drawings: not found")
	// ErrBadRequest is returned when required fields are missing or malformed.
	ErrBadRequest = errors.New("drawings: bad request")
	// ErrConflict indicates an optimistic revision precondition failed.
	ErrConflict = errors.New("drawings: revision conflict")
)

// Drawing is the server-owned metadata around an opaque frontend Drawing
// payload. The backend stores payload untouched; clientID is the frontend
// Drawing.id used to make sync retries idempotent.
type Drawing struct {
	ID             string          `json:"id"`
	Symbol         string          `json:"symbol"`
	ToolType       string          `json:"toolType"`
	Payload        json.RawMessage `json:"payload"`
	Locked         bool            `json:"locked"`
	Hidden         bool            `json:"hidden"`
	ClientID       string          `json:"clientId,omitempty"`
	Revision       int64           `json:"revision"`
	ClientRevision int64           `json:"clientRevision,omitempty"`
	DeletedAt      *time.Time      `json:"deletedAt,omitempty"`
	CreatedAt      time.Time       `json:"createdAt"`
	UpdatedAt      time.Time       `json:"updatedAt"`
}

type DrawingWrite struct {
	Symbol           string          `json:"symbol"`
	ToolType         string          `json:"toolType"`
	Payload          json.RawMessage `json:"payload"`
	Locked           bool            `json:"locked"`
	Hidden           bool            `json:"hidden"`
	ClientID         string          `json:"clientId,omitempty"`
	ClientRevision   int64           `json:"clientRevision,omitempty"`
	ExpectedRevision *int64          `json:"expectedRevision,omitempty"`
}

type DrawingPatch struct {
	Symbol           *string          `json:"symbol,omitempty"`
	ToolType         *string          `json:"toolType,omitempty"`
	Payload          *json.RawMessage `json:"payload,omitempty"`
	Locked           *bool            `json:"locked,omitempty"`
	Hidden           *bool            `json:"hidden,omitempty"`
	ClientID         *string          `json:"clientId,omitempty"`
	ClientRevision   *int64           `json:"clientRevision,omitempty"`
	ExpectedRevision *int64           `json:"expectedRevision,omitempty"`
}

type DrawingDelete struct {
	ID               string `json:"id,omitempty"`
	ClientID         string `json:"clientId,omitempty"`
	Symbol           string `json:"symbol,omitempty"`
	ExpectedRevision *int64 `json:"expectedRevision,omitempty"`
}

type BatchRequest struct {
	Upserts []DrawingWrite  `json:"upserts"`
	Deletes []DrawingDelete `json:"deletes"`
}

type BatchResponse struct {
	Upserted []Drawing `json:"upserted"`
	Deleted  int       `json:"deleted"`
}

// DrawingTemplate stores global style presets. Style is opaque and normally
// contains only DrawingTemplate fields from the frontend, never points or ids.
type DrawingTemplate struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Family    string          `json:"family"`
	Style     json.RawMessage `json:"style"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

type DrawingTemplateWrite struct {
	Name   string          `json:"name"`
	Family string          `json:"family"`
	Style  json.RawMessage `json:"style"`
}

// DrawingToolFavorites stores the ordered tool ids starred in the drawing
// toolbar. The backend does not validate tool ids because the frontend owns the
// tool registry and can evolve it without a schema migration.
type DrawingToolFavorites struct {
	Tools     []string  `json:"tools"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type DrawingToolFavoritesWrite struct {
	Tools []string `json:"tools"`
}
