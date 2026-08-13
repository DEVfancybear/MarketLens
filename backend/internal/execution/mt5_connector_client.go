package execution

import (
	"context"
	"net/http"
)

type MT5ConnectorAccount struct {
	AccountID          string `json:"accountId"`
	Label              string `json:"label"`
	Server             string `json:"server"`
	MaskedLoginSuffix  string `json:"maskedLoginSuffix,omitempty"`
	Persistence        string `json:"persistence"`
	ConnectionStatus   string `json:"connectionStatus"`
	ConnectionRevision uint64 `json:"connectionRevision"`
	UpdatedAtMS        int64  `json:"updatedAtMs"`
	SecretRef          string `json:"secretRef,omitempty"`
	PreviousSecretRef  string `json:"previousSecretRef,omitempty"`
	Created            bool   `json:"created,omitempty"`
	Ready              bool   `json:"ready,omitempty"`
}

type MT5ConnectorReserveRequest struct {
	OwnerID           string `json:"ownerId"`
	AccountID         string `json:"accountId"`
	Label             string `json:"label"`
	Server            string `json:"server"`
	MaskedLoginSuffix string `json:"maskedLoginSuffix"`
	Persistence       string `json:"persistence"`
	SecretRef         string `json:"secretRef"`
	ExpectedRevision  uint64 `json:"expectedRevision,omitempty"`
}

type MT5ConnectorActivateRequest struct {
	OwnerID           string `json:"ownerId"`
	AccountID         string `json:"accountId"`
	Label             string `json:"label"`
	Server            string `json:"server"`
	MaskedLoginSuffix string `json:"maskedLoginSuffix"`
	Persistence       string `json:"persistence"`
	SecretRef         string `json:"secretRef"`
	ExpectedRevision  uint64 `json:"expectedRevision"`
}

type MT5ConnectorAbortRequest struct {
	OwnerID           string `json:"ownerId"`
	AccountID         string `json:"accountId"`
	SecretRef         string `json:"secretRef"`
	PreviousSecretRef string `json:"previousSecretRef,omitempty"`
	ExpectedRevision  uint64 `json:"expectedRevision"`
	Created           bool   `json:"created"`
}

type MT5CredentialGrantConsumeRequest struct {
	ProtocolVersion   uint16 `json:"protocolVersion"`
	WorkerID          string `json:"workerId"`
	SessionGeneration uint64 `json:"sessionGeneration"`
	AccountID         string `json:"accountId"`
	LeaseGeneration   uint64 `json:"leaseGeneration"`
	CommandID         string `json:"commandId"`
	GrantToken        string `json:"grantToken"`
}

type MT5CredentialGrant struct {
	SecretRef   string `json:"secretRef"`
	Persistence string `json:"persistence"`
}

func (c *Client) ReserveMT5ConnectorAccount(ctx context.Context, request MT5ConnectorReserveRequest) (MT5ConnectorAccount, error) {
	var response MT5ConnectorAccount
	err := c.doJSON(ctx, http.MethodPost, c.resolve("/v1/admin/mt5-vm/accounts/reserve"), request, &response)
	return response, err
}

func (c *Client) ActivateMT5ConnectorAccount(ctx context.Context, request MT5ConnectorActivateRequest) (MT5ConnectorAccount, error) {
	var response MT5ConnectorAccount
	err := c.doJSON(ctx, http.MethodPost, c.resolve("/v1/admin/mt5-vm/accounts/activate"), request, &response)
	return response, err
}

func (c *Client) AbortMT5ConnectorAccount(ctx context.Context, request MT5ConnectorAbortRequest) error {
	var response struct {
		OK bool `json:"ok"`
	}
	return c.doJSON(ctx, http.MethodPost, c.resolve("/v1/admin/mt5-vm/accounts/abort"), request, &response)
}

func (c *Client) ListMT5ConnectorAccounts(ctx context.Context, ownerID string) ([]MT5ConnectorAccount, error) {
	endpoint := c.resolve("/v1/admin/mt5-vm/accounts")
	query := endpoint.Query()
	query.Set("ownerId", ownerID)
	endpoint.RawQuery = query.Encode()
	var response []MT5ConnectorAccount
	err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &response)
	return response, err
}

func (c *Client) MT5ConnectorAccount(ctx context.Context, ownerID, accountID string) (MT5ConnectorAccount, error) {
	endpoint := c.resolve("/v1/admin/mt5-vm/accounts/status")
	query := endpoint.Query()
	query.Set("ownerId", ownerID)
	query.Set("accountId", accountID)
	endpoint.RawQuery = query.Encode()
	var response MT5ConnectorAccount
	err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &response)
	return response, err
}

func (c *Client) ReconnectMT5ConnectorAccount(ctx context.Context, ownerID, accountID string, expectedRevision uint64) (MT5ConnectorAccount, error) {
	body := struct {
		OwnerID          string `json:"ownerId"`
		AccountID        string `json:"accountId"`
		ExpectedRevision uint64 `json:"expectedRevision"`
	}{ownerID, accountID, expectedRevision}
	var response MT5ConnectorAccount
	err := c.doJSON(ctx, http.MethodPost, c.resolve("/v1/admin/mt5-vm/accounts/reconnect"), body, &response)
	return response, err
}

func (c *Client) DisconnectMT5ConnectorAccount(ctx context.Context, ownerID, accountID string, expectedRevision uint64) (MT5ConnectorAccount, error) {
	body := struct {
		OwnerID          string `json:"ownerId"`
		AccountID        string `json:"accountId"`
		ExpectedRevision uint64 `json:"expectedRevision"`
	}{ownerID, accountID, expectedRevision}
	var response MT5ConnectorAccount
	err := c.doJSON(ctx, http.MethodPost, c.resolve("/v1/admin/mt5-vm/accounts/disconnect"), body, &response)
	return response, err
}

func (c *Client) PrepareDeleteMT5ConnectorAccount(ctx context.Context, ownerID, accountID string, expectedRevision uint64) (MT5ConnectorAccount, error) {
	body := struct {
		OwnerID          string `json:"ownerId"`
		AccountID        string `json:"accountId"`
		ExpectedRevision uint64 `json:"expectedRevision"`
	}{ownerID, accountID, expectedRevision}
	var response MT5ConnectorAccount
	err := c.doJSON(ctx, http.MethodPost, c.resolve("/v1/admin/mt5-vm/accounts/prepare-delete"), body, &response)
	return response, err
}

func (c *Client) FinalizeDeleteMT5ConnectorAccount(ctx context.Context, ownerID, accountID, secretRef, pendingSecretRef string, expectedRevision uint64) error {
	body := struct {
		OwnerID          string `json:"ownerId"`
		AccountID        string `json:"accountId"`
		SecretRef        string `json:"secretRef"`
		PendingSecretRef string `json:"pendingSecretRef,omitempty"`
		ExpectedRevision uint64 `json:"expectedRevision"`
	}{ownerID, accountID, secretRef, pendingSecretRef, expectedRevision}
	var response struct {
		OK bool `json:"ok"`
	}
	return c.doJSON(ctx, http.MethodPost, c.resolve("/v1/admin/mt5-vm/accounts/finalize-delete"), body, &response)
}

func (c *Client) ConsumeMT5CredentialGrant(ctx context.Context, request MT5CredentialGrantConsumeRequest) (MT5CredentialGrant, error) {
	var response MT5CredentialGrant
	err := c.doJSON(ctx, http.MethodPost, c.resolve("/v1/admin/mt5-vm/credential-grants/consume"), request, &response)
	return response, err
}
