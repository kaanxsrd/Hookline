// Package cmd defines the hookline command tree.
package cmd

import (
	"context"
	"errors"
	"io"
	"os"
	"strings"

	"github.com/pkg/browser"
	"github.com/spf13/cobra"

	"github.com/kaanxsrd/hookline/cli/internal/api"
	"github.com/kaanxsrd/hookline/cli/internal/buildinfo"
	"github.com/kaanxsrd/hookline/cli/internal/config"
	"github.com/kaanxsrd/hookline/cli/internal/ui"
)

// globalOptions holds flags shared by every command.
type globalOptions struct {
	json    bool
	org     string
	noColor bool
	url     string

	stdout, stderr io.Writer
}

// printer formats output for the current flags.
func (o *globalOptions) printer() *ui.Printer {
	return ui.New(o.stdout, o.stderr, o.noColor, o.json)
}

// baseURL picks the instance: --url, HOOKLINE_URL, the config file, then the build default.
func (o *globalOptions) baseURL(cfg *config.Config) string {
	for _, u := range []string{o.url, os.Getenv("HOOKLINE_URL"), cfg.URL, buildinfo.DefaultURL()} {
		if u != "" {
			return strings.TrimRight(u, "/")
		}
	}
	return ""
}

func userAgent() string { return "hookline-cli/" + buildinfo.Get().Version }

// anonymousClient talks to the instance without credentials.
func (o *globalOptions) anonymousClient() (*api.Client, *config.Config, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, nil, err
	}
	return &api.Client{BaseURL: o.baseURL(cfg), UserAgent: userAgent()}, cfg, nil
}

// session is an authenticated API client and the organization it acts for.
type session struct {
	client  *api.Client
	cfg     *config.Config
	orgSlug string // empty when the key comes from HOOKLINE_API_KEY
}

// authed returns a client with the API key from HOOKLINE_API_KEY or the
// config file's profile for --org.
func (o *globalOptions) authed() (*session, error) {
	client, cfg, err := o.anonymousClient()
	if err != nil {
		return nil, err
	}
	if key := os.Getenv("HOOKLINE_API_KEY"); key != "" {
		client.APIKey = key
		return &session{client: client, cfg: cfg, orgSlug: o.org}, nil
	}
	slug, profile, err := cfg.Profile(o.org)
	if err != nil {
		return nil, err
	}
	client.APIKey = profile.APIKey
	return &session{client: client, cfg: cfg, orgSlug: slug}, nil
}

// openBrowser opens url unless HOOKLINE_NO_BROWSER is set (CI, tests, SSH).
func openBrowser(url string) bool {
	if os.Getenv("HOOKLINE_NO_BROWSER") != "" {
		return false
	}
	browser.Stdout, browser.Stderr = io.Discard, io.Discard
	return browser.OpenURL(url) == nil
}

// NewRoot builds the root command. Output goes to stdout and stderr so tests
// can capture it.
func NewRoot(stdout, stderr io.Writer) *cobra.Command {
	opts := &globalOptions{stdout: stdout, stderr: stderr}
	root := &cobra.Command{
		Use:   "hookline",
		Short: "Catch every webhook. Replay anything. Pipe it to localhost.",
		Long: "hookline captures webhooks on a public URL, streams them to your machine,\n" +
			"and lets you inspect, replay and forward them.",
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	root.SetOut(stdout)
	root.SetErr(stderr)
	flags := root.PersistentFlags()
	flags.BoolVar(&opts.json, "json", false, "print machine-readable JSON")
	flags.StringVar(&opts.org, "org", "", "organization to act for (when logged in to several)")
	flags.BoolVar(&opts.noColor, "no-color", os.Getenv("NO_COLOR") != "", "disable colors")
	flags.StringVar(&opts.url, "url", "", "Hookline instance URL (default from HOOKLINE_URL or the config file)")

	root.AddCommand(
		newVersionCmd(opts),
		newLoginCmd(opts),
		newLogoutCmd(opts),
		newWhoamiCmd(opts),
		newEndpointsCmd(opts),
		newListenCmd(opts),
		newTailCmd(opts),
		newReplayCmd(opts),
		newTriggerCmd(opts),
	)
	return root
}

// Execute runs the CLI with args and returns the process exit code.
func Execute(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	root := NewRoot(stdout, stderr) //nolint:contextcheck // commands read ctx from cmd.Context()
	root.SetArgs(args)
	if err := root.ExecuteContext(ctx); err != nil {
		if errors.Is(err, context.Canceled) {
			return 130
		}
		_, _ = io.WriteString(stderr, "Error: "+err.Error()+"\n")
		return 1
	}
	return 0
}
