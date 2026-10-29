package cmd

import (
	"bufio"
	"errors"
	"fmt"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"
)

func newEndpointsCmd(opts *globalOptions) *cobra.Command {
	cmd := &cobra.Command{
		Use:     "endpoints",
		Aliases: []string{"endpoint", "ep"},
		Short:   "List, create, delete and open endpoints",
	}
	cmd.AddCommand(
		&cobra.Command{
			Use:   "list",
			Short: "List the organization's endpoints",
			Args:  cobra.NoArgs,
			RunE: func(cmd *cobra.Command, _ []string) error {
				s, err := opts.authed()
				if err != nil {
					return err
				}
				eps, err := s.client.ListEndpoints(cmd.Context())
				if err != nil {
					return err
				}
				p := opts.printer()
				if opts.json {
					p.JSONLine(eps)
					return nil
				}
				if len(eps) == 0 {
					p.Println("No endpoints yet. Create one with `hookline endpoints create`.")
					return nil
				}
				tw := tabwriter.NewWriter(p.Out(), 0, 4, 2, ' ', 0)
				_, _ = fmt.Fprintln(tw, "SLUG\tNAME\tSTATUS\tREQUESTS\tLAST REQUEST\tURL")
				for _, e := range eps {
					last := "never"
					if e.LastRequestAt != nil {
						last = e.LastRequestAt.Local().Format(time.DateTime)
					}
					_, _ = fmt.Fprintf(tw, "%s\t%s\t%s\t%d\t%s\t%s\n", e.Slug, e.Name, e.Status, e.RequestCount, last, e.URL)
				}
				return tw.Flush()
			},
		},
		&cobra.Command{
			Use:   "create [name]",
			Short: "Create an endpoint and print its URL",
			Args:  cobra.MaximumNArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				name := "CLI endpoint"
				if len(args) == 1 && strings.TrimSpace(args[0]) != "" {
					name = strings.TrimSpace(args[0])
				}
				s, err := opts.authed()
				if err != nil {
					return err
				}
				ep, err := s.client.CreateEndpoint(cmd.Context(), name)
				if err != nil {
					return err
				}
				p := opts.printer()
				if opts.json {
					p.JSONLine(ep)
					return nil
				}
				p.Success("Created %s (%s)", ep.Name, ep.Slug)
				p.Println(ep.URL)
				return nil
			},
		},
		newEndpointDeleteCmd(opts),
		&cobra.Command{
			Use:   "open <slug>",
			Short: "Open an endpoint's inbox in the browser",
			Args:  cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				s, err := opts.authed()
				if err != nil {
					return err
				}
				ep, err := s.client.GetEndpoint(cmd.Context(), args[0])
				if err != nil {
					return err
				}
				org := s.orgSlug
				if org == "" {
					me, err := s.client.Me(cmd.Context())
					if err != nil {
						return err
					}
					org = me.Org.Slug
				}
				url := s.client.BaseURL + "/" + org + "/endpoints/" + ep.Slug
				p := opts.printer()
				if !openBrowser(url) {
					p.Println(url)
					return nil
				}
				p.Status("Opened %s", url)
				return nil
			},
		},
	)
	return cmd
}

func newEndpointDeleteCmd(opts *globalOptions) *cobra.Command {
	var yes bool
	cmd := &cobra.Command{
		Use:   "delete <slug>",
		Short: "Delete an endpoint with its captured requests",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			s, err := opts.authed()
			if err != nil {
				return err
			}
			ep, err := s.client.GetEndpoint(cmd.Context(), args[0])
			if err != nil {
				return err
			}
			p := opts.printer()
			if !yes {
				_, _ = fmt.Fprintf(cmd.ErrOrStderr(),
					"This deletes %s (%s) and every request it captured. Type the slug to confirm: ", ep.Name, ep.Slug)
				line, _ := bufio.NewReader(cmd.InOrStdin()).ReadString('\n')
				if strings.TrimSpace(line) != ep.Slug {
					return errors.New("not deleted: the slug did not match (use --yes in scripts)")
				}
			}
			if err := s.client.DeleteEndpoint(cmd.Context(), ep.ID); err != nil {
				return err
			}
			if opts.json {
				p.JSONLine(map[string]any{"deleted": ep.Slug})
				return nil
			}
			p.Success("Deleted %s", ep.Slug)
			return nil
		},
	}
	cmd.Flags().BoolVarP(&yes, "yes", "y", false, "skip the confirmation")
	return cmd
}
