// Package auth verifies Google/Firebase identities and (in later phases) mints
// and manages the backend's own session/access tokens.
package auth

import (
	"context"
	"encoding/json"
	"fmt"

	firebase "firebase.google.com/go/v4"
	fbauth "firebase.google.com/go/v4/auth"
	"google.golang.org/api/option"

	"github.com/marketlens/backend/internal/config"
)

// idTokenVerifier is the revocation-aware slice of the Firebase auth client
// the verifier uses.
// Abstracted so the claim-mapping logic can be unit-tested without real
// credentials or network access. *fbauth.Client satisfies it.
type idTokenVerifier interface {
	VerifyIDTokenAndCheckRevoked(ctx context.Context, idToken string) (*fbauth.Token, error)
}

// Verifier validates non-revoked Firebase ID tokens and maps them to an internal Identity.
type Verifier struct {
	client idTokenVerifier
}

// NewVerifier initializes the Firebase Admin SDK from the service-account env
// (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY) and
// returns a Verifier backed by a real *auth.Client.
func NewVerifier(ctx context.Context, cfg config.Config) (*Verifier, error) {
	if cfg.FirebaseProjectID == "" || cfg.FirebaseClientEmail == "" || cfg.FirebasePrivateKey == "" {
		return nil, fmt.Errorf("auth: firebase service account is not configured")
	}

	creds, err := serviceAccountJSON(cfg)
	if err != nil {
		return nil, err
	}

	app, err := firebase.NewApp(ctx,
		&firebase.Config{ProjectID: cfg.FirebaseProjectID},
		option.WithCredentialsJSON(creds),
	)
	if err != nil {
		return nil, fmt.Errorf("auth: init firebase app: %w", err)
	}

	client, err := app.Auth(ctx)
	if err != nil {
		return nil, fmt.Errorf("auth: init firebase auth client: %w", err)
	}

	return &Verifier{client: client}, nil
}

// serviceAccountJSON builds the minimal service-account credential JSON the
// Admin SDK expects from the three FIREBASE_* env values.
func serviceAccountJSON(cfg config.Config) ([]byte, error) {
	sa := map[string]string{
		"type":         "service_account",
		"project_id":   cfg.FirebaseProjectID,
		"client_email": cfg.FirebaseClientEmail,
		"private_key":  cfg.FirebasePrivateKey,
		"token_uri":    "https://oauth2.googleapis.com/token",
	}
	b, err := json.Marshal(sa)
	if err != nil {
		return nil, fmt.Errorf("auth: marshal service account: %w", err)
	}
	return b, nil
}
