package config_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	gcfg "github.com/kaanxsrd/hookline/packages/gocommon/config"
	"github.com/kaanxsrd/hookline/packages/gocommon/entitlements"
	"github.com/kaanxsrd/hookline/services/edge/internal/config"
)

var required = map[string]string{
	"DATABASE_URL":        "postgres://localhost/hookline",
	"REDIS_URL":           "redis://localhost:6379/0",
	"STREAM_TOKEN_SECRET": "0123456789abcdef0123456789abcdef",
	"DATA_ENCRYPTION_KEY": "k1:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
}

func TestLoadDefaults(t *testing.T) {
	c, err := config.Load(gcfg.New(gcfg.MapLookup(required)))
	require.NoError(t, err)
	assert.Equal(t, ":8080", c.Addr)
	assert.Equal(t, ":9090", c.MetricsAddr)
	assert.Equal(t, "info", c.LogLevel)
	assert.Equal(t, "json", c.LogFormat)
	assert.Equal(t, 25*time.Second, c.ShutdownTimeout)
	assert.Equal(t, 20, c.DBMaxConns)
	assert.Equal(t, "us-east-1", c.S3.Region)
	assert.False(t, c.S3Enabled())
	assert.Empty(t, c.PlanOverride)
	assert.NotEmpty(t, c.TrustedProxies)
	assert.Equal(t, "http://localhost:3000", c.AppOrigin)
	assert.Equal(t, "http://localhost:8080", c.PublicURL)
	assert.NotNil(t, c.Secrets)
}

func TestLoadValues(t *testing.T) {
	env := map[string]string{
		"S3_BUCKET":           "payloads",
		"S3_ENDPOINT":         "http://localhost:9000",
		"S3_FORCE_PATH_STYLE": "true",
		"PLAN_OVERRIDE":       "unlimited",
		"TRUSTED_PROXIES":     "10.1.0.0/16",
		"APP_URL":             "https://hookline.example.com/some/path",
	}
	for k, v := range required {
		env[k] = v
	}
	c, err := config.Load(gcfg.New(gcfg.MapLookup(env)))
	require.NoError(t, err)
	assert.True(t, c.S3Enabled())
	assert.True(t, c.S3.ForcePathStyle)
	assert.Equal(t, entitlements.PlanUnlimited, c.PlanOverride)
	require.Len(t, c.TrustedProxies, 1)
	assert.Equal(t, "10.1.0.0/16", c.TrustedProxies[0].String())
	assert.Equal(t, "https://hookline.example.com", c.AppOrigin)
}

func TestLoadReportsAllErrors(t *testing.T) {
	_, err := config.Load(gcfg.New(gcfg.MapLookup(map[string]string{
		"EDGE_ADDR":             "nope",
		"LOG_LEVEL":             "loud",
		"EDGE_SHUTDOWN_TIMEOUT": "soon",
		"PLAN_OVERRIDE":         "platinum",
		"TRUSTED_PROXIES":       "not-an-ip",
		"STREAM_TOKEN_SECRET":   "short",
		"APP_URL":               "not a url",
		"EDGE_PUBLIC_URL":       "ftp://x",
	})))
	require.Error(t, err)
	for _, key := range []string{"EDGE_ADDR", "LOG_LEVEL", "EDGE_SHUTDOWN_TIMEOUT", "DATABASE_URL", "REDIS_URL", "PLAN_OVERRIDE", "TRUSTED_PROXIES", "STREAM_TOKEN_SECRET", "APP_URL", "EDGE_PUBLIC_URL", "DATA_ENCRYPTION_KEY"} {
		assert.Contains(t, err.Error(), key)
	}
}
