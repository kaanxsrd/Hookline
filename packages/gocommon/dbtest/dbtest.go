// Package dbtest gives tests a real, fully migrated PostgreSQL database.
//
// The first call in a test binary starts PostgreSQL 17 with testcontainers
// (or uses the server in TEST_DATABASE_URL when set) and applies every
// migration from packages/db/migrations to a template database. Each test
// then gets its own database cloned from that template, dropped on cleanup,
// so tests are isolated and can run in parallel.
package dbtest

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/kaanxsrd/hookline/packages/gocommon/db"
)

const image = "postgres:17.11-alpine"

// Shared by every test in the binary. A test helper is the one place where
// package-level state is the right tool: starting PostgreSQL per test would
// make the suite unbearably slow.
var (
	setupOnce sync.Once
	adminURL  string
	template  string
	errSetup  error
	container *postgres.PostgresContainer
)

// Run is meant for TestMain in every package that uses dbtest:
//
//	func TestMain(m *testing.M) { os.Exit(dbtest.Run(m)) }
//
// It runs the tests and then removes the PostgreSQL container.
//
// On Windows it prepares testcontainers for Docker Desktop: the reaper
// (Ryuk) is disabled because its readiness check does not work over the named
// pipe, and DOCKER_HOST is pinned to the active Docker context, because
// testcontainers' host auto-detection intermittently fails when several test
// binaries probe the pipe at once and then caches the failure. Elsewhere the
// defaults stay, including the reaper as a safety net for crashed binaries.
func Run(m *testing.M) int {
	if runtime.GOOS == "windows" {
		if os.Getenv("TESTCONTAINERS_RYUK_DISABLED") == "" {
			_ = os.Setenv("TESTCONTAINERS_RYUK_DISABLED", "true")
		}
		if os.Getenv("DOCKER_HOST") == "" {
			if host := dockerContextHost(); host != "" {
				_ = os.Setenv("DOCKER_HOST", host)
			}
		}
	}
	code := m.Run()
	if container != nil {
		if err := testcontainers.TerminateContainer(container); err != nil {
			fmt.Fprintf(os.Stderr, "dbtest: terminate container: %v\n", err)
		}
	}
	return code
}

// dockerContextHost returns the endpoint of the active Docker CLI context, or "".
func dockerContextHost() string {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// New returns a pool connected to a fresh, migrated database.
func New(t testing.TB) *pgxpool.Pool {
	t.Helper()
	pool, err := db.Open(t.Context(), NewURL(t), db.Options{MaxConns: 8, ApplicationName: "dbtest"})
	if err != nil {
		t.Fatalf("dbtest: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// NewURL creates a fresh, migrated database and returns its connection URL.
func NewURL(t testing.TB) string {
	t.Helper()
	setupOnce.Do(func() { adminURL, template, errSetup = setup() })
	if errSetup != nil {
		t.Fatalf("dbtest: %v (is Docker running? Set TEST_DATABASE_URL to use an existing server)", errSetup)
	}

	name := "test_" + randomHex(8)
	if err := adminExec(context.Background(), adminURL,
		fmt.Sprintf("CREATE DATABASE %s TEMPLATE %s", name, template)); err != nil {
		t.Fatalf("dbtest: create database: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := adminExec(ctx, adminURL, fmt.Sprintf("DROP DATABASE IF EXISTS %s WITH (FORCE)", name)); err != nil {
			t.Logf("dbtest: drop database %s: %v", name, err)
		}
	})
	return withDatabase(adminURL, name)
}

// setup finds a server and makes sure a template database with the current
// migrations exists on it. Templates are named after a hash of the migration
// files, so unchanged migrations are reused across runs on a shared server.
func setup() (admin, tpl string, err error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	admin = os.Getenv("TEST_DATABASE_URL")
	if admin == "" {
		ctr, err := startContainer(ctx)
		if err != nil {
			return "", "", err
		}
		container = ctr
		if admin, err = ctr.ConnectionString(ctx, "sslmode=disable"); err != nil {
			return "", "", fmt.Errorf("container connection string: %w", err)
		}
	}

	entries, hash, err := readMigrations()
	if err != nil {
		return "", "", err
	}
	tpl = "hookline_tpl_" + hash[:12]

	conn, err := pgx.Connect(ctx, admin)
	if err != nil {
		return "", "", fmt.Errorf("connect: %w", err)
	}
	defer conn.Close(ctx)
	// Serializes template creation across concurrently running test binaries.
	if _, err := conn.Exec(ctx, "SELECT pg_advisory_lock(hashtext('hookline_dbtest'))"); err != nil {
		return "", "", err
	}
	var exists bool
	if err := conn.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)", tpl).Scan(&exists); err != nil {
		return "", "", err
	}
	if !exists {
		if err := buildTemplate(ctx, conn, admin, tpl, entries); err != nil {
			return "", "", err
		}
	}
	return admin, tpl, nil
}

func startContainer(ctx context.Context) (*postgres.PostgresContainer, error) {
	ctr, err := postgres.Run(ctx, image,
		postgres.WithDatabase("postgres"),
		postgres.WithUsername("hookline"),
		postgres.WithPassword("hookline"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).WithStartupTimeout(2*time.Minute)),
	)
	if err != nil {
		return nil, fmt.Errorf("start postgres container: %w", err)
	}
	return ctr, nil
}

func buildTemplate(ctx context.Context, conn *pgx.Conn, admin, tpl string, entries []migration) error {
	if _, err := conn.Exec(ctx, "CREATE DATABASE "+tpl); err != nil {
		return fmt.Errorf("create template database: %w", err)
	}
	if err := migrate(ctx, withDatabase(admin, tpl), entries); err != nil {
		_, _ = conn.Exec(ctx, "DROP DATABASE IF EXISTS "+tpl+" WITH (FORCE)")
		return err
	}
	_, err := conn.Exec(ctx, "ALTER DATABASE "+tpl+" WITH IS_TEMPLATE true")
	return err
}

// MigrationsDir is packages/db/migrations, located relative to this source file.
func MigrationsDir() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(file), "..", "..", "db", "migrations")
}

type migration struct {
	Idx int    `json:"idx"`
	Tag string `json:"tag"`
	sql string
}

// readMigrations returns the migrations in journal order and a hash of their contents.
func readMigrations() ([]migration, string, error) {
	dir := MigrationsDir()
	raw, err := os.ReadFile(filepath.Join(dir, "meta", "_journal.json")) //nolint:gosec // the repository's own migration journal
	if err != nil {
		return nil, "", fmt.Errorf("read migration journal: %w", err)
	}
	var j struct {
		Entries []migration `json:"entries"`
	}
	if err := json.Unmarshal(raw, &j); err != nil {
		return nil, "", fmt.Errorf("parse migration journal: %w", err)
	}
	slices.SortFunc(j.Entries, func(a, b migration) int { return a.Idx - b.Idx })

	h := sha256.New()
	for i := range j.Entries {
		b, err := os.ReadFile(filepath.Join(dir, j.Entries[i].Tag+".sql")) //nolint:gosec // file names come from the journal above
		if err != nil {
			return nil, "", fmt.Errorf("read migration %s: %w", j.Entries[i].Tag, err)
		}
		j.Entries[i].sql = string(b)
		h.Write(b)
	}
	return j.Entries, hex.EncodeToString(h.Sum(nil)), nil
}

// migrate applies the migrations in one transaction, like Drizzle's migrator.
func migrate(ctx context.Context, databaseURL string, entries []migration) error {
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return fmt.Errorf("connect for migrations: %w", err)
	}
	defer conn.Close(ctx)

	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	for _, m := range entries {
		// No arguments: pgx uses the simple protocol, which accepts many statements.
		if _, err := tx.Exec(ctx, m.sql); err != nil {
			return fmt.Errorf("apply migration %s: %w", m.Tag, err)
		}
	}
	return tx.Commit(ctx)
}

func adminExec(ctx context.Context, databaseURL, statement string) error {
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer conn.Close(ctx)
	_, err = conn.Exec(ctx, statement)
	return err
}

func withDatabase(databaseURL, name string) string {
	u, err := url.Parse(databaseURL)
	if err != nil {
		return databaseURL
	}
	u.Path = "/" + name
	return u.String()
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
