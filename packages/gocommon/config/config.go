// Package config reads typed settings from the environment and collects every
// validation problem so a misconfigured service reports them all at boot.
package config

import (
	"errors"
	"fmt"
	"net"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"
)

// LookupFunc matches os.LookupEnv. Tests pass a map-backed function instead.
type LookupFunc func(key string) (string, bool)

// Loader reads values through a LookupFunc and accumulates errors.
// Call Err once all values have been read.
type Loader struct {
	lookup LookupFunc
	errs   []error
}

// New returns a Loader backed by lookup.
func New(lookup LookupFunc) *Loader {
	return &Loader{lookup: lookup}
}

// FromEnv returns a Loader backed by the process environment.
func FromEnv() *Loader {
	return New(os.LookupEnv)
}

// MapLookup adapts a map to a LookupFunc.
func MapLookup(m map[string]string) LookupFunc {
	return func(key string) (string, bool) {
		v, ok := m[key]
		return v, ok
	}
}

// Err returns every error recorded so far, joined, or nil.
func (l *Loader) Err() error {
	return errors.Join(l.errs...)
}

// Fail records a validation error for key, for checks the typed readers do not cover.
func (l *Loader) Fail(key, format string, args ...any) {
	l.errs = append(l.errs, fmt.Errorf("%s: %s", key, fmt.Sprintf(format, args...)))
}

// raw returns the trimmed value and whether it was set to something non-empty.
func (l *Loader) raw(key string) (string, bool) {
	v, ok := l.lookup(key)
	if !ok {
		return "", false
	}
	v = strings.TrimSpace(v)
	return v, v != ""
}

// String returns the value of key, or def when unset or empty.
func (l *Loader) String(key, def string) string {
	if v, ok := l.raw(key); ok {
		return v
	}
	return def
}

// RequiredString returns the value of key and records an error when it is missing.
func (l *Loader) RequiredString(key string) string {
	v, ok := l.raw(key)
	if !ok {
		l.Fail(key, "is required")
	}
	return v
}

// Int returns key parsed as a base-10 integer within [lo, hi].
func (l *Loader) Int(key string, def, lo, hi int) int {
	v, ok := l.raw(key)
	if !ok {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		l.Fail(key, "must be an integer, got %q", v)
		return def
	}
	if n < lo || n > hi {
		l.Fail(key, "must be between %d and %d, got %d", lo, hi, n)
		return def
	}
	return n
}

// Bool returns key parsed with strconv.ParseBool.
func (l *Loader) Bool(key string, def bool) bool {
	v, ok := l.raw(key)
	if !ok {
		return def
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		l.Fail(key, "must be a boolean, got %q", v)
		return def
	}
	return b
}

// Duration returns key parsed with time.ParseDuration; it must be positive.
func (l *Loader) Duration(key string, def time.Duration) time.Duration {
	v, ok := l.raw(key)
	if !ok {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		l.Fail(key, "must be a duration such as 10s, got %q", v)
		return def
	}
	if d <= 0 {
		l.Fail(key, "must be positive, got %s", d)
		return def
	}
	return d
}

// Addr returns a listen address of the form host:port (host may be empty).
func (l *Loader) Addr(key, def string) string {
	v := l.String(key, def)
	_, port, err := net.SplitHostPort(v)
	if err != nil {
		l.Fail(key, "must be host:port, got %q", v)
		return def
	}
	if p, err := strconv.Atoi(port); err != nil || p < 0 || p > 65535 {
		l.Fail(key, "has an invalid port %q", port)
		return def
	}
	return v
}

// OneOf returns key when it matches one of allowed (case-insensitive).
func (l *Loader) OneOf(key, def string, allowed ...string) string {
	v := strings.ToLower(l.String(key, def))
	if !slices.Contains(allowed, v) {
		l.Fail(key, "must be one of %s, got %q", strings.Join(allowed, ", "), v)
		return def
	}
	return v
}
