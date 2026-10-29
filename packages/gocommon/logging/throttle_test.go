package logging_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/kaanxsrd/hookline/packages/gocommon/logging"
)

func TestThrottle(t *testing.T) {
	th := logging.NewThrottle(10 * time.Second)
	t0 := time.Unix(1000, 0)

	ok, n := th.Allow(t0)
	assert.True(t, ok)
	assert.Zero(t, n)

	for i := range 3 {
		ok, _ = th.Allow(t0.Add(time.Duration(i+1) * time.Second))
		assert.False(t, ok)
	}

	ok, n = th.Allow(t0.Add(10 * time.Second))
	assert.True(t, ok)
	assert.Equal(t, 3, n, "reports what was suppressed")
}
