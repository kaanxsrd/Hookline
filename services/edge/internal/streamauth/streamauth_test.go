package streamauth_test

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaanxsrd/hookline/services/edge/internal/streamauth"
)

const secret = "test-stream-secret-0123456789abcdef"

// Produced by apps/web/lib/stream-token.ts (see stream-token.test.ts) with
// this secret, sub "user-1", org "org-1", ep below, iat 1700000000, exp 1700000300.
const webToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEiLCJvcmciOiJvcmctMSIsImVwIjoiMDE4ZjAwMDAtMDAwMC03MDAwLTgwMDAtMDAwMDAwMDAwMDAxIiwiYXVkIjoiaG9va2xpbmUtc3RyZWFtIiwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjE3MDAwMDAzMDB9.JxEJ7-2pFEGyUQi5jrdX0o3Qz2Q6nnovUloEaK_a5mY"

var ep = uuid.MustParse("018f0000-0000-7000-8000-000000000001")

func verifier(t *testing.T) *streamauth.Verifier {
	t.Helper()
	v, err := streamauth.NewVerifier(secret)
	require.NoError(t, err)
	return v
}

func TestVerifiesWebAppTokens(t *testing.T) {
	c, err := verifier(t).Verify(webToken, time.Unix(1700000100, 0))
	require.NoError(t, err)
	assert.Equal(t, "user-1", c.Subject)
	assert.Equal(t, "org-1", c.Org)
	assert.Equal(t, ep, c.Endpoint)
}

func TestSignRoundTrip(t *testing.T) {
	now := time.Unix(1700000000, 0)
	tok := streamauth.Sign(secret, streamauth.Claims{Subject: "user-1", Org: "org-1", Endpoint: ep, Expires: now.Add(5 * time.Minute)}, now)
	assert.Equal(t, webToken, tok, "Go and TypeScript produce identical tokens")
}

func TestRejects(t *testing.T) {
	v := verifier(t)
	now := time.Unix(1700000000, 0)
	valid := streamauth.Claims{Subject: "u", Endpoint: ep, Expires: now.Add(5 * time.Minute)}
	parts := strings.Split(streamauth.Sign(secret, valid, now), ".")
	enc := base64.RawURLEncoding.EncodeToString

	tests := map[string]string{
		"empty":            "",
		"two parts":        parts[0] + "." + parts[1],
		"wrong secret":     streamauth.Sign("another-secret-0123456789abcdefghij", valid, now),
		"tampered payload": parts[0] + "." + enc([]byte(`{"sub":"u","ep":"`+ep.String()+`","aud":"hookline-stream","exp":9999999999}`)) + "." + parts[2],
		"alg none":         enc([]byte(`{"alg":"none","typ":"JWT"}`)) + "." + parts[1] + ".",
		"expired":          streamauth.Sign(secret, streamauth.Claims{Subject: "u", Endpoint: ep, Expires: now.Add(-time.Minute)}, now.Add(-6*time.Minute)),
		"issued in future": streamauth.Sign(secret, valid, now.Add(time.Hour)),
		"garbage sig":      parts[0] + "." + parts[1] + ".!!!",
		"oversized":        strings.Repeat("a", 3000) + ".b.c",
	}
	for name, tok := range tests {
		_, err := v.Verify(tok, now)
		require.ErrorIs(t, err, streamauth.ErrInvalid, name)
	}
}

func TestShortSecretRejected(t *testing.T) {
	_, err := streamauth.NewVerifier("short")
	require.Error(t, err)
}
