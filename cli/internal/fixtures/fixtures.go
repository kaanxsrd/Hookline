// Package fixtures holds the sample webhook events `hookline trigger` sends:
// realistic payloads with fresh IDs and timestamps, signed the way each
// provider signs them.
package fixtures

import (
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"slices"
	"strconv"
	"strings"
	"time"
)

// Fixture is one sample event.
type Fixture struct {
	Name        string // provider.event, e.g. stripe.payment_intent.succeeded
	Provider    string // signature provider (signature_provider enum)
	Description string
	build       func(now time.Time) event
}

type event struct {
	path    string
	headers [][2]string
	body    any
}

// Built is a ready-to-send request.
type Built struct {
	Method  string
	Path    string
	Headers [][2]string
	Body    []byte
	// Note explains something the user should know (e.g. a throwaway key).
	Note string
}

const alnum = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

func randomID(prefix string, n int) string {
	b := make([]byte, n)
	for i := range b {
		k, err := rand.Int(rand.Reader, big.NewInt(int64(len(alnum))))
		if err != nil {
			panic(err)
		}
		b[i] = alnum[k.Int64()]
	}
	return prefix + string(b)
}

func randomNumber(digits int) int64 {
	max := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(digits)), nil)
	n, err := rand.Int(rand.Reader, max)
	if err != nil {
		panic(err)
	}
	return n.Int64() + 1
}

func uuid4() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	h := hex.EncodeToString(b)
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}

func stripeEvent(typ string, object map[string]any, now time.Time) event {
	return event{
		path:    "/stripe",
		headers: [][2]string{{"User-Agent", "Stripe/1.0 (+https://stripe.com/docs/webhooks)"}},
		body: map[string]any{
			"id": randomID("evt_", 24), "object": "event", "api_version": "2026-09-30.clover",
			"created": now.Unix(), "type": typ, "livemode": false, "pending_webhooks": 1,
			"request": map[string]any{"id": randomID("req_", 14), "idempotency_key": uuid4()},
			"data":    map[string]any{"object": object},
		},
	}
}

func githubRepo() map[string]any {
	return map[string]any{
		"id": randomNumber(9), "name": "hello-world", "full_name": "octo-org/hello-world", "private": false,
		"html_url": "https://github.com/octo-org/hello-world", "default_branch": "main",
		"owner": map[string]any{"login": "octo-org", "id": randomNumber(8), "type": "Organization"},
	}
}

func githubEvent(name string, body map[string]any) event {
	return event{
		path: "/github",
		headers: [][2]string{
			{"User-Agent", "GitHub-Hookshot/7f2b1c4"}, {"X-GitHub-Event", name},
			{"X-GitHub-Delivery", uuid4()}, {"X-GitHub-Hook-ID", strconv.FormatInt(randomNumber(9), 10)},
		},
		body: body,
	}
}

var all = []Fixture{
	{
		Name: "stripe.payment_intent.succeeded", Provider: "stripe", Description: "A card payment succeeded",
		build: func(now time.Time) event {
			return stripeEvent("payment_intent.succeeded", map[string]any{
				"id": randomID("pi_", 24), "object": "payment_intent", "amount": 4200, "amount_received": 4200,
				"currency": "usd", "status": "succeeded", "customer": randomID("cus_", 14),
				"payment_method": randomID("pm_", 24), "created": now.Add(-3 * time.Second).Unix(),
				"metadata": map[string]any{"order_id": strconv.FormatInt(randomNumber(6), 10)},
			}, now)
		},
	},
	{
		Name: "stripe.checkout.session.completed", Provider: "stripe", Description: "A Checkout session was paid",
		build: func(now time.Time) event {
			return stripeEvent("checkout.session.completed", map[string]any{
				"id": randomID("cs_test_", 40), "object": "checkout.session", "mode": "payment",
				"amount_total": 9900, "currency": "eur", "payment_status": "paid", "status": "complete",
				"customer_details": map[string]any{"email": "jenny.rosen@example.com", "name": "Jenny Rosen"},
				"payment_intent":   randomID("pi_", 24), "created": now.Add(-time.Minute).Unix(),
			}, now)
		},
	},
	{
		Name: "github.push", Provider: "github", Description: "Commits were pushed to main",
		build: func(time.Time) event {
			sha := hex.EncodeToString([]byte(randomID("", 20)))
			return githubEvent("push", map[string]any{
				"ref": "refs/heads/main", "before": strings.Repeat("0", 40), "after": sha[:40],
				"repository": githubRepo(), "pusher": map[string]any{"name": "octocat", "email": "octocat@example.com"},
				"commits": []any{map[string]any{
					"id": sha[:40], "message": "Fix webhook retries", "author": map[string]any{"name": "Octo Cat", "username": "octocat"},
					"added": []string{}, "removed": []string{}, "modified": []string{"README.md"},
				}},
			})
		},
	},
	{
		Name: "github.pull_request.opened", Provider: "github", Description: "A pull request was opened",
		build: func(now time.Time) event {
			number := randomNumber(3)
			return githubEvent("pull_request", map[string]any{
				"action": "opened", "number": number, "repository": githubRepo(),
				"pull_request": map[string]any{
					"id": randomNumber(9), "number": number, "state": "open", "title": "Add replay to the CLI",
					"user": map[string]any{"login": "octocat"}, "created_at": now.UTC().Format(time.RFC3339),
					"head": map[string]any{"ref": "feature/replay"}, "base": map[string]any{"ref": "main"},
				},
				"sender": map[string]any{"login": "octocat"},
			})
		},
	},
	{
		Name: "shopify.orders/create", Provider: "shopify", Description: "An order was placed",
		build: func(now time.Time) event {
			id := randomNumber(13)
			return event{
				path: "/shopify",
				headers: [][2]string{
					{"X-Shopify-Topic", "orders/create"}, {"X-Shopify-Shop-Domain", "example-shop.myshopify.com"},
					{"X-Shopify-Webhook-Id", uuid4()}, {"X-Shopify-API-Version", "2026-10"},
					{"X-Shopify-Triggered-At", now.UTC().Format(time.RFC3339Nano)},
				},
				body: map[string]any{
					"id": id, "admin_graphql_api_id": fmt.Sprintf("gid://shopify/Order/%d", id), "name": "#1042",
					"email": "jon@example.com", "currency": "USD", "total_price": "64.00", "financial_status": "paid",
					"created_at": now.UTC().Format(time.RFC3339),
					"line_items": []any{map[string]any{"id": randomNumber(13), "title": "Webhook T-shirt", "quantity": 2, "price": "32.00"}},
				},
			}
		},
	},
	{
		Name: "discord.ping", Provider: "discord", Description: "Discord's interaction endpoint check (PING)",
		build: func(time.Time) event {
			return event{
				path:    "/discord",
				headers: [][2]string{{"User-Agent", "Discord-Interactions/1.0 (+https://discord.com)"}},
				body: map[string]any{
					"id": strconv.FormatInt(randomNumber(18), 10), "application_id": strconv.FormatInt(randomNumber(18), 10),
					"type": 1, "token": randomID("", 64), "version": 1,
				},
			}
		},
	},
	{
		Name: "generic.json", Provider: "hmac_sha256", Description: "A generic JSON event signed with HMAC-SHA256",
		build: func(now time.Time) event {
			return event{
				path:    "/events",
				headers: [][2]string{{"User-Agent", "hookline-trigger"}},
				body: map[string]any{
					"id": randomID("evt_", 16), "type": "order.created", "created_at": now.UTC().Format(time.RFC3339),
					"data": map[string]any{"order_id": randomNumber(6), "total": 1999, "currency": "usd"},
				},
			}
		},
	},
}

// List returns every fixture, sorted by name.
func List() []Fixture {
	out := slices.Clone(all)
	slices.SortFunc(out, func(a, b Fixture) int { return strings.Compare(a.Name, b.Name) })
	return out
}

// Find looks a fixture up by name.
func Find(name string) (Fixture, bool) {
	i := slices.IndexFunc(all, func(f Fixture) bool { return f.Name == name })
	if i < 0 {
		return Fixture{}, false
	}
	return all[i], true
}

func mac(key, msg []byte) []byte {
	m := hmac.New(sha256.New, key)
	m.Write(msg)
	return m.Sum(nil)
}

// Build renders the fixture and signs it with secret (empty: unsigned).
// For Discord the secret is a 64-hex Ed25519 seed; without one a throwaway
// key is used and Note says which public key verifies it.
func (f Fixture) Build(secret string, now time.Time) (Built, error) {
	ev := f.build(now)
	body, err := json.Marshal(ev.body)
	if err != nil {
		return Built{}, err
	}
	b := Built{Method: "POST", Path: ev.path, Headers: append([][2]string{{"Content-Type", "application/json"}}, ev.headers...), Body: body}
	ts := strconv.FormatInt(now.Unix(), 10)

	if f.Provider == "discord" {
		var priv ed25519.PrivateKey
		if secret != "" {
			seed, err := hex.DecodeString(secret)
			if err != nil || len(seed) != ed25519.SeedSize {
				return Built{}, errors.New("for Discord events --secret is a 64-hex Ed25519 private key seed")
			}
			priv = ed25519.NewKeyFromSeed(seed)
		} else {
			_, k, err := ed25519.GenerateKey(rand.Reader)
			if err != nil {
				return Built{}, err
			}
			priv = k
			b.Note = "Signed with a throwaway key; to see it verified, set the endpoint's Discord public key to " +
				hex.EncodeToString(priv.Public().(ed25519.PublicKey))
		}
		sig := ed25519.Sign(priv, append([]byte(ts), body...))
		b.Headers = append(b.Headers, [2]string{"X-Signature-Ed25519", hex.EncodeToString(sig)}, [2]string{"X-Signature-Timestamp", ts})
		return b, nil
	}
	if secret == "" {
		return b, nil
	}
	switch f.Provider {
	case "stripe":
		b.Headers = append(b.Headers, [2]string{"Stripe-Signature", "t=" + ts + ",v1=" + hex.EncodeToString(mac([]byte(secret), append([]byte(ts+"."), body...)))})
	case "github":
		b.Headers = append(b.Headers, [2]string{"X-Hub-Signature-256", "sha256=" + hex.EncodeToString(mac([]byte(secret), body))})
	case "shopify":
		b.Headers = append(b.Headers, [2]string{"X-Shopify-Hmac-Sha256", base64.StdEncoding.EncodeToString(mac([]byte(secret), body))})
	case "hmac_sha256":
		b.Headers = append(b.Headers, [2]string{"X-Signature", "sha256=" + hex.EncodeToString(mac([]byte(secret), body))})
	}
	return b, nil
}
