package execution

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

const maxMT5IdentityHMACKeyBytes = 4096

// ReadMT5IdentityHMACKey loads the stable managed-account identity master key
// without putting its value in an environment variable. The caller owns and
// must clear the returned buffer after WithMT5CredentialStore derives its key.
func ReadMT5IdentityHMACKey(path string) ([]byte, error) {
	return readMT5IdentityHMACKey(path, filepath.EvalSymlinks, os.ReadFile)
}

func readMT5IdentityHMACKey(
	path string,
	evaluateLinks func(string) (string, error),
	readFile func(string) ([]byte, error),
) ([]byte, error) {
	if !filepath.IsAbs(path) {
		return nil, errors.New("MT5 identity HMAC key path must be absolute")
	}
	cleanPath := filepath.Clean(path)
	info, err := os.Lstat(cleanPath)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("MT5 identity HMAC key file is not a regular file")
	}
	realPath, err := evaluateLinks(cleanPath)
	if err != nil || !sameCanonicalPath(cleanPath, realPath) {
		return nil, errors.New("MT5 identity HMAC key path must not traverse a link")
	}
	raw, err := readFile(cleanPath)
	if err != nil {
		return nil, errors.New("read MT5 identity HMAC key file")
	}
	key := bytes.TrimSpace(raw)
	if len(key) < 32 || len(key) > maxMT5IdentityHMACKeyBytes || bytes.ContainsAny(key, "\r\n\x00") {
		clear(raw)
		return nil, errors.New("MT5 identity HMAC key file is invalid")
	}
	result := append([]byte(nil), key...)
	clear(raw)
	return result, nil
}

func sameCanonicalPath(left, right string) bool {
	return sameCanonicalPathForOS(runtime.GOOS, left, right)
}

func sameCanonicalPathForOS(goos, left, right string) bool {
	if goos == "windows" {
		return strings.EqualFold(filepath.Clean(left), filepath.Clean(right))
	}
	return filepath.Clean(left) == filepath.Clean(right)
}
