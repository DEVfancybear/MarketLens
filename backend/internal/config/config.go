package config

import (
	"os"
	"strconv"
)

type Config struct {
	Port int
	Env  string
}

func Load() Config {
	return Config{
		Port: getEnvInt("PORT", 8080),
		Env:  getEnv("APP_ENV", "development"),
	}
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
