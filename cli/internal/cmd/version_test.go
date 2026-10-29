package cmd_test

import (
	"bytes"
	"encoding/json"
	"runtime"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaanxsrd/hookline/cli/internal/buildinfo"
	"github.com/kaanxsrd/hookline/cli/internal/cmd"
)

func run(t *testing.T, args ...string) (stdout, stderr string, code int) {
	t.Helper()
	var out, errOut bytes.Buffer
	code = cmd.Execute(t.Context(), args, &out, &errOut)
	return out.String(), errOut.String(), code
}

func TestVersionText(t *testing.T) {
	out, _, code := run(t, "version")
	require.Equal(t, 0, code)
	assert.True(t, strings.HasPrefix(out, "hookline dev"), out)
	assert.Contains(t, out, runtime.Version())
	assert.Contains(t, out, runtime.GOOS+"/"+runtime.GOARCH)
}

func TestVersionJSON(t *testing.T) {
	out, _, code := run(t, "version", "--json")
	require.Equal(t, 0, code)

	var info buildinfo.Info
	require.NoError(t, json.Unmarshal([]byte(out), &info))
	assert.Equal(t, "dev", info.Version)
	assert.Equal(t, runtime.Version(), info.GoVersion)
}

func TestUnknownCommandFails(t *testing.T) {
	_, stderr, code := run(t, "nope")
	assert.Equal(t, 1, code)
	assert.Contains(t, stderr, `unknown command "nope"`)
}
