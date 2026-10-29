package config_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	gcfg "github.com/kaanxsrd/hookline/packages/gocommon/config"
	"github.com/kaanxsrd/hookline/services/worker/internal/config"
)

func TestLoadDefaults(t *testing.T) {
	c, err := config.Load(gcfg.New(gcfg.MapLookup(nil)))
	require.NoError(t, err)
	assert.Equal(t, config.Config{
		HealthAddr:      ":8081",
		LogLevel:        "info",
		LogFormat:       "json",
		ShutdownTimeout: 30 * time.Second,
	}, c)
}

func TestLoadReportsErrors(t *testing.T) {
	_, err := config.Load(gcfg.New(gcfg.MapLookup(map[string]string{
		"WORKER_HEALTH_ADDR": "8081",
		"LOG_FORMAT":         "xml",
	})))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "WORKER_HEALTH_ADDR")
	assert.Contains(t, err.Error(), "LOG_FORMAT")
}
