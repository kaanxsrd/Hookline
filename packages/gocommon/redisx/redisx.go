// Package redisx opens Redis clients tuned for Hookline's failure model:
// Redis is an accelerator (cache, rate limits, live fan-out), never the
// system of record, so calls must fail fast and callers must degrade.
package redisx

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

var silenceOnce sync.Once

// discardLogger replaces go-redis's internal logger, which writes every
// failed dial to stderr. Callers log Redis failures themselves, throttled.
type discardLogger struct{}

func (discardLogger) Printf(context.Context, string, ...any) {}

// Open returns a client for url (redis:// or rediss://). It does not contact
// the server: services start and keep accepting webhooks while Redis is down.
func Open(url, clientName string) (*redis.Client, error) {
	opts, err := redis.ParseURL(url)
	if err != nil {
		// The parse error may echo the URL and its password.
		return nil, errors.New("parse REDIS_URL: invalid URL")
	}
	silenceOnce.Do(func() { redis.SetLogger(discardLogger{}) })
	opts.ClientName = clientName
	opts.DialTimeout = 2 * time.Second
	opts.ReadTimeout = 500 * time.Millisecond
	opts.WriteTimeout = 500 * time.Millisecond
	opts.PoolTimeout = time.Second
	opts.MaxRetries = 1
	return redis.NewClient(opts), nil
}
