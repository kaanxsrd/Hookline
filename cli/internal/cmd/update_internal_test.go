package cmd

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestVersions(t *testing.T) {
	v, ok := parseVersion("cli-v1.4.2")
	assert.True(t, ok)
	assert.Equal(t, [3]int{1, 4, 2}, v)
	_, ok = parseVersion("dev")
	assert.False(t, ok)
	v, ok = parseVersion("v2.0.0-rc.1")
	assert.True(t, ok)
	assert.Equal(t, [3]int{2, 0, 0}, v)

	assert.True(t, newer([3]int{1, 10, 0}, [3]int{1, 9, 9}))
	assert.False(t, newer([3]int{1, 2, 3}, [3]int{1, 2, 3}))
	assert.False(t, newer([3]int{1, 2, 3}, [3]int{2, 0, 0}))
}

func TestUpgradeHint(t *testing.T) {
	assert.Equal(t, "brew upgrade hookline", upgradeHint("/opt/homebrew/Cellar/hookline/1.0.0/bin/hookline"))
	assert.Equal(t, "brew upgrade hookline", upgradeHint("/usr/local/Caskroom/hookline/1.0.0/hookline"))
	assert.Equal(t, "npm install -g hookline-cli@latest",
		upgradeHint("/usr/lib/node_modules/hookline-cli/node_modules/@vantedev/hookline-cli-linux-x64/bin/hookline"))
	assert.Equal(t, "scoop update hookline", upgradeHint(`C:\Users\me\scoop\apps\hookline\current\hookline.exe`))
	assert.Equal(t, "npm install -g hookline-cli@latest", upgradeHint("/usr/lib/node_modules/hookline-cli/bin/hookline"))
	assert.Empty(t, upgradeHint("/usr/local/bin/hookline"))
}
