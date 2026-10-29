// Package safehttp is the outbound HTTP client for every user-supplied URL
// (destinations, replays). It prevents server-side request forgery:
//
//   - only http and https, on ports 80, 443 and 1024–65535, without credentials in the URL;
//   - the client resolves DNS itself and dials the exact address it checked,
//     so a hostname that resolves differently on the second lookup (DNS
//     rebinding) cannot reach a blocked address;
//   - loopback, private, link-local (including 169.254.169.254), CGNAT,
//     multicast, reserved and documentation ranges are blocked, as are IPv6
//     forms that embed a blocked IPv4 address (mapped, NAT64, 6to4);
//   - redirects are not followed, environment proxies are ignored, response
//     headers and bodies are capped.
//
// AllowPrivate (ALLOW_PRIVATE_DESTINATIONS=true) lifts the address checks for
// self-hosted instances that forward to their own network.
package safehttp

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"time"
)

// ErrBlocked is wrapped by every policy rejection.
var ErrBlocked = errors.New("destination not allowed")

// Resolver looks up a host's addresses (net.DefaultResolver satisfies it).
type Resolver interface {
	LookupNetIP(ctx context.Context, network, host string) ([]netip.Addr, error)
}

// Options configure a Client.
type Options struct {
	AllowPrivate bool
	Timeout      time.Duration // default 10 s
	Resolver     Resolver      // default net.DefaultResolver
}

// DefaultTimeout bounds a whole exchange unless Options.Timeout is set.
const DefaultTimeout = 10 * time.Second

// MaxResponseBytes is how much of a response body is read and kept.
const MaxResponseBytes = 64 << 10

var blocked = mustPrefixes(
	"0.0.0.0/8",       // "this" network
	"10.0.0.0/8",      // private
	"100.64.0.0/10",   // carrier-grade NAT
	"127.0.0.0/8",     // loopback
	"169.254.0.0/16",  // link-local, including cloud metadata
	"172.16.0.0/12",   // private
	"192.0.0.0/24",    // IETF protocol assignments
	"192.0.2.0/24",    // TEST-NET-1
	"192.88.99.0/24",  // 6to4 relay anycast
	"192.168.0.0/16",  // private
	"198.18.0.0/15",   // benchmarking
	"198.51.100.0/24", // TEST-NET-2
	"203.0.113.0/24",  // TEST-NET-3
	"224.0.0.0/4",     // multicast
	"240.0.0.0/4",     // reserved, including broadcast
	"::/128",          // unspecified
	"::1/128",         // loopback
	"100::/64",        // discard
	"2001::/23",       // IETF protocol assignments (includes Teredo)
	"2001:db8::/32",   // documentation
	"fc00::/7",        // unique local
	"fe80::/10",       // link-local
	"fec0::/10",       // site-local (deprecated)
	"ff00::/8",        // multicast
)

func mustPrefixes(list ...string) []netip.Prefix {
	out := make([]netip.Prefix, len(list))
	for i, s := range list {
		out[i] = netip.MustParsePrefix(s)
	}
	return out
}

var (
	nat64     = netip.MustParsePrefix("64:ff9b::/96")
	sixToFour = netip.MustParsePrefix("2002::/16")
)

// AllowedAddr reports whether a connection to a may be made.
func AllowedAddr(a netip.Addr) bool {
	a = a.Unmap()
	if !a.IsValid() {
		return false
	}
	// IPv6 addresses that carry an IPv4 address are judged by it.
	if a.Is6() {
		b := a.As16()
		switch {
		case nat64.Contains(a):
			return AllowedAddr(netip.AddrFrom4([4]byte{b[12], b[13], b[14], b[15]}))
		case sixToFour.Contains(a):
			return AllowedAddr(netip.AddrFrom4([4]byte{b[2], b[3], b[4], b[5]}))
		}
	}
	for _, p := range blocked {
		if p.Contains(a) {
			return false
		}
	}
	return a.IsGlobalUnicast()
}

// AllowedPort reports whether a destination port is permitted.
func AllowedPort(port int) bool {
	return port == 80 || port == 443 || (port >= 1024 && port <= 65535)
}

// ValidateURL checks the parts of a URL that do not need DNS. Use it when a
// destination is saved; the dialer re-checks addresses on every connection.
func ValidateURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid URL", ErrBlocked)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("%w: only http and https URLs", ErrBlocked)
	}
	if u.User != nil {
		return nil, fmt.Errorf("%w: credentials in the URL are not allowed", ErrBlocked)
	}
	if u.Hostname() == "" {
		return nil, fmt.Errorf("%w: missing host", ErrBlocked)
	}
	port := u.Port()
	if port == "" {
		port = map[string]string{"http": "80", "https": "443"}[u.Scheme]
	}
	if p, err := strconv.Atoi(port); err != nil || !AllowedPort(p) {
		return nil, fmt.Errorf("%w: port %s is not allowed", ErrBlocked, port)
	}
	return u, nil
}

// NewClient returns an http.Client that enforces the policy on every request.
func NewClient(opts Options) *http.Client {
	resolver := opts.Resolver
	if resolver == nil {
		resolver = net.DefaultResolver
	}
	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = DefaultTimeout
	}
	d := &dialer{resolver: resolver, allowPrivate: opts.AllowPrivate, net: &net.Dialer{Timeout: 5 * time.Second}}
	transport := &http.Transport{
		Proxy:                  nil, // environment proxies would bypass the address checks
		DialContext:            d.dial,
		ForceAttemptHTTP2:      true,
		TLSHandshakeTimeout:    5 * time.Second,
		ResponseHeaderTimeout:  timeout,
		MaxResponseHeaderBytes: 64 << 10,
		MaxIdleConns:           100,
		MaxIdleConnsPerHost:    4,
		IdleConnTimeout:        90 * time.Second,
	}
	return &http.Client{
		Transport: &policyTransport{base: transport},
		Timeout:   timeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

// policyTransport validates each request URL before it is sent.
type policyTransport struct{ base http.RoundTripper }

func (t *policyTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if _, err := ValidateURL(r.URL.String()); err != nil {
		return nil, err
	}
	return t.base.RoundTrip(r)
}

type dialer struct {
	resolver     Resolver
	allowPrivate bool
	net          *net.Dialer
}

func (d *dialer) dial(ctx context.Context, network, address string) (net.Conn, error) {
	host, portStr, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	port, err := strconv.Atoi(portStr)
	if err != nil || !AllowedPort(port) {
		return nil, fmt.Errorf("%w: port %s is not allowed", ErrBlocked, portStr)
	}

	var addrs []netip.Addr
	if ip, err := netip.ParseAddr(host); err == nil {
		addrs = []netip.Addr{ip}
	} else {
		addrs, err = d.resolver.LookupNetIP(ctx, "ip", host)
		if err != nil {
			return nil, fmt.Errorf("resolve %s: %w", host, err)
		}
	}

	lastErr := fmt.Errorf("%w: %s has no allowed address", ErrBlocked, host)
	for _, a := range addrs {
		if !d.allowPrivate && !AllowedAddr(a) {
			continue
		}
		// Dial the checked address itself; never resolve the name again.
		conn, err := d.net.DialContext(ctx, network, net.JoinHostPort(a.Unmap().String(), portStr))
		if err == nil {
			return conn, nil
		}
		lastErr = err
	}
	return nil, lastErr
}

// ReadLimited reads at most MaxResponseBytes of a response body and reports
// whether more was available.
func ReadLimited(body io.Reader) ([]byte, bool, error) {
	b, err := io.ReadAll(io.LimitReader(body, MaxResponseBytes+1))
	if err != nil {
		return nil, false, err
	}
	if len(b) > MaxResponseBytes {
		return b[:MaxResponseBytes], true, nil
	}
	return b, false, nil
}
