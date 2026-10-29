// Package apikey authenticates bearer API keys ("hk_live_" + base62) against
// their stored SHA-256 hashes. Keys are issued by the web app; the edge only
// reads them.
package apikey

import (
	"context"
	"crypto/sha256"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kaanxsrd/hookline/packages/gocommon/dbq"
)

// Prefix starts every Hookline API key.
const Prefix = "hk_live_"

// Scopes an API key can carry.
const (
	ScopeTunnel = "tunnel"
)

var (
	// ErrMissing means the request carried no bearer token.
	ErrMissing = errors.New("missing API key")
	// ErrInvalid means the token is malformed, unknown, revoked or expired.
	ErrInvalid = errors.New("invalid API key")
)

// Key is an authenticated API key.
type Key struct {
	ID     uuid.UUID
	OrgID  uuid.UUID
	Name   string
	Prefix string
	Scopes []string
}

// Has reports whether the key carries scope.
func (k Key) Has(scope string) bool { return slices.Contains(k.Scopes, scope) }

// Authenticator looks keys up by hash.
type Authenticator struct {
	Queries *dbq.Queries
	Logger  *slog.Logger
}

// FromRequest authenticates the Authorization: Bearer header.
func (a *Authenticator) FromRequest(r *http.Request) (Key, error) {
	auth := r.Header.Get("Authorization")
	token, ok := strings.CutPrefix(auth, "Bearer ")
	if !ok || token == "" {
		return Key{}, ErrMissing
	}
	return a.Authenticate(r.Context(), strings.TrimSpace(token))
}

// Authenticate checks a presented key.
func (a *Authenticator) Authenticate(ctx context.Context, token string) (Key, error) {
	// Cheap shape checks before touching the database.
	if !strings.HasPrefix(token, Prefix) || len(token) < len(Prefix)+32 || len(token) > len(Prefix)+64 {
		return Key{}, ErrInvalid
	}
	sum := sha256.Sum256([]byte(token))
	row, err := a.Queries.GetAPIKeyByHash(ctx, sum[:])
	if errors.Is(err, pgx.ErrNoRows) {
		return Key{}, ErrInvalid
	}
	if err != nil {
		return Key{}, err
	}
	go func() {
		// Best effort: last_used_at is informational.
		tctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
		defer cancel()
		if err := a.Queries.TouchAPIKey(tctx, row.ID); err != nil {
			a.Logger.DebugContext(tctx, "touch api key", "error", err)
		}
	}()
	return Key{ID: row.ID, OrgID: row.OrgID, Name: row.Name, Prefix: row.Prefix, Scopes: row.Scopes}, nil
}
