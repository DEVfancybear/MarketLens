package tradeauth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"fmt"
)

type sealedBox struct {
	aead cipher.AEAD
}

func newSealedBox(secret string) (*sealedBox, error) {
	if len(secret) < 32 {
		return nil, fmt.Errorf("tradeauth: encryption key must contain at least 32 characters")
	}
	key := sha256.Sum256([]byte("smc-terminal/webauthn/v1\x00" + secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &sealedBox{aead: aead}, nil
}

func (b *sealedBox) seal(plaintext []byte, aad string) ([]byte, error) {
	nonce := make([]byte, b.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return b.aead.Seal(nonce, nonce, plaintext, []byte(aad)), nil
}

func (b *sealedBox) open(ciphertext []byte, aad string) ([]byte, error) {
	nonceSize := b.aead.NonceSize()
	if len(ciphertext) <= nonceSize {
		return nil, fmt.Errorf("tradeauth: invalid sealed value")
	}
	plaintext, err := b.aead.Open(
		nil,
		ciphertext[:nonceSize],
		ciphertext[nonceSize:],
		[]byte(aad),
	)
	if err != nil {
		return nil, fmt.Errorf("tradeauth: open sealed value: %w", err)
	}
	return plaintext, nil
}
