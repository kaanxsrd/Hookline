// Package testdocker prepares testcontainers for the local Docker setup.
package testdocker

import (
	"context"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// Prepare must run before the first container starts (call it from TestMain).
//
// On Windows it adapts testcontainers to Docker Desktop: the reaper (Ryuk) is
// disabled because its readiness check does not work over the named pipe,
// and DOCKER_HOST is pinned to the active Docker context, because host
// auto-detection intermittently fails when several test binaries probe the
// pipe at once and testcontainers then caches the failure. Callers terminate
// their containers themselves. Elsewhere the defaults stay, including the
// reaper as a safety net for test binaries that crash before cleanup.
func Prepare() {
	if runtime.GOOS != "windows" {
		return
	}
	if os.Getenv("TESTCONTAINERS_RYUK_DISABLED") == "" {
		_ = os.Setenv("TESTCONTAINERS_RYUK_DISABLED", "true")
	}
	if os.Getenv("DOCKER_HOST") == "" {
		if host := contextHost(); host != "" {
			_ = os.Setenv("DOCKER_HOST", host)
		}
	}
}

// contextHost returns the endpoint of the active Docker CLI context, or "".
func contextHost() string {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}
