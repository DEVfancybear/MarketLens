package execution

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/rs/zerolog/log"
	"github.com/smc-trading-terminal/backend/internal/auth"
)

type Gateway interface {
	ListAccounts(ctx context.Context, ownerID string) ([]Account, error)
	IssuePairingToken(ctx context.Context, ownerID string, expiresInSeconds int) (PairingToken, error)
	RouteOrder(ctx context.Context, ownerID string, order OrderRequest) (json.RawMessage, error)
	AccountState(ctx context.Context, ownerID string, accountID string) (json.RawMessage, error)
	AccountInstruments(ctx context.Context, ownerID string, accountID string) (json.RawMessage, error)
	UpsertSymbolMapping(ctx context.Context, ownerID string, request SymbolMappingRequest) (json.RawMessage, error)
	QueueCommand(ctx context.Context, ownerID string, request CommandRequest) (json.RawMessage, error)
}

type Handler struct {
	gateway     Gateway
	requireAuth fiber.Handler
	eaProxy     *EAProxy
}

func NewHandler(gateway Gateway, requireAuth fiber.Handler) *Handler {
	return &Handler{gateway: gateway, requireAuth: requireAuth}
}

func (h *Handler) WithEAProxy(proxy *EAProxy) *Handler {
	h.eaProxy = proxy
	return h
}

func (h *Handler) Register(router fiber.Router) {
	router.Get("/execution/accounts", h.requireAuth, h.listAccounts)
	router.Get("/execution/account-state", h.requireAuth, h.accountState)
	router.Get("/execution/instruments", h.requireAuth, h.accountInstruments)
	router.Post("/execution/symbol-mappings", h.requireAuth, h.upsertSymbolMapping)
	router.Post("/execution/pairing-tokens", h.requireAuth, h.issuePairingToken)
	router.Post("/execution/orders", h.requireAuth, h.routeOrder)
	router.Post("/execution/commands", h.requireAuth, h.queueCommand)
}

func (h *Handler) RegisterPublic(router fiber.Router) {
	if h.eaProxy == nil {
		return
	}
	router.Get("/execution-ea/health", h.eaHealth)
	router.Post("/execution-ea/v1/ea/sessions", h.forwardEA("/v1/ea/sessions", false))
	router.Post("/execution-ea/v1/ea/poll", h.forwardEA("/v1/ea/poll", true))
	router.Post("/execution-ea/v1/ea/events", h.forwardEA("/v1/ea/events", true))
}

func (h *Handler) eaHealth(c fiber.Ctx) error {
	response, err := h.eaProxy.Forward(c.Context(), fiber.MethodGet, "/health", "", nil)
	if err != nil || response.StatusCode != fiber.StatusOK {
		if err != nil {
			log.Error().Err(err).Msg("EA gateway health proxy failed")
		}
		return fiber.NewError(
			fiber.StatusServiceUnavailable,
			"execution EA service unavailable",
		)
	}
	return c.JSON(struct {
		OK      bool   `json:"ok"`
		Service string `json:"service"`
	}{OK: true, Service: "execution-ea-relay"})
}

func (h *Handler) forwardEA(path string, requireBearer bool) fiber.Handler {
	return func(c fiber.Ctx) error {
		body := c.Body()
		if len(body) > maxEAProxyBytes {
			return fiber.NewError(fiber.StatusRequestEntityTooLarge, "request body too large")
		}
		authorization := strings.TrimSpace(c.Get(fiber.HeaderAuthorization))
		if len(authorization) > 512 {
			return fiber.NewError(fiber.StatusUnauthorized, "invalid EA session")
		}
		if requireBearer &&
			(!strings.HasPrefix(authorization, "Bearer ") ||
				strings.TrimSpace(strings.TrimPrefix(authorization, "Bearer ")) == "") {
			return fiber.NewError(fiber.StatusUnauthorized, "EA session required")
		}
		response, err := h.eaProxy.Forward(
			c.Context(),
			c.Method(),
			path,
			authorization,
			body,
		)
		if err != nil {
			log.Error().Err(err).Str("path", path).Msg("EA gateway proxy failed")
			return fiber.NewError(
				fiber.StatusServiceUnavailable,
				"execution EA service unavailable",
			)
		}
		c.Set(fiber.HeaderCacheControl, "no-store")
		c.Type(fiber.MIMEApplicationJSON)
		return c.Status(response.StatusCode).Send(response.Body)
	}
}

func (h *Handler) accountInstruments(c fiber.Ctx) error {
	accountID := c.Query("accountId")
	if !validExecutionIdentifier(accountID, 96) {
		return fiber.NewError(fiber.StatusBadRequest, "invalid accountId")
	}
	response, err := h.gateway.AccountInstruments(
		c.Context(),
		authenticatedUserID(c),
		accountID,
	)
	if err != nil {
		return gatewayHTTPError(err)
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	c.Type(fiber.MIMEApplicationJSON)
	return c.Send(response)
}

func (h *Handler) upsertSymbolMapping(c fiber.Ctx) error {
	var request SymbolMappingRequest
	if err := decodeStrict(c.Body(), &request); err != nil ||
		!validExecutionIdentifier(request.AccountID, 96) ||
		!validSymbol(request.CanonicalSymbol) ||
		!validSymbol(request.VenueSymbol) {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	response, err := h.gateway.UpsertSymbolMapping(
		c.Context(),
		authenticatedUserID(c),
		request,
	)
	if err != nil {
		return gatewayHTTPError(err)
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	c.Type(fiber.MIMEApplicationJSON)
	return c.Send(response)
}

func (h *Handler) accountState(c fiber.Ctx) error {
	accountID := c.Query("accountId")
	if !validExecutionIdentifier(accountID, 96) {
		return fiber.NewError(fiber.StatusBadRequest, "invalid accountId")
	}
	response, err := h.gateway.AccountState(
		c.Context(),
		authenticatedUserID(c),
		accountID,
	)
	if err != nil {
		return gatewayHTTPError(err)
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	c.Type(fiber.MIMEApplicationJSON)
	return c.Send(response)
}

func (h *Handler) queueCommand(c fiber.Ctx) error {
	var request CommandRequest
	if err := decodeStrict(c.Body(), &request); err != nil ||
		len(request.Command) == 0 || !json.Valid(request.Command) {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	response, err := h.gateway.QueueCommand(
		c.Context(),
		authenticatedUserID(c),
		request,
	)
	if err != nil {
		return gatewayHTTPError(err)
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	c.Type(fiber.MIMEApplicationJSON)
	return c.Status(fiber.StatusAccepted).Send(response)
}

func (h *Handler) routeOrder(c fiber.Ctx) error {
	var request OrderRequest
	if err := decodeStrict(c.Body(), &request); err != nil ||
		len(request.Intent) == 0 || len(request.Targets) == 0 ||
		!json.Valid(request.Intent) || !json.Valid(request.Targets) {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	response, err := h.gateway.RouteOrder(
		c.Context(),
		authenticatedUserID(c),
		request,
	)
	if err != nil {
		return gatewayHTTPError(err)
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	c.Type(fiber.MIMEApplicationJSON)
	return c.Status(fiber.StatusAccepted).Send(response)
}

func (h *Handler) listAccounts(c fiber.Ctx) error {
	accounts, err := h.gateway.ListAccounts(c.Context(), authenticatedUserID(c))
	if err != nil {
		return gatewayHTTPError(err)
	}
	return c.JSON(struct {
		Accounts []Account `json:"accounts"`
	}{Accounts: accounts})
}

func (h *Handler) issuePairingToken(c fiber.Ctx) error {
	var request struct {
		ExpiresInSeconds int `json:"expiresInSeconds"`
	}
	if err := decodeStrict(c.Body(), &request); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	if request.ExpiresInSeconds == 0 {
		request.ExpiresInSeconds = 300
	}
	if request.ExpiresInSeconds < 30 || request.ExpiresInSeconds > 600 {
		return fiber.NewError(
			fiber.StatusBadRequest,
			"expiresInSeconds must be between 30 and 600",
		)
	}
	token, err := h.gateway.IssuePairingToken(
		c.Context(),
		authenticatedUserID(c),
		request.ExpiresInSeconds,
	)
	if err != nil {
		return gatewayHTTPError(err)
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.Status(fiber.StatusCreated).JSON(token)
}

func decodeStrict(body []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}

func authenticatedUserID(c fiber.Ctx) string {
	id, _ := c.Locals(auth.LocalUserID).(string)
	return id
}

func validExecutionIdentifier(value string, maximum int) bool {
	if value == "" || len(value) > maximum {
		return false
	}
	for _, character := range []byte(value) {
		if (character >= 'a' && character <= 'z') ||
			(character >= 'A' && character <= 'Z') ||
			(character >= '0' && character <= '9') ||
			character == '.' || character == '_' || character == ':' || character == '-' {
			continue
		}
		return false
	}
	return true
}

func validSymbol(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 64 {
		return false
	}
	for _, character := range []byte(value) {
		if character < 0x21 || character > 0x7e {
			return false
		}
	}
	return true
}

func gatewayHTTPError(err error) error {
	var gatewayErr *GatewayError
	if errors.As(err, &gatewayErr) {
		switch gatewayErr.Status {
		case fiber.StatusTooManyRequests:
			return fiber.NewError(fiber.StatusTooManyRequests, "too many active pairing tokens")
		case fiber.StatusBadRequest, fiber.StatusConflict:
			return fiber.NewError(gatewayErr.Status, "execution request was rejected")
		case fiber.StatusUnprocessableEntity:
			return fiber.NewError(
				fiber.StatusUnprocessableEntity,
				"execution order was rejected",
			)
		}
	}
	log.Error().Err(err).Msg("execution gateway request failed")
	return fiber.NewError(fiber.StatusServiceUnavailable, "execution service unavailable")
}
