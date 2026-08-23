package execution

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"unicode"

	"github.com/gofiber/fiber/v3"
	"github.com/marketlens/backend/internal/mt5vault"
	"github.com/rs/zerolog/log"
)

type MT5CredentialStore interface {
	Put(context.Context, string, mt5vault.Credential) error
	Get(context.Context, string) (mt5vault.Credential, error)
	Delete(context.Context, string) error
}

type MT5ConnectorGateway interface {
	ReserveMT5ConnectorAccount(context.Context, MT5ConnectorReserveRequest) (MT5ConnectorAccount, error)
	ActivateMT5ConnectorAccount(context.Context, MT5ConnectorActivateRequest) (MT5ConnectorAccount, error)
	AbortMT5ConnectorAccount(context.Context, MT5ConnectorAbortRequest) error
	MT5ConnectorAccount(context.Context, string, string) (MT5ConnectorAccount, error)
	MT5ConnectorReadState(context.Context, string, string) (json.RawMessage, error)
	MT5ConnectorHistory(context.Context, string, string, int64, int64, int, string) (json.RawMessage, error)
	ReconnectMT5ConnectorAccount(context.Context, string, string, uint64) (MT5ConnectorAccount, error)
	DisconnectMT5ConnectorAccount(context.Context, string, string, uint64) (MT5ConnectorAccount, error)
	PrepareDeleteMT5ConnectorAccount(context.Context, string, string, uint64) (MT5ConnectorAccount, error)
	FinalizeDeleteMT5ConnectorAccount(context.Context, string, string, string, string, uint64) error
	ConsumeMT5CredentialGrantAuthenticated(context.Context, MT5CredentialGrantConsumeRequest, string) (MT5CredentialGrant, error)
}

type mt5ConnectRequest struct {
	RequestID   string `json:"requestId"`
	Platform    string `json:"platform"`
	Login       string `json:"login"`
	Password    string `json:"password"`
	Server      string `json:"server"`
	Label       string `json:"label"`
	Persistence string `json:"persistence"`
}

type mt5ReconnectRequest struct {
	ExpectedRevision uint64 `json:"expectedRevision"`
	Login            string `json:"login,omitempty"`
	Password         string `json:"password,omitempty"`
	Server           string `json:"server,omitempty"`
}

type mt5RevisionRequest struct {
	ExpectedRevision uint64 `json:"expectedRevision"`
}

type mt5MutationResponse struct {
	AccountID          string `json:"accountId"`
	ConnectionStatus   string `json:"connectionStatus"`
	ConnectionRevision uint64 `json:"connectionRevision"`
}

func (h *Handler) registerMT5ConnectorRoutes(router fiber.Router) {
	router.Post("/execution/connectors/mt5/accounts", h.requireAuth, h.requestRateLimit, h.requireActiveSession, h.mutationRateLimit, h.connectorRateLimit, h.connectMT5Account)
	router.Get("/execution/connectors/accounts/:accountId", h.requireAuth, h.requestRateLimit, h.requireActiveSession, h.getMT5ConnectorAccount)
	router.Get("/execution/connectors/accounts/:accountId/snapshot", h.requireAuth, h.requestRateLimit, h.requireActiveSession, h.getMT5ConnectorReadState)
	router.Get("/execution/connectors/accounts/:accountId/history", h.requireAuth, h.requestRateLimit, h.requireActiveSession, h.getMT5ConnectorHistory)
	router.Post("/execution/connectors/accounts/:accountId/reconnect", h.requireAuth, h.requestRateLimit, h.requireActiveSession, h.mutationRateLimit, h.connectorRateLimit, h.reconnectMT5Account)
	router.Post("/execution/connectors/accounts/:accountId/disconnect", h.requireAuth, h.requestRateLimit, h.requireActiveSession, h.mutationRateLimit, h.connectorRateLimit, h.disconnectMT5Account)
	router.Delete("/execution/connectors/accounts/:accountId", h.requireAuth, h.requestRateLimit, h.requireActiveSession, h.mutationRateLimit, h.connectorRateLimit, h.deleteMT5Account)
	// This exact route is for private workers, not browsers. Its unpredictable,
	// one-time, worker/session/lease-bound grant is consumed by Rust before any
	// Vault read. Production proxies must not publish this path publicly.
	router.Post("/execution-workers/mt5/credential-grants/consume", h.connectorWorkerRateLimit, h.consumeMT5CredentialGrant)
}

func (h *Handler) connectMT5Account(c fiber.Ctx) error {
	body := c.Body()
	defer clear(body)
	var request mt5ConnectRequest
	if err := decodeStrict(body, &request); err != nil || !validMT5ConnectRequest(request) {
		request.Password = ""
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	credential := mt5vault.Credential{
		Login: strings.TrimSpace(request.Login), Password: request.Password, Server: strings.TrimSpace(request.Server),
	}
	identityFingerprint := mt5IdentityFingerprint(h.mt5IdentityKey, credential.Login, credential.Server)
	serverFingerprint := mt5ServerFingerprint(h.mt5IdentityKey, credential.Server)
	defer func() {
		request.Password = ""
		credential.Password = ""
	}()
	ownerID := authenticatedUserID(c)
	accountID := mt5AccountIDForRequest(h.mt5IdentityKey, ownerID, request.RequestID)
	secretRef, err := mt5vault.NewSecretRef()
	if err != nil {
		return fiber.NewError(fiber.StatusServiceUnavailable, "MT5 connection service unavailable")
	}
	reserved, err := h.mt5ConnectorGateway.ReserveMT5ConnectorAccount(c.Context(), MT5ConnectorReserveRequest{
		OwnerID: ownerID, AccountID: accountID, Label: strings.TrimSpace(request.Label),
		Server: "", MaskedLoginSuffix: loginSuffix(credential.Login),
		IdentityFingerprint: identityFingerprint,
		ServerFingerprint:   serverFingerprint,
		Persistence:         request.Persistence, SecretRef: secretRef,
	})
	if err != nil {
		return mt5ConnectorHTTPError(err)
	}
	if reserved.Ready {
		c.Set(fiber.HeaderCacheControl, "no-store")
		return c.Status(fiber.StatusAccepted).JSON(mutationResponse(reserved))
	}
	if reserved.SecretRef != "" {
		secretRef = reserved.SecretRef
	}
	if err := h.mt5Vault.Put(c.Context(), secretRef, credential); err != nil {
		if h.abortMT5Reservation(c.Context(), ownerID, reserved, secretRef) == nil {
			_ = h.mt5Vault.Delete(c.Context(), secretRef)
		}
		log.Error().Err(err).Str("account_id", accountID).Msg("MT5 credential vault write failed")
		return fiber.NewError(fiber.StatusServiceUnavailable, "MT5 credential vault unavailable")
	}
	activated, err := h.mt5ConnectorGateway.ActivateMT5ConnectorAccount(c.Context(), MT5ConnectorActivateRequest{
		OwnerID: ownerID, AccountID: accountID, SecretRef: secretRef,
		Label: strings.TrimSpace(request.Label), Server: "",
		MaskedLoginSuffix: loginSuffix(credential.Login), IdentityFingerprint: identityFingerprint,
		ServerFingerprint: serverFingerprint,
		Persistence:       request.Persistence,
		ExpectedRevision:  reserved.ConnectionRevision,
	})
	if err != nil {
		if h.abortMT5Reservation(c.Context(), ownerID, reserved, secretRef) == nil {
			_ = h.mt5Vault.Delete(c.Context(), secretRef)
		}
		return mt5ConnectorHTTPError(err)
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.Status(fiber.StatusAccepted).JSON(mutationResponse(activated))
}

func (h *Handler) getMT5ConnectorAccount(c fiber.Ctx) error {
	accountID := c.Params("accountId")
	if !validExecutionIdentifier(accountID, 96) {
		return fiber.NewError(fiber.StatusBadRequest, "invalid accountId")
	}
	account, err := h.mt5ConnectorGateway.MT5ConnectorAccount(c.Context(), authenticatedUserID(c), accountID)
	if err != nil {
		return mt5ConnectorHTTPError(err)
	}
	account.SecretRef, account.PreviousSecretRef = "", ""
	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.JSON(account)
}

func (h *Handler) getMT5ConnectorReadState(c fiber.Ctx) error {
	accountID := c.Params("accountId")
	if !validExecutionIdentifier(accountID, 96) {
		return fiber.NewError(fiber.StatusBadRequest, "invalid accountId")
	}
	state, err := h.mt5ConnectorGateway.MT5ConnectorReadState(c.Context(), authenticatedUserID(c), accountID)
	if err != nil {
		return mt5ConnectorHTTPError(err)
	}
	if !json.Valid(state) {
		return fiber.NewError(fiber.StatusServiceUnavailable, "MT5 read state unavailable")
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	c.Type(fiber.MIMEApplicationJSON)
	return c.Send(state)
}

func (h *Handler) getMT5ConnectorHistory(c fiber.Ctx) error {
	accountID := c.Params("accountId")
	fromMS, fromErr := strconv.ParseInt(c.Query("fromMs"), 10, 64)
	toMS, toErr := strconv.ParseInt(c.Query("toMs"), 10, 64)
	limit, limitErr := strconv.Atoi(c.Query("limit", "100"))
	cursor := c.Query("cursor")
	if !validExecutionIdentifier(accountID, 96) || fromErr != nil || toErr != nil || limitErr != nil ||
		fromMS <= 0 || toMS <= fromMS || toMS-fromMS > 31*24*60*60*1000 || limit < 1 || limit > 500 || len(cursor) > 256 {
		return fiber.NewError(fiber.StatusBadRequest, "invalid MT5 history window")
	}
	history, err := h.mt5ConnectorGateway.MT5ConnectorHistory(c.Context(), authenticatedUserID(c), accountID, fromMS, toMS, limit, cursor)
	if err != nil {
		return mt5ConnectorHTTPError(err)
	}
	if !json.Valid(history) {
		return fiber.NewError(fiber.StatusServiceUnavailable, "MT5 history unavailable")
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	c.Type(fiber.MIMEApplicationJSON)
	return c.Send(history)
}

func (h *Handler) reconnectMT5Account(c fiber.Ctx) error {
	accountID := c.Params("accountId")
	body := c.Body()
	defer clear(body)
	var request mt5ReconnectRequest
	if !validExecutionIdentifier(accountID, 96) || decodeStrict(body, &request) != nil || request.ExpectedRevision == 0 {
		request.Password = ""
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	defer func() { request.Password = "" }()
	hasCredential := request.Login != "" || request.Password != "" || request.Server != ""
	if !hasCredential {
		account, err := h.mt5ConnectorGateway.ReconnectMT5ConnectorAccount(c.Context(), authenticatedUserID(c), accountID, request.ExpectedRevision)
		if err != nil {
			return mt5ConnectorHTTPError(err)
		}
		c.Set(fiber.HeaderCacheControl, "no-store")
		return c.Status(fiber.StatusAccepted).JSON(mutationResponse(account))
	}
	if !validMT5Credential(request.Login, request.Password, request.Server) {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	current, err := h.mt5ConnectorGateway.MT5ConnectorAccount(c.Context(), authenticatedUserID(c), accountID)
	if err != nil {
		return mt5ConnectorHTTPError(err)
	}
	if current.ConnectionRevision != request.ExpectedRevision {
		return fiber.NewError(fiber.StatusConflict, "MT5 account revision changed")
	}
	credential := mt5vault.Credential{Login: strings.TrimSpace(request.Login), Password: request.Password, Server: strings.TrimSpace(request.Server)}
	defer func() { credential.Password = "" }()
	identityFingerprint := mt5IdentityFingerprint(h.mt5IdentityKey, credential.Login, credential.Server)
	serverFingerprint := mt5ServerFingerprint(h.mt5IdentityKey, credential.Server)
	secretRef, err := mt5vault.NewSecretRef()
	if err != nil {
		return fiber.NewError(fiber.StatusServiceUnavailable, "MT5 connection service unavailable")
	}
	reserved, err := h.mt5ConnectorGateway.ReserveMT5ConnectorAccount(c.Context(), MT5ConnectorReserveRequest{
		OwnerID: authenticatedUserID(c), AccountID: accountID, Label: current.Label, Server: "",
		MaskedLoginSuffix: loginSuffix(credential.Login), IdentityFingerprint: identityFingerprint,
		ServerFingerprint: serverFingerprint,
		Persistence:       current.Persistence,
		SecretRef:         secretRef, ExpectedRevision: request.ExpectedRevision,
	})
	if err != nil {
		return mt5ConnectorHTTPError(err)
	}
	if err := h.mt5Vault.Put(c.Context(), secretRef, credential); err != nil {
		if h.abortMT5Reservation(c.Context(), authenticatedUserID(c), reserved, secretRef) == nil {
			_ = h.mt5Vault.Delete(c.Context(), secretRef)
		}
		return fiber.NewError(fiber.StatusServiceUnavailable, "MT5 credential vault unavailable")
	}
	activated, err := h.mt5ConnectorGateway.ActivateMT5ConnectorAccount(c.Context(), MT5ConnectorActivateRequest{
		OwnerID: authenticatedUserID(c), AccountID: accountID, SecretRef: secretRef,
		Label: current.Label, Server: "", MaskedLoginSuffix: loginSuffix(credential.Login),
		IdentityFingerprint: identityFingerprint,
		ServerFingerprint:   serverFingerprint,
		Persistence:         current.Persistence, ExpectedRevision: reserved.ConnectionRevision,
	})
	if err != nil {
		if h.abortMT5Reservation(c.Context(), authenticatedUserID(c), reserved, secretRef) == nil {
			_ = h.mt5Vault.Delete(c.Context(), secretRef)
		}
		return mt5ConnectorHTTPError(err)
	}
	if reserved.PreviousSecretRef != "" && reserved.PreviousSecretRef != secretRef {
		if err := h.mt5Vault.Delete(c.Context(), reserved.PreviousSecretRef); err != nil {
			log.Error().Err(err).Str("account_id", accountID).Msg("old MT5 credential version deletion failed")
		}
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.Status(fiber.StatusAccepted).JSON(mutationResponse(activated))
}

func (h *Handler) disconnectMT5Account(c fiber.Ctx) error {
	accountID := c.Params("accountId")
	var request mt5RevisionRequest
	if !validExecutionIdentifier(accountID, 96) || decodeStrict(c.Body(), &request) != nil || request.ExpectedRevision == 0 {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	account, err := h.mt5ConnectorGateway.DisconnectMT5ConnectorAccount(c.Context(), authenticatedUserID(c), accountID, request.ExpectedRevision)
	if err != nil {
		return mt5ConnectorHTTPError(err)
	}
	if account.Persistence == "session" && account.SecretRef != "" {
		if err := h.mt5Vault.Delete(c.Context(), account.SecretRef); err != nil {
			log.Error().Err(err).Str("account_id", accountID).Msg("session MT5 credential deletion failed")
			return fiber.NewError(fiber.StatusServiceUnavailable, "MT5 credential vault unavailable")
		}
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.Status(fiber.StatusAccepted).JSON(mutationResponse(account))
}

func (h *Handler) deleteMT5Account(c fiber.Ctx) error {
	accountID := c.Params("accountId")
	var request mt5RevisionRequest
	if !validExecutionIdentifier(accountID, 96) || decodeStrict(c.Body(), &request) != nil || request.ExpectedRevision == 0 {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	prepared, err := h.mt5ConnectorGateway.PrepareDeleteMT5ConnectorAccount(c.Context(), authenticatedUserID(c), accountID, request.ExpectedRevision)
	if err != nil {
		return mt5ConnectorHTTPError(err)
	}
	if !prepared.Ready {
		c.Set(fiber.HeaderCacheControl, "no-store")
		return c.Status(fiber.StatusAccepted).JSON(mutationResponse(prepared))
	}
	if prepared.SecretRef != "" {
		if err := h.mt5Vault.Delete(c.Context(), prepared.SecretRef); err != nil {
			log.Error().Err(err).Str("account_id", accountID).Msg("MT5 credential deletion failed")
			return fiber.NewError(fiber.StatusServiceUnavailable, "MT5 credential vault unavailable")
		}
	}
	if prepared.PreviousSecretRef != "" && prepared.PreviousSecretRef != prepared.SecretRef {
		if err := h.mt5Vault.Delete(c.Context(), prepared.PreviousSecretRef); err != nil {
			log.Error().Err(err).Str("account_id", accountID).Msg("pending MT5 credential deletion failed")
			return fiber.NewError(fiber.StatusServiceUnavailable, "MT5 credential vault unavailable")
		}
	}
	if err := h.mt5ConnectorGateway.FinalizeDeleteMT5ConnectorAccount(c.Context(), authenticatedUserID(c), accountID, prepared.SecretRef, prepared.PreviousSecretRef, prepared.ConnectionRevision); err != nil {
		return mt5ConnectorHTTPError(err)
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.JSON(struct {
		OK bool `json:"ok"`
	}{OK: true})
}

func (h *Handler) consumeMT5CredentialGrant(c fiber.Ctx) error {
	workerBearer := mt5WorkerSessionBearer(c.Get(fiber.HeaderAuthorization))
	if workerBearer == "" {
		return fiber.NewError(fiber.StatusUnauthorized, "worker authentication required")
	}
	body := c.Body()
	defer clear(body)
	var request MT5CredentialGrantConsumeRequest
	if decodeStrict(body, &request) != nil || !validMT5CredentialGrantRequest(request) {
		request.GrantToken = ""
		return fiber.NewError(fiber.StatusBadRequest, "invalid credential grant")
	}
	defer func() { request.GrantToken = "" }()
	grant, err := h.mt5ConnectorGateway.ConsumeMT5CredentialGrantAuthenticated(c.Context(), request, workerBearer)
	workerBearer = ""
	if err != nil {
		return mt5ConnectorHTTPError(err)
	}
	credential, err := h.mt5Vault.Get(c.Context(), grant.SecretRef)
	if err != nil {
		return fiber.NewError(fiber.StatusServiceUnavailable, "MT5 credential vault unavailable")
	}
	defer func() { credential.Password = "" }()
	if grant.Persistence == "session" {
		if err := h.mt5Vault.Delete(c.Context(), grant.SecretRef); err != nil {
			return fiber.NewError(fiber.StatusServiceUnavailable, "MT5 credential vault unavailable")
		}
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	c.Set("Pragma", "no-cache")
	return c.JSON(credential)
}

func (h *Handler) abortMT5Reservation(ctx context.Context, ownerID string, reserved MT5ConnectorAccount, secretRef string) error {
	if err := h.mt5ConnectorGateway.AbortMT5ConnectorAccount(ctx, MT5ConnectorAbortRequest{
		OwnerID: ownerID, AccountID: reserved.AccountID, SecretRef: secretRef, PreviousSecretRef: reserved.PreviousSecretRef,
		ExpectedRevision: reserved.ConnectionRevision, Created: reserved.Created,
	}); err != nil {
		log.Error().Err(err).Str("account_id", reserved.AccountID).Msg("MT5 credential reservation compensation failed")
		return err
	}
	return nil
}

func mutationResponse(account MT5ConnectorAccount) mt5MutationResponse {
	return mt5MutationResponse{account.AccountID, account.ConnectionStatus, account.ConnectionRevision}
}

func validMT5ConnectRequest(request mt5ConnectRequest) bool {
	return validMT5RequestID(request.RequestID) && request.Platform == "mt5" && validMT5Credential(request.Login, request.Password, request.Server) &&
		validMT5Label(request.Label) && (request.Persistence == "session" || request.Persistence == "managed")
}

func validMT5RequestID(value string) bool {
	if len(value) != 36 || value[8] != '-' || value[13] != '-' || value[18] != '-' || value[23] != '-' || value[14] != '4' {
		return false
	}
	for index, character := range value {
		if index == 8 || index == 13 || index == 18 || index == 23 {
			continue
		}
		if !strings.ContainsRune("0123456789abcdefABCDEF", character) {
			return false
		}
	}
	return strings.ContainsRune("89abAB", rune(value[19]))
}

func validMT5Credential(login, password, server string) bool {
	login, server = strings.TrimSpace(login), strings.TrimSpace(server)
	if login == "" || len(login) > 32 || len(password) == 0 || len(password) > 256 || server == "" || len(server) > 128 {
		return false
	}
	for _, value := range login {
		if value < '0' || value > '9' {
			return false
		}
	}
	return !strings.ContainsAny(server, "\r\n\x00")
}

func validMT5Label(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 80 {
		return false
	}
	return !strings.ContainsFunc(value, unicode.IsControl)
}

func validMT5CredentialGrantRequest(request MT5CredentialGrantConsumeRequest) bool {
	if request.ProtocolVersion == 0 || request.SessionGeneration == 0 || request.LeaseGeneration == 0 ||
		!validExecutionIdentifier(request.WorkerID, 64) || !validExecutionIdentifier(request.AccountID, 96) ||
		!validExecutionIdentifier(request.CommandID, 96) || len(request.GrantToken) != 64 {
		return false
	}
	for _, value := range request.GrantToken {
		if !strings.ContainsRune("0123456789abcdef", value) {
			return false
		}
	}
	return true
}

func loginSuffix(login string) string {
	login = strings.TrimSpace(login)
	if len(login) <= 4 {
		return "****"
	}
	return login[len(login)-4:]
}

func mt5WorkerSessionBearer(authorization string) string {
	const prefix = "Bearer "
	if !strings.HasPrefix(authorization, prefix) {
		return ""
	}
	token := strings.TrimSpace(strings.TrimPrefix(authorization, prefix))
	if len(token) != 64 {
		return ""
	}
	for _, character := range token {
		if !strings.ContainsRune("0123456789abcdef", character) {
			return ""
		}
	}
	return token
}

func mt5IdentityFingerprint(key []byte, login, server string) string {
	if len(key) != sha256.Size {
		return ""
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(strings.ToLower(strings.TrimSpace(server))))
	_, _ = mac.Write([]byte{0})
	_, _ = mac.Write([]byte(strings.TrimSpace(login)))
	return hex.EncodeToString(mac.Sum(nil))
}

func mt5ServerFingerprint(key []byte, server string) string {
	if len(key) != sha256.Size {
		return ""
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte("server"))
	_, _ = mac.Write([]byte{0})
	_, _ = mac.Write([]byte(strings.ToLower(strings.TrimSpace(server))))
	return hex.EncodeToString(mac.Sum(nil))
}

func mt5AccountIDForRequest(key []byte, ownerID, requestID string) string {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte("request"))
	_, _ = mac.Write([]byte{0})
	_, _ = mac.Write([]byte(strings.TrimSpace(ownerID)))
	_, _ = mac.Write([]byte{0})
	_, _ = mac.Write([]byte(strings.ToLower(strings.TrimSpace(requestID))))
	return "mt5vm-" + hex.EncodeToString(mac.Sum(nil)[:16])
}

func mt5ConnectorHTTPError(err error) error {
	var gatewayErr *GatewayError
	if errors.As(err, &gatewayErr) {
		switch gatewayErr.Status {
		case fiber.StatusBadRequest, fiber.StatusConflict, fiber.StatusNotFound, fiber.StatusTooManyRequests:
			return fiber.NewError(gatewayErr.Status, "MT5 connector request was rejected")
		}
	}
	log.Error().Err(err).Msg("MT5 connector gateway request failed")
	return fiber.NewError(fiber.StatusServiceUnavailable, "MT5 connection service unavailable")
}
