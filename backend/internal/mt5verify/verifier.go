// Package mt5verify verifies saved MetaTrader 5 credentials in a short-lived
// helper process. Credentials are serialized to the helper's standard input so
// they never appear in command-line arguments or process listings.
package mt5verify

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"time"
)

const (
	defaultTimeout = 20 * time.Second
	maxOutputBytes = 64 << 10
)

// Credentials contains the three values required by MetaTrader 5 to select an
// account. Password is sent only through the verifier process's stdin.
type Credentials struct {
	Login    string `json:"login"`
	Server   string `json:"server"`
	Password string `json:"password"`
}

// AccountSummary is the deliberately small, non-secret account identity
// returned after a successful verification.
type AccountSummary struct {
	Login        string `json:"login"`
	Server       string `json:"server"`
	Currency     string `json:"currency,omitempty"`
	TradeAllowed bool   `json:"tradeAllowed"`
}

// Result distinguishes a rejected credential set from verifier infrastructure
// failures. A rejected credential set is a valid Result with Verified=false;
// failure to start the helper or decode its response is returned as an error.
type Result struct {
	Verified bool            `json:"verified"`
	Code     string          `json:"code"`
	Message  string          `json:"message"`
	Account  *AccountSummary `json:"account,omitempty"`
}

// AccountVerifier is the contract consumed by the settings service.
type AccountVerifier interface {
	Verify(context.Context, Credentials) (Result, error)
}

// CommandVerifier invokes a verifier executable with fixed arguments. In
// production the executable is Python and args contains verify_account.py.
type CommandVerifier struct {
	executable string
	args       []string
	timeout    time.Duration
	// MetaTrader 5 controls one local terminal session. Serialize helper
	// processes so concurrent users cannot switch that terminal underneath one
	// another while credentials are being checked.
	gate chan struct{}
}

// NewCommandVerifier constructs a verifier. A non-positive timeout uses a
// conservative default suitable for launching the MT5 terminal locally.
func NewCommandVerifier(executable string, args []string, timeout time.Duration) *CommandVerifier {
	return &CommandVerifier{
		executable: strings.TrimSpace(executable),
		args:       append([]string(nil), args...),
		timeout:    timeout,
		gate:       make(chan struct{}, 1),
	}
}

// ResolvePythonRuntime selects the first candidate that can actually import
// MetaTrader5. This lets production recover from a stale service-level Python
// override while still honoring a working explicit runtime.
func ResolvePythonRuntime(ctx context.Context, candidates []string, probeTimeout time.Duration) (string, error) {
	if probeTimeout <= 0 {
		probeTimeout = 5 * time.Second
	}
	seen := make(map[string]struct{}, len(candidates))
	attempted := 0
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		key := strings.ToLower(candidate)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		attempted++

		probeContext, cancel := context.WithTimeout(ctx, probeTimeout)
		cmd := exec.CommandContext(probeContext, candidate, "-c", "import MetaTrader5")
		cmd.Stdout = io.Discard
		cmd.Stderr = io.Discard
		err := cmd.Run()
		cancel()
		if err == nil {
			return candidate, nil
		}
	}
	if attempted == 0 {
		return "", errors.New("no MT5 Python runtime candidate is configured")
	}
	return "", fmt.Errorf("none of %d MT5 Python runtime candidate(s) can import MetaTrader5", attempted)
}

// Verify sends credentials as one JSON document on stdin and accepts one
// sanitized JSON result on stdout. Stderr is discarded because native MT5 or
// Python diagnostics are not safe to return to API callers.
func (v *CommandVerifier) Verify(ctx context.Context, credentials Credentials) (Result, error) {
	credentials.Login = strings.TrimSpace(credentials.Login)
	credentials.Server = strings.TrimSpace(credentials.Server)
	if credentials.Login == "" || credentials.Server == "" || strings.TrimSpace(credentials.Password) == "" {
		return canonicalResult("missing_credentials"), nil
	}
	if v == nil || v.executable == "" {
		return Result{}, errors.New("MT5 verifier executable is not configured")
	}

	payload, err := json.Marshal(credentials)
	if err != nil {
		return Result{}, errors.New("encode MT5 verification request")
	}
	timeout := v.timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	// The timeout is the budget for the whole verification request, including
	// time spent waiting for another helper to release the shared terminal.
	commandContext, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	if v.gate != nil {
		select {
		case v.gate <- struct{}{}:
			defer func() { <-v.gate }()
		case <-commandContext.Done():
			return Result{}, fmt.Errorf("MT5 verifier wait was canceled: %w", commandContext.Err())
		}
	}

	cmd := exec.CommandContext(commandContext, v.executable, v.args...)
	cmd.Stdin = bytes.NewReader(payload)
	var stdout cappedBuffer
	stdout.limit = maxOutputBytes
	cmd.Stdout = &stdout
	cmd.Stderr = io.Discard

	if err := cmd.Run(); err != nil {
		if commandContext.Err() != nil {
			return Result{}, fmt.Errorf("MT5 verifier timed out or was canceled: %w", commandContext.Err())
		}
		return Result{}, fmt.Errorf("MT5 verifier command failed: %w", err)
	}
	// A valid verifier response is only a few hundred bytes. Treat filling the
	// entire cap as oversized too: some Windows stdout copy paths can stop at
	// the cap without issuing one final Write that would flip exceeded.
	if stdout.exceeded || stdout.Len() >= maxOutputBytes {
		return Result{}, errors.New("MT5 verifier returned an oversized response")
	}

	var result Result
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
		return Result{}, errors.New("MT5 verifier returned invalid JSON")
	}
	if err := validateResult(credentials, &result); err != nil {
		return Result{}, err
	}
	return result, nil
}

func validateResult(credentials Credentials, result *Result) error {
	canonical, ok := resultMessages[result.Code]
	if !ok {
		return errors.New("MT5 verifier returned an unknown result code")
	}
	// Do not trust free-form helper diagnostics. Returning the canonical message
	// prevents a native error from accidentally reflecting a password.
	result.Message = canonical
	if result.Verified != (result.Code == "verified") {
		return errors.New("MT5 verifier returned an inconsistent result")
	}
	if !result.Verified {
		result.Account = nil
		return nil
	}
	if result.Account == nil || !result.Account.TradeAllowed {
		return errors.New("MT5 verifier returned an invalid verified account")
	}
	result.Account.Login = strings.TrimSpace(result.Account.Login)
	result.Account.Server = strings.TrimSpace(result.Account.Server)
	result.Account.Currency = strings.TrimSpace(result.Account.Currency)
	if result.Account.Login != credentials.Login || !strings.EqualFold(result.Account.Server, credentials.Server) {
		return errors.New("MT5 verifier returned a different account")
	}
	return nil
}

var resultMessages = map[string]string{
	"verified":               "MT5 account verified.",
	"missing_credentials":    "MT5 login, server, and password are required.",
	"invalid_request":        "The MT5 verification request is invalid.",
	"invalid_login":          "The MT5 login must be a positive number.",
	"dependency_unavailable": "The selected Python runtime cannot import MetaTrader5. Rebuild and restart the backend API.",
	"initialize_failed":      "MetaTrader 5 could not be initialized.",
	"login_failed":           "MT5 rejected the login, server, or password.",
	"account_unavailable":    "MT5 did not return account information.",
	"account_mismatch":       "MT5 connected to a different login or server.",
	"trading_not_allowed":    "The MT5 account is not allowed to trade.",
	"internal_error":         "MT5 verification failed unexpectedly.",
}

func canonicalResult(code string) Result {
	return Result{
		Verified: code == "verified",
		Code:     code,
		Message:  resultMessages[code],
	}
}

type cappedBuffer struct {
	bytes.Buffer
	limit    int
	exceeded bool
}

func (b *cappedBuffer) Write(p []byte) (int, error) {
	written := len(p)
	remaining := b.limit - b.Len()
	if remaining <= 0 {
		b.exceeded = true
		return written, nil
	}
	if len(p) > remaining {
		_, _ = b.Buffer.Write(p[:remaining])
		b.exceeded = true
		return written, nil
	}
	_, _ = b.Buffer.Write(p)
	return written, nil
}
