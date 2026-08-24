//go:build windows && !mt5credentials_unsupported_test

package mt5credentials

import (
	"context"
	"errors"
	"strings"
)

const (
	credentialTypeGeneric         uint32 = 1
	credentialPersistLocalMachine uint32 = 2
	credentialTargetPrefix               = "MarketLens:MT5:"
	credentialTestTargetPrefix           = "MarketLens:MT5:test:"
)

type credentialRecord struct {
	TargetName string
	UserName   string
	Comment    string
	Blob       []byte
	Type       uint32
	Persist    uint32
}

type credentialTarget struct {
	TargetName string
	Type       uint32
}

type credentialAPI interface {
	Write(credentialRecord) error
	Read(string, uint32) (credentialRecord, error)
	Delete(string, uint32) error
	Enumerate(string) ([]credentialTarget, error)
}

type windowsStore struct {
	api             credentialAPI
	createSecretRef func() (string, error)
	encode          func(Credential) ([]byte, error)
}

func newWindowsStore(api credentialAPI) *windowsStore {
	return &windowsStore{
		api:             api,
		createSecretRef: NewSecretRef,
		encode:          encodeCredential,
	}
}

func (store *windowsStore) Put(ctx context.Context, secretRef string, credential Credential) error {
	if err := contextError(ctx); err != nil {
		return err
	}
	if !validSecretRef(secretRef) {
		return ErrInvalid
	}
	blob, err := encodeCredential(credential)
	if err != nil {
		return err
	}
	defer clearCredentialBlob(blob)
	record := credentialRecord{
		TargetName: credentialTargetPrefix + secretRef,
		Blob:       blob,
		Type:       credentialTypeGeneric,
		Persist:    credentialPersistLocalMachine,
	}
	if err := store.api.Write(record); err != nil {
		return storeError(err, false)
	}
	return nil
}

func (store *windowsStore) Get(ctx context.Context, secretRef string) (Credential, error) {
	if err := contextError(ctx); err != nil {
		return Credential{}, err
	}
	if !validSecretRef(secretRef) {
		return Credential{}, ErrInvalid
	}
	target := credentialTargetPrefix + secretRef
	record, err := store.api.Read(target, credentialTypeGeneric)
	if err != nil {
		return Credential{}, storeError(err, true)
	}
	defer clear(record.Blob)
	if record.TargetName != target || record.Type != credentialTypeGeneric ||
		record.Persist != credentialPersistLocalMachine || record.UserName != "" || record.Comment != "" {
		return Credential{}, ErrInvalid
	}
	credential, err := decodeCredential(record.Blob)
	if err != nil {
		return Credential{}, err
	}
	return credential, nil
}

func (store *windowsStore) Delete(ctx context.Context, secretRef string) error {
	if err := contextError(ctx); err != nil {
		return err
	}
	if !validSecretRef(secretRef) {
		return ErrInvalid
	}
	err := store.api.Delete(credentialTargetPrefix+secretRef, credentialTypeGeneric)
	if credentialDeleteSucceeded(err) {
		return nil
	}
	return storeError(err, false)
}

func credentialDeleteSucceeded(err error) bool {
	return err == nil || errors.Is(err, errNativeNotFound)
}

func (store *windowsStore) Probe(ctx context.Context) (result error) {
	if err := contextError(ctx); err != nil {
		return err
	}
	if err := store.cleanupSyntheticProbeTargets(ctx); err != nil {
		return err
	}
	secretRef, err := store.createSecretRef()
	if err != nil {
		return ErrUnavailable
	}
	target := credentialTestTargetPrefix + secretRef[4:]
	credential := Credential{Login: "1", Password: "synthetic-probe", Server: "MarketLens-Probe"}
	blob, err := store.encode(credential)
	credential.Password = ""
	if err != nil {
		return ErrUnavailable
	}
	defer clear(blob)
	written := false
	defer func() {
		if written {
			cleanupErr := store.api.Delete(target, credentialTypeGeneric)
			if cleanupErr != nil && !errors.Is(cleanupErr, errNativeNotFound) {
				result = storeError(cleanupErr, false)
			}
		}
	}()
	record := credentialRecord{
		TargetName: target,
		Blob:       blob,
		Type:       credentialTypeGeneric,
		Persist:    credentialPersistLocalMachine,
	}
	if err := store.api.Write(record); err != nil {
		return storeError(err, false)
	}
	written = true
	loaded, err := store.api.Read(target, credentialTypeGeneric)
	if err != nil {
		return storeError(err, true)
	}
	defer clear(loaded.Blob)
	if loaded.TargetName != target || loaded.Type != credentialTypeGeneric ||
		loaded.Persist != credentialPersistLocalMachine {
		return ErrUnavailable
	}
	decoded, err := decodeCredential(loaded.Blob)
	if err != nil || decoded.Login != "1" || decoded.Password != "synthetic-probe" ||
		decoded.Server != "MarketLens-Probe" {
		decoded.Password = ""
		return ErrUnavailable
	}
	decoded.Password = ""
	if err := store.api.Delete(target, credentialTypeGeneric); err != nil {
		return storeError(err, false)
	}
	written = false
	remaining, err := store.api.Read(target, credentialTypeGeneric)
	if err == nil {
		clear(remaining.Blob)
		return ErrUnavailable
	}
	if !errors.Is(err, errNativeNotFound) {
		return storeError(err, false)
	}
	return nil
}

func (store *windowsStore) cleanupSyntheticProbeTargets(ctx context.Context) error {
	targets, err := store.api.Enumerate(credentialTestTargetPrefix + "*")
	if errors.Is(err, errNativeNotFound) {
		return nil
	}
	if err != nil {
		return storeError(err, false)
	}
	for _, target := range targets {
		if err := contextError(ctx); err != nil {
			return err
		}
		if target.Type != credentialTypeGeneric || !validSyntheticProbeTarget(target.TargetName) {
			return ErrUnavailable
		}
		err := store.api.Delete(target.TargetName, credentialTypeGeneric)
		if err != nil && !errors.Is(err, errNativeNotFound) {
			return storeError(err, false)
		}
	}
	return nil
}

func validSyntheticProbeTarget(target string) bool {
	if !strings.HasPrefix(target, credentialTestTargetPrefix) {
		return false
	}
	return validSecretRef("mt5-" + strings.TrimPrefix(target, credentialTestTargetPrefix))
}
