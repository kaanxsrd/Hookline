// Package streamauth verifies the short-lived tokens that authorize a
// dashboard tab to open an SSE stream for one endpoint.
//
// The web app mints them (apps/web/lib/stream-token.ts) after checking that
// the viewer may read the endpoint: a compact JWT signed with HS256 and
// STREAM_TOKEN_SECRET, valid for five minutes, with the claims
//
//	sub  user ID, or "anonymous" for view-token holders
//	org  organization ID ("" for anonymous endpoints)
//	ep   endpoint ID
//	aud  "hookline-stream"
//	iat, exp
//
// Only HS256 is accepted, whatever the header claims, so algorithm
// confusion ("none", RS256 with the secret as a public key) is impossible.
package streamauth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Audience is the required "aud" claim.
const Audience = "hookline-stream"

// MinSecretBytes is the shortest accepted signing secret.
const MinSecretBytes = 32

// clockSkew tolerates small clock differences between web and edge hosts.
const clockSkew = 30 * time.Second

// ErrInvalid is returned for every malformed, forged or expired token; the
// reason is deliberately not revealed to the client.
var ErrInvalid = errors.New("invalid stream token")

// Claims are the verified token contents.
type Claims struct {
	Subject  string
	Org      string
	Endpoint uuid.UUID
	Expires  time.Time
}

// Verifier checks tokens signed with one secret.
type Verifier struct {
	secret []byte
}

// NewVerifier returns a Verifier. The secret must be at least MinSecretBytes long.
func NewVerifier(secret string) (*Verifier, error) {
	if len(secret) < MinSecretBytes {
		return nil, errors.New("stream token secret must be at least 32 bytes")
	}
	return &Verifier{secret: []byte(secret)}, nil
}

type header struct {
	Alg string `json:"alg"`
	Typ string `json:"typ"`
}

type payload struct {
	Sub string `json:"sub"`
	Org string `json:"org"`
	Ep  string `json:"ep"`
	Aud string `json:"aud"`
	Iat int64  `json:"iat"`
	Exp int64  `json:"exp"`
}

// Verify checks token at time now and returns its claims.
func (v *Verifier) Verify(token string, now time.Time) (Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 || len(token) > 2048 {
		return Claims{}, ErrInvalid
	}

	mac := hmac.New(sha256.New, v.secret)
	mac.Write([]byte(parts[0] + "." + parts[1]))
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !hmac.Equal(sig, mac.Sum(nil)) {
		return Claims{}, ErrInvalid
	}

	var h header
	if decode(parts[0], &h) != nil || h.Alg != "HS256" {
		return Claims{}, ErrInvalid
	}
	var p payload
	if decode(parts[1], &p) != nil || p.Aud != Audience || p.Sub == "" {
		return Claims{}, ErrInvalid
	}
	exp := time.Unix(p.Exp, 0)
	if p.Exp == 0 || now.After(exp.Add(clockSkew)) || time.Unix(p.Iat, 0).After(now.Add(clockSkew)) {
		return Claims{}, ErrInvalid
	}
	ep, err := uuid.Parse(p.Ep)
	if err != nil {
		return Claims{}, ErrInvalid
	}
	return Claims{Subject: p.Sub, Org: p.Org, Endpoint: ep, Expires: exp}, nil
}

// Sign creates a token. The web app is the production signer; this exists
// for tests and tooling and produces byte-identical output for equal input.
func Sign(secret string, c Claims, issuedAt time.Time) string {
	h, _ := json.Marshal(header{Alg: "HS256", Typ: "JWT"})
	p, _ := json.Marshal(payload{
		Sub: c.Subject, Org: c.Org, Ep: c.Endpoint.String(), Aud: Audience,
		Iat: issuedAt.Unix(), Exp: c.Expires.Unix(),
	})
	signing := base64.RawURLEncoding.EncodeToString(h) + "." + base64.RawURLEncoding.EncodeToString(p)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(signing))
	return signing + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func decode(segment string, v any) error {
	b, err := base64.RawURLEncoding.DecodeString(segment)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}
