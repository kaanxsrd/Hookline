package cmd_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaanxsrd/hookline/cli/internal/cmd"
	"github.com/kaanxsrd/hookline/cli/internal/config"
)

const (
	key       = "hk_live_CliTestKey0123456789abcdefghijABCDEFGHIJKLMN"
	requestID = "0192f3a4-0000-7000-8000-000000000001"
)

// TestMain doubles as a fake $EDITOR: with HOOKLINE_FAKE_EDITOR set, the test
// binary rewrites the file it is given and exits.
func TestMain(m *testing.M) {
	if os.Getenv("HOOKLINE_FAKE_EDITOR") == "1" {
		file := os.Args[len(os.Args)-1]
		b, err := os.ReadFile(file)
		if err != nil {
			os.Exit(2)
		}
		out := strings.Replace(string(b), "method: POST", "method: PUT", 1)
		out = strings.Replace(out, "invoice.paid", "invoice.voided", 1)
		if err := os.WriteFile(file, []byte(out), 0o600); err != nil {
			os.Exit(3)
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}

// fakeAPI imitates the parts of /api/v1 the CLI uses.
type fakeAPI struct {
	*httptest.Server
	polls   atomic.Int32
	revoked atomic.Bool
	created atomic.Value

	mu       sync.Mutex
	replays  []map[string]any
	captured []*http.Request
	bodies   []string
}

func newFakeAPI(t *testing.T) *fakeAPI {
	f := &fakeAPI{}
	mux := http.NewServeMux()
	writeJSON := func(w http.ResponseWriter, status int, v any) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(v)
	}
	authed := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "Bearer "+key || f.revoked.Load() {
				writeJSON(w, 401, map[string]any{"error": map[string]string{"code": "unauthorized", "message": "bad key"}})
				return
			}
			next(w, r)
		}
	}
	mux.HandleFunc("POST /api/v1/cli/device-codes", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		writeJSON(w, 201, map[string]any{
			"device_code": "device-code-0123456789", "user_code": "BCDF-GHJK",
			"verification_uri": f.URL + "/cli/authorize", "verification_uri_complete": f.URL + "/cli/authorize?code=BCDF-GHJK",
			"expires_in": 600, "interval": 0,
		})
	})
	mux.HandleFunc("POST /api/v1/cli/device-codes/poll", func(w http.ResponseWriter, _ *http.Request) {
		if f.polls.Add(1) < 3 {
			writeJSON(w, 400, map[string]any{"error": map[string]string{"code": "authorization_pending", "message": "waiting"}})
			return
		}
		writeJSON(w, 200, map[string]any{
			"api_key": key, "key_prefix": "hk_live_CliT",
			"org":  map[string]string{"id": "o1", "slug": "acme", "name": "Acme"},
			"user": map[string]string{"email": "dev@acme.test", "name": "Dev"},
		})
	})
	mux.HandleFunc("GET /api/v1/me", authed(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{
			"org":  map[string]string{"id": "o1", "slug": "acme", "name": "Acme", "plan": "pro"},
			"key":  map[string]any{"id": "k1", "name": "CLI on laptop", "prefix": "hk_live_CliT", "scopes": []string{"tunnel"}},
			"user": map[string]string{"email": "dev@acme.test", "name": "Dev"},
		})
	}))
	mux.HandleFunc("POST /api/v1/cli/logout", authed(func(w http.ResponseWriter, _ *http.Request) {
		f.revoked.Store(true)
		writeJSON(w, 200, map[string]bool{"revoked": true})
	}))
	endpoint := map[string]any{
		"id": "e1", "slug": "abc123def456", "url": "", "name": "Stripe",
		"status": "active", "request_count": 7, "created_at": "2026-01-01T00:00:00Z",
	}
	mux.HandleFunc("GET /api/v1/endpoints", authed(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]any{"data": []any{endpoint}})
	}))
	mux.HandleFunc("POST /api/v1/endpoints", authed(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		f.created.Store(body["name"])
		writeJSON(w, 201, map[string]any{"id": "e2", "slug": "newSlug00001", "url": "https://hooks.test/h/newSlug00001", "name": body["name"], "status": "active"})
	}))
	mux.HandleFunc("GET /api/v1/endpoints/{ref}", authed(func(w http.ResponseWriter, r *http.Request) {
		if r.PathValue("ref") != "abc123def456" {
			writeJSON(w, 404, map[string]any{"error": map[string]string{"code": "not_found", "message": "No such endpoint in this organization."}})
			return
		}
		writeJSON(w, 200, endpoint)
	}))
	mux.HandleFunc("DELETE /api/v1/endpoints/{ref}", authed(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("GET /api/v1/requests/{id}", authed(func(w http.ResponseWriter, r *http.Request) {
		if r.PathValue("id") != requestID {
			writeJSON(w, 404, map[string]any{"error": map[string]string{"code": "not_found", "message": "No such request in this organization."}})
			return
		}
		body := base64.StdEncoding.EncodeToString([]byte(`{"type":"invoice.paid"}`))
		writeJSON(w, 200, map[string]any{
			"id": requestID, "endpoint": map[string]string{"id": "e1", "slug": "abc123def456"},
			"method": "POST", "path": "/stripe", "query": [][2]string{{"a", "1"}},
			"headers":  [][2]string{{"Content-Type", "application/json"}, {"Stripe-Signature", "t=1,v1=x"}},
			"body_b64": body, "body_size": 23, "received_at": "2026-10-29T12:00:00Z",
		})
	}))
	mux.HandleFunc("POST /api/v1/requests/{id}/replay", authed(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		f.mu.Lock()
		f.replays = append(f.replays, body)
		f.mu.Unlock()
		if body["target"] == "cli" {
			writeJSON(w, 202, map[string]any{"target": "cli", "receivers": 1})
			return
		}
		writeJSON(w, 202, map[string]any{"target": "destination", "delivery_id": "d1"})
	}))
	mux.HandleFunc("GET /api/v1/endpoints/{ref}/signature-secret", authed(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]string{"provider": "stripe", "secret": "whsec_from_api"})
	}))
	// Intake, for `trigger`.
	mux.HandleFunc("/h/", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		f.mu.Lock()
		f.captured = append(f.captured, r)
		f.bodies = append(f.bodies, string(body))
		f.mu.Unlock()
		w.Header().Set("X-Hookline-Request-Id", "captured-1")
		w.WriteHeader(http.StatusOK)
	})
	f.Server = httptest.NewServer(mux)
	endpoint["url"] = f.URL + "/h/abc123def456"
	t.Cleanup(f.Close)
	return f
}

func setup(t *testing.T) *fakeAPI {
	t.Setenv("HOOKLINE_CONFIG_DIR", t.TempDir())
	t.Setenv("HOOKLINE_NO_BROWSER", "1")
	t.Setenv("HOOKLINE_API_KEY", "")
	t.Setenv("HOOKLINE_URL", "")
	t.Setenv("NO_COLOR", "1")
	return newFakeAPI(t)
}

func runCLI(t *testing.T, stdin string, args ...string) (string, string, int) {
	t.Helper()
	var out, errb bytes.Buffer
	root := cmd.NewRoot(&out, &errb)
	root.SetIn(strings.NewReader(stdin))
	root.SetArgs(args)
	code := 0
	if err := root.ExecuteContext(context.Background()); err != nil {
		errb.WriteString("Error: " + err.Error())
		code = 1
	}
	return out.String(), errb.String(), code
}

func login(t *testing.T, api *fakeAPI) {
	t.Helper()
	_, stderr, code := runCLI(t, "", "login", "--url", api.URL)
	require.Equal(t, 0, code, stderr)
}

func TestLoginStoresTheKeyPrivately(t *testing.T) {
	api := setup(t)
	out, stderr, code := runCLI(t, "", "login", "--url", api.URL)
	require.Equal(t, 0, code, stderr)
	assert.Contains(t, out, "BCDF-GHJK")
	assert.Contains(t, out, "/cli/authorize?code=BCDF-GHJK")
	assert.Contains(t, stderr, "Logged in to Acme (acme) as dev@acme.test")
	assert.EqualValues(t, 3, api.polls.Load(), "polled until approved")

	cfg, err := config.Load()
	require.NoError(t, err)
	assert.Equal(t, api.URL, cfg.URL)
	assert.Equal(t, "acme", cfg.DefaultOrg)
	assert.Equal(t, key, cfg.Orgs["acme"].APIKey)

	if runtime.GOOS != "windows" {
		p, _ := config.Path()
		st, err := os.Stat(p)
		require.NoError(t, err)
		assert.Equal(t, os.FileMode(0o600), st.Mode().Perm())
		dir, err := os.Stat(filepath.Dir(p))
		require.NoError(t, err)
		assert.Equal(t, os.FileMode(0o700), dir.Mode().Perm())
	}
}

func TestWhoamiAndLogout(t *testing.T) {
	api := setup(t)
	login(t, api)

	out, _, code := runCLI(t, "", "whoami")
	require.Equal(t, 0, code)
	assert.Contains(t, out, "dev@acme.test in Acme (acme, pro plan)")

	out, _, code = runCLI(t, "", "whoami", "--json")
	require.Equal(t, 0, code)
	var me map[string]any
	require.NoError(t, json.Unmarshal([]byte(out), &me))
	assert.Equal(t, "acme", me["org"].(map[string]any)["slug"])

	_, stderr, code := runCLI(t, "", "logout")
	require.Equal(t, 0, code, stderr)
	assert.True(t, api.revoked.Load())
	cfg, err := config.Load()
	require.NoError(t, err)
	assert.Empty(t, cfg.Orgs)

	_, stderr, code = runCLI(t, "", "whoami")
	assert.Equal(t, 1, code)
	assert.Contains(t, stderr, "hookline login")
}

func TestEnvironmentKeyOverridesTheConfig(t *testing.T) {
	api := setup(t)
	t.Setenv("HOOKLINE_API_KEY", key)
	t.Setenv("HOOKLINE_URL", api.URL)
	out, stderr, code := runCLI(t, "", "endpoints", "list")
	require.Equal(t, 0, code, stderr)
	assert.Contains(t, out, "abc123def456")
	assert.Contains(t, out, "Stripe")
}

func TestEndpointsCommands(t *testing.T) {
	api := setup(t)
	login(t, api)

	out, _, code := runCLI(t, "", "endpoints", "list", "--json")
	require.Equal(t, 0, code)
	var eps []map[string]any
	require.NoError(t, json.Unmarshal([]byte(out), &eps))
	require.Len(t, eps, 1)

	out, _, code = runCLI(t, "", "endpoints", "create", "Billing")
	require.Equal(t, 0, code)
	assert.Equal(t, "Billing", api.created.Load())
	assert.Contains(t, out, "https://hooks.test/h/newSlug00001")

	_, stderr, code := runCLI(t, "wrong\n", "endpoints", "delete", "abc123def456")
	assert.Equal(t, 1, code)
	assert.Contains(t, stderr, "did not match")
	_, stderr, code = runCLI(t, "abc123def456\n", "endpoints", "delete", "abc123def456")
	require.Equal(t, 0, code, stderr)
	assert.Contains(t, stderr, "Deleted abc123def456")

	_, stderr, code = runCLI(t, "", "endpoints", "delete", "missing", "--yes")
	assert.Equal(t, 1, code)
	assert.Contains(t, stderr, "No such endpoint")

	out, _, code = runCLI(t, "", "endpoints", "open", "abc123def456")
	require.Equal(t, 0, code)
	assert.Equal(t, api.URL+"/acme/endpoints/abc123def456\n", out, "prints the URL when no browser is opened")
}

func TestListenValidatesFlags(t *testing.T) {
	setup(t)
	_, stderr, code := runCLI(t, "", "listen", "abc123def456")
	assert.Equal(t, 1, code)
	assert.Contains(t, stderr, "--forward")
	_, stderr, code = runCLI(t, "", "listen", "abc123def456", "--forward", "localhost:3000")
	assert.Equal(t, 1, code)
	assert.Contains(t, stderr, "http(s) URL")
	_, stderr, code = runCLI(t, "", "listen", "abc123def456", "--forward", "http://localhost:3000", "--path-rewrite", "nope")
	assert.Equal(t, 1, code)
	assert.Contains(t, stderr, "/from=/to")
	_, stderr, code = runCLI(t, "", "listen", "abc123def456", "--forward", "http://localhost:3000")
	assert.Equal(t, 1, code)
	assert.Contains(t, stderr, "not logged in")
}

func TestReplayToALocalURL(t *testing.T) {
	api := setup(t)
	login(t, api)
	var got *http.Request
	var body string
	local := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r
		b, _ := io.ReadAll(r.Body)
		body = string(b)
		w.WriteHeader(http.StatusAccepted)
	}))
	defer local.Close()

	out, stderr, code := runCLI(t, "", "replay", requestID, "--to", local.URL+"/hooks")
	require.Equal(t, 0, code, stderr)
	assert.Equal(t, "/hooks/stripe", got.URL.Path)
	assert.Equal(t, "a=1", got.URL.RawQuery)
	assert.Equal(t, "t=1,v1=x", got.Header.Get("Stripe-Signature"))
	assert.JSONEq(t, `{"type":"invoice.paid"}`, body)
	assert.Contains(t, out, "→ 202")
	assert.Contains(t, out, "(replay)")
}

func TestReplayEditedToTheCLI(t *testing.T) {
	api := setup(t)
	login(t, api)
	exe, err := os.Executable()
	require.NoError(t, err)
	t.Setenv("HOOKLINE_EDITOR", exe)
	t.Setenv("HOOKLINE_FAKE_EDITOR", "1")

	_, stderr, code := runCLI(t, "", "replay", requestID, "--cli", "--edit")
	require.Equal(t, 0, code, stderr)
	assert.Contains(t, stderr, "Sent to the CLIs")
	api.mu.Lock()
	defer api.mu.Unlock()
	require.Len(t, api.replays, 1)
	assert.Equal(t, "cli", api.replays[0]["target"])
	override := api.replays[0]["override"].(map[string]any)
	assert.Equal(t, "PUT", override["method"])
	assert.Equal(t, "/stripe", override["path"])
	body, _ := base64.StdEncoding.DecodeString(override["body_b64"].(string))
	assert.JSONEq(t, `{"type":"invoice.voided"}`, string(body))
}

func TestReplayNeedsOneTarget(t *testing.T) {
	api := setup(t)
	login(t, api)
	_, stderr, code := runCLI(t, "", "replay", requestID)
	assert.Equal(t, 1, code)
	assert.Contains(t, stderr, "choose one target")
	_, stderr, code = runCLI(t, "", "replay", requestID, "--cli", "--destination", "d1")
	assert.Equal(t, 1, code)
	assert.Contains(t, stderr, "choose one target")

	_, stderr, code = runCLI(t, "", "replay", requestID, "--destination", "0192f3a4-0000-7000-8000-00000000000d")
	require.Equal(t, 0, code, stderr)
	assert.Contains(t, stderr, "Queued delivery d1")
}

func TestTriggerSignsWithTheEndpointSecret(t *testing.T) {
	api := setup(t)
	login(t, api)

	out, _, code := runCLI(t, "", "trigger", "--list")
	require.Equal(t, 0, code)
	assert.Contains(t, out, "stripe.payment_intent.succeeded")
	assert.Contains(t, out, "discord.ping")

	_, stderr, code := runCLI(t, "", "trigger", "abc123def456", "stripe.payment_intent.succeeded")
	require.Equal(t, 0, code, stderr)
	assert.Contains(t, stderr, "Sent stripe.payment_intent.succeeded")
	api.mu.Lock()
	defer api.mu.Unlock()
	require.Len(t, api.captured, 1)
	assert.Equal(t, "/h/abc123def456/stripe", api.captured[0].URL.Path)
	assert.Contains(t, api.captured[0].Header.Get("Stripe-Signature"), ",v1=")
	assert.Contains(t, api.bodies[0], `"type":"payment_intent.succeeded"`)

	_, stderr, code = runCLI(t, "", "trigger", "abc123def456", "nope.event")
	assert.Equal(t, 1, code)
	assert.Contains(t, stderr, "trigger --list")
}
