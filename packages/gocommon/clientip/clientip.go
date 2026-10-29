// Package clientip finds the address of the client behind any trusted
// reverse proxies (Caddy in production).
package clientip

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// DefaultTrusted are loopback and private ranges: the proxy normally runs on
// the same host or private network. A public peer is never trusted, so
// senders on the internet cannot spoof X-Forwarded-For.
const DefaultTrusted = "127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7"

// Resolver extracts client addresses.
type Resolver struct {
	trusted []netip.Prefix
}

// ParseTrusted parses a comma-separated list of CIDR prefixes or single addresses.
func ParseTrusted(list string) ([]netip.Prefix, error) {
	var out []netip.Prefix
	for _, item := range strings.Split(list, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if p, err := netip.ParsePrefix(item); err == nil {
			out = append(out, p.Masked())
			continue
		}
		a, err := netip.ParseAddr(item)
		if err != nil {
			return nil, fmt.Errorf("invalid trusted proxy %q: want a CIDR prefix or an IP address", item)
		}
		out = append(out, netip.PrefixFrom(a.Unmap(), a.Unmap().BitLen()))
	}
	return out, nil
}

// New returns a Resolver trusting the given proxy ranges.
func New(trusted []netip.Prefix) *Resolver {
	return &Resolver{trusted: trusted}
}

// From returns the client address of r: the TCP peer, unless the peer is a
// trusted proxy, in which case X-Forwarded-For is walked from right to left
// and the first address outside the trusted ranges wins. The zero Addr is
// returned when nothing parses.
func (rs *Resolver) From(r *http.Request) netip.Addr {
	peer := parseHostPort(r.RemoteAddr)
	if !peer.IsValid() || !rs.isTrusted(peer) {
		return peer
	}

	client := peer
	hops := r.Header.Values("X-Forwarded-For")
	for i := len(hops) - 1; i >= 0; i-- {
		parts := strings.Split(hops[i], ",")
		for j := len(parts) - 1; j >= 0; j-- {
			a, err := netip.ParseAddr(strings.TrimSpace(parts[j]))
			if err != nil {
				// A malformed hop means everything further left is unreliable.
				return client
			}
			client = a.Unmap()
			if !rs.isTrusted(client) {
				return client
			}
		}
	}
	return client
}

func (rs *Resolver) isTrusted(a netip.Addr) bool {
	for _, p := range rs.trusted {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

func parseHostPort(s string) netip.Addr {
	host, _, err := net.SplitHostPort(s)
	if err != nil {
		host = s
	}
	a, err := netip.ParseAddr(host)
	if err != nil {
		return netip.Addr{}
	}
	return a.Unmap()
}
