package mail_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaanxsrd/hookline/packages/gocommon/mail"
)

func TestGraphSend(t *testing.T) {
	var tokens atomic.Int32
	var sent map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			assert.NoError(t, r.ParseForm())
			assert.Equal(t, "client_credentials", r.PostForm.Get("grant_type"))
			assert.Equal(t, "app-id", r.PostForm.Get("client_id"))
			assert.Equal(t, "app-secret", r.PostForm.Get("client_secret"))
			tokens.Add(1)
			_, _ = w.Write([]byte(`{"access_token":"tok","expires_in":3600}`))
		case "/v1.0/users/contact@example.com/sendMail":
			assert.Equal(t, "Bearer tok", r.Header.Get("Authorization"))
			assert.NoError(t, json.NewDecoder(r.Body).Decode(&sent))
			w.WriteHeader(http.StatusAccepted)
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)

	g, err := mail.NewGraph("tenant", "app-id", "app-secret", "Hookline <contact@example.com>")
	require.NoError(t, err)
	g.TokenURL, g.APIBase = srv.URL+"/token", srv.URL+"/v1.0"

	msg := mail.Message{
		To: []string{"owner@example.com"}, Subject: "Deliveries are failing", Template: "delivery_failing",
		Data: failing{OrgName: "Acme", DestinationName: "API", DestinationURL: "https://api.example.com", EndpointName: "Stripe", LastResult: "timeout", URL: "https://hookline.test/acme/deliveries"},
	}
	require.NoError(t, g.Send(t.Context(), msg))
	require.NoError(t, g.Send(t.Context(), msg))
	assert.Equal(t, int32(1), tokens.Load(), "the token is cached")

	m := sent["message"].(map[string]any)
	assert.Equal(t, "Deliveries are failing", m["subject"])
	assert.Equal(t, "HTML", m["body"].(map[string]any)["contentType"])
	assert.Contains(t, m["body"].(map[string]any)["content"], "Acme")
	from := m["from"].(map[string]any)["emailAddress"].(map[string]any)
	assert.Equal(t, map[string]any{"name": "Hookline", "address": "contact@example.com"}, from)
	to := m["toRecipients"].([]any)[0].(map[string]any)["emailAddress"].(map[string]any)
	assert.Equal(t, "owner@example.com", to["address"])
	assert.Equal(t, false, sent["saveToSentItems"])
}

func TestGraphReportsErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/token") {
			_, _ = w.Write([]byte(`{"access_token":"tok","expires_in":3600}`))
			return
		}
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":{"code":"ErrorAccessDenied","message":"Access is denied."}}`))
	}))
	t.Cleanup(srv.Close)
	g, err := mail.NewGraph("tenant", "id", "secret", "contact@example.com")
	require.NoError(t, err)
	g.TokenURL, g.APIBase = srv.URL+"/token", srv.URL
	err = g.Send(t.Context(), mail.Message{To: []string{"a@b.c"}, Subject: "s", Template: "delivery_failing", Data: failing{}})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "ErrorAccessDenied: Access is denied.")

	_, err = mail.NewGraph("", "id", "secret", "contact@example.com")
	require.Error(t, err)
}
