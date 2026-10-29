package logging_test

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaanxsrd/hookline/packages/gocommon/logging"
)

func TestNewJSONIncludesService(t *testing.T) {
	var buf bytes.Buffer
	logger, err := logging.New(&buf, logging.Options{Service: "edge", Level: "info", Format: "json"})
	require.NoError(t, err)

	logger.Info("hello", "k", 1)

	var rec map[string]any
	require.NoError(t, json.Unmarshal(buf.Bytes(), &rec))
	assert.Equal(t, "edge", rec["service"])
	assert.Equal(t, "hello", rec["msg"])
	assert.InDelta(t, 1, rec["k"], 0)
}

func TestNewRespectsLevel(t *testing.T) {
	var buf bytes.Buffer
	logger, err := logging.New(&buf, logging.Options{Level: "warn", Format: "text"})
	require.NoError(t, err)

	logger.Info("dropped")
	assert.Empty(t, buf.String())
	logger.Warn("kept")
	assert.Contains(t, buf.String(), "kept")
}

func TestNewRejectsUnknownValues(t *testing.T) {
	_, err := logging.New(&bytes.Buffer{}, logging.Options{Level: "loud"})
	require.Error(t, err)
	_, err = logging.New(&bytes.Buffer{}, logging.Options{Format: "xml"})
	require.Error(t, err)
}

func TestParseLevel(t *testing.T) {
	for name, want := range map[string]slog.Level{
		"":      slog.LevelInfo,
		"DEBUG": slog.LevelDebug,
		"info":  slog.LevelInfo,
		"warn":  slog.LevelWarn,
		"error": slog.LevelError,
	} {
		got, err := logging.ParseLevel(name)
		require.NoError(t, err, name)
		assert.Equal(t, want, got, name)
	}
}
