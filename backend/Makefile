# Backend developer tasks. DATABASE_URL is read from the environment or .env.
.PHONY: run build vet test migrate-up migrate-down migrate-version sqlc

run:
	go run ./cmd/api

build:
	go build ./...

vet:
	go vet ./...

test:
	go test ./...

# Migrations (golang-migrate runner in cmd/migrate).
migrate-up:
	go run ./cmd/migrate up

migrate-down:
	go run ./cmd/migrate down $(N)

migrate-version:
	go run ./cmd/migrate version

# Regenerate type-safe query code (requires sqlc on PATH).
sqlc:
	sqlc generate
