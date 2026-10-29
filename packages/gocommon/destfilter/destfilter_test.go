package destfilter_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaanxsrd/hookline/packages/gocommon/destfilter"
)

var stripe = destfilter.Request{
	Method:  "POST",
	Headers: [][2]string{{"Content-Type", "application/json"}, {"Stripe-Signature", "t=1,v1=x"}},
	Body:    []byte(`{"type":"payment_intent.succeeded","livemode":false,"data":{"object":{"amount":4999,"items":[{"id":"a"},{"id":"b"}]}}}`),
}

func TestMatch(t *testing.T) {
	tests := []struct {
		name   string
		filter string
		want   bool
	}{
		{"empty filter", `{}`, true},
		{"null filter", `null`, true},
		{"method match (case-insensitive)", `{"methods":["post"]}`, true},
		{"method mismatch", `{"methods":["GET","PUT"]}`, false},
		{"header match (name case-insensitive)", `{"header_equals":{"content-type":"application/json"}}`, true},
		{"header value is exact", `{"header_equals":{"Content-Type":"Application/JSON"}}`, false},
		{"missing header", `{"header_equals":{"X-GitHub-Event":"push"}}`, false},
		{"json string", `{"json_path_equals":{"type":"payment_intent.succeeded"}}`, true},
		{"json $ prefix", `{"json_path_equals":{"$.type":"payment_intent.succeeded"}}`, true},
		{"json nested number", `{"json_path_equals":{"data.object.amount":4999}}`, true},
		{"json bool", `{"json_path_equals":{"livemode":false}}`, true},
		{"json array index", `{"json_path_equals":{"data.object.items[1].id":"b"}}`, true},
		{"json out of range", `{"json_path_equals":{"data.object.items[5].id":"b"}}`, false},
		{"json missing key", `{"json_path_equals":{"data.missing":"x"}}`, false},
		{"json wrong value", `{"json_path_equals":{"type":"charge.failed"}}`, false},
		{"json type mismatch", `{"json_path_equals":{"data.object.amount":"4999"}}`, false},
		{"all conditions", `{"methods":["POST"],"header_equals":{"content-type":"application/json"},"json_path_equals":{"type":"payment_intent.succeeded"}}`, true},
		{"one condition fails", `{"methods":["POST"],"json_path_equals":{"type":"other"}}`, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f, err := destfilter.Parse([]byte(tt.filter))
			require.NoError(t, err)
			assert.Equal(t, tt.want, f.Match(stripe))
		})
	}
}

func TestJSONConditionsNeedJSON(t *testing.T) {
	f, err := destfilter.Parse([]byte(`{"json_path_equals":{"a":1}}`))
	require.NoError(t, err)
	assert.False(t, f.Match(destfilter.Request{Method: "POST", Body: []byte("a=1")}))
}

func TestParseRejectsGarbage(t *testing.T) {
	_, err := destfilter.Parse([]byte(`{"methods":"POST"}`))
	require.Error(t, err)
}
