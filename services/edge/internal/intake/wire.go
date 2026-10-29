package intake

import (
	"net/http"
	"net/url"
	"slices"
	"strings"
)

// Pair is a name/value pair as stored in request.headers and request.query.
type Pair = [2]string

// queryPairs splits a raw query string keeping order, repeats and empty values.
func queryPairs(raw string) []Pair {
	pairs := []Pair{}
	for part := range strings.SplitSeq(raw, "&") {
		if part == "" {
			continue
		}
		name, value, _ := strings.Cut(part, "=")
		pairs = append(pairs, Pair{unescape(name), unescape(value)})
	}
	return pairs
}

func unescape(s string) string {
	if u, err := url.QueryUnescape(s); err == nil {
		return u
	}
	return s // keep malformed escapes verbatim rather than dropping data
}

// headerPairs flattens the request headers. Go's HTTP server canonicalizes
// header names and does not keep their order (and HTTP/2 lowercases them),
// so names are sorted for a stable display; repeated values keep their
// order. Host is listed first because net/http moves it out of the map.
func headerPairs(r *http.Request) []Pair {
	pairs := make([]Pair, 0, len(r.Header)+1)
	if r.Host != "" {
		pairs = append(pairs, Pair{"Host", r.Host})
	}
	names := make([]string, 0, len(r.Header))
	for name := range r.Header {
		names = append(names, name)
	}
	slices.Sort(names)
	for _, name := range names {
		for _, v := range r.Header[name] {
			pairs = append(pairs, Pair{name, v})
		}
	}
	return pairs
}

// blockedResponseHeaders may not be set by an endpoint's custom response.
// Responses are served from the application's origin, so cookies, security
// policies and CORS stay under Hookline's control; framing headers are
// managed by net/http.
var blockedResponseHeaders = map[string]bool{
	"set-cookie":                          true,
	"set-cookie2":                         true,
	"clear-site-data":                     true,
	"content-security-policy":             true,
	"content-security-policy-report-only": true,
	"strict-transport-security":           true,
	"x-frame-options":                     true,
	"x-content-type-options":              true,
	"cross-origin-opener-policy":          true,
	"cross-origin-embedder-policy":        true,
	"cross-origin-resource-policy":        true,
	"connection":                          true,
	"keep-alive":                          true,
	"proxy-connection":                    true,
	"transfer-encoding":                   true,
	"te":                                  true,
	"trailer":                             true,
	"upgrade":                             true,
	"content-length":                      true,
}

// allowedResponseHeader reports whether a configured response header may be sent.
func allowedResponseHeader(name, value string) bool {
	lower := strings.ToLower(name)
	if blockedResponseHeaders[lower] ||
		strings.HasPrefix(lower, "access-control-") ||
		strings.HasPrefix(lower, "x-hookline-") {
		return false
	}
	return validHeaderName(name) && !strings.ContainsAny(value, "\r\n\x00")
}

// validHeaderName checks RFC 9110 token characters.
func validHeaderName(name string) bool {
	if name == "" {
		return false
	}
	for i := range len(name) {
		c := name[i]
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9':
		case strings.IndexByte("!#$%&'*+-.^_`|~", c) >= 0:
		default:
			return false
		}
	}
	return true
}

// setBaseHeaders applies the headers every intake response carries.
// The sandbox CSP turns any HTML a custom response contains into an inert,
// script-less document in an opaque origin.
func setBaseHeaders(h http.Header) {
	h.Set("Access-Control-Allow-Origin", "*")
	h.Set("Access-Control-Expose-Headers", "X-Hookline-Request-Id")
	h.Set("Content-Security-Policy", "sandbox; default-src 'none'; frame-ancestors 'none'")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("X-Frame-Options", "DENY")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("Cross-Origin-Resource-Policy", "cross-origin")
}

// isPreflight reports whether r is a CORS preflight rather than a webhook.
func isPreflight(r *http.Request) bool {
	return r.Method == http.MethodOptions &&
		r.Header.Get("Origin") != "" &&
		r.Header.Get("Access-Control-Request-Method") != ""
}

// validSlug checks the 12-character base62 format before touching any store.
func validSlug(s string) bool {
	if len(s) != 12 {
		return false
	}
	for i := range len(s) {
		c := s[i]
		if (c < '0' || c > '9') && (c < 'a' || c > 'z') && (c < 'A' || c > 'Z') {
			return false
		}
	}
	return true
}
