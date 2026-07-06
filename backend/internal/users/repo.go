// Package users owns the users + auth_identities persistence. Its Repo
// implements auth.UserUpserter; it depends on auth (for the User/Identity DTOs),
// never the reverse.
package users

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/smc-trading-terminal/backend/internal/auth"
	"github.com/smc-trading-terminal/backend/internal/db/gen"
)

// Repo persists users and their linked auth identities.
type Repo struct {
	pool *pgxpool.Pool
	q    *gen.Queries
}

func NewRepo(pool *pgxpool.Pool) *Repo {
	return &Repo{pool: pool, q: gen.New(pool)}
}

var _ auth.UserUpserter = (*Repo)(nil)

// UpsertFromIdentity finds or creates the user for a verified Google identity,
// all within a single transaction:
//   - identity (google, provider_uid) exists → login: refresh profile + last_login.
//   - else a user with the same email exists → link a new google identity to them.
//   - else → register a new user + identity.
//
// Returns (user, isNewUser). isNewUser is true only when a brand-new user row was
// created.
func (r *Repo) UpsertFromIdentity(ctx context.Context, id auth.Identity) (auth.User, bool, error) {
	if id.Email == "" {
		return auth.User{}, false, fmt.Errorf("%w: token has no email", auth.ErrUnauthorized)
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return auth.User{}, false, err
	}
	defer tx.Rollback(ctx)
	q := r.q.WithTx(tx)

	profile := rawProfile(id)

	// 1. Existing identity → login.
	ident, err := q.GetIdentityByProvider(ctx, gen.GetIdentityByProviderParams{
		Provider:    gen.AuthProviderGoogle,
		ProviderUid: id.ProviderUID,
	})
	if err == nil {
		user, err := q.UpdateUserProfile(ctx, gen.UpdateUserProfileParams{
			ID:            ident.UserID,
			DisplayName:   nullString(id.Name),
			PhotoUrl:      nullString(id.PhotoURL),
			EmailVerified: id.EmailVerified,
		})
		if err != nil {
			return auth.User{}, false, err
		}
		if _, err := q.UpdateIdentityProfile(ctx, gen.UpdateIdentityProfileParams{
			ID:          ident.ID,
			FirebaseUid: nullString(id.UID),
			RawProfile:  profile,
		}); err != nil {
			return auth.User{}, false, err
		}
		if err := tx.Commit(ctx); err != nil {
			return auth.User{}, false, err
		}
		return toAuthUser(user), false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return auth.User{}, false, err
	}

	// 2. No identity yet. Link to an existing user by email, or create one.
	var user gen.User
	isNewUser := false

	existing, gerr := q.GetUserByEmail(ctx, id.Email)
	switch {
	case gerr == nil:
		user, err = q.UpdateUserProfile(ctx, gen.UpdateUserProfileParams{
			ID:            existing.ID,
			DisplayName:   nullString(id.Name),
			PhotoUrl:      nullString(id.PhotoURL),
			EmailVerified: id.EmailVerified,
		})
		if err != nil {
			return auth.User{}, false, err
		}
	case errors.Is(gerr, pgx.ErrNoRows):
		user, err = q.CreateUser(ctx, gen.CreateUserParams{
			Email:         id.Email,
			EmailVerified: id.EmailVerified,
			DisplayName:   nullString(id.Name),
			PhotoUrl:      nullString(id.PhotoURL),
		})
		if err != nil {
			return auth.User{}, false, err
		}
		isNewUser = true
	default:
		return auth.User{}, false, gerr
	}

	if _, err := q.CreateIdentity(ctx, gen.CreateIdentityParams{
		UserID:      user.ID,
		Provider:    gen.AuthProviderGoogle,
		ProviderUid: id.ProviderUID,
		FirebaseUid: nullString(id.UID),
		RawProfile:  profile,
	}); err != nil {
		return auth.User{}, false, err
	}

	if err := tx.Commit(ctx); err != nil {
		return auth.User{}, false, err
	}
	return toAuthUser(user), isNewUser, nil
}

// GetUser loads a user by id.
func (r *Repo) GetUser(ctx context.Context, userID string) (auth.User, error) {
	uid, err := parseUUID(userID)
	if err != nil {
		return auth.User{}, err
	}
	user, err := r.q.GetUserByID(ctx, uid)
	if err != nil {
		return auth.User{}, err
	}
	return toAuthUser(user), nil
}

func toAuthUser(u gen.User) auth.User {
	return auth.User{
		ID:            uuidString(u.ID),
		Email:         u.Email,
		DisplayName:   derefString(u.DisplayName),
		PhotoURL:      derefString(u.PhotoUrl),
		EmailVerified: u.EmailVerified,
		CreatedAt:     u.CreatedAt.Time,
	}
}

// rawProfile is the JSON snapshot stored in auth_identities.raw_profile — only
// what Google returns (no extra scopes).
func rawProfile(id auth.Identity) []byte {
	b, err := json.Marshal(map[string]any{
		"email":          id.Email,
		"email_verified": id.EmailVerified,
		"name":           id.Name,
		"picture":        id.PhotoURL,
	})
	if err != nil {
		return []byte("{}")
	}
	return b
}

func nullString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func derefString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func parseUUID(s string) (pgtype.UUID, error) {
	var u pgtype.UUID
	if err := u.Scan(s); err != nil {
		return pgtype.UUID{}, err
	}
	return u, nil
}

func uuidString(u pgtype.UUID) string {
	v, err := u.Value()
	if err != nil || v == nil {
		return ""
	}
	s, _ := v.(string)
	return s
}
