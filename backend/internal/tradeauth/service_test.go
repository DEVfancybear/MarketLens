package tradeauth

import (
	"bytes"
	"database/sql"
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
		{"copyGroup", `{"group":{"enabled":true},"targets":[{"accountId":"a","enabled":true}]}`},
		{"copyGroup", `{"groupId":"33333333-3333-4333-8333-333333333333","group":{"enabled":true},"targets":[{"accountId":"a","enabled":true}]}`},
		{"copyGroup", `{"groupId":"33333333-3333-4333-8333-333333333333","expectedRevision":7,"action":"resume"}`},
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

	invalidCopyGroups := []string{
		`{"group":{"enabled":false},"targets":[{"accountId":"a","enabled":true}]}`,
		`{"group":{"enabled":"true"},"targets":[{"accountId":"a","enabled":true}]}`,
		`{"group":null,"targets":[{"accountId":"a","enabled":true}]}`,
		`{"group":{"enabled":true},"targets":[]}`,
		`{"group":{"enabled":true},"targets":[null]}`,
		`{"group":{"enabled":true},"targets":[{"accountId":"a","enabled":false}]}`,
		`{"groupId":null,"group":{"enabled":true},"targets":[{"accountId":"a","enabled":true}]}`,
		`{"groupId":"g","expectedRevision":1,"action":"pause"}`,
		`{"groupId":"g","expectedRevision":1,"action":"archive"}`,
		`{"groupId":"g","expectedRevision":0,"action":"resume"}`,
		`{"groupId":"g","expectedRevision":1.5,"action":"resume"}`,
		`{"groupId":"g","expectedRevision":"1","action":"resume"}`,
		`{"groupId":"g","expectedRevision":1,"action":"resume","ownerId":"attacker"}`,
		`{"expectedRevision":1,"action":"resume"}`,
	}
	for _, payload := range invalidCopyGroups {
		if err := validateOperationPayload("copyGroup", json.RawMessage(payload)); err == nil {
			t.Fatalf("invalid copy-group payload accepted: %s", payload)
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

func TestConfigurationRequiresCurrentPasswordBeforeDisablingOrRotating(t *testing.T) {
	const password = "correct horse battery staple"
	hash, err := hashTradePassword(password)
	if err != nil {
		t.Fatal(err)
	}
	configuredHash := sql.NullString{String: hash, Valid: true}

	tests := []struct {
		name            string
		currentEnabled  bool
		nextEnabled     bool
		newPassword     string
		currentPassword string
		wantErr         error
	}{
		{
			name:           "disabled protection does not require proof",
			newPassword:    "another memorable trade phrase",
			nextEnabled:    false,
			currentEnabled: false,
		},
		{
			name:           "unchanged enabled protection does not require proof",
			nextEnabled:    true,
			currentEnabled: true,
		},
		{
			name:           "disabling requires proof",
			nextEnabled:    false,
			currentEnabled: true,
			wantErr:        ErrPasswordRequired,
		},
		{
			name:            "disabling rejects incorrect proof",
			nextEnabled:     false,
			currentEnabled:  true,
			currentPassword: "incorrect password",
			wantErr:         ErrPasswordInvalid,
		},
		{
			name:            "new password cannot verify itself while disabling",
			nextEnabled:     false,
			currentEnabled:  true,
			newPassword:     "attacker chosen memorable phrase",
			currentPassword: "attacker chosen memorable phrase",
			wantErr:         ErrPasswordInvalid,
		},
		{
			name:            "disabling accepts current password",
			nextEnabled:     false,
			currentEnabled:  true,
			currentPassword: password,
		},
		{
			name:           "rotation requires proof while enabled",
			nextEnabled:    true,
			currentEnabled: true,
			newPassword:    "another memorable trade phrase",
			wantErr:        ErrPasswordRequired,
		},
		{
			name:            "rotation rejects incorrect proof",
			nextEnabled:     true,
			currentEnabled:  true,
			newPassword:     "another memorable trade phrase",
			currentPassword: "incorrect password",
			wantErr:         ErrPasswordInvalid,
		},
		{
			name:            "rotation accepts current password",
			nextEnabled:     true,
			currentEnabled:  true,
			newPassword:     "another memorable trade phrase",
			currentPassword: password,
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			err := verifyCurrentPasswordForConfiguration(
				testCase.currentEnabled,
				testCase.nextEnabled,
				testCase.newPassword,
				configuredHash,
				testCase.currentPassword,
			)
			if !errors.Is(err, testCase.wantErr) {
				t.Fatalf("error = %v, want %v", err, testCase.wantErr)
			}
		})
	}

	err = verifyCurrentPasswordForConfiguration(
		true,
		false,
		"",
		sql.NullString{},
		password,
	)
	if err == nil || errors.Is(err, ErrPasswordInvalid) {
		t.Fatalf("missing stored hash must fail closed, got %v", err)
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
