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

// Watchlist is a named list with its ordered symbols.
type Watchlist struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Position int      `json:"position"`
	Symbols  []string `json:"symbols"`
}
