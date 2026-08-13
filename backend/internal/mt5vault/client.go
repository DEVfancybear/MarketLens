package mt5vault

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const maxVaultResponseBytes = 64 * 1024

// Credential is deliberately never JSON-logged or persisted by MarketLens.
// It exists only long enough to write an opaque record to Vault.
type Credential struct {
	Login    string `json:"login"`
	Password string `json:"password"`
	Server   string `json:"server"`
}

type Store interface {
	Put(context.Context, string, Credential) error
	Get(context.Context, string) (Credential, error)
	Delete(context.Context, string) error
}

type Config struct {
	Address   string
	TokenFile string
	Namespace string
	Mount     string
	Prefix    string
	Timeout   time.Duration
}

type Client struct {
	baseURL   *url.URL
	tokenFile string
	namespace string
	mount     string
	prefix    string
	http      *http.Client
}

func NewClient(config Config) (*Client, error) {
	baseURL, err := url.Parse(strings.TrimRight(strings.TrimSpace(config.Address), "/"))
	if err != nil || baseURL.Hostname() == "" || baseURL.User != nil ||
		baseURL.RawQuery != "" || baseURL.Fragment != "" || baseURL.Path != "" {
		return nil, errors.New("MT5 credential vault address must be an absolute origin")
	}
	hostIP := net.ParseIP(baseURL.Hostname())
	loopback := strings.EqualFold(baseURL.Hostname(), "localhost") ||
		(hostIP != nil && hostIP.IsLoopback())
	if baseURL.Scheme != "https" && !(baseURL.Scheme == "http" && loopback) {
		return nil, errors.New("MT5 credential vault must use HTTPS or loopback HTTP")
	}
	tokenFile := strings.TrimSpace(config.TokenFile)
	if tokenFile == "" || !filepath.IsAbs(tokenFile) {
		return nil, errors.New("MT5 credential vault token file must be absolute")
	}
	mount := strings.TrimSpace(config.Mount)
	prefix := strings.Trim(strings.TrimSpace(config.Prefix), "/")
	if !validSegment(mount) || !validPath(prefix) {
		return nil, errors.New("MT5 credential vault mount or prefix is invalid")
	}
	timeout := config.Timeout
	if timeout <= 0 || timeout > 15*time.Second {
		timeout = 5 * time.Second
	}
	return &Client{
		baseURL:   baseURL,
		tokenFile: tokenFile,
		namespace: strings.TrimSpace(config.Namespace),
		mount:     mount,
		prefix:    prefix,
		http: &http.Client{
			Timeout: timeout,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}, nil
}

func NewSecretRef() (string, error) {
	random := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, random); err != nil {
		return "", fmt.Errorf("generate MT5 vault reference: %w", err)
	}
	return "mt5-" + hex.EncodeToString(random), nil
}

func (client *Client) Put(ctx context.Context, secretRef string, credential Credential) error {
	if !validSecretRef(secretRef) || !validCredential(credential) {
		return errors.New("invalid MT5 credential vault write")
	}
	body, err := json.Marshal(struct {
		Data Credential `json:"data"`
	}{Data: credential})
	if err != nil {
		return errors.New("encode MT5 credential vault write")
	}
	defer clear(body)
	return client.request(ctx, http.MethodPost, "data", secretRef, body, false, nil)
}

// Get reads one KV v2 credential only after the execution authority has
// consumed an account/worker/lease-bound one-time grant. Callers must clear the
// returned password as soon as it has been serialized to the private worker.
func (client *Client) Get(ctx context.Context, secretRef string) (Credential, error) {
	if !validSecretRef(secretRef) {
		return Credential{}, errors.New("invalid MT5 credential vault read")
	}
	var response struct {
		Data struct {
			Data Credential `json:"data"`
		} `json:"data"`
	}
	if err := client.request(ctx, http.MethodGet, "data", secretRef, nil, false, &response); err != nil {
		return Credential{}, err
	}
	if !validCredential(response.Data.Data) {
		response.Data.Data.Password = ""
		return Credential{}, errors.New("MT5 credential vault response is invalid")
	}
	return response.Data.Data, nil
}

// Delete permanently removes KV v2 metadata and every credential version.
// Soft-deleting only the latest version would retain an old broker password.
func (client *Client) Delete(ctx context.Context, secretRef string) error {
	if !validSecretRef(secretRef) {
		return errors.New("invalid MT5 credential vault delete")
	}
	return client.request(ctx, http.MethodDelete, "metadata", secretRef, nil, true, nil)
}

func (client *Client) request(
	ctx context.Context,
	method string,
	kind string,
	secretRef string,
	body []byte,
	allowMissing bool,
	output any,
) error {
	token, err := client.readToken()
	if err != nil {
		return err
	}
	defer clear(token)
	endpoint := *client.baseURL
	endpoint.Path = "/v1/" + client.mount + "/" + kind + "/" +
		client.prefix + "/" + secretRef
	request, err := http.NewRequestWithContext(ctx, method, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return errors.New("create MT5 credential vault request")
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("X-Vault-Token", string(token))
	if client.namespace != "" {
		request.Header.Set("X-Vault-Namespace", client.namespace)
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := client.http.Do(request)
	if err != nil {
		return errors.New("MT5 credential vault request failed")
	}
	defer response.Body.Close()
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		if output == nil {
			_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, maxVaultResponseBytes))
			return nil
		}
		decoder := json.NewDecoder(io.LimitReader(response.Body, maxVaultResponseBytes))
		if err := decoder.Decode(output); err != nil {
			return errors.New("decode MT5 credential vault response")
		}
		return nil
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, maxVaultResponseBytes))
	if allowMissing && response.StatusCode == http.StatusNotFound {
		return nil
	}
	return fmt.Errorf("MT5 credential vault returned HTTP %d", response.StatusCode)
}

func (client *Client) readToken() ([]byte, error) {
	raw, err := os.ReadFile(client.tokenFile)
	if err != nil {
		return nil, errors.New("read MT5 credential vault token file")
	}
	token := bytes.TrimSpace(raw)
	if len(token) < 16 || len(token) > 4096 || bytes.ContainsAny(token, "\r\n\x00") {
		clear(raw)
		return nil, errors.New("MT5 credential vault token file is invalid")
	}
	result := append([]byte(nil), token...)
	clear(raw)
	return result, nil
}

func validCredential(value Credential) bool {
	login := strings.TrimSpace(value.Login)
	server := strings.TrimSpace(value.Server)
	return len(login) >= 1 && len(login) <= 32 && allDigits(login) &&
		len(value.Password) >= 1 && len(value.Password) <= 256 &&
		len(server) >= 1 && len(server) <= 128 &&
		!strings.ContainsAny(server, "\r\n\x00")
}

func validSecretRef(value string) bool {
	return len(value) == 36 && strings.HasPrefix(value, "mt5-") &&
		strings.IndexFunc(value[4:], func(character rune) bool {
			return !strings.ContainsRune("0123456789abcdef", character)
		}) == -1
}

func validSegment(value string) bool {
	if value == "" || len(value) > 64 {
		return false
	}
	return strings.IndexFunc(value, func(character rune) bool {
		return !(character >= 'a' && character <= 'z') &&
			!(character >= 'A' && character <= 'Z') &&
			!(character >= '0' && character <= '9') &&
			character != '-' && character != '_'
	}) == -1
}

func validPath(value string) bool {
	if value == "" || len(value) > 128 || strings.Contains(value, "..") {
		return false
	}
	for _, segment := range strings.Split(value, "/") {
		if !validSegment(segment) {
			return false
		}
	}
	return true
}

func allDigits(value string) bool {
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}
