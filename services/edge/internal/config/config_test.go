package config_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	gcfg "github.com/kaanxsrd/hookline/packages/gocommon/config"
	"github.com/kaanxsrd/hookline/services/edge/internal/config"
)

func TestLoadDefaults(t *testing.T) {
	c, err := config.Load(gcfg.New(gcfg.MapLookup(nil)))
	require.NoError(t, err)
	assert.Equal(t, config.Config{
		Addr:            ":8080",
		LogLevel:        "info",
		LogFormat:       "json",
		ShutdownTimeout: 25 * time.Second,
	}, c)
}

func TestLoadReportsAllErrors(t *testing.T) {
	_, err := config.Load(gcfg.New(gcfg.MapLookup(map[string]string{
		"EDGE_ADDR":             "nope",
		"LOG_LEVEL":             "loud",
		"EDGE_SHUTDOWN_TIMEOUT": "soon",
	})))
	require.Error(t, err)
	for _, key := range []string{"EDGE_ADDR", "LOG_LEVEL", "EDGE_SHUTDOWN_TIMEOUT"} {
		assert.Contains(t, err.Error(), key)
	}
}
