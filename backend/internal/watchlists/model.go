package watchlists

import "errors"

var (
	// ErrNotFound is returned when a watchlist does not exist or belongs to
	// another user (cross-user access is a 404, never a 403, to avoid leaking
	// existence — API.md §Conventions).
	ErrNotFound = errors.New("watchlists: not found")
	// ErrBadRequest is returned for invalid input (empty name/symbol).
	ErrBadRequest = errors.New("watchlists: bad request")
)

// WatchlistSection is a TradingView-style divider row anchored at a symbol
// insertion index. It lets the frontend restore grouped watchlist layout without
// browser localStorage.
type WatchlistSection struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Index int    `json:"index"`
}

// WatchlistLayout is the full mutable list body used by drag/drop, clear,
// add/remove symbol, and section actions. Sending the whole layout keeps every
// frontend gesture backed by one common backend write path.
type WatchlistLayout struct {
	Symbols  []string           `json:"symbols"`
	Sections []WatchlistSection `json:"sections"`
}

// Watchlist is a named list with ordered symbols and section dividers.
type Watchlist struct {
	ID       string             `json:"id"`
	Name     string             `json:"name"`
	Position int                `json:"position"`
	Symbols  []string           `json:"symbols"`
	Sections []WatchlistSection `json:"sections"`
	Shared   bool               `json:"shared"`
	Active   bool               `json:"active,omitempty"`
	SortKey  string             `json:"sortKey"`
	SortDir  string             `json:"sortDir"`
}
