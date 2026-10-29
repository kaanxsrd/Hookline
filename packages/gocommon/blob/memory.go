package blob

import (
	"bytes"
	"context"
	"io"
	"sync"
)

// Memory is an in-process Store for tests and for running without object
// storage. Its contents do not survive a restart.
type Memory struct {
	mu      sync.Mutex
	objects map[string][]byte
	// Fail, when set, is returned by every operation (to simulate an outage).
	Fail error
}

// NewMemory returns an empty in-memory Store.
func NewMemory() *Memory {
	return &Memory{objects: map[string][]byte{}}
}

// Put stores a copy of body.
func (m *Memory) Put(_ context.Context, key string, body []byte, _ string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Fail != nil {
		return m.Fail
	}
	m.objects[key] = bytes.Clone(body)
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
	}
	return nil
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
