package config_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaanxsrd/hookline/cli/internal/config"
)

func TestRoundTripAndProfiles(t *testing.T) {
	t.Setenv("HOOKLINE_CONFIG_DIR", t.TempDir())
	c, err := config.Load()
	require.NoError(t, err)
	_, _, err = c.Profile("")
	require.ErrorContains(t, err, "not logged in")

	c.URL = "https://hooks.test"
	c.Orgs["acme"] = config.Profile{APIKey: "k1", OrgName: "Acme"}
	require.NoError(t, c.Save())

	c, err = config.Load()
	require.NoError(t, err)
	slug, p, err := c.Profile("")
	require.NoError(t, err)
	assert.Equal(t, "acme", slug, "the only profile is the default")
	assert.Equal(t, "k1", p.APIKey)

	c.Orgs["beta"] = config.Profile{APIKey: "k2"}
	_, _, err = c.Profile("")
	require.ErrorContains(t, err, "--org")
	c.DefaultOrg = "beta"
	slug, _, err = c.Profile("")
	require.NoError(t, err)
	assert.Equal(t, "beta", slug)
	_, _, err = c.Profile("gamma")
	require.ErrorContains(t, err, "gamma")
}
