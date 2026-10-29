// Package secretbox encrypts secrets at rest (signature and signing
// secrets) with AES-256-GCM.
//
// Keys come from DATA_ENCRYPTION_KEY as "kid:base64key[,kid:base64key...]":
// the first key encrypts, every key decrypts, so keys rotate by prepending a
// new one. Envelopes are "hlenc:v1:<kid>:<base64url(nonce || ciphertext)>".
// Each secret is sealed with associated data naming its purpose and row
// (e.g. "destination.signing_secret:<id>"), so a ciphertext copied to another
// row or column does not decrypt. apps/web/lib/secretbox.ts is the TypeScript
// twin; both share a test vector.
package secretbox

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
)

const prefix = "hlenc:v1:"

// ErrDecrypt hides why decryption failed (wrong key, tampering, wrong context).
var ErrDecrypt = errors.New("secretbox: cannot decrypt")

type key struct {
	id   string
	aead cipher.AEAD
}

// Box seals and opens envelopes.
type Box struct {
	keys []key
}

// Parse builds a Box from a DATA_ENCRYPTION_KEY value.
func Parse(spec string) (*Box, error) {
	var b Box
	for item := range strings.SplitSeq(spec, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		id, encoded, ok := strings.Cut(item, ":")
		if !ok || id == "" || strings.ContainsAny(id, ": ") {
			return nil, errors.New("secretbox: keys must look like kid:base64key")
		}
		raw, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil || len(raw) != 32 {
			return nil, fmt.Errorf("secretbox: key %q must be 32 bytes of base64", id)
		}
		block, err := aes.NewCipher(raw)
		if err != nil {
			return nil, err
		}
		aead, err := cipher.NewGCM(block)
		if err != nil {
			return nil, err
		}
		b.keys = append(b.keys, key{id: id, aead: aead})
	}
	if len(b.keys) == 0 {
		return nil, errors.New("secretbox: no keys configured")
	}
	return &b, nil
}

// Seal encrypts plaintext with the active key, bound to context.
func (b *Box) Seal(plaintext, context string) (string, error) {
	k := b.keys[0]
	nonce := make([]byte, k.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := k.aead.Seal(nonce, nonce, []byte(plaintext), []byte(context))
	return prefix + k.id + ":" + base64.RawURLEncoding.EncodeToString(sealed), nil
}

// Open decrypts an envelope sealed with the same context.
func (b *Box) Open(envelope, context string) (string, error) {
	rest, ok := strings.CutPrefix(envelope, prefix)
	if !ok {
		return "", ErrDecrypt
	}
	id, encoded, ok := strings.Cut(rest, ":")
	if !ok {
		return "", ErrDecrypt
	}
	sealed, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return "", ErrDecrypt
	}
	for _, k := range b.keys {
		if k.id != id {
			continue
		}
		n := k.aead.NonceSize()
		if len(sealed) < n {
			return "", ErrDecrypt
		}
		plain, err := k.aead.Open(nil, sealed[:n], sealed[n:], []byte(context))
		if err != nil {
			return "", ErrDecrypt
		}
		return string(plain), nil
	}
	return "", ErrDecrypt
}
