package tradeauth

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/go-webauthn/webauthn/webauthn"
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

func TestPasskeyFailureDoesNotMasqueradeAsSessionExpiry(t *testing.T) {
	err, ok := serviceError(ErrAuthorizationRejected).(*fiber.Error)
	if !ok {
		t.Fatalf("unexpected error type %T", err)
	}
	if err.Code != fiber.StatusForbidden {
		t.Fatalf("status = %d, want 403", err.Code)
	}
}

func TestAcceptableAssertionCredentialAllowsSyncedCounterAnomaly(t *testing.T) {
	valid := webauthn.Credential{
		Flags: webauthn.CredentialFlags{
			UserPresent:    true,
			UserVerified:   true,
			BackupEligible: true,
		},
		Authenticator: webauthn.Authenticator{CloneWarning: true},
	}
	if !acceptableAssertionCredential(&valid) {
		t.Fatal("verified synced passkey with a counter anomaly was rejected")
	}

	invalid := []webauthn.Credential{
		{
			Flags: webauthn.CredentialFlags{
				UserPresent:  true,
				UserVerified: true,
			},
			Authenticator: webauthn.Authenticator{CloneWarning: true},
		},
		{
			Flags: webauthn.CredentialFlags{
				UserPresent: true,
			},
		},
		{
			Flags: webauthn.CredentialFlags{
				UserVerified: true,
			},
		},
	}
	for index := range invalid {
		if acceptableAssertionCredential(&invalid[index]) {
			t.Fatalf("unsafe assertion %d was accepted", index)
		}
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
}

func TestSealedBoxBindsAssociatedData(t *testing.T) {
	box, err := newSealedBox("a-development-test-key-with-more-than-32-bytes")
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := box.seal([]byte("credential"), "user-a")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := box.open(sealed, "user-b"); err == nil {
		t.Fatal("credential decrypted with the wrong associated identity")
	}
}
