package tradeauth

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"

	"github.com/smc-trading-terminal/backend/internal/auth"
	"github.com/smc-trading-terminal/backend/internal/config"
)

const maxTransactionPayloadBytes = 256 * 1024

var (
	ErrPasskeyRequired       = errors.New("trade passkey required")
	ErrCeremonyRejected      = errors.New("webauthn ceremony rejected")
	ErrAuthorizationRejected = errors.New("trade authorization rejected")
)

type IdentityVerifier interface {
	VerifyUserIdentity(ctx context.Context, idToken, userID string) (auth.User, error)
	GetUser(ctx context.Context, userID string) (auth.User, error)
}

type Service struct {
	pool             *pgxpool.Pool
	identity         IdentityVerifier
	webAuthn         *webauthn.WebAuthn
	box              *sealedBox
	challengeTTL     time.Duration
	authorizationTTL time.Duration
	now              func() time.Time
}

type BeginCeremony struct {
	ChallengeID string `json:"challengeId"`
	Options     any    `json:"options"`
}

type Authorization struct {
	Token       string `json:"token"`
	ExpiresAtMS int64  `json:"expiresAtMs"`
}

type CredentialSummary struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	CreatedAt  int64  `json:"createdAtMs"`
	LastUsedAt *int64 `json:"lastUsedAtMs,omitempty"`
}

func NewService(
	pool *pgxpool.Pool,
	identity IdentityVerifier,
	cfg config.Config,
) (*Service, error) {
	secret := cfg.WebAuthnEncryptionKey
	if secret == "" && !cfg.IsProduction() {
		secret = cfg.AuthJWTSecret
	}
	box, err := newSealedBox(secret)
	if err != nil {
		return nil, err
	}
	wa, err := webauthn.New(&webauthn.Config{
		RPID:          cfg.WebAuthnRPID,
		RPDisplayName: "SMC Trading Terminal",
		RPOrigins:     cfg.WebAuthnRPOrigins,
		AuthenticatorSelection: protocol.AuthenticatorSelection{
			ResidentKey:      protocol.ResidentKeyRequirementPreferred,
			UserVerification: protocol.VerificationRequired,
		},
		AttestationPreference: protocol.PreferNoAttestation,
		Timeouts: webauthn.TimeoutsConfig{
			Login: webauthn.TimeoutConfig{
				Enforce: true,
				Timeout: cfg.WebAuthnChallengeTTL,
			},
			Registration: webauthn.TimeoutConfig{
				Enforce: true,
				Timeout: cfg.WebAuthnChallengeTTL,
			},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("tradeauth: initialize WebAuthn: %w", err)
	}
	return &Service{
		pool:             pool,
		identity:         identity,
		webAuthn:         wa,
		box:              box,
		challengeTTL:     cfg.WebAuthnChallengeTTL,
		authorizationTTL: cfg.TradeAuthorizationTTL,
		now:              time.Now,
	}, nil
}

type webAuthnUser struct {
	id          []byte
	name        string
	displayName string
	credentials []webauthn.Credential
}

func (u webAuthnUser) WebAuthnID() []byte                         { return u.id }
func (u webAuthnUser) WebAuthnName() string                       { return u.name }
func (u webAuthnUser) WebAuthnDisplayName() string                { return u.displayName }
func (u webAuthnUser) WebAuthnCredentials() []webauthn.Credential { return u.credentials }

func (s *Service) BeginRegistration(
	ctx context.Context,
	userID, sessionID, idToken string,
) (BeginCeremony, error) {
	user, err := s.identity.VerifyUserIdentity(ctx, idToken, userID)
	if err != nil {
		return BeginCeremony{}, err
	}
	webUser, err := s.loadUser(ctx, s.pool, user)
	if err != nil {
		return BeginCeremony{}, err
	}
	options, session, err := s.webAuthn.BeginRegistration(
		webUser,
		webauthn.WithResidentKeyRequirement(protocol.ResidentKeyRequirementPreferred),
		webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
			ResidentKey:      protocol.ResidentKeyRequirementPreferred,
			UserVerification: protocol.VerificationRequired,
		}),
		webauthn.WithConveyancePreference(protocol.PreferNoAttestation),
	)
	if err != nil {
		return BeginCeremony{}, fmt.Errorf("%w: %v", ErrCeremonyRejected, err)
	}
	challengeID := uuid.NewString()
	if err := s.storeChallenge(
		ctx, challengeID, userID, sessionID, "registration", "", nil, session,
	); err != nil {
		return BeginCeremony{}, err
	}
	return BeginCeremony{ChallengeID: challengeID, Options: options}, nil
}

func (s *Service) FinishRegistration(
	ctx context.Context,
	userID, sessionID, challengeID, label string,
	response json.RawMessage,
) (CredentialSummary, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CredentialSummary{}, err
	}
	defer tx.Rollback(ctx)

	session, _, err := s.lockChallenge(
		ctx, tx, challengeID, userID, sessionID, "registration", "", nil,
	)
	if err != nil {
		return CredentialSummary{}, err
	}
	user, err := s.identity.GetUser(ctx, userID)
	if err != nil {
		return CredentialSummary{}, err
	}
	webUser, err := s.loadUser(ctx, tx, user)
	if err != nil {
		return CredentialSummary{}, err
	}
	parsed, err := protocol.ParseCredentialCreationResponseBytes(response)
	if err != nil {
		return CredentialSummary{}, fmt.Errorf("%w: invalid registration response", ErrCeremonyRejected)
	}
	credential, err := s.webAuthn.CreateCredential(webUser, session, parsed)
	if err != nil || !credential.Flags.UserPresent || !credential.Flags.UserVerified {
		return CredentialSummary{}, fmt.Errorf("%w: credential verification failed", ErrCeremonyRejected)
	}
	if strings.TrimSpace(label) == "" {
		label = "Passkey"
	}
	label = strings.TrimSpace(label)
	if len(label) > 80 {
		return CredentialSummary{}, fmt.Errorf("%w: invalid passkey label", ErrCeremonyRejected)
	}
	credentialJSON, err := json.Marshal(credential)
	if err != nil {
		return CredentialSummary{}, err
	}
	sealed, err := s.box.seal(credentialJSON, credentialAAD(userID, credential.ID))
	if err != nil {
		return CredentialSummary{}, err
	}
	credentialRowID := uuid.NewString()
	createdAt := s.now().UTC()
	_, err = tx.Exec(ctx, `
		INSERT INTO webauthn_credentials
			(id, user_id, credential_id, credential_data, label, created_at)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
	`, credentialRowID, userID, credential.ID, sealed, label, createdAt)
	if err != nil {
		return CredentialSummary{}, fmt.Errorf("%w: credential already registered", ErrCeremonyRejected)
	}
	if err := s.consumeChallenge(ctx, tx, challengeID); err != nil {
		return CredentialSummary{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return CredentialSummary{}, err
	}
	return CredentialSummary{
		ID:        credentialRowID,
		Label:     label,
		CreatedAt: createdAt.UnixMilli(),
	}, nil
}

func (s *Service) BeginAuthorization(
	ctx context.Context,
	userID, sessionID, operation string,
	payload json.RawMessage,
) (BeginCeremony, error) {
	if err := validateOperationPayload(operation, payload); err != nil {
		return BeginCeremony{}, err
	}
	user, err := s.identity.GetUser(ctx, userID)
	if err != nil {
		return BeginCeremony{}, err
	}
	webUser, err := s.loadUser(ctx, s.pool, user)
	if err != nil {
		return BeginCeremony{}, err
	}
	if len(webUser.credentials) == 0 {
		return BeginCeremony{}, ErrPasskeyRequired
	}
	options, session, err := s.webAuthn.BeginLogin(
		webUser,
		webauthn.WithUserVerification(protocol.VerificationRequired),
	)
	if err != nil {
		return BeginCeremony{}, fmt.Errorf("%w: %v", ErrCeremonyRejected, err)
	}
	challengeID := uuid.NewString()
	if err := s.storeChallenge(
		ctx, challengeID, userID, sessionID, "transaction", operation, payload, session,
	); err != nil {
		return BeginCeremony{}, err
	}
	return BeginCeremony{ChallengeID: challengeID, Options: options}, nil
}

func (s *Service) FinishAuthorization(
	ctx context.Context,
	userID, sessionID, challengeID, operation string,
	payload, response json.RawMessage,
) (Authorization, error) {
	if err := validateOperationPayload(operation, payload); err != nil {
		return Authorization{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Authorization{}, err
	}
	defer tx.Rollback(ctx)

	session, storedPayload, err := s.lockChallenge(
		ctx, tx, challengeID, userID, sessionID, "transaction", operation, payload,
	)
	if err != nil {
		return Authorization{}, err
	}
	user, err := s.identity.GetUser(ctx, userID)
	if err != nil {
		return Authorization{}, err
	}
	webUser, rows, err := s.loadUserWithRows(ctx, tx, user, true)
	if err != nil {
		return Authorization{}, err
	}
	parsed, err := protocol.ParseCredentialRequestResponseBytes(response)
	if err != nil {
		return Authorization{}, fmt.Errorf("%w: invalid assertion response", ErrAuthorizationRejected)
	}
	credential, err := s.webAuthn.ValidateLogin(webUser, session, parsed)
	if err != nil {
		log.Warn().
			Err(err).
			Str("challenge_id", challengeID).
			Msg("passkey assertion validation rejected")
		return Authorization{}, fmt.Errorf("%w: passkey assertion failed", ErrAuthorizationRejected)
	}
	if !acceptableAssertionCredential(credential) {
		log.Warn().
			Str("challenge_id", challengeID).
			Bool("user_present", credential.Flags.UserPresent).
			Bool("user_verified", credential.Flags.UserVerified).
			Bool("clone_warning", credential.Authenticator.CloneWarning).
			Bool("backup_eligible", credential.Flags.BackupEligible).
			Msg("passkey assertion did not meet the authorization policy")
		return Authorization{}, fmt.Errorf("%w: passkey assertion failed", ErrAuthorizationRejected)
	}
	if credential.Authenticator.CloneWarning {
		// Synced passkeys do not provide a reliable monotonic signature counter.
		// The assertion signature, RP ID, origin, challenge, user presence, and
		// user verification have already been validated above.
		log.Warn().
			Str("challenge_id", challengeID).
			Msg("accepting synced passkey assertion with a counter anomaly")
	}
	rowID, ok := rows[base64.RawURLEncoding.EncodeToString(credential.ID)]
	if !ok {
		return Authorization{}, ErrAuthorizationRejected
	}
	credentialJSON, err := json.Marshal(credential)
	if err != nil {
		return Authorization{}, err
	}
	sealed, err := s.box.seal(credentialJSON, credentialAAD(userID, credential.ID))
	if err != nil {
		return Authorization{}, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE webauthn_credentials
		SET credential_data = $1, last_used_at = $2
		WHERE id = $3::uuid AND user_id = $4::uuid
	`, sealed, s.now().UTC(), rowID, userID); err != nil {
		return Authorization{}, err
	}

	rawToken, tokenHash, err := generateAuthorizationToken()
	if err != nil {
		return Authorization{}, err
	}
	expiresAt := s.now().UTC().Add(s.authorizationTTL)
	if _, err := tx.Exec(ctx, `
		INSERT INTO trade_authorizations
			(user_id, session_id, credential_id, operation, payload, token_hash, expires_at)
		VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::jsonb, $6, $7)
	`, userID, sessionID, rowID, operation, string(storedPayload), tokenHash, expiresAt); err != nil {
		return Authorization{}, err
	}
	if err := s.consumeChallenge(ctx, tx, challengeID); err != nil {
		return Authorization{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Authorization{}, err
	}
	return Authorization{Token: rawToken, ExpiresAtMS: expiresAt.UnixMilli()}, nil
}

func acceptableAssertionCredential(credential *webauthn.Credential) bool {
	if credential == nil ||
		!credential.Flags.UserPresent ||
		!credential.Flags.UserVerified {
		return false
	}
	return !credential.Authenticator.CloneWarning || credential.Flags.BackupEligible
}

func (s *Service) ListCredentials(ctx context.Context, userID string) ([]CredentialSummary, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, label, created_at, last_used_at
		FROM webauthn_credentials
		WHERE user_id = $1::uuid
		ORDER BY created_at
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]CredentialSummary, 0)
	for rows.Next() {
		var item CredentialSummary
		var created time.Time
		var lastUsed *time.Time
		if err := rows.Scan(&item.ID, &item.Label, &created, &lastUsed); err != nil {
			return nil, err
		}
		item.CreatedAt = created.UnixMilli()
		if lastUsed != nil {
			ms := lastUsed.UnixMilli()
			item.LastUsedAt = &ms
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

type queryer interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func (s *Service) loadUser(
	ctx context.Context,
	q queryer,
	user auth.User,
) (webAuthnUser, error) {
	webUser, _, err := s.loadUserWithRows(ctx, q, user, false)
	return webUser, err
}

func (s *Service) loadUserWithRows(
	ctx context.Context,
	q queryer,
	user auth.User,
	lock bool,
) (webAuthnUser, map[string]string, error) {
	userUUID, err := uuid.Parse(user.ID)
	if err != nil {
		return webAuthnUser{}, nil, err
	}
	statement := `
		SELECT id::text, credential_id, credential_data
		FROM webauthn_credentials
		WHERE user_id = $1::uuid
		ORDER BY created_at`
	if lock {
		statement += " FOR UPDATE"
	}
	rows, err := q.Query(ctx, statement, user.ID)
	if err != nil {
		return webAuthnUser{}, nil, err
	}
	defer rows.Close()
	credentials := make([]webauthn.Credential, 0)
	rowIDs := make(map[string]string)
	for rows.Next() {
		var rowID string
		var credentialID, sealed []byte
		if err := rows.Scan(&rowID, &credentialID, &sealed); err != nil {
			return webAuthnUser{}, nil, err
		}
		plaintext, err := s.box.open(sealed, credentialAAD(user.ID, credentialID))
		if err != nil {
			return webAuthnUser{}, nil, err
		}
		var credential webauthn.Credential
		if err := json.Unmarshal(plaintext, &credential); err != nil {
			return webAuthnUser{}, nil, err
		}
		if !bytes.Equal(credential.ID, credentialID) {
			return webAuthnUser{}, nil, fmt.Errorf("tradeauth: credential integrity mismatch")
		}
		credentials = append(credentials, credential)
		rowIDs[base64.RawURLEncoding.EncodeToString(credential.ID)] = rowID
	}
	if err := rows.Err(); err != nil {
		return webAuthnUser{}, nil, err
	}
	displayName := user.DisplayName
	if displayName == "" {
		displayName = user.Email
	}
	return webAuthnUser{
		id:          userUUID[:],
		name:        user.Email,
		displayName: displayName,
		credentials: credentials,
	}, rowIDs, nil
}

func (s *Service) storeChallenge(
	ctx context.Context,
	challengeID, userID, sessionID, ceremony, operation string,
	payload json.RawMessage,
	session *webauthn.SessionData,
) error {
	sessionJSON, err := json.Marshal(session)
	if err != nil {
		return err
	}
	sealed, err := s.box.seal(
		sessionJSON,
		challengeAAD(challengeID, userID, sessionID),
	)
	if err != nil {
		return err
	}
	expiresAt := s.now().UTC().Add(s.challengeTTL)
	var payloadArg any
	if payload != nil {
		payloadArg = string(payload)
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO webauthn_challenges
			(id, user_id, session_id, ceremony, operation, payload, session_data, expires_at)
		VALUES ($1::uuid, $2::uuid, $3::uuid, $4, NULLIF($5, ''), $6::jsonb, $7, $8)
	`, challengeID, userID, sessionID, ceremony, operation, payloadArg, sealed, expiresAt)
	if err == nil {
		_, _ = s.pool.Exec(ctx, `
			DELETE FROM webauthn_challenges
			WHERE expires_at < now() - interval '1 hour' OR consumed_at < now() - interval '1 hour'
		`)
		_, _ = s.pool.Exec(ctx, `
			DELETE FROM trade_authorizations
			WHERE expires_at < now() - interval '1 hour' OR consumed_at < now() - interval '1 hour'
		`)
	}
	return err
}

func (s *Service) lockChallenge(
	ctx context.Context,
	tx pgx.Tx,
	challengeID, userID, sessionID, ceremony, operation string,
	payload json.RawMessage,
) (webauthn.SessionData, json.RawMessage, error) {
	var sealed []byte
	var storedPayload []byte
	err := tx.QueryRow(ctx, `
		SELECT session_data, COALESCE(payload::text, 'null')
		FROM webauthn_challenges
		WHERE id = $1::uuid
		  AND user_id = $2::uuid
		  AND session_id = $3::uuid
		  AND ceremony = $4
		  AND COALESCE(operation, '') = $5
		  AND consumed_at IS NULL
		  AND expires_at > now()
		  AND ($6::jsonb IS NULL OR payload = $6::jsonb)
		FOR UPDATE
	`, challengeID, userID, sessionID, ceremony, operation, nullableJSON(payload)).
		Scan(&sealed, &storedPayload)
	if errors.Is(err, pgx.ErrNoRows) {
		return webauthn.SessionData{}, nil, ErrCeremonyRejected
	}
	if err != nil {
		return webauthn.SessionData{}, nil, err
	}
	plaintext, err := s.box.open(
		sealed,
		challengeAAD(challengeID, userID, sessionID),
	)
	if err != nil {
		return webauthn.SessionData{}, nil, err
	}
	var session webauthn.SessionData
	if err := json.Unmarshal(plaintext, &session); err != nil {
		return webauthn.SessionData{}, nil, err
	}
	return session, json.RawMessage(storedPayload), nil
}

func (s *Service) consumeChallenge(ctx context.Context, tx pgx.Tx, challengeID string) error {
	tag, err := tx.Exec(ctx, `
		UPDATE webauthn_challenges
		SET consumed_at = now()
		WHERE id = $1::uuid AND consumed_at IS NULL
	`, challengeID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrCeremonyRejected
	}
	return nil
}

func validateOperationPayload(operation string, payload json.RawMessage) error {
	if operation != "order" && operation != "command" {
		return fmt.Errorf("%w: invalid operation", ErrAuthorizationRejected)
	}
	if len(payload) == 0 || len(payload) > maxTransactionPayloadBytes || !json.Valid(payload) {
		return fmt.Errorf("%w: invalid payload", ErrAuthorizationRejected)
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(payload, &object); err != nil {
		return fmt.Errorf("%w: payload must be an object", ErrAuthorizationRejected)
	}
	if operation == "order" {
		if len(object) != 2 || len(object["intent"]) == 0 || len(object["targets"]) == 0 {
			return fmt.Errorf("%w: invalid order payload", ErrAuthorizationRejected)
		}
	} else if len(object) != 1 || len(object["command"]) == 0 {
		return fmt.Errorf("%w: invalid command payload", ErrAuthorizationRejected)
	}
	return nil
}

func generateAuthorizationToken() (raw string, hash []byte, err error) {
	value := make([]byte, 32)
	if _, err = rand.Read(value); err != nil {
		return "", nil, err
	}
	raw = base64.RawURLEncoding.EncodeToString(value)
	sum := sha256.Sum256([]byte(raw))
	return raw, sum[:], nil
}

func credentialAAD(userID string, credentialID []byte) string {
	return "credential\x00" + userID + "\x00" + base64.RawURLEncoding.EncodeToString(credentialID)
}

func challengeAAD(challengeID, userID, sessionID string) string {
	return "challenge\x00" + challengeID + "\x00" + userID + "\x00" + sessionID
}

func nullableJSON(payload json.RawMessage) any {
	if payload == nil {
		return nil
	}
	return string(payload)
}
