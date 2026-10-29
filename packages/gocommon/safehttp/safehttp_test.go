package safehttp_test

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaanxsrd/hookline/packages/gocommon/safehttp"
)

func TestAllowedAddr(t *testing.T) {
	tests := []struct {
		addr string
		want bool
	}{
		// Public.
		{"8.8.8.8", true},
		{"1.1.1.1", true},
		{"93.184.216.34", true},
		{"2606:4700:4700::1111", true},
		// Loopback and unspecified.
		{"127.0.0.1", false},
		{"127.255.255.254", false},
		{"0.0.0.0", false},
		{"::1", false},
		{"::", false},
		// Private.
		{"10.0.0.1", false},
		{"172.16.0.1", false},
		{"172.31.255.255", false},
		{"192.168.1.1", false},
		{"fd00::1", false},
		// Link-local and cloud metadata.
		{"169.254.169.254", false},
		{"fe80::1", false},
		// CGNAT, benchmarking, documentation, reserved, multicast, broadcast.
		{"100.64.0.1", false},
		{"100.127.255.254", false},
		{"198.18.0.1", false},
		{"192.0.2.1", false},
		{"198.51.100.1", false},
		{"203.0.113.1", false},
		{"240.0.0.1", false},
		{"224.0.0.1", false},
		{"255.255.255.255", false},
		{"ff02::1", false},
		{"2001:db8::1", false},
		// IPv6 carrying IPv4.
		{"::ffff:127.0.0.1", false},
		{"::ffff:8.8.8.8", true},
		{"64:ff9b::7f00:1", false},     // NAT64 of 127.0.0.1
		{"64:ff9b::808:808", true},     // NAT64 of 8.8.8.8
		{"2002:a9fe:a9fe::1", false},   // 6to4 of 169.254.169.254
		{"2002:0808:0808::1", true},    // 6to4 of 8.8.8.8
		{"2001:0:4136:e378::1", false}, // Teredo
		// Edges of private ranges.
		{"172.15.255.255", true},
		{"172.32.0.1", true},
		{"100.63.255.255", true},
		{"100.128.0.1", true},
	}
	for _, tt := range tests {
		assert.Equal(t, tt.want, safehttp.AllowedAddr(netip.MustParseAddr(tt.addr)), tt.addr)
	}
}

func TestValidateURL(t *testing.T) {
	for raw, ok := range map[string]bool{
		"https://example.com/hook":       true,
		"http://example.com:8080/x":      true,
		"https://example.com:443":        true,
		"http://example.com:80":          true,
		"ftp://example.com":              false,
		"file:///etc/passwd":             false,
		"gopher://example.com":           false,
		"https://user:pass@example.com":  false,
		"https://example.com:22":         false,
		"https://example.com:1023":       false,
		"https://example.com:1024":       true,
		"https://example.com:65535":      true,
		"https://":                       false,
		"javascript:alert(1)":            false,
		"https://example.com:notaport/x": false,
	} {
		_, err := safehttp.ValidateURL(raw)
		if ok {
			assert.NoError(t, err, raw)
		} else {
			assert.ErrorIs(t, err, safehttp.ErrBlocked, raw)
		}
	}
}

// fakeResolver answers each lookup with the next answer in the list.
type fakeResolver struct {
	answers [][]netip.Addr
	calls   atomic.Int32
}

func (f *fakeResolver) LookupNetIP(context.Context, string, string) ([]netip.Addr, error) {
	n := int(f.calls.Add(1)) - 1
	if n >= len(f.answers) {
		n = len(f.answers) - 1
	}
	return f.answers[n], nil
}

func addrs(list ...string) []netip.Addr {
	out := make([]netip.Addr, len(list))
	for i, s := range list {
		out[i] = netip.MustParseAddr(s)
	}
	return out
}

func get(t *testing.T, c *http.Client, url string) (*http.Response, error) {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, url, nil)
	require.NoError(t, err)
	resp, err := c.Do(req)
	if resp != nil {
		t.Cleanup(func() { _ = resp.Body.Close() })
	}
	return resp, err
}

func TestBlocksPrivateTargets(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("blocked request reached the server")
	}))
	defer srv.Close()
	_, port, _ := net.SplitHostPort(strings.TrimPrefix(srv.URL, "http://"))

	c := safehttp.NewClient(safehttp.Options{})
	_, err := get(t, c, "http://127.0.0.1:"+port)
	require.ErrorIs(t, err, safehttp.ErrBlocked, "literal loopback")
	_, err = get(t, c, "http://[::1]:"+port)
	require.ErrorIs(t, err, safehttp.ErrBlocked, "IPv6 loopback")
	_, err = get(t, c, "http://169.254.169.254/latest/meta-data")
	require.ErrorIs(t, err, safehttp.ErrBlocked, "metadata")

	// A hostname that resolves to loopback is blocked too.
	dns := safehttp.NewClient(safehttp.Options{Resolver: &fakeResolver{answers: [][]netip.Addr{addrs("127.0.0.1")}}})
	_, err = get(t, dns, "http://evil.test:"+port)
	require.ErrorIs(t, err, safehttp.ErrBlocked)
}

func TestDNSRebindingCannotReachBlockedAddress(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("rebinding reached the server")
	}))
	defer srv.Close()
	_, port, _ := net.SplitHostPort(strings.TrimPrefix(srv.URL, "http://"))

	// Every answer is blocked (IPv4 and IPv6 loopback): nothing is dialled.
	mixed := &fakeResolver{answers: [][]netip.Addr{addrs("127.0.0.1", "::1")}}
	c := safehttp.NewClient(safehttp.Options{Resolver: mixed, Timeout: time.Second})
	_, err := get(t, c, "http://rebind.test:"+port)
	require.ErrorIs(t, err, safehttp.ErrBlocked)

	// The resolved address is the one dialled: the name is resolved once per
	// connection and never handed to the system resolver again.
	resolver := &fakeResolver{answers: [][]netip.Addr{addrs("127.0.0.1")}}
	allowed := safehttp.NewClient(safehttp.Options{Resolver: resolver, AllowPrivate: true})
	ok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, "ok")
	}))
	defer ok.Close()
	_, okPort, _ := net.SplitHostPort(strings.TrimPrefix(ok.URL, "http://"))
	resp, err := get(t, allowed, "http://does-not-exist.invalid:"+okPort)
	require.NoError(t, err, "dials the resolver's address, not the hostname")
	body, _ := io.ReadAll(resp.Body)
	assert.Equal(t, "ok", string(body))
	assert.Equal(t, int32(1), resolver.calls.Load())
}

func TestDoesNotFollowRedirects(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://169.254.169.254/", http.StatusFound)
	}))
	defer srv.Close()
	c := safehttp.NewClient(safehttp.Options{AllowPrivate: true})
	resp, err := get(t, c, srv.URL)
	require.NoError(t, err)
	assert.Equal(t, http.StatusFound, resp.StatusCode)
}

func TestPortsAndSchemesEnforcedAtRequestTime(t *testing.T) {
	c := safehttp.NewClient(safehttp.Options{AllowPrivate: true})
	_, err := get(t, c, "http://example.com:22/")
	require.ErrorIs(t, err, safehttp.ErrBlocked)
	_, err = get(t, c, "http://user:pw@example.com/")
	require.ErrorIs(t, err, safehttp.ErrBlocked)
}

func TestTimeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(5 * time.Second):
		}
	}))
	defer srv.Close()
	c := safehttp.NewClient(safehttp.Options{AllowPrivate: true, Timeout: 200 * time.Millisecond})
	start := time.Now()
	_, err := get(t, c, srv.URL)
	require.Error(t, err)
	assert.Less(t, time.Since(start), 2*time.Second)
	var netErr net.Error
	assert.True(t, errors.As(err, &netErr) && netErr.Timeout(), "a timeout error")
}

func TestReadLimited(t *testing.T) {
	b, truncated, err := safehttp.ReadLimited(strings.NewReader(strings.Repeat("x", safehttp.MaxResponseBytes+10)))
	require.NoError(t, err)
	assert.Len(t, b, safehttp.MaxResponseBytes)
	assert.True(t, truncated)

	b, truncated, err = safehttp.ReadLimited(strings.NewReader("small"))
	require.NoError(t, err)
	assert.Equal(t, "small", string(b))
	assert.False(t, truncated)
}
