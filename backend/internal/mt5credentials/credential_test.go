package mt5credentials

import (
	"errors"
	"regexp"
	"strings"
	"testing"
	"testing/quick"
)

func TestSecretReferencesAreOpaqueUniqueAndStrictlyValidated(t *testing.T) {
	pattern := regexp.MustCompile(`^mt5-[0-9a-f]{32}$`)
	seen := make(map[string]struct{}, 1024)
	for range 1024 {
		ref, err := NewSecretRef()
		if err != nil {
			t.Fatal(err)
		}
		if !pattern.MatchString(ref) || !validSecretRef(ref) {
			t.Fatalf("invalid opaque reference shape: %q", ref)
		}
		if _, exists := seen[ref]; exists {
			t.Fatalf("opaque reference collision: %q", ref)
		}
		seen[ref] = struct{}{}
	}

	for _, invalid := range []string{
		"", "mt5-", "MT5-0123456789abcdef0123456789abcdef",
		"mt5-0123456789ABCDEF0123456789ABCDEF",
		"mt5-0123456789abcdef0123456789abcde",
		"mt5-0123456789abcdef0123456789abcdef0",
		"mt5-0123456789abcdef0123456789abcdeg",
	} {
		if validSecretRef(invalid) {
			t.Fatalf("invalid reference accepted: %q", invalid)
		}
	}
}

func TestSecretReferenceGenerationFailsClosedWhenEntropyIsUnavailable(t *testing.T) {
	ref, err := newSecretRef(strings.NewReader("too-short"))
	if ref != "" || !errors.Is(err, ErrUnavailable) {
		t.Fatalf("entropy failure ref=%q err=%v", ref, err)
	}
}

func TestCredentialEncodingIsVersionedBoundedAndRoundTrips(t *testing.T) {
	want := Credential{
		Login:    "12345678",
		Password: "S3cure-密码-!@#",
		Server:   "Broker-演示",
	}
	blob, err := encodeCredential(want)
	if err != nil {
		t.Fatal(err)
	}
	defer clear(blob)
	if len(blob) == 0 || len(blob) > maxCredentialBlobBytesForTests() {
		t.Fatalf("encoded blob size=%d", len(blob))
	}
	if blob[0] != 1 {
		t.Fatalf("credential encoding version=%d", blob[0])
	}
	got, err := decodeCredential(blob)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { got.Password = "" }()
	if got != want {
		t.Fatalf("credential round-trip mismatch: %#v", got)
	}
}

func TestCredentialEncodingRejectsHostileAndMalformedValuesBeforePersistence(t *testing.T) {
	valid := Credential{Login: "12345678", Password: "private-value", Server: "Broker-Demo"}
	invalid := []Credential{
		{},
		{Login: "12x", Password: valid.Password, Server: valid.Server},
		{Login: strings.Repeat("1", 33), Password: valid.Password, Server: valid.Server},
		{Login: valid.Login, Password: "", Server: valid.Server},
		{Login: valid.Login, Password: strings.Repeat("x", 257), Server: valid.Server},
		{Login: valid.Login, Password: "line\nbreak", Server: valid.Server},
		{Login: valid.Login, Password: valid.Password, Server: ""},
		{Login: valid.Login, Password: valid.Password, Server: strings.Repeat("s", 129)},
		{Login: valid.Login, Password: valid.Password, Server: "Broker\x00Demo"},
		{Login: valid.Login, Password: string([]byte{0xff}), Server: valid.Server},
	}
	for index, value := range invalid {
		if blob, err := encodeCredential(value); !errors.Is(err, ErrInvalid) {
			clear(blob)
			t.Fatalf("invalid credential %d accepted or leaked an unsanitized error: %v", index, err)
		}
	}

	validBlob, err := encodeCredential(valid)
	if err != nil {
		t.Fatal(err)
	}
	defer clear(validBlob)
	malformed := [][]byte{
		nil,
		{},
		{2, 0, 0, 0, 0, 0, 0},
		{1, 1, 0, 1, 0, 1, 0, 'x', 'p', 's'},
		validBlob[:len(validBlob)-1],
		append(append([]byte(nil), validBlob...), 0),
		make([]byte, maxCredentialBlobBytesForTests()+1),
	}
	for index, blob := range malformed {
		if value, err := decodeCredential(blob); !errors.Is(err, ErrInvalid) {
			value.Password = ""
			t.Fatalf("malformed blob %d accepted or leaked an unsanitized error: %v", index, err)
		}
	}
}

func TestMaximumValidCredentialEncodingStaysInsideNativeBound(t *testing.T) {
	credential := Credential{
		Login:    strings.Repeat("1", 32),
		Password: strings.Repeat("p", 256),
		Server:   strings.Repeat("s", 128),
	}
	blob, err := encodeCredential(credential)
	if err != nil {
		t.Fatal(err)
	}
	defer clear(blob)
	if len(blob) != credentialEncodingHeaderBytes+32+256+128 {
		t.Fatalf("maximum valid credential encoded length=%d", len(blob))
	}
	if !credentialBlobSizeAllowed(len(blob)) {
		t.Fatalf("maximum valid credential exceeded native bound: %d", len(blob))
	}
}

func TestCredentialBlobSizeBoundaries(t *testing.T) {
	for _, allowed := range []int{1, maxCredentialBlobBytesForTests()} {
		if !credentialBlobSizeAllowed(allowed) {
			t.Fatalf("valid credential blob size %d was rejected", allowed)
		}
	}
	for _, rejected := range []int{-1, 0, maxCredentialBlobBytesForTests() + 1} {
		if credentialBlobSizeAllowed(rejected) {
			t.Fatalf("invalid credential blob size %d was accepted", rejected)
		}
	}
}

func TestCredentialCodecPropertyRoundTripsTenThousandValidInputs(t *testing.T) {
	config := &quick.Config{MaxCount: 10_000}
	property := func(loginNumber uint32, passwordSeed uint64, serverSeed uint64) bool {
		credential := Credential{
			Login:    decimalDigits(loginNumber),
			Password: "p-" + decimalDigits64(passwordSeed),
			Server:   "server-" + decimalDigits64(serverSeed),
		}
		blob, err := encodeCredential(credential)
		if err != nil {
			return false
		}
		decoded, err := decodeCredential(blob)
		clear(blob)
		matched := err == nil && decoded == credential
		decoded.Password = ""
		return matched
	}
	if err := quick.Check(property, config); err != nil {
		t.Fatal(err)
	}
}

func decimalDigits(value uint32) string {
	if value == 0 {
		return "0"
	}
	const digits = "0123456789"
	var buffer [10]byte
	position := len(buffer)
	for value > 0 {
		position--
		buffer[position] = digits[value%10]
		value /= 10
	}
	return string(buffer[position:])
}

func decimalDigits64(value uint64) string {
	if value == 0 {
		return "0"
	}
	const digits = "0123456789"
	var buffer [20]byte
	position := len(buffer)
	for value > 0 {
		position--
		buffer[position] = digits[value%10]
		value /= 10
	}
	return string(buffer[position:])
}

func maxCredentialBlobBytesForTests() int {
	return 5 * 512
}
