package tradeauth

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
)

func TestValidateOperationPayloadRejectsShapeChanges(t *testing.T) {
	valid := []struct {
		operation string
		payload   string
	}{
		{"order", `{"intent":{"side":"buy"},"targets":[{"accountId":"a"}]}`},
		{"command", `{"command":{"type":"closePosition","accountId":"a"}}`},
	}
	for _, testCase := range valid {
		if err := validateOperationPayload(
			testCase.operation,
			json.RawMessage(testCase.payload),
		); err != nil {
			t.Fatalf("valid %s payload rejected: %v", testCase.operation, err)
		}
	}

	invalid := []string{
		`{"intent":{},"targets":[],"ownerId":"attacker"}`,
		`{"command":{},"authorizationToken":"attacker"}`,
		`[]`,
		`{"command":`,
	}
	for _, payload := range invalid {
		operation := "command"
		if bytes.Contains([]byte(payload), []byte(`"intent"`)) {
			operation = "order"
		}
		if err := validateOperationPayload(operation, json.RawMessage(payload)); err == nil {
			t.Fatalf("invalid payload accepted: %s", payload)
		}
	}
}

func TestTradePasswordHashRoundTrip(t *testing.T) {
	hash, err := hashTradePassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(hash, "correct horse") {
		t.Fatal("password hash contains plaintext")
	}
	matches, err := verifyTradePassword("correct horse battery staple", hash)
	if err != nil {
		t.Fatal(err)
	}
	if !matches {
		t.Fatal("correct password did not verify")
	}
	matches, err = verifyTradePassword("incorrect password", hash)
	if err != nil {
		t.Fatal(err)
	}
	if matches {
		t.Fatal("incorrect password verified")
	}
}

func TestTradePasswordPolicy(t *testing.T) {
	for _, password := range []string{"short", "password", "12345678"} {
		if err := validateTradePassword(password); !errors.Is(err, ErrPasswordPolicy) {
			t.Fatalf("password %q policy error = %v", password, err)
		}
	}
	if err := validateTradePassword("a long but memorable trade phrase"); err != nil {
		t.Fatalf("valid password rejected: %v", err)
	}
}

func TestTradePasswordLockBackoff(t *testing.T) {
	if got := passwordLockDuration(4); got != 0 {
		t.Fatalf("four failures lock duration = %s", got)
	}
	if got := passwordLockDuration(5); got != 30*time.Second {
		t.Fatalf("five failures lock duration = %s", got)
	}
	if got := passwordLockDuration(100); got != 15*time.Minute {
		t.Fatalf("lock duration cap = %s", got)
	}
}

func TestPasswordFailureDoesNotMasqueradeAsSessionExpiry(t *testing.T) {
	err, ok := serviceError(ErrPasswordInvalid).(*fiber.Error)
	if !ok {
		t.Fatalf("unexpected error type %T", err)
	}
	if err.Code != fiber.StatusForbidden {
		t.Fatalf("status = %d, want 403", err.Code)
	}
}

func TestAuthorizationTokensAreOpaqueAndOneTimeComparable(t *testing.T) {
	first, firstHash, err := generateAuthorizationToken()
	if err != nil {
		t.Fatal(err)
	}
	second, secondHash, err := generateAuthorizationToken()
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 43 || len(firstHash) != 32 {
		t.Fatalf("unexpected token dimensions: %d/%d", len(first), len(firstHash))
	}
	if first == second || bytes.Equal(firstHash, secondHash) {
		t.Fatal("authorization tokens must be independently random")
	}
	recomputed, ok := opaqueTokenHash(first)
	if !ok || !bytes.Equal(firstHash, recomputed) {
		t.Fatal("opaque unlock token hashing is inconsistent")
	}
	if _, ok := opaqueTokenHash("not-a-valid-token"); ok {
		t.Fatal("malformed unlock token was accepted")
	}
}
