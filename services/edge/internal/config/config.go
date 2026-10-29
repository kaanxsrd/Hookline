// Package config loads and validates the edge server configuration.
package config

import (
	"net/netip"
	"net/url"
	"time"

	"github.com/kaanxsrd/hookline/packages/gocommon/blob"
	"github.com/kaanxsrd/hookline/packages/gocommon/clientip"
	"github.com/kaanxsrd/hookline/packages/gocommon/config"
	"github.com/kaanxsrd/hookline/packages/gocommon/entitlements"
	"github.com/kaanxsrd/hookline/packages/gocommon/logging"
)

// Config is the edge server configuration.
type Config struct {
	Addr            string        // EDGE_ADDR: public listener (intake, SSE, tunnel, health)
	MetricsAddr     string        // EDGE_METRICS_ADDR: internal Prometheus listener
	LogLevel        string        // LOG_LEVEL
	LogFormat       string        // LOG_FORMAT
	ShutdownTimeout time.Duration // EDGE_SHUTDOWN_TIMEOUT: drain window for in-flight requests

	DatabaseURL string // DATABASE_URL
	DBMaxConns  int    // EDGE_DB_MAX_CONNS
	RedisURL    string // REDIS_URL

	// S3 is used for bodies over 64 KiB; with S3_BUCKET unset such bodies are rejected.
	S3 blob.S3Config // S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_FORCE_PATH_STYLE

	StreamTokenSecret string // STREAM_TOKEN_SECRET: verifies SSE stream tokens minted by the web app
	AppOrigin         string // origin of APP_URL, allowed to open SSE streams cross-origin

	TrustedProxies []netip.Prefix    // TRUSTED_PROXIES: proxies whose X-Forwarded-For is believed
	PlanOverride   entitlements.Plan // PLAN_OVERRIDE: "unlimited" on self-hosted instances
}

// S3Enabled reports whether object storage is configured.
func (c Config) S3Enabled() bool { return c.S3.Bucket != "" }

// Load reads the configuration through l and returns every validation error at once.
func Load(l *config.Loader) (Config, error) {
	c := Config{
		Addr:            l.Addr("EDGE_ADDR", ":8080"),
		MetricsAddr:     l.Addr("EDGE_METRICS_ADDR", ":9090"),
		LogLevel:        l.OneOf("LOG_LEVEL", "info", logging.Levels...),
		LogFormat:       l.OneOf("LOG_FORMAT", "json", logging.Formats...),
		ShutdownTimeout: l.Duration("EDGE_SHUTDOWN_TIMEOUT", 25*time.Second),
		DatabaseURL:     l.RequiredString("DATABASE_URL"),
		DBMaxConns:      l.Int("EDGE_DB_MAX_CONNS", 20, 1, 500),
		RedisURL:        l.RequiredString("REDIS_URL"),
		S3: blob.S3Config{
			Endpoint:        l.String("S3_ENDPOINT", ""),
			Region:          l.String("S3_REGION", "us-east-1"),
			Bucket:          l.String("S3_BUCKET", ""),
			AccessKeyID:     l.String("S3_ACCESS_KEY_ID", ""),
			SecretAccessKey: l.String("S3_SECRET_ACCESS_KEY", ""),
			ForcePathStyle:  l.Bool("S3_FORCE_PATH_STYLE", false),
		},
		PlanOverride: entitlements.Plan(l.OneOf("PLAN_OVERRIDE", "", "", string(entitlements.PlanUnlimited))),
	}
	c.StreamTokenSecret = l.RequiredString("STREAM_TOKEN_SECRET")
	if c.StreamTokenSecret != "" && len(c.StreamTokenSecret) < 32 {
		l.Fail("STREAM_TOKEN_SECRET", "must be at least 32 characters")
	}
	appURL := l.String("APP_URL", "http://localhost:3000")
	if u, err := url.Parse(appURL); err != nil || u.Scheme == "" || u.Host == "" {
		l.Fail("APP_URL", "must be an absolute URL, got %q", appURL)
	} else {
		c.AppOrigin = u.Scheme + "://" + u.Host
	}

	trusted, err := clientip.ParseTrusted(l.String("TRUSTED_PROXIES", clientip.DefaultTrusted))
	if err != nil {
		l.Fail("TRUSTED_PROXIES", "%v", err)
	}
	c.TrustedProxies = trusted
	return c, l.Err()
}
