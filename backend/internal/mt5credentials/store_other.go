//go:build !windows || mt5credentials_unsupported_test

package mt5credentials

func NewStore() (Store, error) {
	return nil, ErrUnsupported
}
