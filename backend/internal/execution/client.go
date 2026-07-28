package execution

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const maxGatewayResponseBytes = 2 * 1024 * 1024

type Client struct {
	baseURL    *url.URL
	adminToken string
	httpClient *http.Client
}

type GatewayError struct {
	Status int
}

func (e *GatewayError) Error() string {
	return fmt.Sprintf("execution gateway returned HTTP %d", e.Status)
}

type gatewayAccount struct {
	AccountID    string          `json:"accountId"`
	Connected    bool            `json:"connected"`
	LastSeenAtMS int64           `json:"lastSeenAtMs"`
	Account      gatewaySnapshot `json:"account"`
}

type gatewaySnapshot struct {
	Login        string      `json:"login"`
	Broker       string      `json:"broker"`
	Server       string      `json:"server"`
	Mode         string      `json:"mode"`
	Currency     string      `json:"currency"`
	Balance      json.Number `json:"balance"`
	Equity       json.Number `json:"equity"`
	TradeAllowed bool        `json:"tradeAllowed"`
	EAVersion    string      `json:"eaVersion"`
}

type Account struct {
	ID                 string   `json:"id"`
	Label              string   `json:"label"`
	VenueKind          string   `json:"venueKind"`
	BrokerCode         string   `json:"brokerCode"`
	ExternalAccountRef string   `json:"externalAccountRef"`
	Server             string   `json:"server,omitempty"`
	Mode               string   `json:"mode"`
	Status             string   `json:"status"`
	Currency           string   `json:"currency"`
	Balance            *float64 `json:"balance,omitempty"`
	Equity             *float64 `json:"equity,omitempty"`
	TradeAllowed       bool     `json:"tradeAllowed"`
	UpdatedAt          int64    `json:"updatedAt"`
	EAVersion          string   `json:"eaVersion,omitempty"`
	StatusReason       string   `json:"statusReason,omitempty"`
}

type PairingToken struct {
	Token       string `json:"token"`
	ExpiresAtMS int64  `json:"expiresAtMs"`
}

type AccountLayout struct {
	ItemIDs     []string `json:"itemIds"`
	Revision    uint64   `json:"revision"`
	UpdatedAtMS int64    `json:"updatedAtMs"`
}

type AccountLayoutUpdate struct {
	ItemIDs          []string `json:"itemIds"`
	ExpectedRevision uint64   `json:"expectedRevision"`
}

type OrderRequest struct {
	Intent                 json.RawMessage `json:"intent"`
	Targets                json.RawMessage `json:"targets"`
	AuthorizationToken     string          `json:"authorizationToken"`
	AuthorizationSessionID string          `json:"authorizationSessionId"`
}

type CommandRequest struct {
	Command                json.RawMessage `json:"command"`
	AuthorizationToken     string          `json:"authorizationToken"`
	AuthorizationSessionID string          `json:"authorizationSessionId"`
}

type SymbolMappingRequest struct {
	AccountID       string `json:"accountId"`
	CanonicalSymbol string `json:"canonicalSymbol"`
	VenueSymbol     string `json:"venueSymbol"`
}

func NewClient(baseURL, adminToken string) (*Client, error) {
	parsed, err := parseLoopbackHTTPURL(baseURL)
	if err != nil {
		return nil, errors.New("invalid execution admin URL")
	}
	if len(adminToken) < 32 {
		return nil, errors.New("execution admin token must contain at least 32 characters")
	}
	return &Client{
		baseURL:    parsed,
		adminToken: adminToken,
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				// Never forward the service credential to a redirect target.
				return http.ErrUseLastResponse
			},
		},
	}, nil
}

func parseLoopbackHTTPURL(raw string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimRight(strings.TrimSpace(raw), "/"))
	hostIP := net.ParseIP(parsedHostname(parsed))
	if err != nil || parsed.Scheme != "http" || parsed.Hostname() == "" ||
		parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" ||
		(parsed.Hostname() != "localhost" && (hostIP == nil || !hostIP.IsLoopback())) {
		return nil, errors.New("URL must use loopback HTTP")
	}
	return parsed, nil
}

func parsedHostname(parsed *url.URL) string {
	if parsed == nil {
		return ""
	}
	return strings.ToLower(parsed.Hostname())
}

func (c *Client) ListAccounts(ctx context.Context, ownerID string) ([]Account, error) {
	endpoint := c.resolve("/v1/admin/accounts")
	query := endpoint.Query()
	query.Set("ownerId", ownerID)
	endpoint.RawQuery = query.Encode()

	var raw []gatewayAccount
	if err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &raw); err != nil {
		return nil, err
	}
	accounts := make([]Account, 0, len(raw))
	for _, item := range raw {
		status := "offline"
		statusReason := ""
		if item.Connected && !eaVersionSupported(item.Account.EAVersion) {
			status = "blocked"
			statusReason = "ea_update_required"
		} else if item.Connected && item.Account.TradeAllowed {
			status = "ready"
		} else if item.Connected {
			status = "blocked"
			statusReason = "broker_trading_disabled"
		}
		accounts = append(accounts, Account{
			ID:                 item.AccountID,
			Label:              strings.TrimSpace(item.Account.Broker + " " + item.Account.Login),
			VenueKind:          "metatrader5",
			BrokerCode:         normalizeBrokerCode(item.Account.Broker),
			ExternalAccountRef: item.Account.Login,
			Server:             item.Account.Server,
			Mode:               item.Account.Mode,
			Status:             status,
			Currency:           item.Account.Currency,
			Balance:            numberPointer(item.Account.Balance),
			Equity:             numberPointer(item.Account.Equity),
			TradeAllowed:       item.Account.TradeAllowed,
			UpdatedAt:          item.LastSeenAtMS,
			EAVersion:          item.Account.EAVersion,
			StatusReason:       statusReason,
		})
	}
	return accounts, nil
}

func (c *Client) AccountLayout(ctx context.Context, ownerID string) (AccountLayout, error) {
	endpoint := c.resolve("/v1/admin/account-layout")
	query := endpoint.Query()
	query.Set("ownerId", ownerID)
	endpoint.RawQuery = query.Encode()
	var layout AccountLayout
	err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &layout)
	return layout, err
}

func (c *Client) UpdateAccountLayout(
	ctx context.Context,
	ownerID string,
	request AccountLayoutUpdate,
) (AccountLayout, error) {
	body := struct {
		OwnerID          string   `json:"ownerId"`
		ItemIDs          []string `json:"itemIds"`
		ExpectedRevision uint64   `json:"expectedRevision"`
	}{
		OwnerID:          ownerID,
		ItemIDs:          request.ItemIDs,
		ExpectedRevision: request.ExpectedRevision,
	}
	var layout AccountLayout
	err := c.doJSON(
		ctx,
		http.MethodPost,
		c.resolve("/v1/admin/account-layout"),
		body,
		&layout,
	)
	return layout, err
}

func eaVersionSupported(value string) bool {
	core := strings.TrimSpace(value)
	if index := strings.IndexAny(core, "-+"); index >= 0 {
		core = core[:index]
	}
	parts := strings.Split(core, ".")
	if len(parts) < 2 || len(parts) > 3 {
		return false
	}
	version := [3]int{}
	for index, part := range parts {
		parsed, err := strconv.Atoi(part)
		if err != nil || parsed < 0 {
			return false
		}
		version[index] = parsed
	}
	if version[0] != 1 {
		return version[0] > 1
	}
	return version[1] >= 22
}

func (c *Client) IssuePairingToken(
	ctx context.Context,
	ownerID string,
	expiresInSeconds int,
) (PairingToken, error) {
	body := struct {
		OwnerID          string `json:"ownerId"`
		ExpiresInSeconds int    `json:"expiresInSeconds"`
	}{
		OwnerID:          ownerID,
		ExpiresInSeconds: expiresInSeconds,
	}
	var token PairingToken
	err := c.doJSON(
		ctx,
		http.MethodPost,
		c.resolve("/v1/admin/pairing-tokens"),
		body,
		&token,
	)
	return token, err
}

func (c *Client) DisconnectAccount(
	ctx context.Context,
	ownerID string,
	accountID string,
) error {
	return c.manageAccount(ctx, "/v1/admin/accounts/disconnect", ownerID, accountID)
}

func (c *Client) RemoveAccount(
	ctx context.Context,
	ownerID string,
	accountID string,
) error {
	return c.manageAccount(ctx, "/v1/admin/accounts/remove", ownerID, accountID)
}

func (c *Client) manageAccount(
	ctx context.Context,
	path string,
	ownerID string,
	accountID string,
) error {
	body := struct {
		OwnerID   string `json:"ownerId"`
		AccountID string `json:"accountId"`
	}{
		OwnerID:   ownerID,
		AccountID: accountID,
	}
	var response struct {
		OK bool `json:"ok"`
	}
	if err := c.doJSON(ctx, http.MethodPost, c.resolve(path), body, &response); err != nil {
		return err
	}
	if !response.OK {
		return errors.New("execution gateway returned an invalid account action acknowledgement")
	}
	return nil
}

func (c *Client) RouteOrder(
	ctx context.Context,
	ownerID string,
	order OrderRequest,
) (json.RawMessage, error) {
	body := struct {
		OwnerID                string          `json:"ownerId"`
		Intent                 json.RawMessage `json:"intent"`
		Targets                json.RawMessage `json:"targets"`
		AuthorizationToken     string          `json:"authorizationToken"`
		AuthorizationSessionID string          `json:"authorizationSessionId"`
	}{
		OwnerID:                ownerID,
		Intent:                 order.Intent,
		Targets:                order.Targets,
		AuthorizationToken:     order.AuthorizationToken,
		AuthorizationSessionID: order.AuthorizationSessionID,
	}
	var response json.RawMessage
	err := c.doJSON(
		ctx,
		http.MethodPost,
		c.resolve("/v1/admin/orders"),
		body,
		&response,
	)
	return response, err
}

func (c *Client) AccountState(
	ctx context.Context,
	ownerID string,
	accountID string,
) (json.RawMessage, error) {
	endpoint := c.resolve("/v1/admin/account-state")
	query := endpoint.Query()
	query.Set("ownerId", ownerID)
	query.Set("accountId", accountID)
	endpoint.RawQuery = query.Encode()
	var response json.RawMessage
	err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &response)
	return response, err
}

func (c *Client) AccountInstruments(
	ctx context.Context,
	ownerID string,
	accountID string,
) (json.RawMessage, error) {
	endpoint := c.resolve("/v1/admin/instruments")
	query := endpoint.Query()
	query.Set("ownerId", ownerID)
	query.Set("accountId", accountID)
	endpoint.RawQuery = query.Encode()
	var response json.RawMessage
	err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &response)
	return response, err
}

func (c *Client) UpsertSymbolMapping(
	ctx context.Context,
	ownerID string,
	request SymbolMappingRequest,
) (json.RawMessage, error) {
	body := struct {
		OwnerID         string `json:"ownerId"`
		AccountID       string `json:"accountId"`
		CanonicalSymbol string `json:"canonicalSymbol"`
		VenueSymbol     string `json:"venueSymbol"`
	}{
		OwnerID:         ownerID,
		AccountID:       request.AccountID,
		CanonicalSymbol: request.CanonicalSymbol,
		VenueSymbol:     request.VenueSymbol,
	}
	var response json.RawMessage
	err := c.doJSON(
		ctx,
		http.MethodPost,
		c.resolve("/v1/admin/symbol-mappings"),
		body,
		&response,
	)
	return response, err
}

func (c *Client) QueueCommand(
	ctx context.Context,
	ownerID string,
	request CommandRequest,
) (json.RawMessage, error) {
	body := struct {
		OwnerID                string          `json:"ownerId"`
		Command                json.RawMessage `json:"command"`
		AuthorizationToken     string          `json:"authorizationToken"`
		AuthorizationSessionID string          `json:"authorizationSessionId"`
	}{
		OwnerID:                ownerID,
		Command:                request.Command,
		AuthorizationToken:     request.AuthorizationToken,
		AuthorizationSessionID: request.AuthorizationSessionID,
	}
	var response json.RawMessage
	err := c.doJSON(
		ctx,
		http.MethodPost,
		c.resolve("/v1/admin/commands"),
		body,
		&response,
	)
	return response, err
}

func (c *Client) resolve(path string) *url.URL {
	resolved := *c.baseURL
	resolved.Path = strings.TrimRight(resolved.Path, "/") + path
	resolved.RawQuery = ""
	resolved.Fragment = ""
	return &resolved
}

func (c *Client) doJSON(
	ctx context.Context,
	method string,
	endpoint *url.URL,
	body any,
	output any,
) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("encode execution request: %w", err)
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint.String(), reader)
	if err != nil {
		return fmt.Errorf("create execution request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("X-Execution-Admin-Token", c.adminToken)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}

	response, err := c.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("call execution gateway: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 16*1024))
		return &GatewayError{Status: response.StatusCode}
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, maxGatewayResponseBytes))
	decoder.UseNumber()
	if err := decoder.Decode(output); err != nil {
		return fmt.Errorf("decode execution response: %w", err)
	}
	return nil
}

func numberPointer(value json.Number) *float64 {
	if value == "" {
		return nil
	}
	parsed, err := strconv.ParseFloat(value.String(), 64)
	if err != nil {
		return nil
	}
	return &parsed
}

func normalizeBrokerCode(value string) string {
	var builder strings.Builder
	previousDash := false
	for _, char := range strings.ToLower(strings.TrimSpace(value)) {
		isAlphaNumeric := char >= 'a' && char <= 'z' || char >= '0' && char <= '9'
		if isAlphaNumeric {
			builder.WriteRune(char)
			previousDash = false
		} else if !previousDash && builder.Len() > 0 {
			builder.WriteByte('-')
			previousDash = true
		}
	}
	return strings.TrimRight(builder.String(), "-")
}
