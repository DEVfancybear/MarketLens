package config

import "testing"

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

func TestValidateRejectsWeakJWTWhenAuthConfigured(t *testing.T) {
	cfg := Config{
		Env: "development", ChartTimeZone: "UTC", DatabaseURL: "postgres://example",
		FirebaseProjectID: "project", FirebaseClientEmail: "service@example.com", FirebasePrivateKey: "key",
		AuthJWTSecret: "short", CORSAllowedOrigins: []string{"http://localhost:3000"},
	}
	if err := cfg.validate(); err == nil {
		t.Fatal("validate() accepted a weak JWT secret")
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
