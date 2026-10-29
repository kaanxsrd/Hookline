// Package signatures verifies webhook signatures for the providers Hookline
// supports. apps/web/lib/signatures.ts is the TypeScript twin; both are
// tested against packages/shared/fixtures/signature-vectors.json.
package signatures

import (
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"strconv"
	"strings"
	"time"
)

// SecretContext is the associated data an endpoint's signature secret is
// sealed with (secretbox), binding it to that endpoint.
func SecretContext(endpointID string) string { return "endpoint.signature_secret:" + endpointID }

// Provider names match the signature_provider enum in packages/db.
type Provider string

// Supported providers.
const (
	Stripe           Provider = "stripe"
	GitHub           Provider = "github"
	Shopify          Provider = "shopify"
	Slack            Provider = "slack"
	StandardWebhooks Provider = "standard_webhooks"
	Discord          Provider = "discord"
	HMACSHA256       Provider = "hmac_sha256"
)

// Tolerance is how far a signed timestamp may be from the time of capture.
const Tolerance = 5 * time.Minute

// Reason explains an invalid signature.
type Reason string

// Why a signature did not verify.
const (
	ReasonMissing   Reason = "missing"   // the signature header (or timestamp) is absent
	ReasonMalformed Reason = "malformed" // the header cannot be parsed
	ReasonTimestamp Reason = "timestamp" // the signed timestamp is outside Tolerance
	ReasonMismatch  Reason = "mismatch"  // the signature does not match
	ReasonSecret    Reason = "secret"    // the configured secret or key is unusable
	ReasonProvider  Reason = "provider"  // unknown provider
)

// Result is the outcome of a verification.
type Result struct {
	Verified bool
	Reason   Reason // set when not verified
	Message  string // human-readable explanation, safe to show
}

// Input is what a verifier looks at.
type Input struct {
	Headers [][2]string
	Body    []byte
	Now     time.Time
}

func (in Input) header(names ...string) string {
	for _, name := range names {
		for _, h := range in.Headers {
			if strings.EqualFold(h[0], name) {
				return h[1]
			}
		}
	}
	return ""
}

func ok() Result { return Result{Verified: true} }

func fail(r Reason, msg string) Result { return Result{Reason: r, Message: msg} }

// Verify checks in against the provider's scheme using secret.
func Verify(p Provider, secret string, in Input) Result {
	switch p {
	case Stripe:
		return stripe(secret, in)
	case GitHub:
		return hexHMAC(secret, in, "X-Hub-Signature-256", "sha256=")
	case Shopify:
		return shopify(secret, in)
	case Slack:
		return slack(secret, in)
	case StandardWebhooks:
		return standardWebhooks(secret, in)
	case Discord:
		return discord(secret, in)
	case HMACSHA256:
		return generic(secret, in)
	default:
		return fail(ReasonProvider, "Unknown signature provider "+strconv.Quote(string(p))+".")
	}
}

func hmacSHA256(key, msg []byte) []byte {
	m := hmac.New(sha256.New, key)
	m.Write(msg)
	return m.Sum(nil)
}

func withinTolerance(ts string, now time.Time) (bool, bool) {
	sec, err := strconv.ParseInt(strings.TrimSpace(ts), 10, 64)
	if err != nil {
		return false, false
	}
	d := now.Sub(time.Unix(sec, 0))
	return d <= Tolerance && d >= -Tolerance, true
}

const toleranceMsg = "The signed timestamp is more than 5 minutes from the time of capture."

func stripe(secret string, in Input) Result {
	h := in.header("Stripe-Signature")
	if h == "" {
		return fail(ReasonMissing, "The Stripe-Signature header is missing.")
	}
	var ts string
	var sigs []string
	for part := range strings.SplitSeq(h, ",") {
		k, v, found := strings.Cut(strings.TrimSpace(part), "=")
		if !found {
			continue
		}
		switch k {
		case "t":
			ts = v
		case "v1":
			sigs = append(sigs, v)
		}
	}
	if ts == "" || len(sigs) == 0 {
		return fail(ReasonMalformed, "Stripe-Signature needs t= and v1= parts.")
	}
	within, valid := withinTolerance(ts, in.Now)
	if !valid {
		return fail(ReasonMalformed, "Stripe-Signature has an invalid timestamp.")
	}
	if !within {
		return fail(ReasonTimestamp, toleranceMsg)
	}
	want := hmacSHA256([]byte(secret), append([]byte(ts+"."), in.Body...))
	for _, s := range sigs {
		if got, err := hex.DecodeString(s); err == nil && hmac.Equal(got, want) {
			return ok()
		}
	}
	return fail(ReasonMismatch, "No v1 signature matches the body and signing secret.")
}

func hexHMAC(secret string, in Input, header, prefix string) Result {
	h := in.header(header)
	if h == "" {
		return fail(ReasonMissing, "The "+header+" header is missing.")
	}
	sig, found := strings.CutPrefix(strings.TrimSpace(h), prefix)
	if !found {
		return fail(ReasonMalformed, header+" must start with "+prefix+".")
	}
	got, err := hex.DecodeString(sig)
	if err != nil {
		return fail(ReasonMalformed, header+" is not hex.")
	}
	if !hmac.Equal(got, hmacSHA256([]byte(secret), in.Body)) {
		return fail(ReasonMismatch, "The signature does not match the body and secret.")
	}
	return ok()
}

func shopify(secret string, in Input) Result {
	h := in.header("X-Shopify-Hmac-Sha256")
	if h == "" {
		return fail(ReasonMissing, "The X-Shopify-Hmac-Sha256 header is missing.")
	}
	got, err := base64.StdEncoding.DecodeString(strings.TrimSpace(h))
	if err != nil {
		return fail(ReasonMalformed, "X-Shopify-Hmac-Sha256 is not base64.")
	}
	if !hmac.Equal(got, hmacSHA256([]byte(secret), in.Body)) {
		return fail(ReasonMismatch, "The signature does not match the body and secret.")
	}
	return ok()
}

func slack(secret string, in Input) Result {
	sig, ts := in.header("X-Slack-Signature"), in.header("X-Slack-Request-Timestamp")
	if sig == "" || ts == "" {
		return fail(ReasonMissing, "X-Slack-Signature and X-Slack-Request-Timestamp are required.")
	}
	within, valid := withinTolerance(ts, in.Now)
	if !valid {
		return fail(ReasonMalformed, "X-Slack-Request-Timestamp is not a Unix timestamp.")
	}
	if !within {
		return fail(ReasonTimestamp, toleranceMsg)
	}
	hexSig, found := strings.CutPrefix(sig, "v0=")
	got, err := hex.DecodeString(hexSig)
	if !found || err != nil {
		return fail(ReasonMalformed, "X-Slack-Signature must be v0= followed by hex.")
	}
	msg := append([]byte("v0:"+strings.TrimSpace(ts)+":"), in.Body...)
	if !hmac.Equal(got, hmacSHA256([]byte(secret), msg)) {
		return fail(ReasonMismatch, "The signature does not match the body and signing secret.")
	}
	return ok()
}

func standardWebhooks(secret string, in Input) Result {
	id := in.header("webhook-id", "svix-id")
	ts := in.header("webhook-timestamp", "svix-timestamp")
	sigs := in.header("webhook-signature", "svix-signature")
	if id == "" || ts == "" || sigs == "" {
		return fail(ReasonMissing, "webhook-id, webhook-timestamp and webhook-signature are required.")
	}
	key, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(secret, "whsec_"))
	if err != nil || len(key) == 0 {
		return fail(ReasonSecret, "The secret must be whsec_ followed by base64.")
	}
	within, valid := withinTolerance(ts, in.Now)
	if !valid {
		return fail(ReasonMalformed, "webhook-timestamp is not a Unix timestamp.")
	}
	if !within {
		return fail(ReasonTimestamp, toleranceMsg)
	}
	want := hmacSHA256(key, append([]byte(id+"."+strings.TrimSpace(ts)+"."), in.Body...))
	for s := range strings.FieldsSeq(sigs) {
		v, sig, found := strings.Cut(s, ",")
		if !found || v != "v1" {
			continue
		}
		if got, err := base64.StdEncoding.DecodeString(sig); err == nil && hmac.Equal(got, want) {
			return ok()
		}
	}
	return fail(ReasonMismatch, "No v1 signature matches the body and secret.")
}

func discord(publicKey string, in Input) Result {
	sig, ts := in.header("X-Signature-Ed25519"), in.header("X-Signature-Timestamp")
	if sig == "" || ts == "" {
		return fail(ReasonMissing, "X-Signature-Ed25519 and X-Signature-Timestamp are required.")
	}
	key, err := hex.DecodeString(strings.TrimSpace(publicKey))
	if err != nil || len(key) != ed25519.PublicKeySize {
		return fail(ReasonSecret, "Use your Discord application's public key (64 hex characters).")
	}
	got, err := hex.DecodeString(sig)
	if err != nil || len(got) != ed25519.SignatureSize {
		return fail(ReasonMalformed, "X-Signature-Ed25519 is not a hex Ed25519 signature.")
	}
	// Discord signs without a freshness window of its own; timestamps are not checked.
	if !ed25519.Verify(ed25519.PublicKey(key), append([]byte(ts), in.Body...), got) {
		return fail(ReasonMismatch, "The Ed25519 signature does not match.")
	}
	return ok()
}

// genericHeaders are where a plain HMAC-SHA256 of the body is looked for.
var genericHeaders = []string{"X-Signature", "X-Signature-256", "X-Hub-Signature-256", "X-Webhook-Signature", "X-Hmac-Signature"}

func generic(secret string, in Input) Result {
	h := in.header(genericHeaders...)
	if h == "" {
		return fail(ReasonMissing, "None of "+strings.Join(genericHeaders, ", ")+" is present.")
	}
	sig := strings.TrimSpace(h)
	sig = strings.TrimPrefix(sig, "sha256=")
	want := hmacSHA256([]byte(secret), in.Body)
	var got []byte
	if b, err := hex.DecodeString(sig); err == nil {
		got = b
	} else if b, err := base64.StdEncoding.DecodeString(sig); err == nil {
		got = b
	} else {
		return fail(ReasonMalformed, "The signature is neither hex nor base64.")
	}
	if subtle.ConstantTimeCompare(got, want) != 1 {
		return fail(ReasonMismatch, "The signature does not match the body and secret.")
	}
	return ok()
}
