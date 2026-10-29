package blob_test

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/kaanxsrd/hookline/packages/gocommon/blob"
	"github.com/kaanxsrd/hookline/packages/gocommon/testdocker"
)

// Same image as docker-compose.yml.
const minioImage = "cgr.dev/chainguard/minio@sha256:0dab2f9fee1c1139ae8753b5e35bb4461af2a276cfe0923a2504c75a6170bc64"

var endpoint string

func TestMain(m *testing.M) {
	testdocker.Prepare()
	ctx := context.Background()
	ctr, err := testcontainers.Run(ctx, minioImage,
		testcontainers.WithCmd("server", "/data"),
		testcontainers.WithEnv(map[string]string{"MINIO_ROOT_USER": "test", "MINIO_ROOT_PASSWORD": "test-secret"}),
		testcontainers.WithExposedPorts("9000/tcp"),
		testcontainers.WithWaitStrategy(wait.ForHTTP("/minio/health/live").WithPort("9000/tcp").WithStartupTimeout(time.Minute)),
	)
	if err != nil {
		fmt.Fprintln(os.Stderr, "start minio:", err)
		os.Exit(1)
	}
	host, err := ctr.PortEndpoint(ctx, "9000/tcp", "http")
	if err != nil {
		fmt.Fprintln(os.Stderr, "minio endpoint:", err)
		os.Exit(1)
	}
	endpoint = host
	code := m.Run()
	_ = testcontainers.TerminateContainer(ctr)
	os.Exit(code)
}

func newStore(t *testing.T) *blob.S3 {
	t.Helper()
	bucket := "test-" + strings.ToLower(strings.ReplaceAll(uuid.NewString()[:13], "-", ""))
	s := blob.NewS3(blob.S3Config{
		Endpoint: endpoint, Region: "us-east-1", Bucket: bucket,
		AccessKeyID: "test", SecretAccessKey: "test-secret", ForcePathStyle: true,
	})
	require.Error(t, s.Ping(t.Context()), "bucket does not exist yet")
	require.NoError(t, s.EnsureBucket(t.Context()))
	require.NoError(t, s.EnsureBucket(t.Context()), "idempotent")
	return s
}

func TestPutGetDelete(t *testing.T) {
	s := newStore(t)
	ctx := t.Context()
	require.NoError(t, s.Ping(ctx))

	body := []byte(strings.Repeat("x", 100<<10))
	require.NoError(t, s.Put(ctx, "a/b/c", body, "application/octet-stream"))

	r, err := s.Get(ctx, "a/b/c")
	require.NoError(t, err)
	got, err := io.ReadAll(r)
	require.NoError(t, err)
	require.NoError(t, r.Close())
	assert.Equal(t, body, got)

	require.NoError(t, s.Delete(ctx, "a/b/c", "never/existed"))
	_, err = s.Get(ctx, "a/b/c")
	require.ErrorIs(t, err, blob.ErrNotFound)
}

func TestDeleteBatches(t *testing.T) {
	s := newStore(t)
	ctx := t.Context()
	keys := make([]string, 1005)
	for i := range keys {
		keys[i] = fmt.Sprintf("k/%04d", i)
	}
	for _, k := range []string{keys[0], keys[999], keys[1000], keys[1004]} {
		require.NoError(t, s.Put(ctx, k, []byte("1"), ""))
	}
	require.NoError(t, s.Delete(ctx, keys...))
	for _, k := range []string{keys[0], keys[1004]} {
		_, err := s.Get(ctx, k)
		require.ErrorIs(t, err, blob.ErrNotFound)
	}
}

func TestKey(t *testing.T) {
	org := uuid.MustParse("01890000-0000-7000-8000-000000000001")
	ep := uuid.MustParse("01890000-0000-7000-8000-000000000002")
	req := uuid.MustParse("01890000-0000-7000-8000-000000000003")
	at := time.Date(2026, 3, 4, 23, 30, 0, 0, time.FixedZone("x", -5*3600))

	assert.Equal(t, org.String()+"/"+ep.String()+"/2026/03/05/"+req.String(), blob.Key(&org, ep, req, at),
		"dates are UTC")
	assert.Equal(t, "anonymous/"+ep.String()+"/2026/03/05/"+req.String(), blob.Key(nil, ep, req, at))
}

func TestList(t *testing.T) {
	s := newStore(t)
	ctx := t.Context()
	for _, k := range []string{"a/1", "a/2", "b/1"} {
		require.NoError(t, s.Put(ctx, k, []byte("x"), ""))
	}
	page, err := s.List(ctx, "", 2)
	require.NoError(t, err)
	require.Len(t, page, 2)
	assert.Equal(t, "a/1", page[0].Key)
	assert.False(t, page[0].LastModified.IsZero())

	rest, err := s.List(ctx, page[1].Key, 10)
	require.NoError(t, err)
	require.Len(t, rest, 1)
	assert.Equal(t, "b/1", rest[0].Key)
}
