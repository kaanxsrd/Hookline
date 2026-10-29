// Package destfilter decides whether a captured request should be forwarded
// to a destination. Every condition present in the filter must match.
package destfilter

import (
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"
)

// Filter mirrors destination.filter in packages/db (DestinationFilter).
type Filter struct {
	// Methods the request must use (any of them); empty means any method.
	Methods []string `json:"methods,omitempty"`
	// HeaderEquals maps header names (case-insensitive) to exact values.
	HeaderEquals map[string]string `json:"header_equals,omitempty"`
	// JSONPathEquals maps paths such as "type" or "$.data.object.status" or
	// "items[0].id" to the scalar the JSON body must hold there.
	JSONPathEquals map[string]any `json:"json_path_equals,omitempty"`
}

// Parse reads a filter column; an empty or null value matches everything.
func Parse(raw []byte) (Filter, error) {
	var f Filter
	if len(raw) == 0 || string(raw) == "null" {
		return f, nil
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		return f, fmt.Errorf("invalid destination filter: %w", err)
	}
	return f, nil
}

// Request is what a filter looks at.
type Request struct {
	Method  string
	Headers [][2]string
	Body    []byte
}

// Match reports whether r passes every condition of f.
func (f Filter) Match(r Request) bool {
	if len(f.Methods) > 0 && !slices.ContainsFunc(f.Methods, func(m string) bool { return strings.EqualFold(m, r.Method) }) {
		return false
	}
	for name, want := range f.HeaderEquals {
		if !slices.ContainsFunc(r.Headers, func(h [2]string) bool { return strings.EqualFold(h[0], name) && h[1] == want }) {
			return false
		}
	}
	if len(f.JSONPathEquals) == 0 {
		return true
	}
	var doc any
	if json.Unmarshal(r.Body, &doc) != nil {
		return false
	}
	for path, want := range f.JSONPathEquals {
		got, ok := lookup(doc, path)
		if !ok || !scalarEqual(got, want) {
			return false
		}
	}
	return true
}

// lookup follows a dotted path with optional [index] steps.
func lookup(doc any, path string) (any, bool) {
	path = strings.TrimPrefix(strings.TrimPrefix(path, "$"), ".")
	if path == "" {
		return doc, true
	}
	cur := doc
	for segment := range strings.SplitSeq(path, ".") {
		name, rest, _ := strings.Cut(segment, "[")
		if name != "" {
			obj, ok := cur.(map[string]any)
			if !ok {
				return nil, false
			}
			if cur, ok = obj[name]; !ok {
				return nil, false
			}
		}
		for rest != "" {
			idxStr, after, ok := strings.Cut(rest, "]")
			if !ok {
				return nil, false
			}
			idx, err := strconv.Atoi(idxStr)
			arr, isArr := cur.([]any)
			if err != nil || !isArr || idx < 0 || idx >= len(arr) {
				return nil, false
			}
			cur = arr[idx]
			rest = strings.TrimPrefix(after, "[")
		}
	}
	return cur, true
}

// scalarEqual compares JSON scalars; numbers compare by value.
func scalarEqual(got, want any) bool {
	switch w := want.(type) {
	case nil:
		return got == nil
	case string, bool:
		return got == w
	case float64:
		g, ok := got.(float64)
		return ok && g == w
	case int:
		g, ok := got.(float64)
		return ok && g == float64(w)
	default:
		return false
	}
}
