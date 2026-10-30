package mail_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaanxsrd/hookline/packages/gocommon/mail"
)

func TestResendSend(t *testing.T) {
	var sent map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "Bearer re_test", r.Header.Get("Authorization"))
		assert.NoError(t, json.NewDecoder(r.Body).Decode(&sent))
		_, _ = w.Write([]byte(`{"id":"49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"}`))
	}))
	t.Cleanup(srv.Close)

	r, err := mail.NewResend("re_test", "Hookline <contact@example.com>")
	require.NoError(t, err)
	r.APIURL = srv.URL
	err = r.Send(t.Context(), mail.Message{
		To: []string{"owner@example.com"}, Subject: "Deliveries are failing", Template: "delivery_failing",
		Data: failing{OrgName: "Acme", DestinationName: "API", DestinationURL: "https://api.example.com", EndpointName: "Stripe", LastResult: "timeout", URL: "https://hookline.test/acme/deliveries"},
	})
	require.NoError(t, err)
	assert.Equal(t, "Hookline <contact@example.com>", sent["from"])
	assert.Equal(t, []any{"owner@example.com"}, sent["to"])
	assert.Equal(t, "Deliveries are failing", sent["subject"])
	assert.Contains(t, sent["html"], "Acme")
	assert.Contains(t, sent["text"], "Acme")
}

func TestResendReportsErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"statusCode":403,"name":"validation_error","message":"The vante.app domain is not verified."}`))
	}))
	t.Cleanup(srv.Close)
	r, err := mail.NewResend("re_test", "contact@example.com")
	require.NoError(t, err)
	r.APIURL = srv.URL
	err = r.Send(t.Context(), mail.Message{To: []string{"a@b.c"}, Subject: "s", Template: "delivery_failing", Data: failing{}})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "validation_error: The vante.app domain is not verified.")

	_, err = mail.NewResend("not-a-key", "contact@example.com")
	require.Error(t, err)
}
