//go:build windows && !mt5credentials_unsupported_test

package mt5credentials

import (
	"runtime"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	credentialDLL        = windows.NewLazySystemDLL("advapi32.dll")
	credentialWriteProc  = credentialDLL.NewProc("CredWriteW")
	credentialReadProc   = credentialDLL.NewProc("CredReadW")
	credentialDeleteProc = credentialDLL.NewProc("CredDeleteW")
	credentialEnumProc   = credentialDLL.NewProc("CredEnumerateW")
	credentialFreeProc   = credentialDLL.NewProc("CredFree")
	credentialWriteCall  = callCredentialWrite
	credentialReadCall   = callCredentialRead
	credentialDeleteCall = callCredentialDelete
	credentialEnumCall   = callCredentialEnumerate
	credentialFreeCall   = callCredentialFree
)

type nativeCredential struct {
	Flags              uint32
	Type               uint32
	TargetName         *uint16
	Comment            *uint16
	LastWritten        windows.Filetime
	CredentialBlobSize uint32
	CredentialBlob     *byte
	Persist            uint32
	AttributeCount     uint32
	Attributes         uintptr
	TargetAlias        *uint16
	UserName           *uint16
}

func callCredentialWrite(credential *nativeCredential) (uintptr, error) {
	result, _, err := credentialWriteProc.Call(uintptr(unsafe.Pointer(credential)), 0)
	return result, err
}

func callCredentialRead(target *uint16, credentialType uint32, output **nativeCredential) (uintptr, error) {
	result, _, err := credentialReadProc.Call(
		uintptr(unsafe.Pointer(target)),
		uintptr(credentialType),
		0,
		uintptr(unsafe.Pointer(output)),
	)
	return result, err
}

func callCredentialDelete(target *uint16, credentialType uint32) (uintptr, error) {
	result, _, err := credentialDeleteProc.Call(
		uintptr(unsafe.Pointer(target)),
		uintptr(credentialType),
		0,
	)
	return result, err
}

func callCredentialEnumerate(filter *uint16, count *uint32, output ***nativeCredential) (uintptr, error) {
	result, _, err := credentialEnumProc.Call(
		uintptr(unsafe.Pointer(filter)),
		0,
		uintptr(unsafe.Pointer(count)),
		uintptr(unsafe.Pointer(output)),
	)
	return result, err
}

func callCredentialFree(value uintptr) {
	credentialFreeProc.Call(value)
}

type nativeCredentialAPI struct{}

func NewStore() (Store, error) {
	return newWindowsStore(nativeCredentialAPI{}), nil
}

func (nativeCredentialAPI) Write(record credentialRecord) error {
	target, err := windows.UTF16PtrFromString(record.TargetName)
	if err != nil {
		return errNativeUnavailable
	}
	var username *uint16
	if record.UserName != "" {
		username, err = windows.UTF16PtrFromString(record.UserName)
		if err != nil {
			return errNativeUnavailable
		}
	}
	var comment *uint16
	if record.Comment != "" {
		comment, err = windows.UTF16PtrFromString(record.Comment)
		if err != nil {
			return errNativeUnavailable
		}
	}
	if !credentialBlobSizeAllowed(len(record.Blob)) {
		return errNativeUnavailable
	}
	credential := nativeCredential{
		Type:               record.Type,
		TargetName:         target,
		Comment:            comment,
		CredentialBlobSize: uint32(len(record.Blob)),
		CredentialBlob:     &record.Blob[0],
		Persist:            record.Persist,
		UserName:           username,
	}
	result, callErr := credentialWriteCall(&credential)
	runtime.KeepAlive(target)
	runtime.KeepAlive(username)
	runtime.KeepAlive(comment)
	runtime.KeepAlive(record.Blob)
	if result == 0 {
		return classifyNativeError(callErr)
	}
	return nil
}

func (nativeCredentialAPI) Read(targetName string, credentialType uint32) (credentialRecord, error) {
	target, err := windows.UTF16PtrFromString(targetName)
	if err != nil {
		return credentialRecord{}, errNativeUnavailable
	}
	var credential *nativeCredential
	result, callErr := credentialReadCall(target, credentialType, &credential)
	runtime.KeepAlive(target)
	if result == 0 {
		return credentialRecord{}, classifyNativeError(callErr)
	}
	if credential == nil {
		return credentialRecord{}, errNativeUnavailable
	}
	defer credentialFreeCall(uintptr(unsafe.Pointer(credential)))
	if credential.CredentialBlobSize == 0 ||
		credential.CredentialBlobSize > uint32(maxCredentialBlobBytes) ||
		credential.CredentialBlob == nil {
		return credentialRecord{}, errNativeUnavailable
	}
	nativeBlob := unsafe.Slice(credential.CredentialBlob, int(credential.CredentialBlobSize))
	blob := append([]byte(nil), nativeBlob...)
	clear(nativeBlob)
	return credentialRecord{
		TargetName: utf16PointerString(credential.TargetName),
		UserName:   utf16PointerString(credential.UserName),
		Comment:    utf16PointerString(credential.Comment),
		Blob:       blob,
		Type:       credential.Type,
		Persist:    credential.Persist,
	}, nil
}

func (nativeCredentialAPI) Delete(targetName string, credentialType uint32) error {
	target, err := windows.UTF16PtrFromString(targetName)
	if err != nil {
		return errNativeUnavailable
	}
	result, callErr := credentialDeleteCall(target, credentialType)
	runtime.KeepAlive(target)
	if result == 0 {
		return classifyNativeError(callErr)
	}
	return nil
}

func (nativeCredentialAPI) Enumerate(filter string) ([]credentialTarget, error) {
	filterPointer, err := windows.UTF16PtrFromString(filter)
	if err != nil {
		return nil, errNativeUnavailable
	}
	var count uint32
	var credentials **nativeCredential
	result, callErr := credentialEnumCall(filterPointer, &count, &credentials)
	runtime.KeepAlive(filterPointer)
	if result == 0 {
		return nil, classifyNativeError(callErr)
	}
	if count == 0 || count > 1024 || credentials == nil {
		if credentials != nil {
			credentialFreeCall(uintptr(unsafe.Pointer(credentials)))
		}
		return nil, errNativeUnavailable
	}
	defer credentialFreeCall(uintptr(unsafe.Pointer(credentials)))
	nativeCredentials := unsafe.Slice(credentials, int(count))
	targets := make([]credentialTarget, 0, len(nativeCredentials))
	for _, credential := range nativeCredentials {
		if credential == nil {
			return nil, errNativeUnavailable
		}
		targetName := utf16PointerString(credential.TargetName)
		if targetName == "" {
			return nil, errNativeUnavailable
		}
		targets = append(targets, credentialTarget{TargetName: targetName, Type: credential.Type})
	}
	return targets, nil
}

func utf16PointerString(value *uint16) string {
	if value == nil {
		return ""
	}
	return windows.UTF16PtrToString(value)
}

func classifyNativeError(err error) error {
	errno, ok := err.(syscall.Errno)
	if ok && errno == windows.ERROR_NOT_FOUND {
		return errNativeNotFound
	}
	return errNativeUnavailable
}
