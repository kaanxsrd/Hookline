package clientip_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaanxsrd/hookline/packages/gocommon/clientip"
)

func TestFrom(t *testing.T) {
	trusted, err := clientip.ParseTrusted(clientip.DefaultTrusted)
	require.NoError(t, err)
	rs := clientip.New(trusted)

	tests := []struct {
		name   string
		remote string
		xff    []string
		want   string
	}{
		{"direct public peer", "203.0.113.7:5555", nil, "203.0.113.7"},
		{"public peer cannot spoof XFF", "203.0.113.7:5555", []string{"1.2.3.4"}, "203.0.113.7"},
		{"trusted proxy, single hop", "127.0.0.1:1234", []string{"198.51.100.9"}, "198.51.100.9"},
		{"rightmost untrusted wins", "10.0.0.2:1234", []string{"1.1.1.1, 198.51.100.9, 10.0.0.5"}, "198.51.100.9"},
		{"multiple header lines", "10.0.0.2:1234", []string{"6.6.6.6", "198.51.100.9"}, "198.51.100.9"},
		{"all hops trusted", "10.0.0.2:1234", []string{"192.168.1.5"}, "192.168.1.5"},
		{"malformed hop stops the walk", "10.0.0.2:1234", []string{"6.6.6.6, garbage, 10.0.0.9"}, "10.0.0.9"},
		{"trusted proxy without XFF", "127.0.0.1:1234", nil, "127.0.0.1"},
		{"ipv6 peer", "[2001:db8::1]:443", nil, "2001:db8::1"},
		{"ipv4-mapped ipv6 is unmapped", "[::ffff:203.0.113.7]:80", nil, "203.0.113.7"},
		{"unparseable peer", "pipe", nil, "invalid IP"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, "/", nil)
			r.RemoteAddr = tt.remote
			for _, v := range tt.xff {
				r.Header.Add("X-Forwarded-For", v)
			}
			assert.Equal(t, tt.want, rs.From(r).String())
		})
	}
}

func TestParseTrusted(t *testing.T) {
	got, err := clientip.ParseTrusted(" 10.0.0.0/8, 192.0.2.1 ,,::1")
	require.NoError(t, err)
	require.Len(t, got, 3)
	assert.Equal(t, "192.0.2.1/32", got[1].String())
	assert.Equal(t, "::1/128", got[2].String())

	_, err = clientip.ParseTrusted("10.0.0.0/8,not-an-ip")
	require.ErrorContains(t, err, "not-an-ip")
}

func TestFromHeader(t *testing.T) {
	trusted, err := clientip.ParseTrusted(clientip.DefaultTrusted)
	require.NoError(t, err)
	rs := clientip.New(trusted).WithHeader("X-Real-Ip")

	req := func(remote, realIP, xff string) *http.Request {
		r := httptest.NewRequest(http.MethodPost, "/", nil)
		r.RemoteAddr = remote
		if realIP != "" {
			r.Header.Set("X-Real-Ip", realIP)
		}
		if xff != "" {
			r.Header.Set("X-Forwarded-For", xff)
		}
		return r
	}
	// Railway: the trusted internal proxy sets X-Real-Ip; XFF ends with a public edge address.
	assert.Equal(t, "212.60.107.194", rs.From(req("[fd12::1]:4000", "212.60.107.194", "212.60.107.194, 152.233.12.241")).String())
	// A public peer cannot choose its address through the header.
	assert.Equal(t, "203.0.113.7", rs.From(req("203.0.113.7:5555", "6.6.6.6", "")).String())
	// Without a usable header, X-Forwarded-For is walked as before.
	assert.Equal(t, "198.51.100.9", rs.From(req("10.0.0.2:1234", "garbage", "198.51.100.9")).String())
	assert.Equal(t, "198.51.100.9", rs.From(req("10.0.0.2:1234", "", "198.51.100.9")).String())
}
