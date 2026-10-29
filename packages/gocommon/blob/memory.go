package blob

import (
	"bytes"
	"context"
	"io"
	"slices"
	"sync"
	"time"
)

// Memory is an in-process Store for tests and for running without object
// storage. Its contents do not survive a restart.
type Memory struct {
	mu      sync.Mutex
	objects map[string][]byte
	created map[string]time.Time
	// Fail, when set, is returned by every operation (to simulate an outage).
	Fail error
}

// NewMemory returns an empty in-memory Store.
func NewMemory() *Memory {
	return &Memory{objects: map[string][]byte{}, created: map[string]time.Time{}}
}

// Put stores a copy of body.
func (m *Memory) Put(_ context.Context, key string, body []byte, _ string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Fail != nil {
		return m.Fail
	}
	m.objects[key] = bytes.Clone(body)
	m.created[key] = time.Now()
	return nil
}

// Get returns the object at key.
func (m *Memory) Get(_ context.Context, key string) (io.ReadCloser, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Fail != nil {
		return nil, m.Fail
	}
	b, ok := m.objects[key]
	if !ok {
		return nil, ErrNotFound
	}
	return io.NopCloser(bytes.NewReader(b)), nil
}

// Delete removes keys.
func (m *Memory) Delete(_ context.Context, keys ...string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Fail != nil {
		return m.Fail
	}
	for _, k := range keys {
		delete(m.objects, k)
		delete(m.created, k)
	}
	return nil
}

// List returns up to max objects after the given key, in key order.
func (m *Memory) List(_ context.Context, after string, max int) ([]Object, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Fail != nil {
		return nil, m.Fail
	}
	keys := make([]string, 0, len(m.objects))
	for k := range m.objects {
		if k > after {
			keys = append(keys, k)
		}
	}
	slices.Sort(keys)
	out := make([]Object, 0, min(max, len(keys)))
	for _, k := range keys[:min(max, len(keys))] {
		out = append(out, Object{Key: k, LastModified: m.created[k]})
	}
	return out, nil
}

// Backdate changes an object's age, for tests of age-based cleanup.
func (m *Memory) Backdate(key string, at time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.created[key] = at
}

// Ping fails only when Fail is set.
func (m *Memory) Ping(context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.Fail
}

// Len returns the number of stored objects.
func (m *Memory) Len() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.objects)
}
