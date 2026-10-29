package config_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaanxsrd/hookline/packages/gocommon/config"
)

func TestDefaultsWhenUnset(t *testing.T) {
	l := config.New(config.MapLookup(map[string]string{"EMPTY": "  "}))

	assert.Equal(t, "fallback", l.String("MISSING", "fallback"))
	assert.Equal(t, "fallback", l.String("EMPTY", "fallback"))
	assert.Equal(t, 7, l.Int("MISSING", 7, 0, 10))
	assert.True(t, l.Bool("MISSING", true))
	assert.Equal(t, 3*time.Second, l.Duration("MISSING", 3*time.Second))
	assert.Equal(t, ":8080", l.Addr("MISSING", ":8080"))
	assert.Equal(t, "info", l.OneOf("MISSING", "info", "debug", "info"))
	require.NoError(t, l.Err())
}

func TestParsesValidValues(t *testing.T) {
	l := config.New(config.MapLookup(map[string]string{
		"S":    " value ",
		"I":    "42",
		"B":    "false",
		"D":    "1m30s",
		"ADDR": "127.0.0.1:9000",
		"ONE":  "DEBUG",
	}))

	assert.Equal(t, "value", l.String("S", ""))
	assert.Equal(t, 42, l.Int("I", 0, 0, 100))
	assert.False(t, l.Bool("B", true))
	assert.Equal(t, 90*time.Second, l.Duration("D", time.Second))
	assert.Equal(t, "127.0.0.1:9000", l.Addr("ADDR", ":1"))
	assert.Equal(t, "debug", l.OneOf("ONE", "info", "debug", "info"))
	assert.Equal(t, "value", l.RequiredString("S"))
	require.NoError(t, l.Err())
}

func TestCollectsEveryError(t *testing.T) {
	tests := []struct {
		name string
		env  map[string]string
		read func(*config.Loader)
		want string
	}{
		{"required missing", nil, func(l *config.Loader) { l.RequiredString("K") }, "K: is required"},
		{"int not a number", map[string]string{"K": "x"}, func(l *config.Loader) { l.Int("K", 0, 0, 1) }, "must be an integer"},
		{"int out of range", map[string]string{"K": "5"}, func(l *config.Loader) { l.Int("K", 0, 0, 1) }, "between 0 and 1"},
		{"bool invalid", map[string]string{"K": "maybe"}, func(l *config.Loader) { l.Bool("K", false) }, "must be a boolean"},
		{"duration invalid", map[string]string{"K": "10"}, func(l *config.Loader) { l.Duration("K", time.Second) }, "must be a duration"},
		{"duration negative", map[string]string{"K": "-1s"}, func(l *config.Loader) { l.Duration("K", time.Second) }, "must be positive"},
		{"addr without port", map[string]string{"K": "localhost"}, func(l *config.Loader) { l.Addr("K", ":1") }, "must be host:port"},
		{"addr bad port", map[string]string{"K": ":99999"}, func(l *config.Loader) { l.Addr("K", ":1") }, "invalid port"},
		{"oneof mismatch", map[string]string{"K": "loud"}, func(l *config.Loader) { l.OneOf("K", "a", "a", "b") }, "must be one of a, b"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			l := config.New(config.MapLookup(tt.env))
			tt.read(l)
			require.Error(t, l.Err())
			assert.Contains(t, l.Err().Error(), tt.want)
		})
	}

	t.Run("joins all errors", func(t *testing.T) {
		l := config.New(config.MapLookup(map[string]string{"A": "x", "B": "y"}))
		l.Int("A", 0, 0, 1)
		l.Bool("B", false)
		l.RequiredString("C")
		msg := l.Err().Error()
		assert.Contains(t, msg, "A:")
		assert.Contains(t, msg, "B:")
		assert.Contains(t, msg, "C:")
	})
}
