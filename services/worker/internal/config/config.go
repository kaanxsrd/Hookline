// Package config loads and validates the worker configuration.
package config

import (
	"time"

	"github.com/kaanxsrd/hookline/packages/gocommon/blob"
	"github.com/kaanxsrd/hookline/packages/gocommon/config"
	"github.com/kaanxsrd/hookline/packages/gocommon/entitlements"
	"github.com/kaanxsrd/hookline/packages/gocommon/logging"
	"github.com/kaanxsrd/hookline/packages/gocommon/mail"
	"github.com/kaanxsrd/hookline/packages/gocommon/secretbox"
)

// Config is the worker configuration.
type Config struct {
	HealthAddr      string        // WORKER_HEALTH_ADDR: internal listener for /healthz and /readyz
	LogLevel        string        // LOG_LEVEL
	LogFormat       string        // LOG_FORMAT
	ShutdownTimeout time.Duration // WORKER_SHUTDOWN_TIMEOUT: time allowed for running jobs to finish

	DatabaseURL string // DATABASE_URL
	RedisURL    string // REDIS_URL

	// S3 holds bodies over 64 KiB; with S3_BUCKET unset there are none to forward or sweep.
	S3 blob.S3Config // S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_FORCE_PATH_STYLE

	// DATA_ENCRYPTION_KEY: "kid:base64key[,kid:base64key...]", decrypts destination signing secrets.
	Secrets *secretbox.Box

	DeliveryConcurrency int  // WORKER_DELIVERY_CONCURRENCY: deliveries in flight per process
	AllowPrivate        bool // ALLOW_PRIVATE_DESTINATIONS: permit loopback/private destinations (self-hosted only)

	SMTPURL  string // SMTP_URL: notification emails; empty disables them
	MailFrom string // MAIL_FROM
	// MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET: send through
	// Microsoft Graph (HTTPS) instead of SMTP, for hosts that block SMTP.
	GraphTenant, GraphClientID, GraphSecret string
	AppURL                                  string            // APP_URL: links in emails
	PlanOverride                            entitlements.Plan // PLAN_OVERRIDE: "unlimited" on self-hosted instances
}

// GraphEnabled reports whether email goes through Microsoft Graph.
func (c Config) GraphEnabled() bool {
	return c.GraphTenant != "" && c.GraphClientID != "" && c.GraphSecret != ""
}

// S3Enabled reports whether object storage is configured.
func (c Config) S3Enabled() bool { return c.S3.Bucket != "" }

// Load reads the configuration through l and returns every validation error at once.
func Load(l *config.Loader) (Config, error) {
	c := Config{
		HealthAddr:      l.Addr("WORKER_HEALTH_ADDR", ":8081"),
		LogLevel:        l.OneOf("LOG_LEVEL", "info", logging.Levels...),
		LogFormat:       l.OneOf("LOG_FORMAT", "json", logging.Formats...),
		ShutdownTimeout: l.Duration("WORKER_SHUTDOWN_TIMEOUT", 30*time.Second),
		DatabaseURL:     l.RequiredString("DATABASE_URL"),
		RedisURL:        l.RequiredString("REDIS_URL"),
		S3: blob.S3Config{
			Endpoint:        l.String("S3_ENDPOINT", ""),
			Region:          l.String("S3_REGION", "us-east-1"),
			Bucket:          l.String("S3_BUCKET", ""),
			AccessKeyID:     l.String("S3_ACCESS_KEY_ID", ""),
			SecretAccessKey: l.String("S3_SECRET_ACCESS_KEY", ""),
			ForcePathStyle:  l.Bool("S3_FORCE_PATH_STYLE", false),
		},
		DeliveryConcurrency: l.Int("WORKER_DELIVERY_CONCURRENCY", 50, 1, 1000),
		AllowPrivate:        l.Bool("ALLOW_PRIVATE_DESTINATIONS", false),
		SMTPURL:             l.String("SMTP_URL", ""),
		MailFrom:            l.String("MAIL_FROM", "Hookline <no-reply@hookline.localhost>"),
		AppURL:              l.String("APP_URL", "http://localhost:3000"),
		PlanOverride:        entitlements.Plan(l.OneOf("PLAN_OVERRIDE", "", "", string(entitlements.PlanUnlimited))),
	}
	c.GraphTenant = l.String("MS_GRAPH_TENANT_ID", "")
	c.GraphClientID = l.String("MS_GRAPH_CLIENT_ID", "")
	c.GraphSecret = l.String("MS_GRAPH_CLIENT_SECRET", "")
	// Any of the three set means Graph is intended: all three are then required.
	if c.GraphTenant+c.GraphClientID+c.GraphSecret != "" {
		if _, err := mail.NewGraph(c.GraphTenant, c.GraphClientID, c.GraphSecret, c.MailFrom); err != nil {
			l.Fail("MS_GRAPH_CLIENT_ID", "%v", err)
		}
	} else if c.SMTPURL != "" {
		if _, err := mail.NewSMTP(c.SMTPURL, c.MailFrom); err != nil {
			l.Fail("SMTP_URL", "%v", err)
		}
	}
	if spec := l.RequiredString("DATA_ENCRYPTION_KEY"); spec != "" {
		box, err := secretbox.Parse(spec)
		if err != nil {
			l.Fail("DATA_ENCRYPTION_KEY", "%v", err)
		}
		c.Secrets = box
	}
	return c, l.Err()
}
