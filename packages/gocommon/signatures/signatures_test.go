package signatures_test

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaanxsrd/hookline/packages/gocommon/signatures"
)

type vector struct {
	Name     string      `json:"name"`
	Provider string      `json:"provider"`
	Secret   string      `json:"secret"`
	Headers  [][2]string `json:"headers"`
	Body     string      `json:"body"`
	Now      int64       `json:"now"`
	Expect   string      `json:"expect"`
	Reason   string      `json:"reason"`
}

func TestSharedVectors(t *testing.T) {
	raw, err := os.ReadFile("../../shared/fixtures/signature-vectors.json")
	require.NoError(t, err)
	var file struct {
		Vectors []vector `json:"vectors"`
	}
	require.NoError(t, json.Unmarshal(raw, &file))
	require.NotEmpty(t, file.Vectors)

	seen := map[string]bool{}
	for _, v := range file.Vectors {
		t.Run(v.Name, func(t *testing.T) {
			r := signatures.Verify(signatures.Provider(v.Provider), v.Secret, signatures.Input{
				Headers: v.Headers, Body: []byte(v.Body), Now: time.Unix(v.Now, 0),
			})
			if v.Expect == "verified" {
				assert.True(t, r.Verified, r.Message)
				return
			}
			assert.False(t, r.Verified)
			assert.Equal(t, signatures.Reason(v.Reason), r.Reason, r.Message)
			assert.NotEmpty(t, r.Message)
		})
		if v.Expect == "verified" {
			seen[v.Provider] = true
		}
	}
	for _, p := range []string{"stripe", "github", "shopify", "slack", "standard_webhooks", "discord", "hmac_sha256"} {
		assert.True(t, seen[p], "a passing vector for %s", p)
	}
}

func TestUnknownProvider(t *testing.T) {
	r := signatures.Verify("acme", "s", signatures.Input{})
	assert.False(t, r.Verified)
	assert.Equal(t, signatures.ReasonProvider, r.Reason)
}
