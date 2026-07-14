package config

import "testing"

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
