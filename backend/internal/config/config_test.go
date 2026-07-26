package config

import (
	"testing"
	"time"
)

func TestAuthCookiesSecure(t *testing.T) {
	t.Run("manual development config defaults false", func(t *testing.T) {
		cfg := Config{Env: "development"}
		if cfg.AuthCookiesSecure() {
			t.Fatal("AuthCookiesSecure() = true, want false")
		}
	})

	t.Run("manual production config defaults true", func(t *testing.T) {
		cfg := Config{Env: "production"}
		if !cfg.AuthCookiesSecure() {
			t.Fatal("AuthCookiesSecure() = false, want true")
		}
	})

	t.Run("explicit local HTTP override", func(t *testing.T) {
		value := false
		cfg := Config{Env: "production", AuthCookieSecure: &value}
		if cfg.AuthCookiesSecure() {
			t.Fatal("AuthCookiesSecure() = true, want explicit false")
		}
	})
}

func TestLoadDefaultsChartTimeZone(t *testing.T) {
	t.Setenv("APP_ENV", "development")
	t.Setenv("CHART_TIME_ZONE", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.ChartTimeZone != "Asia/Ho_Chi_Minh" {
		t.Fatalf("ChartTimeZone = %q, want Asia/Ho_Chi_Minh", cfg.ChartTimeZone)
	}
}

func TestValidateChartTimeZone(t *testing.T) {
	t.Run("accepts IANA zone", func(t *testing.T) {
		cfg := Config{Env: "development", ChartTimeZone: "Asia/Ho_Chi_Minh"}
		if err := cfg.validate(); err != nil {
			t.Fatalf("validate() error = %v", err)
		}
	})

	t.Run("rejects invalid zone", func(t *testing.T) {
		cfg := Config{Env: "development", ChartTimeZone: "UTC+7"}
		if err := cfg.validate(); err == nil {
			t.Fatal("validate() expected invalid IANA time-zone error")
		}
	})
}

func TestValidateRejectsUnsafeCORSOrigins(t *testing.T) {
	for _, origin := range []string{"*", "https://app.example.com/path", "javascript:alert(1)"} {
		t.Run(origin, func(t *testing.T) {
			cfg := Config{Env: "development", ChartTimeZone: "UTC", CORSAllowedOrigins: []string{origin}}
			if err := cfg.validate(); err == nil {
				t.Fatalf("validate() accepted unsafe origin %q", origin)
			}
		})
	}
}

func TestValidateExecutionServicesRemainLoopbackOnly(t *testing.T) {
	for _, eaURL := range []string{
		"https://127.0.0.1:8790",
		"http://example.com:8790",
		"http://user@127.0.0.1:8790",
	} {
		t.Run(eaURL, func(t *testing.T) {
			cfg := Config{
				Env:                    "development",
				ChartTimeZone:          "UTC",
				ExecutionEAURL:         eaURL,
				ExecutionAdminURL:      "http://127.0.0.1:8791",
				ExecutionAdminToken:    "execution-admin-secret-at-least-32-bytes",
				CORSAllowedOrigins:     []string{"http://localhost:3000"},
				AlertEvaluatorInterval: 15 * time.Second,
				AlertEvaluatorTimeout:  30 * time.Second,
				MT5BridgeDialTimeout:   10 * time.Second,
				MT5BridgeReconnectMin:  time.Second,
				MT5BridgeReconnectMax:  30 * time.Second,
				ReplayCleanupInterval:  time.Hour,
				ReplaySessionRetention: 30 * 24 * time.Hour,
				ReplayDatasetRetention: 7 * 24 * time.Hour,
				ReplayDisconnectGrace:  5 * time.Second,
				ReplayActorLeaseTTL:    5 * time.Second,
			}
			if err := cfg.validate(); err == nil {
				t.Fatalf("validate() accepted unsafe execution EA URL %q", eaURL)
			}
		})
	}
}

func TestValidateRejectsWeakJWTWhenAuthConfigured(t *testing.T) {
	cfg := Config{
		Env: "development", ChartTimeZone: "UTC", DatabaseURL: "postgres://example",
		FirebaseProjectID: "project", FirebaseClientEmail: "service@example.com", FirebasePrivateKey: "key",
		AuthJWTSecret: "short", AuthAccessTTL: 15 * time.Minute, AuthRefreshTTL: 30 * 24 * time.Hour,
		CORSAllowedOrigins: []string{"http://localhost:3000"},
	}
	if err := cfg.validate(); err == nil {
		t.Fatal("validate() accepted a weak JWT secret")
	}
}

func TestValidateRejectsUnsafeAuthDurations(t *testing.T) {
	base := Config{
		Env: "development", ChartTimeZone: "UTC", DatabaseURL: "postgres://example",
		FirebaseProjectID: "project", FirebaseClientEmail: "service@example.com", FirebasePrivateKey: "key",
		AuthJWTSecret:      "test-secret-at-least-32-bytes-long-xxxx",
		CORSAllowedOrigins: []string{"http://localhost:3000"},
		AuthAccessTTL:      15 * time.Minute, AuthRefreshTTL: 30 * 24 * time.Hour,
	}

	tooLongAccess := base
	tooLongAccess.AuthAccessTTL = 2 * time.Hour
	if err := tooLongAccess.validate(); err == nil {
		t.Fatal("validate() accepted an excessive access-token lifetime")
	}

	tooLongRefresh := base
	tooLongRefresh.AuthRefreshTTL = 365 * 24 * time.Hour
	if err := tooLongRefresh.validate(); err == nil {
		t.Fatal("validate() accepted an excessive refresh-token lifetime")
	}
}

func TestDefaultAlertEvaluatorURLUsesProductionHTTPSOrigin(t *testing.T) {
	got := defaultAlertEvaluatorURL(
		"production",
		[]string{"http://localhost:3000", "https://tradingterminal.io.vn"},
	)
	if got != "https://tradingterminal.io.vn/api/push/evaluate" {
		t.Fatalf("default evaluator URL = %q", got)
	}
}

func TestDefaultAlertEvaluatorURLKeepsLocalDevelopment(t *testing.T) {
	got := defaultAlertEvaluatorURL("development", []string{"http://localhost:3000"})
	if got != "http://localhost:3000/api/push/evaluate" {
		t.Fatalf("development evaluator URL = %q", got)
	}
}
