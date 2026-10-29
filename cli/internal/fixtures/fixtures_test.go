package fixtures_test

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaanxsrd/hookline/cli/internal/fixtures"
	"github.com/kaanxsrd/hookline/packages/gocommon/signatures"
)

// Every fixture must verify with the same code the edge uses at capture.
func TestFixturesVerify(t *testing.T) {
	now := time.Now()
	secrets := map[string]string{
		"stripe": "whsec_test", "github": "gh-secret", "shopify": "shpss", "hmac_sha256": "generic",
		"discord": "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
	}
	// The Discord public key for the seed above.
	verifyWith := map[string]string{"discord": "79b5562e8fe654f94078b112e8a98ba7901f853ae695bed7e0e3910bad049664"}

	require.Len(t, fixtures.List(), 7)
	for _, f := range fixtures.List() {
		t.Run(f.Name, func(t *testing.T) {
			b, err := f.Build(secrets[f.Provider], now)
			require.NoError(t, err)
			assert.Equal(t, "POST", b.Method)
			assert.True(t, strings.HasPrefix(b.Path, "/"))
			var doc map[string]any
			require.NoError(t, json.Unmarshal(b.Body, &doc), "valid JSON")

			key := secrets[f.Provider]
			if k, ok := verifyWith[f.Provider]; ok {
				key = k
			}
			r := signatures.Verify(signatures.Provider(f.Provider), key, signatures.Input{Headers: b.Headers, Body: b.Body, Now: now})
			assert.True(t, r.Verified, r.Message)
		})
	}
}

func TestFreshIdentifiers(t *testing.T) {
	f, ok := fixtures.Find("stripe.payment_intent.succeeded")
	require.True(t, ok)
	a, err := f.Build("", time.Now())
	require.NoError(t, err)
	b, err := f.Build("", time.Now())
	require.NoError(t, err)
	assert.NotEqual(t, string(a.Body), string(b.Body))
	for _, h := range a.Headers {
		assert.NotEqual(t, "Stripe-Signature", h[0], "unsigned without a secret")
	}
}

func TestDiscordThrowawayKey(t *testing.T) {
	f, ok := fixtures.Find("discord.ping")
	require.True(t, ok)
	b, err := f.Build("", time.Now())
	require.NoError(t, err)
	assert.Contains(t, b.Note, "public key")
	pub := b.Note[strings.LastIndex(b.Note, " ")+1:]
	r := signatures.Verify(signatures.Discord, pub, signatures.Input{Headers: b.Headers, Body: b.Body, Now: time.Now()})
	assert.True(t, r.Verified, r.Message)

	_, err = f.Build("not-a-seed", time.Now())
	require.Error(t, err)
}
