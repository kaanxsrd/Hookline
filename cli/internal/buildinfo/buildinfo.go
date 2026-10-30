// Package buildinfo exposes the CLI version. Release builds set the variables
// with -ldflags "-X ..."; development builds fall back to VCS data embedded by
// the Go toolchain.
package buildinfo

import (
	"runtime"
	"runtime/debug"
)

// Set by goreleaser through -ldflags.
var (
	version = "dev"
	commit  = ""
	date    = ""
	// defaultURL is the Hookline instance used when neither --url,
	// HOOKLINE_URL nor the config file names one. Release builds set it to
	// the hosted instance; development builds talk to a local stack.
	defaultURL = "http://localhost:3000"
	// repository is where releases are published (owner/name on GitHub).
	repository = "kaanxsrd/hookline"
)

// Repository is the GitHub repository whose releases ship the CLI.
func Repository() string { return repository }

// DefaultURL is the instance the CLI talks to unless configured otherwise.
func DefaultURL() string { return defaultURL }

// Info describes the running binary.
type Info struct {
	Version   string `json:"version"`
	Commit    string `json:"commit,omitempty"`
	Date      string `json:"date,omitempty"`
	GoVersion string `json:"go"`
	Platform  string `json:"platform"`
}

// Get returns the build information of the running binary.
func Get() Info {
	info := Info{
		Version:   version,
		Commit:    commit,
		Date:      date,
		GoVersion: runtime.Version(),
		Platform:  runtime.GOOS + "/" + runtime.GOARCH,
	}
	if info.Commit != "" {
		return info
	}
	if bi, ok := debug.ReadBuildInfo(); ok {
		for _, s := range bi.Settings {
			switch s.Key {
			case "vcs.revision":
				info.Commit = s.Value
			case "vcs.time":
				info.Date = s.Value
			}
		}
	}
	return info
}

// ShortCommit returns the first 7 characters of the commit hash.
func (i Info) ShortCommit() string {
	if len(i.Commit) > 7 {
		return i.Commit[:7]
	}
	return i.Commit
}
