package protocol_test

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaanxsrd/hookline/packages/protocol"
)

func TestPeek(t *testing.T) {
	typ, id, err := protocol.Peek([]byte(`{"type":"response","id":"r1","status":200}`))
	require.NoError(t, err)
	assert.Equal(t, protocol.TypeResponse, typ)
	assert.Equal(t, "r1", id)

	_, _, err = protocol.Peek([]byte(`{"id":"x"}`))
	require.Error(t, err)
	_, _, err = protocol.Peek([]byte(`not json`))
	require.Error(t, err)
	_, _, err = protocol.Peek([]byte(`{"type":"ping","pad":"` + strings.Repeat("x", protocol.MaxMessageBytes) + `"}`))
	require.ErrorIs(t, err, protocol.ErrTooLarge)
}

func TestUnknownFieldsAreIgnored(t *testing.T) {
	var h protocol.Hello
	require.NoError(t, protocol.Decode([]byte(`{"type":"hello","protocol":1,"cli_version":"1.2.3","endpoints":["abc"],"sync":true,"future":{"x":1}}`), &h))
	assert.Equal(t, []string{"abc"}, h.Endpoints)
	assert.True(t, h.Sync)
	require.NoError(t, h.Validate())
}

func TestHelloValidation(t *testing.T) {
	require.Error(t, protocol.Hello{Protocol: 0, Endpoints: []string{"a"}}.Validate())
	require.Error(t, protocol.Hello{Protocol: 1}.Validate())
	require.Error(t, protocol.Hello{Protocol: 1, Endpoints: make([]string, protocol.MaxEndpoints+1)}.Validate())
}

func TestResponseValidation(t *testing.T) {
	require.NoError(t, protocol.Response{ID: "a", Status: 204}.Validate())
	require.Error(t, protocol.Response{Status: 200}.Validate())
	require.Error(t, protocol.Response{ID: "a", Status: 99}.Validate())
	require.Error(t, protocol.Response{ID: "a", Status: 600}.Validate())
}

// The wire format is part of the protocol: field names must not drift.
func TestRequestWireFormat(t *testing.T) {
	at := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	b, err := json.Marshal(protocol.Request{
		Type: protocol.TypeRequest, ID: "r", EndpointID: "e", Method: "POST", Path: "/x", Query: "a=1",
		Headers: []protocol.Header{{"Content-Type", "application/json"}}, BodyB64: "e30=", BodySize: 2,
		ReceivedAt: at, SyncDeadlineMS: 5000,
	})
	require.NoError(t, err)
	assert.JSONEq(t, `{"type":"request","id":"r","endpoint_id":"e","method":"POST","path":"/x","query":"a=1",
		"headers":[["Content-Type","application/json"]],"body_b64":"e30=","body_size":2,
		"received_at":"2026-01-02T03:04:05Z","sync_deadline_ms":5000}`, string(b))
}

func TestRetryable(t *testing.T) {
	for code, want := range map[int]bool{
		protocol.CloseNormal: true, protocol.CloseGoingAway: true, protocol.ClosePingTimeout: true,
		protocol.CloseTooManyTunnels: true, protocol.CloseUnauthorized: false, protocol.CloseUnknownEndpoint: false,
		protocol.CloseUnsupportedProtocol: false, protocol.CloseInvalidMessage: false,
	} {
		assert.Equal(t, want, protocol.Retryable(code), code)
	}
}
