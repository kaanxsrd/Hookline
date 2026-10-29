package secretbox_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaanxsrd/hookline/packages/gocommon/secretbox"
)

// 32 bytes each, base64.
const (
	k1 = "k1:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
	k0 = "k0:ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8="
)

// Sealed by apps/web/lib/secretbox.ts with k1, context "destination.signing_secret:abc".
const tsVector = "hlenc:v1:k1:AAECAwQFBgcICQoLL2e6d6pAC3GXju-k7PvPr6X_Pzr8"

func TestRoundTrip(t *testing.T) {
	b, err := secretbox.Parse(k1)
	require.NoError(t, err)
	env, err := b.Seal("whsec_secret", "destination.signing_secret:abc")
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(env, "hlenc:v1:k1:"))

	plain, err := b.Open(env, "destination.signing_secret:abc")
	require.NoError(t, err)
	assert.Equal(t, "whsec_secret", plain)

	other, err := b.Seal("whsec_secret", "destination.signing_secret:abc")
	require.NoError(t, err)
	assert.NotEqual(t, env, other, "fresh nonce every time")
}

func TestOpensTypeScriptVector(t *testing.T) {
	b, err := secretbox.Parse(k1)
	require.NoError(t, err)
	plain, err := b.Open(tsVector, "destination.signing_secret:abc")
	require.NoError(t, err)
	assert.Equal(t, "hello", plain)
}

func TestRejects(t *testing.T) {
	b, err := secretbox.Parse(k1)
	require.NoError(t, err)
	env, err := b.Seal("s", "ctx:1")
	require.NoError(t, err)

	for name, tc := range map[string][2]string{
		"wrong context": {env, "ctx:2"},
		"tampered":      {env[:len(env)-2] + "AA", "ctx:1"},
		"unknown key":   {strings.Replace(env, ":k1:", ":k9:", 1), "ctx:1"},
		"not envelope":  {"plaintext", "ctx:1"},
		"truncated":     {"hlenc:v1:k1:AA", "ctx:1"},
	} {
		_, err := b.Open(tc[0], tc[1])
		require.ErrorIs(t, err, secretbox.ErrDecrypt, name)
	}
}

func TestRotation(t *testing.T) {
	old, err := secretbox.Parse(k0)
	require.NoError(t, err)
	env, err := old.Seal("legacy", "ctx")
	require.NoError(t, err)

	rotated, err := secretbox.Parse(k1 + "," + k0)
	require.NoError(t, err)
	plain, err := rotated.Open(env, "ctx")
	require.NoError(t, err)
	assert.Equal(t, "legacy", plain)

	fresh, err := rotated.Seal("new", "ctx")
	require.NoError(t, err)
	assert.Contains(t, fresh, ":k1:", "new secrets use the first key")
}

func TestParseErrors(t *testing.T) {
	for _, spec := range []string{"", "nokey", "k1:notbase64!", "k1:AAAA", ":AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="} {
		_, err := secretbox.Parse(spec)
		require.Error(t, err, spec)
	}
}
