package db_test

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaanxsrd/hookline/packages/gocommon/db"
	"github.com/kaanxsrd/hookline/packages/gocommon/dbtest"
)

func TestMain(m *testing.M) { os.Exit(dbtest.Run(m)) }

func TestOpen(t *testing.T) {
	pool, err := db.Open(t.Context(), dbtest.NewURL(t), db.Options{MaxConns: 3, ApplicationName: "hookline-test"})
	require.NoError(t, err)
	defer pool.Close()

	assert.Equal(t, int32(3), pool.Config().MaxConns)
	var tz, app string
	require.NoError(t, pool.QueryRow(t.Context(),
		"SELECT current_setting('TimeZone'), current_setting('application_name')").Scan(&tz, &app))
	assert.Equal(t, "UTC", tz)
	assert.Equal(t, "hookline-test", app)
}

func TestOpenErrorsDoNotLeakPassword(t *testing.T) {
	_, err := db.Open(t.Context(), "postgres://user:s3cret@%zz/db", db.Options{})
	require.Error(t, err)
	assert.NotContains(t, err.Error(), "s3cret")
}
