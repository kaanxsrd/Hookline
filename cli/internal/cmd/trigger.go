package cmd

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"

	"github.com/kaanxsrd/hookline/cli/internal/api"
	"github.com/kaanxsrd/hookline/cli/internal/fixtures"
)

func newTriggerCmd(opts *globalOptions) *cobra.Command {
	var (
		list   bool
		secret string
	)
	cmd := &cobra.Command{
		Use:   "trigger <slug> <provider.event>",
		Short: "Send a realistic, signed sample event to an endpoint",
		Long: "Sends a sample webhook from the bundled fixtures to an endpoint, signed with the\n" +
			"endpoint's signature secret (or --secret / HOOKLINE_SIGNING_SECRET) so it shows as\n" +
			"Verified. `hookline trigger --list` shows the events.",
		Example: "  hookline trigger abc123def456 stripe.payment_intent.succeeded\n  hookline trigger --list",
		Args: func(cmd *cobra.Command, args []string) error {
			if list {
				return cobra.NoArgs(cmd, args)
			}
			return cobra.ExactArgs(2)(cmd, args)
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			p := opts.printer()
			if list {
				if opts.json {
					names := []map[string]string{}
					for _, f := range fixtures.List() {
						names = append(names, map[string]string{"name": f.Name, "provider": f.Provider, "description": f.Description})
					}
					p.JSONLine(names)
					return nil
				}
				tw := tabwriter.NewWriter(p.Out(), 0, 4, 2, ' ', 0)
				for _, f := range fixtures.List() {
					_, _ = fmt.Fprintf(tw, "%s\t%s\n", f.Name, f.Description)
				}
				return tw.Flush()
			}

			fx, ok := fixtures.Find(args[1])
			if !ok {
				return fmt.Errorf("unknown event %q: see `hookline trigger --list`", args[1])
			}
			s, err := opts.authed()
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			ep, err := s.client.GetEndpoint(ctx, args[0])
			if err != nil {
				return err
			}

			if secret == "" {
				secret = os.Getenv("HOOKLINE_SIGNING_SECRET")
			}
			if secret == "" && fx.Provider != "discord" {
				sig, err := s.client.GetSignatureSecret(ctx, ep.Id.String())
				switch {
				case err == nil && string(sig.Provider) == fx.Provider:
					secret = sig.Secret
				case err == nil:
					p.Warn("%s verifies %s signatures; this %s event will show as Invalid", ep.Slug, sig.Provider, fx.Provider)
				case api.IsCode(err, "not_configured"):
					p.Warn("%s has no signature verification: the event is sent unsigned", ep.Slug)
				case api.IsCode(err, "insufficient_scope"):
					p.Warn("this API key cannot read the endpoint's secret: the event is sent unsigned (pass --secret)")
				default:
					return err
				}
			}

			built, err := fx.Build(secret, time.Now())
			if err != nil {
				return err
			}
			target := strings.TrimRight(ep.Url, "/") + built.Path
			req, err := http.NewRequestWithContext(ctx, built.Method, target, bytes.NewReader(built.Body))
			if err != nil {
				return err
			}
			for _, h := range built.Headers {
				req.Header.Add(h[0], h[1])
			}
			resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
			if err != nil {
				return fmt.Errorf("send to %s: %w", target, err)
			}
			defer func() { _ = resp.Body.Close() }()
			_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
			id := resp.Header.Get("X-Hookline-Request-Id")
			if opts.json {
				p.JSONLine(map[string]any{"event": fx.Name, "url": target, "status": resp.StatusCode, "request_id": id})
			} else {
				if resp.StatusCode >= 400 {
					return fmt.Errorf("the endpoint answered %s", resp.Status)
				}
				p.Success("Sent %s to %s → %d", fx.Name, target, resp.StatusCode)
				if id != "" {
					p.Status("Request %s", id)
				}
			}
			if built.Note != "" {
				p.Warn("%s", built.Note)
			}
			if resp.StatusCode >= 400 {
				return errors.New(resp.Status)
			}
			return nil
		},
	}
	cmd.Flags().BoolVar(&list, "list", false, "list the sample events")
	cmd.Flags().StringVar(&secret, "secret", "", "sign with this secret instead of the endpoint's")
	return cmd
}
