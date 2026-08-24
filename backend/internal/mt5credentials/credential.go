package mt5credentials

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"io"
	"strings"
	"unicode/utf8"
)

const (
	credentialEncodingVersion     byte = 1
	credentialEncodingHeaderBytes      = 7
	maxCredentialBlobBytes             = 5 * 512
)

var (
	ErrInvalid           = errors.New("invalid MT5 credential")
	ErrNotFound          = errors.New("MT5 credential not found")
	ErrUnavailable       = errors.New("MT5 credential store unavailable")
	ErrUnsupported       = errors.New("MT5 credential store unsupported")
	errNativeNotFound    = errors.New("native credential not found")
	errNativeUnavailable = errors.New("native credential store unavailable")
)

// Credential is deliberately short-lived and must never be logged or persisted
// outside the operating-system credential store.
type Credential struct {
	Login    string `json:"login"`
	Password string `json:"password"`
	Server   string `json:"server"`
}

type Store interface {
	Put(context.Context, string, Credential) error
	Get(context.Context, string) (Credential, error)
	Delete(context.Context, string) error
	Probe(context.Context) error
}

func NewSecretRef() (string, error) {
	return newSecretRef(rand.Reader)
}

func newSecretRef(reader io.Reader) (string, error) {
	random := make([]byte, 16)
	if _, err := io.ReadFull(reader, random); err != nil {
		return "", ErrUnavailable
	}
	defer clear(random)
	return "mt5-" + hex.EncodeToString(random), nil
}

func encodeCredential(credential Credential) ([]byte, error) {
	if !validCredential(credential) {
		return nil, ErrInvalid
	}
	login := []byte(credential.Login)
	password := []byte(credential.Password)
	server := []byte(credential.Server)
	total := credentialEncodingHeaderBytes + len(login) + len(password) + len(server)
	blob := make([]byte, total)
	blob[0] = credentialEncodingVersion
	binary.LittleEndian.PutUint16(blob[1:3], uint16(len(login)))
	binary.LittleEndian.PutUint16(blob[3:5], uint16(len(password)))
	binary.LittleEndian.PutUint16(blob[5:7], uint16(len(server)))
	offset := credentialEncodingHeaderBytes
	offset += copy(blob[offset:], login)
	offset += copy(blob[offset:], password)
	copy(blob[offset:], server)
	return blob, nil
}

func decodeCredential(blob []byte) (Credential, error) {
	if len(blob) < credentialEncodingHeaderBytes || !credentialBlobSizeAllowed(len(blob)) ||
		blob[0] != credentialEncodingVersion {
		return Credential{}, ErrInvalid
	}
	loginLength := int(binary.LittleEndian.Uint16(blob[1:3]))
	passwordLength := int(binary.LittleEndian.Uint16(blob[3:5]))
	serverLength := int(binary.LittleEndian.Uint16(blob[5:7]))
	if loginLength+passwordLength+serverLength != len(blob)-credentialEncodingHeaderBytes {
		return Credential{}, ErrInvalid
	}
	loginStart := credentialEncodingHeaderBytes
	passwordStart := loginStart + loginLength
	serverStart := passwordStart + passwordLength
	credential := Credential{
		Login:    string(blob[loginStart:passwordStart]),
		Password: string(blob[passwordStart:serverStart]),
		Server:   string(blob[serverStart:]),
	}
	if !validCredential(credential) {
		credential.Password = ""
		return Credential{}, ErrInvalid
	}
	return credential, nil
}

func credentialBlobSizeAllowed(size int) bool {
	return size > 0 && size <= maxCredentialBlobBytes
}

func clearCredentialBlob(blob []byte) {
	clear(blob)
}

func validCredential(credential Credential) bool {
	return len(credential.Login) >= 1 && len(credential.Login) <= 32 &&
		allDigits(credential.Login) &&
		len(credential.Password) >= 1 && len(credential.Password) <= 256 &&
		utf8.ValidString(credential.Password) &&
		!strings.ContainsAny(credential.Password, "\r\n\x00") &&
		len(credential.Server) >= 1 && len(credential.Server) <= 128 &&
		utf8.ValidString(credential.Server) &&
		!strings.ContainsAny(credential.Server, "\r\n\x00")
}

func validSecretRef(value string) bool {
	return len(value) == 36 && strings.HasPrefix(value, "mt5-") &&
		strings.IndexFunc(value[4:], func(character rune) bool {
			return !strings.ContainsRune("0123456789abcdef", character)
		}) == -1
}

func allDigits(value string) bool {
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

func contextError(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return nil
	}
}

func storeError(err error, allowNotFound bool) error {
	if errors.Is(err, errNativeNotFound) {
		if allowNotFound {
			return ErrNotFound
		}
		return ErrUnavailable
	}
	return ErrUnavailable
}
