//go:build !windows || mt5credentials_unsupported_test

package mt5credentials

import (
	"errors"
	"testing"
)

func TestUnsupportedPlatformCredentialStoreFailsClosed(t *testing.T) {
	store, err := NewStore()
	if store != nil || !errors.Is(err, ErrUnsupported) {
		t.Fatalf("unsupported platform store=%T err=%v", store, err)
	}
}
