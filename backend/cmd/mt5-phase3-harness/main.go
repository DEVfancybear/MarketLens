// Command mt5-phase3-harness exposes only a loopback disposable verification server.
// It assembles the production MT5 connector handler, gateway client, JWT middleware,
// and Vault client without requiring an external Firebase identity provider.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"github.com/marketlens/backend/internal/auth"
	"github.com/marketlens/backend/internal/config"
	"github.com/marketlens/backend/internal/execution"
	"github.com/marketlens/backend/internal/mt5vault"
)

type harnessConfig struct {
	ListenAddress           string           `json:"listenAddress"`
	ExecutionAdminURL       string           `json:"executionAdminUrl"`
	ExecutionAdminTokenFile string           `json:"executionAdminTokenFile"`
	VaultAddress            string           `json:"vaultAddress"`
	VaultTokenFile          string           `json:"vaultTokenFile"`
	AuthJWTSecretFile       string           `json:"authJwtSecretFile"`
	Sessions                []harnessSession `json:"sessions"`
}

type harnessSession struct {
	UserID    string `json:"userId"`
	SessionID string `json:"sessionId"`
}

type activeSessions map[string]struct{}

func (sessions activeSessions) IsActive(_ context.Context, sessionID, userID string) (bool, error) {
	_, ok := sessions[userID+"|"+sessionID]
	return ok, nil
}

func main() {
	cfg, err := readConfig(os.Stdin)
	if err != nil {
		fmt.Fprintln(os.Stderr, "MT5_PHASE3_HARNESS_CONFIG_INVALID")
		os.Exit(2)
	}
	adminToken, err := readSecretFile(cfg.ExecutionAdminTokenFile)
	if err != nil || len(adminToken) < 32 {
		fmt.Fprintln(os.Stderr, "MT5_PHASE3_HARNESS_ADMIN_TOKEN_INVALID")
		os.Exit(2)
	}
	authSecret, err := readSecretFile(cfg.AuthJWTSecretFile)
	if err != nil || len(authSecret) < 32 {
		fmt.Fprintln(os.Stderr, "MT5_PHASE3_HARNESS_AUTH_SECRET_INVALID")
		os.Exit(2)
	}

	gateway, err := execution.NewClient(cfg.ExecutionAdminURL, adminToken)
	adminToken = ""
	if err != nil {
		fmt.Fprintln(os.Stderr, "MT5_PHASE3_HARNESS_GATEWAY_INVALID")
		os.Exit(2)
	}
	gateway.EnableMT5Connector()
	vault, err := mt5vault.NewClient(mt5vault.Config{
		Address:   cfg.VaultAddress,
		TokenFile: cfg.VaultTokenFile,
		Mount:     "secret",
		Prefix:    "marketlens/mt5",
		Timeout:   5 * time.Second,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "MT5_PHASE3_HARNESS_VAULT_INVALID")
		os.Exit(2)
	}

	tokenService := auth.NewTokenService(config.Config{
		AuthJWTSecret: authSecret,
		AuthAccessTTL: 15 * time.Minute,
	})
	authSecret = ""
	checker := make(activeSessions, len(cfg.Sessions))
	for _, session := range cfg.Sessions {
		checker[session.UserID+"|"+session.SessionID] = struct{}{}
	}
	handler := execution.NewHandler(
		gateway,
		auth.RequireAuth(tokenService),
		auth.RequireActiveSession(checker),
	).WithMT5ConnectorVault(vault)

	app := fiber.New(fiber.Config{
		BodyLimit:    256 * 1024,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 20 * time.Second,
		ErrorHandler: func(c fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			var fiberErr *fiber.Error
			if errors.As(err, &fiberErr) {
				code = fiberErr.Code
			}
			return c.Status(code).JSON(fiber.Map{"error": "request rejected"})
		},
	})
	app.Get("/health", func(c fiber.Ctx) error { return c.JSON(fiber.Map{"ok": true}) })
	handler.Register(app.Group("/api/v1"))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		_ = app.ShutdownWithTimeout(5 * time.Second)
	}()
	if err := app.Listen(cfg.ListenAddress, fiber.ListenConfig{DisableStartupMessage: true}); err != nil {
		fmt.Fprintln(os.Stderr, "MT5_PHASE3_HARNESS_LISTEN_FAILED")
		os.Exit(1)
	}
}

func readConfig(reader io.Reader) (harnessConfig, error) {
	decoder := json.NewDecoder(io.LimitReader(reader, 64*1024))
	decoder.DisallowUnknownFields()
	var cfg harnessConfig
	if err := decoder.Decode(&cfg); err != nil {
		return harnessConfig{}, err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return harnessConfig{}, fmt.Errorf("trailing JSON")
	}
	host, _, err := net.SplitHostPort(cfg.ListenAddress)
	if err != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() {
		return harnessConfig{}, fmt.Errorf("listen address must be loopback")
	}
	if err := validateServiceOrigin(cfg.ExecutionAdminURL, true); err != nil {
		return harnessConfig{}, err
	}
	if err := validateServiceOrigin(cfg.VaultAddress, false); err != nil {
		return harnessConfig{}, err
	}
	for _, path := range []string{
		cfg.ExecutionAdminTokenFile,
		cfg.VaultTokenFile,
		cfg.AuthJWTSecretFile,
	} {
		if _, err := checkedRealFile(path); err != nil {
			return harnessConfig{}, err
		}
	}
	if len(cfg.Sessions) != 2 {
		return harnessConfig{}, fmt.Errorf("exactly two sessions are required")
	}
	seen := make(map[string]struct{}, len(cfg.Sessions))
	for _, session := range cfg.Sessions {
		if _, err := uuid.Parse(session.UserID); err != nil {
			return harnessConfig{}, fmt.Errorf("invalid user")
		}
		if _, err := uuid.Parse(session.SessionID); err != nil {
			return harnessConfig{}, fmt.Errorf("invalid session")
		}
		key := session.UserID + "|" + session.SessionID
		if _, duplicate := seen[key]; duplicate {
			return harnessConfig{}, fmt.Errorf("duplicate session")
		}
		seen[key] = struct{}{}
	}
	return cfg, nil
}

func validateServiceOrigin(raw string, loopbackOnly bool) error {
	parsed, err := url.Parse(strings.TrimRight(strings.TrimSpace(raw), "/"))
	if err != nil || parsed.Hostname() == "" || parsed.User != nil || parsed.Path != "" ||
		parsed.RawQuery != "" || parsed.Fragment != "" {
		return fmt.Errorf("invalid service origin")
	}
	ip := net.ParseIP(parsed.Hostname())
	loopback := strings.EqualFold(parsed.Hostname(), "localhost") || (ip != nil && ip.IsLoopback())
	if loopbackOnly && (parsed.Scheme != "http" || !loopback) {
		return fmt.Errorf("service must use loopback HTTP")
	}
	if !loopbackOnly && parsed.Scheme != "https" && !(parsed.Scheme == "http" && loopback) {
		return fmt.Errorf("service must use HTTPS or loopback HTTP")
	}
	return nil
}

func checkedRealFile(path string) (string, error) {
	if !filepath.IsAbs(path) {
		return "", fmt.Errorf("secret path must be absolute")
	}
	cleaned := filepath.Clean(path)
	real, err := filepath.EvalSymlinks(cleaned)
	if err != nil || !strings.EqualFold(cleaned, real) {
		return "", fmt.Errorf("secret path must be a real file")
	}
	info, err := os.Stat(real)
	if err != nil || !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > 8192 {
		return "", fmt.Errorf("secret file is invalid")
	}
	return real, nil
}

func readSecretFile(path string) (string, error) {
	real, err := checkedRealFile(path)
	if err != nil {
		return "", err
	}
	contents, err := os.ReadFile(real)
	if err != nil {
		return "", err
	}
	defer clear(contents)
	value := strings.TrimSpace(string(contents))
	if value == "" || strings.ContainsFunc(value, func(r rune) bool { return r < 0x21 || r == 0x7f }) {
		return "", fmt.Errorf("secret file content is invalid")
	}
	return value, nil
}
