package ui_test

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaanxsrd/hookline/cli/internal/ui"
	"github.com/kaanxsrd/hookline/packages/protocol"
)

func req(headers []protocol.Header, body string) protocol.Request {
	return protocol.Request{
		ID: "r1", Method: "POST", Path: "/stripe", Headers: headers, BodySize: len(body),
		BodyB64: base64.StdEncoding.EncodeToString([]byte(body)), ReceivedAt: time.Date(2026, 1, 1, 12, 4, 31, 0, time.Local),
	}
}

func TestHint(t *testing.T) {
	jsonCT := []protocol.Header{{"Content-Type", "application/json"}}
	assert.Equal(t, "push", ui.Hint(req([]protocol.Header{{"X-GitHub-Event", "push"}}, "{}")))
	assert.Equal(t, "payment_intent.succeeded", ui.Hint(req(jsonCT, `{"id":"evt_1","type":"payment_intent.succeeded"}`)))
	assert.Equal(t, "evt_1Px", ui.Hint(req(jsonCT, `{"id":"evt_1Px"}`)))
	assert.Empty(t, ui.Hint(req(jsonCT, `[1,2]`)))
	assert.Empty(t, ui.Hint(req([]protocol.Header{{"Content-Type", "text/plain"}}, `{"type":"x"}`)))
}

func TestForwardedLine(t *testing.T) {
	var out bytes.Buffer
	p := ui.New(&out, &bytes.Buffer{}, true, false)
	r := req([]protocol.Header{{"Content-Type", "application/json"}}, `{"id":"evt_1Px"}`)
	p.Forwarded("abc", r, &protocol.Response{Status: 200}, nil, 38*time.Millisecond)
	assert.Equal(t, "12:04:31  POST   /h/abc/stripe  → 200  38 ms  evt_1Px\n", out.String())

	out.Reset()
	p.Forwarded("abc", r, nil, &protocol.Error{Code: "target_unreachable", Message: "connection refused"}, 0)
	assert.Contains(t, out.String(), "✗ connection refused")
}

func TestJSONLines(t *testing.T) {
	var out bytes.Buffer
	p := ui.New(&out, &bytes.Buffer{}, true, true)
	p.Observed("abc", req(nil, `{"a":1}`))
	var v map[string]any
	require.NoError(t, json.Unmarshal(out.Bytes(), &v))
	assert.Equal(t, "abc", v["endpoint"])
	assert.Equal(t, `{"a":1}`, v["body"])

	out.Reset()
	bin := req(nil, "")
	bin.BodyB64 = base64.StdEncoding.EncodeToString([]byte{0xff, 0xfe})
	p.Observed("abc", bin)
	require.NoError(t, json.Unmarshal(out.Bytes(), &v))
	assert.Equal(t, "//4=", v["body_b64"])
}
