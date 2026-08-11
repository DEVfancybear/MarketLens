package config

import (
	"fmt"
	"net"
	"net/mail"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata"

	"github.com/joho/godotenv"
)

// Config holds every runtime setting the backend needs. Values come from the
// environment (optionally seeded from a local .env file in development).
type Config struct {
	Port int
	Env  string

	// AuthCookieSecure controls whether backend session cookies require HTTPS.
	// It defaults to true outside development and can be disabled explicitly
	// for a local production-mode HTTP setup.
	AuthCookieSecure *bool

	DatabaseURL string

	ExecutionEAURL      string
	ExecutionAdminURL   string
	ExecutionAdminToken string

	AuthJWTSecret          string
	PushWorkerSecret       string
	AlertEvaluatorEnabled  bool
	AlertEvaluatorURL      string
	AlertEvaluatorInterval time.Duration
	AlertEvaluatorTimeout  time.Duration
	AuthAccessTTL          time.Duration
	AuthRefreshTTL         time.Duration
	TradeAuthorizationTTL  time.Duration
	TradeRecoverySMTPHost  string
	TradeRecoverySMTPPort  int
	TradeRecoverySMTPUser  string
	TradeRecoverySMTPPass  string
	TradeRecoverySMTPMode  string
	TradeRecoveryEmailFrom string

	FirebaseProjectID   string
	FirebaseClientEmail string
	FirebasePrivateKey  string

	CORSAllowedOrigins []string
	ChartTimeZone      string

	ObjectStorageEndpoint     string
	ObjectStorageBucket       string
	ObjectStorageRegion       string
	ObjectStorageAccessKey    string
	ObjectStorageSecretKey    string
	ObjectStorageSessionToken string
	ObjectStoragePathStyle    bool

	MT5StreamAPIEnabled     bool
	MT5BridgeWSURL          string
	MT5BridgeDialTimeout    time.Duration
	MT5BridgeReadLimitBytes int64
	MT5BridgeReconnectMin   time.Duration
	MT5BridgeReconnectMax   time.Duration
	MT5TerminalPath         string

	ReplayEngineEnabled    bool
	ReplayMaxBars          int
	ReplayMaxTracks        int
	ReplayCleanupInterval  time.Duration
	ReplaySessionRetention time.Duration
	ReplayDatasetRetention time.Duration
	ReplayDisconnectGrace  time.Duration
	ReplayActorLeaseTTL    time.Duration
}

// IsProduction reports whether the app is running outside local development.
// The Secure cookie flag and the required-secret checks key off this.
func (c Config) IsProduction() bool {
	return c.Env != "development"
}

// FirebaseConfigured reports whether the full Firebase service account is set —
// used to decide whether the auth routes can be mounted.
func (c Config) FirebaseConfigured() bool {
	return c.FirebaseProjectID != "" && c.FirebaseClientEmail != "" && c.FirebasePrivateKey != ""
}

func (c Config) ObjectStorageConfigured() bool {
	return c.ObjectStorageBucket != "" && c.ObjectStorageAccessKey != "" && c.ObjectStorageSecretKey != ""
}

// TradeRecoveryEmailConfigured reports whether the backend can deliver trade
// password recovery codes. Authentication is optional for local SMTP relays,
// but username/password must always be supplied as a pair.
func (c Config) TradeRecoveryEmailConfigured() bool {
	return strings.TrimSpace(c.TradeRecoverySMTPHost) != "" &&
		c.TradeRecoverySMTPPort > 0 &&
		strings.TrimSpace(c.TradeRecoveryEmailFrom) != "" &&
		((c.TradeRecoverySMTPUser == "" && c.TradeRecoverySMTPPass == "") ||
			(c.TradeRecoverySMTPUser != "" && c.TradeRecoverySMTPPass != ""))
}

// Load reads configuration from the environment. In development it best-effort
// loads a local .env file first. It returns an error (rather than exiting) when
// a required secret is missing outside development, so the caller controls the
// failure path.
func Load() (Config, error) {
	// Best-effort: a missing .env is fine (production injects real env vars).
	_ = godotenv.Load()
	// Local monorepo development keeps shared worker secrets in the root env.
	// godotenv does not overwrite values already loaded from backend/.env.
	_ = godotenv.Load("../.env.local")
	_ = godotenv.Load("../.env")

	env := getEnv("APP_ENV", "development")
	authCookieSecure := getEnvBool("AUTH_COOKIE_SECURE", env != "development")
	corsAllowedOrigins := splitAndTrim(getEnv("CORS_ALLOWED_ORIGINS", "http://localhost:3000"))
	alertEvaluatorEnabled := getEnvBool("ALERT_EVALUATOR_ENABLED", true)
	cfg := Config{
		Port:                   getEnvInt("PORT", 8080),
		Env:                    env,
		AuthCookieSecure:       &authCookieSecure,
		DatabaseURL:            os.Getenv("DATABASE_URL"),
		ExecutionEAURL:         getEnv("EXECUTION_EA_URL", "http://127.0.0.1:8790"),
		ExecutionAdminURL:      getEnv("EXECUTION_ADMIN_URL", "http://127.0.0.1:8791"),
		ExecutionAdminToken:    os.Getenv("EXECUTION_ADMIN_TOKEN"),
		AuthJWTSecret:          os.Getenv("AUTH_JWT_SECRET"),
		PushWorkerSecret:       os.Getenv("PUSH_WORKER_SECRET"),
		AlertEvaluatorEnabled:  alertEvaluatorEnabled,
		AlertEvaluatorURL:      getEnv("ALERT_EVALUATOR_URL", defaultAlertEvaluatorURL(env, corsAllowedOrigins)),
		AlertEvaluatorInterval: getEnvDuration("ALERT_EVALUATOR_INTERVAL", 15*time.Second),
		AlertEvaluatorTimeout:  getEnvDuration("ALERT_EVALUATOR_TIMEOUT", 30*time.Second),
		AuthAccessTTL:          getEnvDuration("AUTH_ACCESS_TTL", 15*time.Minute),
		AuthRefreshTTL:         getEnvDuration("AUTH_REFRESH_TTL", 720*time.Hour),
		TradeAuthorizationTTL:  getEnvDuration("TRADE_AUTHORIZATION_TTL", 45*time.Second),
		TradeRecoverySMTPHost:  strings.TrimSpace(os.Getenv("TRADE_RECOVERY_SMTP_HOST")),
		TradeRecoverySMTPPort:  getEnvInt("TRADE_RECOVERY_SMTP_PORT", 587),
		TradeRecoverySMTPUser:  os.Getenv("TRADE_RECOVERY_SMTP_USERNAME"),
		TradeRecoverySMTPPass:  os.Getenv("TRADE_RECOVERY_SMTP_PASSWORD"),
		TradeRecoverySMTPMode:  strings.ToLower(strings.TrimSpace(getEnv("TRADE_RECOVERY_SMTP_MODE", "starttls"))),
		TradeRecoveryEmailFrom: strings.TrimSpace(os.Getenv("TRADE_RECOVERY_EMAIL_FROM")),
		FirebaseProjectID:      os.Getenv("FIREBASE_PROJECT_ID"),
		FirebaseClientEmail:    os.Getenv("FIREBASE_CLIENT_EMAIL"),
		// The private key is stored \n-escaped (same as the frontend push key);
		// restore the real newlines so it parses as PEM.
		FirebasePrivateKey:        strings.ReplaceAll(os.Getenv("FIREBASE_PRIVATE_KEY"), `\n`, "\n"),
		CORSAllowedOrigins:        corsAllowedOrigins,
		ChartTimeZone:             strings.TrimSpace(getEnv("CHART_TIME_ZONE", "Asia/Ho_Chi_Minh")),
		ObjectStorageEndpoint:     os.Getenv("OBJECT_STORAGE_ENDPOINT"),
		ObjectStorageBucket:       os.Getenv("OBJECT_STORAGE_BUCKET"),
		ObjectStorageRegion:       getEnv("OBJECT_STORAGE_REGION", "us-east-1"),
		ObjectStorageAccessKey:    os.Getenv("OBJECT_STORAGE_ACCESS_KEY"),
		ObjectStorageSecretKey:    os.Getenv("OBJECT_STORAGE_SECRET_KEY"),
		ObjectStorageSessionToken: os.Getenv("OBJECT_STORAGE_SESSION_TOKEN"),
		ObjectStoragePathStyle:    getEnvBool("OBJECT_STORAGE_PATH_STYLE", false),
		MT5StreamAPIEnabled:       getEnvBool("MT5_STREAM_API_ENABLED", true),
		MT5BridgeWSURL:            getEnv("MT5_BRIDGE_WS_URL", "ws://localhost:8765"),
		MT5BridgeDialTimeout:      getEnvDurationOrSeconds("MT5_BRIDGE_DIAL_TIMEOUT_SECONDS", 10*time.Second),
		MT5BridgeReadLimitBytes:   getEnvInt64("MT5_BRIDGE_READ_LIMIT_BYTES", 8*1024*1024),
		MT5BridgeReconnectMin:     getEnvDuration("MT5_BRIDGE_RECONNECT_MIN", time.Second),
		MT5BridgeReconnectMax:     getEnvDuration("MT5_BRIDGE_RECONNECT_MAX", 30*time.Second),
		MT5TerminalPath:           strings.TrimSpace(os.Getenv("MT5_TERMINAL_PATH")),
		ReplayEngineEnabled:       getEnvBool("REPLAY_ENGINE_ENABLED", false),
		ReplayMaxBars:             getEnvInt("REPLAY_MAX_BARS_PER_TRACK", 5000),
		ReplayMaxTracks:           getEnvInt("REPLAY_MAX_TRACKS_PER_SESSION", 4),
		ReplayCleanupInterval:     getEnvDuration("REPLAY_CLEANUP_INTERVAL", time.Hour),
		ReplaySessionRetention:    getEnvDuration("REPLAY_SESSION_RETENTION", 720*time.Hour),
		ReplayDatasetRetention:    getEnvDuration("REPLAY_DATASET_RETENTION", 168*time.Hour),
		ReplayDisconnectGrace:     getEnvDuration("REPLAY_DISCONNECT_GRACE", 5*time.Second),
		ReplayActorLeaseTTL:       getEnvDuration("REPLAY_ACTOR_LEASE_TTL", 5*time.Second),
	}

	if err := cfg.validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// AuthCookiesSecure returns the effective Secure flag for backend session
// cookies. Config values built manually (for tests/tools) preserve the original
// environment-based default when no explicit override is supplied.
func (c Config) AuthCookiesSecure() bool {
	if c.AuthCookieSecure != nil {
		return *c.AuthCookieSecure
	}
	return c.IsProduction()
}

// validate fails fast when required secrets are absent in a non-development
// environment. Development stays permissive so `go run` works with no setup.
func (c Config) validate() error {
	if _, err := time.LoadLocation(c.ChartTimeZone); err != nil {
		return fmt.Errorf("CHART_TIME_ZONE must be a valid IANA time zone: %q", c.ChartTimeZone)
	}
	for _, origin := range c.CORSAllowedOrigins {
		if err := validateCORSOrigin(origin); err != nil {
			return err
		}
	}
	if c.AlertEvaluatorEnabled {
		if err := validateAlertEvaluatorURL(c.AlertEvaluatorURL); err != nil {
			return err
		}
	}
	// Never assemble authentication with an empty or guessable HMAC key, even
	// in development. A dev server is often reachable from the local network.
	if c.DatabaseURL != "" && c.FirebaseConfigured() {
		if len(c.AuthJWTSecret) < 32 {
			return fmt.Errorf("AUTH_JWT_SECRET must contain at least 32 characters when authentication is configured")
		}
		if c.AuthAccessTTL < time.Minute || c.AuthAccessTTL > time.Hour {
			return fmt.Errorf("AUTH_ACCESS_TTL must be between 1m and 1h when authentication is configured")
		}
		if c.AuthRefreshTTL <= c.AuthAccessTTL || c.AuthRefreshTTL > 90*24*time.Hour {
			return fmt.Errorf("AUTH_REFRESH_TTL must be longer than AUTH_ACCESS_TTL and at most 2160h")
		}
	}
	if strings.TrimSpace(c.ExecutionAdminToken) != "" {
		if len(c.ExecutionAdminToken) < 32 {
			return fmt.Errorf("EXECUTION_ADMIN_TOKEN must contain at least 32 characters")
		}
		if err := validateLoopbackServiceURL("EXECUTION_EA_URL", c.ExecutionEAURL); err != nil {
			return err
		}
		if err := validateLoopbackServiceURL("EXECUTION_ADMIN_URL", c.ExecutionAdminURL); err != nil {
			return err
		}
		if c.TradeAuthorizationTTL < 10*time.Second || c.TradeAuthorizationTTL > 2*time.Minute {
			return fmt.Errorf("TRADE_AUTHORIZATION_TTL must be between 10s and 2m")
		}
	}
	if err := c.validateTradeRecoveryEmail(); err != nil {
		return err
	}

	storageValues := []string{c.ObjectStorageBucket, c.ObjectStorageAccessKey, c.ObjectStorageSecretKey}
	storageSet := 0
	for _, value := range storageValues {
		if strings.TrimSpace(value) != "" {
			storageSet++
		}
	}
	if storageSet != 0 && storageSet != len(storageValues) {
		return fmt.Errorf("OBJECT_STORAGE_BUCKET, OBJECT_STORAGE_ACCESS_KEY and OBJECT_STORAGE_SECRET_KEY must be configured together")
	}
	if !c.IsProduction() {
		return nil
	}

	required := map[string]string{
		"DATABASE_URL":                 c.DatabaseURL,
		"AUTH_JWT_SECRET":              c.AuthJWTSecret,
		"FIREBASE_PROJECT_ID":          c.FirebaseProjectID,
		"FIREBASE_CLIENT_EMAIL":        c.FirebaseClientEmail,
		"FIREBASE_PRIVATE_KEY":         c.FirebasePrivateKey,
		"PUSH_WORKER_SECRET":           c.PushWorkerSecret,
		"EXECUTION_ADMIN_TOKEN":        c.ExecutionAdminToken,
		"TRADE_RECOVERY_SMTP_HOST":     c.TradeRecoverySMTPHost,
		"TRADE_RECOVERY_SMTP_USERNAME": c.TradeRecoverySMTPUser,
		"TRADE_RECOVERY_SMTP_PASSWORD": c.TradeRecoverySMTPPass,
		"TRADE_RECOVERY_EMAIL_FROM":    c.TradeRecoveryEmailFrom,
	}
	if c.AlertEvaluatorEnabled {
		required["ALERT_EVALUATOR_URL"] = c.AlertEvaluatorURL
	}

	var missing []string
	for name, value := range required {
		if strings.TrimSpace(value) == "" {
			missing = append(missing, name)
		}
	}
	if len(c.CORSAllowedOrigins) == 0 {
		missing = append(missing, "CORS_ALLOWED_ORIGINS")
	}

	if len(missing) > 0 {
		sort.Strings(missing)
		return fmt.Errorf("missing required environment variables for APP_ENV=%s: %s",
			c.Env, strings.Join(missing, ", "))
	}
	if len(c.AuthJWTSecret) < 32 {
		return fmt.Errorf("AUTH_JWT_SECRET must contain at least 32 characters")
	}
	if len(c.PushWorkerSecret) < 32 {
		return fmt.Errorf("PUSH_WORKER_SECRET must contain at least 32 characters")
	}
	if !c.AuthCookiesSecure() {
		return fmt.Errorf("AUTH_COOKIE_SECURE cannot be disabled in production")
	}
	return nil
}

func (c Config) validateTradeRecoveryEmail() error {
	host := strings.TrimSpace(c.TradeRecoverySMTPHost)
	from := strings.TrimSpace(c.TradeRecoveryEmailFrom)
	userSet := c.TradeRecoverySMTPUser != ""
	passSet := c.TradeRecoverySMTPPass != ""
	anySet := host != "" || from != "" || userSet || passSet
	if !anySet {
		return nil
	}
	if host == "" || from == "" || userSet != passSet {
		return fmt.Errorf("TRADE_RECOVERY_SMTP_HOST, TRADE_RECOVERY_EMAIL_FROM and both SMTP credentials must be configured together")
	}
	if c.TradeRecoverySMTPPort < 1 || c.TradeRecoverySMTPPort > 65535 {
		return fmt.Errorf("TRADE_RECOVERY_SMTP_PORT must be between 1 and 65535")
	}
	address, err := mail.ParseAddress(from)
	if err != nil || address.Address == "" {
		return fmt.Errorf("TRADE_RECOVERY_EMAIL_FROM must be a valid email address")
	}
	switch c.TradeRecoverySMTPMode {
	case "starttls", "tls":
	case "plain":
		ip := net.ParseIP(host)
		if c.IsProduction() || (host != "localhost" && (ip == nil || !ip.IsLoopback())) {
			return fmt.Errorf("TRADE_RECOVERY_SMTP_MODE=plain is allowed only for a local development SMTP server")
		}
		if userSet {
			return fmt.Errorf("TRADE_RECOVERY_SMTP_MODE=plain cannot be used with SMTP credentials")
		}
	default:
		return fmt.Errorf("TRADE_RECOVERY_SMTP_MODE must be starttls, tls, or plain")
	}
	return nil
}

func validateLoopbackServiceURL(name, raw string) error {
	raw = strings.TrimSpace(raw)
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "http" || u.Hostname() == "" ||
		u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("%s must be an absolute loopback HTTP URL", name)
	}
	host := strings.ToLower(u.Hostname())
	ip := net.ParseIP(host)
	if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return fmt.Errorf("%s must use localhost or a loopback IP", name)
	}
	return nil
}

func validateCORSOrigin(raw string) error {
	raw = strings.TrimSpace(raw)
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" ||
		u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("CORS_ALLOWED_ORIGINS contains an invalid absolute origin: %q", raw)
	}
	return nil
}

func defaultAlertEvaluatorURL(env string, origins []string) string {
	if strings.TrimSpace(env) == "development" {
		return "http://localhost:3000/api/push/evaluate"
	}
	for _, raw := range origins {
		u, err := url.Parse(strings.TrimSpace(raw))
		if err != nil || u.Scheme != "https" || u.Hostname() == "" {
			continue
		}
		host := strings.TrimSpace(strings.ToLower(u.Hostname()))
		ip := net.ParseIP(host)
		if host == "localhost" || (ip != nil && ip.IsLoopback()) {
			continue
		}
		return strings.TrimRight(raw, "/") + "/api/push/evaluate"
	}
	return ""
}

func validateAlertEvaluatorURL(raw string) error {
	raw = strings.TrimSpace(raw)
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") ||
		u.Hostname() == "" || u.User != nil || u.Fragment != "" {
		return fmt.Errorf("ALERT_EVALUATOR_URL must be an absolute HTTP(S) URL: %q", raw)
	}
	return nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func getEnvInt64(key string, fallback int64) int64 {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return n
		}
	}
	return fallback
}

func getEnvBool(key string, fallback bool) bool {
	if v := os.Getenv(key); v != "" {
		switch strings.ToLower(strings.TrimSpace(v)) {
		case "1", "true", "yes", "y", "on":
			return true
		case "0", "false", "no", "n", "off":
			return false
		}
	}
	return fallback
}

func getEnvDuration(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}

func getEnvDurationOrSeconds(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return time.Duration(n) * time.Second
		}
	}
	return fallback
}

func splitAndTrim(v string) []string {
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}
