package config

import (
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

// Config holds every runtime setting the backend needs. Values come from the
// environment (optionally seeded from a local .env file in development).
type Config struct {
	Port int
	Env  string

	DatabaseURL string

	AuthJWTSecret  string
	AuthAccessTTL  time.Duration
	AuthRefreshTTL time.Duration

	FirebaseProjectID   string
	FirebaseClientEmail string
	FirebasePrivateKey  string

	CORSAllowedOrigins []string
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

// Load reads configuration from the environment. In development it best-effort
// loads a local .env file first. It returns an error (rather than exiting) when
// a required secret is missing outside development, so the caller controls the
// failure path.
func Load() (Config, error) {
	// Best-effort: a missing .env is fine (production injects real env vars).
	_ = godotenv.Load()

	cfg := Config{
		Port:                getEnvInt("PORT", 8080),
		Env:                 getEnv("APP_ENV", "development"),
		DatabaseURL:         os.Getenv("DATABASE_URL"),
		AuthJWTSecret:       os.Getenv("AUTH_JWT_SECRET"),
		AuthAccessTTL:       getEnvDuration("AUTH_ACCESS_TTL", 15*time.Minute),
		AuthRefreshTTL:      getEnvDuration("AUTH_REFRESH_TTL", 720*time.Hour),
		FirebaseProjectID:   os.Getenv("FIREBASE_PROJECT_ID"),
		FirebaseClientEmail: os.Getenv("FIREBASE_CLIENT_EMAIL"),
		// The private key is stored \n-escaped (same as the frontend push key);
		// restore the real newlines so it parses as PEM.
		FirebasePrivateKey: strings.ReplaceAll(os.Getenv("FIREBASE_PRIVATE_KEY"), `\n`, "\n"),
		CORSAllowedOrigins: splitAndTrim(getEnv("CORS_ALLOWED_ORIGINS", "http://localhost:3000")),
	}

	if err := cfg.validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// validate fails fast when required secrets are absent in a non-development
// environment. Development stays permissive so `go run` works with no setup.
func (c Config) validate() error {
	if !c.IsProduction() {
		return nil
	}

	required := map[string]string{
		"DATABASE_URL":          c.DatabaseURL,
		"AUTH_JWT_SECRET":       c.AuthJWTSecret,
		"FIREBASE_PROJECT_ID":   c.FirebaseProjectID,
		"FIREBASE_CLIENT_EMAIL": c.FirebaseClientEmail,
		"FIREBASE_PRIVATE_KEY":  c.FirebasePrivateKey,
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

func getEnvDuration(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
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
