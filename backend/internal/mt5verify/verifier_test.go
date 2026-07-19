package mt5verify

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
)

const helperPassword = "never-put-this-password-in-argv"

func TestCommandVerifierReturnsVerifiedAccountFromHelper(t *testing.T) {
	verifier := helperVerifier(t, time.Second)

	result, err := verifier.Verify(context.Background(), Credentials{
		Login:    " 100 ",
		Server:   " FTMO-Server4 ",
		Password: helperPassword,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Verified || result.Code != "verified" || result.Account == nil {
		t.Fatalf("unexpected result: %+v", result)
	}
	if result.Message != resultMessages["verified"] {
		t.Fatalf("helper message was not canonicalized: %q", result.Message)
	}
	if result.Account.Login != "100" || result.Account.Server != "ftmo-server4" || !result.Account.TradeAllowed {
		t.Fatalf("unexpected account: %+v", result.Account)
	}
	if strings.Contains(result.Message, helperPassword) {
		t.Fatal("password leaked through the helper message")
	}
}

func TestCommandVerifierReturnsBusinessRejectionWithoutAccount(t *testing.T) {
	verifier := helperVerifier(t, time.Second)

	result, err := verifier.Verify(context.Background(), Credentials{
		Login:    "200",
		Server:   "FTMO-Server4",
		Password: helperPassword,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Verified || result.Code != "login_failed" || result.Account != nil {
		t.Fatalf("unexpected result: %+v", result)
	}
	if result.Message != resultMessages["login_failed"] || strings.Contains(result.Message, helperPassword) {
		t.Fatalf("unsafe rejection message: %q", result.Message)
	}
}

func TestCommandVerifierRejectsUntrustedHelperResponses(t *testing.T) {
	tests := []struct {
		name  string
		login string
		want  string
	}{
		{name: "malformed JSON", login: "300", want: "invalid JSON"},
		{name: "unknown code", login: "400", want: "unknown result code"},
		{name: "inconsistent verified flag", login: "500", want: "inconsistent result"},
		{name: "different account", login: "600", want: "different account"},
		{name: "oversized output", login: "700", want: "oversized response"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			verifier := helperVerifier(t, time.Second)
			_, err := verifier.Verify(context.Background(), Credentials{
				Login:    test.login,
				Server:   "FTMO-Server4",
				Password: helperPassword,
			})
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error=%v, want substring %q", err, test.want)
			}
			if strings.Contains(err.Error(), helperPassword) {
				t.Fatal("password leaked through verifier error")
			}
		})
	}
}

func TestCommandVerifierTimeoutAndCommandFailureDoNotLeakPassword(t *testing.T) {
	t.Run("timeout", func(t *testing.T) {
		verifier := helperVerifier(t, 30*time.Millisecond)
		_, err := verifier.Verify(context.Background(), Credentials{
			Login:    "800",
			Server:   "FTMO-Server4",
			Password: helperPassword,
		})
		if err == nil || !strings.Contains(err.Error(), "timed out or was canceled") {
			t.Fatalf("unexpected error: %v", err)
		}
		if strings.Contains(err.Error(), helperPassword) {
			t.Fatal("password leaked through timeout error")
		}
	})

	t.Run("exit failure", func(t *testing.T) {
		verifier := helperVerifier(t, time.Second)
		_, err := verifier.Verify(context.Background(), Credentials{
			Login:    "900",
			Server:   "FTMO-Server4",
			Password: helperPassword,
		})
		if err == nil || !strings.Contains(err.Error(), "command failed") {
			t.Fatalf("unexpected error: %v", err)
		}
		if strings.Contains(err.Error(), helperPassword) {
			t.Fatal("password leaked through command error")
		}
	})
}

func TestCommandVerifierValidatesMissingCredentialsBeforeLaunching(t *testing.T) {
	verifier := NewCommandVerifier("definitely-not-an-executable", nil, time.Second)
	result, err := verifier.Verify(context.Background(), Credentials{Login: "100"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Verified || result.Code != "missing_credentials" {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestCommandVerifierWaitForSharedTerminalIsContextAware(t *testing.T) {
	verifier := helperVerifier(t, 30*time.Millisecond)
	verifier.gate <- struct{}{}
	defer func() { <-verifier.gate }()

	startedAt := time.Now()
	_, err := verifier.Verify(context.Background(), Credentials{
		Login:    "100",
		Server:   "FTMO-Server4",
		Password: helperPassword,
	})
	if err == nil || !strings.Contains(err.Error(), "wait was canceled") {
		t.Fatalf("unexpected error: %v", err)
	}
	if strings.Contains(err.Error(), helperPassword) {
		t.Fatal("password leaked through wait cancellation error")
	}
	if elapsed := time.Since(startedAt); elapsed > 250*time.Millisecond {
		t.Fatalf("gate wait exceeded verifier timeout: %v", elapsed)
	}
}

func helperVerifier(t *testing.T, timeout time.Duration) *CommandVerifier {
	t.Helper()
	t.Setenv("GO_WANT_MT5VERIFY_HELPER_PROCESS", "1")
	return NewCommandVerifier(
		os.Args[0],
		[]string{"-test.run=TestMt5VerifyHelperProcess"},
		timeout,
	)
}

// TestMt5VerifyHelperProcess runs only in subprocesses launched by the tests
// above. It proves that the password arrives on stdin and never in argv.
func TestMt5VerifyHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_MT5VERIFY_HELPER_PROCESS") != "1" {
		return
	}
	var credentials Credentials
	if err := json.NewDecoder(os.Stdin).Decode(&credentials); err != nil {
		os.Exit(20)
	}
	for _, arg := range os.Args {
		if strings.Contains(arg, credentials.Password) {
			os.Exit(21)
		}
	}
	if credentials.Password != helperPassword {
		os.Exit(22)
	}

	switch credentials.Login {
	case "100":
		fmt.Fprintf(os.Stdout, `{"verified":true,"code":"verified","message":%q,"account":{"login":"100","server":"ftmo-server4","currency":"USD","tradeAllowed":true}}`, helperPassword)
	case "200":
		fmt.Fprintf(os.Stdout, `{"verified":false,"code":"login_failed","message":%q,"account":{"login":"200","server":"FTMO-Server4","tradeAllowed":true}}`, helperPassword)
	case "300":
		fmt.Fprintf(os.Stdout, `{not-json:%q}`, helperPassword)
	case "400":
		fmt.Fprint(os.Stdout, `{"verified":false,"code":"native_password_error","message":"unsafe"}`)
	case "500":
		fmt.Fprint(os.Stdout, `{"verified":true,"code":"login_failed","message":"unsafe"}`)
	case "600":
		fmt.Fprint(os.Stdout, `{"verified":true,"code":"verified","message":"unsafe","account":{"login":"601","server":"FTMO-Server4","tradeAllowed":true}}`)
	case "700":
		fmt.Fprint(os.Stdout, strings.Repeat("x", maxOutputBytes+1))
	case "800":
		time.Sleep(5 * time.Second)
	case "900":
		fmt.Fprint(os.Stderr, helperPassword)
		os.Exit(23)
	default:
		os.Exit(24)
	}
	os.Exit(0)
}
