package cmd

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/kaanxsrd/hookline/cli/internal/buildinfo"
)

// release is the part of GitHub's release object the command reads.
type release struct {
	TagName string `json:"tag_name"`
	HTMLURL string `json:"html_url"`
}

// version parses "1.2.3", "v1.2.3" or "cli-v1.2.3"; pre-release suffixes are ignored.
func parseVersion(s string) ([3]int, bool) {
	s = strings.TrimPrefix(strings.TrimPrefix(s, "cli-"), "v")
	s, _, _ = strings.Cut(s, "-")
	parts := strings.Split(s, ".")
	if len(parts) != 3 {
		return [3]int{}, false
	}
	var v [3]int
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return [3]int{}, false
		}
		v[i] = n
	}
	return v, true
}

func newer(latest, current [3]int) bool {
	for i := range 3 {
		if latest[i] != current[i] {
			return latest[i] > current[i]
		}
	}
	return false
}

// upgradeHint guesses how the binary was installed from where it lives.
func upgradeHint(exe string) string {
	p := strings.ToLower(filepath.ToSlash(exe))
	switch {
	case strings.Contains(p, "/cellar/") || strings.Contains(p, "/homebrew/") || strings.Contains(p, "/linuxbrew/"):
		return "brew upgrade hookline"
	case strings.Contains(p, "/scoop/"):
		return "scoop update hookline"
	case strings.Contains(p, "/node_modules/"):
		return "npm install -g @hookline/cli@latest"
	}
	return ""
}

func newUpdateCmd(opts *globalOptions) *cobra.Command {
	return &cobra.Command{
		Use:   "update",
		Short: "Check for a newer hookline release",
		Long:  "Checks GitHub for the latest CLI release and says how to upgrade. It never replaces the binary itself.",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			base := os.Getenv("HOOKLINE_RELEASES_API")
			if base == "" {
				base = "https://api.github.com/repos/" + buildinfo.Repository()
			}
			// The URL is GitHub's API, or the user's own HOOKLINE_RELEASES_API.
			req, err := http.NewRequestWithContext(cmd.Context(), http.MethodGet, strings.TrimRight(base, "/")+"/releases/latest", nil) //nolint:gosec // see above
			if err != nil {
				return err
			}
			req.Header.Set("Accept", "application/vnd.github+json")
			req.Header.Set("User-Agent", userAgent())
			resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req) //nolint:gosec // see above
			if err != nil {
				return fmt.Errorf("check for updates: %w", err)
			}
			defer func() { _ = resp.Body.Close() }()
			if resp.StatusCode != http.StatusOK {
				return fmt.Errorf("check for updates: GitHub answered %s", resp.Status)
			}
			var rel release
			if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&rel); err != nil {
				return fmt.Errorf("check for updates: %w", err)
			}
			latest, ok := parseVersion(rel.TagName)
			if !ok {
				return errors.New("check for updates: the latest release has no version tag")
			}
			current := buildinfo.Get().Version
			cur, known := parseVersion(current)
			available := !known || newer(latest, cur)
			latestStr := fmt.Sprintf("%d.%d.%d", latest[0], latest[1], latest[2])

			p := opts.printer()
			exe, _ := os.Executable()
			hint := upgradeHint(exe)
			if opts.json {
				p.JSONLine(map[string]any{"current": current, "latest": latestStr, "update_available": available, "url": rel.HTMLURL, "upgrade": hint})
				return nil
			}
			switch {
			case !known:
				p.Println(fmt.Sprintf("This is a development build (%s); the latest release is %s.", current, latestStr))
			case !available:
				p.Success("hookline %s is the latest release", current)
				return nil
			default:
				p.Println(fmt.Sprintf("hookline %s is available (you have %s).", p.Bold(latestStr), current))
			}
			if hint != "" {
				p.Println("Upgrade with: " + p.Info(hint))
			}
			p.Println("Release notes and downloads: " + rel.HTMLURL)
			return nil
		},
	}
}
