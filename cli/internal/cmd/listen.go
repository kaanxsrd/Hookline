package cmd

import (
	"context"
	"errors"
	"fmt"
	"os"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/spf13/cobra"

	"github.com/kaanxsrd/hookline/cli/internal/buildinfo"
	"github.com/kaanxsrd/hookline/cli/internal/forward"
	"github.com/kaanxsrd/hookline/cli/internal/ui"
	"github.com/kaanxsrd/hookline/cli/tunnel"
	"github.com/kaanxsrd/hookline/packages/protocol"
)

// tunnelURL is where tunnels connect: HOOKLINE_TUNNEL_URL, else what the instance advertises.
func tunnelURL(ctx context.Context, s *session) (string, error) {
	if u := os.Getenv("HOOKLINE_TUNNEL_URL"); u != "" {
		return u, nil
	}
	c, err := s.client.Config(ctx)
	if err != nil {
		return "", err
	}
	if c.TunnelURL == "" {
		return "", errors.New("this Hookline instance did not advertise a tunnel URL")
	}
	return c.TunnelURL, nil
}

// slugs maps endpoint IDs to slugs for display, filled from ready frames.
type slugs struct {
	mu sync.Mutex
	m  map[string]string
}

func (s *slugs) set(r *protocol.Ready) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, e := range r.Endpoints {
		s.m[e.ID] = e.Slug
	}
}

func (s *slugs) get(id string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if v, ok := s.m[id]; ok {
		return v
	}
	return "?"
}

// connectionEvents prints connection changes; first reports the first ready.
func connectionEvents(p *ui.Printer, names *slugs, first func(*protocol.Ready)) func(tunnel.Event) {
	var once sync.Once
	return func(e tunnel.Event) {
		switch e.Kind {
		case tunnel.EventConnecting:
			if e.Attempt == 1 {
				p.Status("Connecting…")
			}
		case tunnel.EventReady:
			names.set(e.Ready)
			reconnected := true
			once.Do(func() {
				reconnected = false
				first(e.Ready)
			})
			if reconnected {
				p.Success("Reconnected")
			}
		case tunnel.EventDisconnected:
			reason := ""
			if e.Err != nil {
				reason = ": " + e.Err.Error()
			}
			p.Warn("Connection lost%s; reconnecting in %s…", reason, e.Delay.Round(100*time.Millisecond))
		case tunnel.EventGoAway:
			p.Status("Server restarting; reconnecting…")
		case tunnel.EventServerError:
			p.Warn("%s", e.Message)
		}
	}
}

func runTunnel(ctx context.Context, c *tunnel.Client) error {
	err := c.Run(ctx)
	var fatal *tunnel.FatalError
	if errors.As(err, &fatal) {
		return errors.New(fatal.Message)
	}
	return err
}

func newListenCmd(opts *globalOptions) *cobra.Command {
	var (
		target   string
		sync     bool
		rewrites []string
		headers  []string
		methods  []string
	)
	cmd := &cobra.Command{
		Use:   "listen <slug> [slug...]",
		Short: "Forward an endpoint's requests to a local server",
		Long: "Opens a tunnel and forwards every request the endpoints capture to --forward,\n" +
			"printing one line per request. With --sync, endpoints in CLI sync response\n" +
			"mode answer the original sender with your server's response.",
		Example: "  hookline listen abc123def456 --forward http://localhost:3000/api/webhooks\n" +
			"  hookline listen abc123def456 --forward http://localhost:8000 --sync --path-rewrite /stripe=/webhooks/stripe",
		Args: cobra.RangeArgs(1, protocol.MaxEndpoints),
		RunE: func(cmd *cobra.Command, args []string) error {
			if target == "" {
				return errors.New("pass --forward URL (or use `hookline tail` to watch without forwarding)")
			}
			var rws []forward.Rewrite
			for _, r := range rewrites {
				rw, err := forward.ParseRewrite(r)
				if err != nil {
					return err
				}
				rws = append(rws, rw)
			}
			var hdrs [][2]string
			for _, h := range headers {
				hv, err := forward.ParseHeader(h)
				if err != nil {
					return err
				}
				hdrs = append(hdrs, hv)
			}
			for i, m := range methods {
				methods[i] = strings.ToUpper(strings.TrimSpace(m))
			}
			fwd, err := forward.New(target, rws, hdrs)
			if err != nil {
				return err
			}
			s, err := opts.authed()
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			wsURL, err := tunnelURL(ctx, s)
			if err != nil {
				return err
			}

			p := opts.printer()
			names := &slugs{m: map[string]string{}}
			client := &tunnel.Client{
				URL: wsURL, APIKey: s.client.APIKey, Endpoints: args, Sync: sync, CLIVersion: buildinfo.Get().Version,
				Handler: func(ctx context.Context, req protocol.Request) (*protocol.Response, *protocol.Error) {
					if len(methods) > 0 && !slices.Contains(methods, req.Method) {
						return nil, nil
					}
					return fwd.Handle(ctx, req)
				},
				OnAnswer: func(req protocol.Request, resp *protocol.Response, perr *protocol.Error, d time.Duration) {
					if resp == nil && perr == nil {
						return // filtered out
					}
					p.Forwarded(names.get(req.EndpointID), req, resp, perr, d)
				},
			}
			client.OnEvent = connectionEvents(p, names, func(r *protocol.Ready) {
				for _, e := range r.Endpoints {
					p.Success("Forwarding %s → %s", p.Info(e.URL), fwd.Target.String())
					if sync && e.ResponseMode != "cli_sync" {
						p.Warn("%s answers senders with its static response; switch it to CLI sync in its settings for --sync to apply", e.Slug)
					}
				}
				if len(methods) > 0 {
					p.Status("Only %s requests are forwarded", strings.Join(methods, ", "))
				}
				p.Status("Press Ctrl+C to stop")
			})
			if err := runTunnel(ctx, client); err != nil {
				return err
			}
			p.Status("Tunnel closed")
			return nil
		},
	}
	f := cmd.Flags()
	f.StringVar(&target, "forward", "", "local URL to forward requests to, e.g. http://localhost:3000/api/webhooks")
	f.BoolVar(&sync, "sync", false, "answer senders with your server's response (endpoints in CLI sync mode)")
	f.StringArrayVar(&rewrites, "path-rewrite", nil, "rewrite a path prefix, /from=/to (repeatable)")
	f.StringArrayVar(&headers, "header", nil, "set a header on forwarded requests, Name:value (repeatable)")
	f.StringSliceVar(&methods, "filter-method", nil, "only forward these methods, e.g. POST (repeatable)")
	return cmd
}

func newTailCmd(opts *globalOptions) *cobra.Command {
	return &cobra.Command{
		Use:   "tail <slug> [slug...]",
		Short: "Print an endpoint's requests live without forwarding them",
		Long:  "Prints one line per captured request. With --json, prints one JSON object per line (pipe it to jq).",
		Args:  cobra.RangeArgs(1, protocol.MaxEndpoints),
		RunE: func(cmd *cobra.Command, args []string) error {
			s, err := opts.authed()
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			wsURL, err := tunnelURL(ctx, s)
			if err != nil {
				return err
			}
			p := opts.printer()
			names := &slugs{m: map[string]string{}}
			client := &tunnel.Client{
				URL: wsURL, APIKey: s.client.APIKey, Endpoints: args, CLIVersion: buildinfo.Get().Version,
				OnRequest: func(req protocol.Request) { p.Observed(names.get(req.EndpointID), req) },
			}
			client.OnEvent = connectionEvents(p, names, func(r *protocol.Ready) {
				urls := make([]string, 0, len(r.Endpoints))
				for _, e := range r.Endpoints {
					urls = append(urls, e.URL)
				}
				p.Success("Watching %s", strings.Join(urls, ", "))
				p.Status("Press Ctrl+C to stop")
			})
			if err := runTunnel(ctx, client); err != nil {
				return fmt.Errorf("tail: %w", err)
			}
			return nil
		},
	}
}
