package config_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	gcfg "github.com/kaanxsrd/hookline/packages/gocommon/config"
	"github.com/kaanxsrd/hookline/services/worker/internal/config"
)

var required = map[string]string{
	"DATABASE_URL":        "postgres://localhost/hookline",
	"REDIS_URL":           "redis://localhost:6379/0",
	"DATA_ENCRYPTION_KEY": "k1:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
}

func TestLoadDefaults(t *testing.T) {
	c, err := config.Load(gcfg.New(gcfg.MapLookup(required)))
	require.NoError(t, err)
	assert.Equal(t, ":8081", c.HealthAddr)
	assert.Equal(t, "info", c.LogLevel)
	assert.Equal(t, "json", c.LogFormat)
	assert.Equal(t, 30*time.Second, c.ShutdownTimeout)
	assert.Equal(t, 50, c.DeliveryConcurrency)
	assert.False(t, c.AllowPrivate)
	assert.False(t, c.S3Enabled())
	require.NotNil(t, c.Secrets)
	sealed, err := c.Secrets.Seal("s", "ctx")
	require.NoError(t, err)
	assert.Contains(t, sealed, "hlenc:v1:k1:")
}

func TestLoadValues(t *testing.T) {
	env := map[string]string{
		"S3_BUCKET":                   "payloads",
		"ALLOW_PRIVATE_DESTINATIONS":  "true",
		"WORKER_DELIVERY_CONCURRENCY": "8",
	}
	for k, v := range required {
		env[k] = v
	}
	c, err := config.Load(gcfg.New(gcfg.MapLookup(env)))
	require.NoError(t, err)
	assert.True(t, c.S3Enabled())
	assert.True(t, c.AllowPrivate)
	assert.Equal(t, 8, c.DeliveryConcurrency)
}

func TestLoadReportsErrors(t *testing.T) {
	_, err := config.Load(gcfg.New(gcfg.MapLookup(map[string]string{
		"WORKER_HEALTH_ADDR":          "8081",
		"LOG_FORMAT":                  "xml",
		"WORKER_DELIVERY_CONCURRENCY": "0",
		"DATA_ENCRYPTION_KEY":         "not-a-key",
	})))
	require.Error(t, err)
	for _, key := range []string{"WORKER_HEALTH_ADDR", "LOG_FORMAT", "WORKER_DELIVERY_CONCURRENCY", "DATA_ENCRYPTION_KEY", "DATABASE_URL", "REDIS_URL"} {
		assert.Contains(t, err.Error(), key)
	}
}
