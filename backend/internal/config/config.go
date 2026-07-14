package config

import (
	"fmt"
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

	DatabaseURL string

	AuthJWTSecret          string
	PushWorkerSecret       string
	AlertEvaluatorEnabled  bool
	AlertEvaluatorURL      string
	AlertEvaluatorInterval time.Duration
	AlertEvaluatorTimeout  time.Duration
	AuthAccessTTL          time.Duration
	AuthRefreshTTL         time.Duration

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

	cfg := Config{
		Port:                   getEnvInt("PORT", 8080),
		Env:                    getEnv("APP_ENV", "development"),
		DatabaseURL:            os.Getenv("DATABASE_URL"),
		AuthJWTSecret:          os.Getenv("AUTH_JWT_SECRET"),
		PushWorkerSecret:       os.Getenv("PUSH_WORKER_SECRET"),
		AlertEvaluatorEnabled:  getEnvBool("ALERT_EVALUATOR_ENABLED", true),
		AlertEvaluatorURL:      getEnv("ALERT_EVALUATOR_URL", "http://localhost:3000/api/push/evaluate"),
		AlertEvaluatorInterval: getEnvDuration("ALERT_EVALUATOR_INTERVAL", 15*time.Second),
		AlertEvaluatorTimeout:  getEnvDuration("ALERT_EVALUATOR_TIMEOUT", 30*time.Second),
		AuthAccessTTL:          getEnvDuration("AUTH_ACCESS_TTL", 15*time.Minute),
		AuthRefreshTTL:         getEnvDuration("AUTH_REFRESH_TTL", 720*time.Hour),
		FirebaseProjectID:      os.Getenv("FIREBASE_PROJECT_ID"),
		FirebaseClientEmail:    os.Getenv("FIREBASE_CLIENT_EMAIL"),
		// The private key is stored \n-escaped (same as the frontend push key);
		// restore the real newlines so it parses as PEM.
		FirebasePrivateKey:        strings.ReplaceAll(os.Getenv("FIREBASE_PRIVATE_KEY"), `\n`, "\n"),
		CORSAllowedOrigins:        splitAndTrim(getEnv("CORS_ALLOWED_ORIGINS", "http://localhost:3000")),
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

// validate fails fast when required secrets are absent in a non-development
// environment. Development stays permissive so `go run` works with no setup.
func (c Config) validate() error {
	if _, err := time.LoadLocation(c.ChartTimeZone); err != nil {
		return fmt.Errorf("CHART_TIME_ZONE must be a valid IANA time zone: %q", c.ChartTimeZone)
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
		"DATABASE_URL":          c.DatabaseURL,
		"AUTH_JWT_SECRET":       c.AuthJWTSecret,
		"FIREBASE_PROJECT_ID":   c.FirebaseProjectID,
		"FIREBASE_CLIENT_EMAIL": c.FirebaseClientEmail,
		"FIREBASE_PRIVATE_KEY":  c.FirebasePrivateKey,
		"PUSH_WORKER_SECRET":    c.PushWorkerSecret,
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
