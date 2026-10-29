package cmd

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/spf13/cobra"

	"github.com/kaanxsrd/hookline/cli/internal/buildinfo"
)

func newVersionCmd(opts *globalOptions) *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print the hookline version",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			info := buildinfo.Get()
			if opts.json {
				enc := json.NewEncoder(cmd.OutOrStdout())
				enc.SetIndent("", "  ")
				return enc.Encode(info)
			}

			details := []string{}
			if c := info.ShortCommit(); c != "" {
				details = append(details, c)
			}
			if info.Date != "" {
				details = append(details, info.Date)
			}
			line := "hookline " + info.Version
			if len(details) > 0 {
				line += " (" + strings.Join(details, ", ") + ")"
			}
			_, err := fmt.Fprintf(cmd.OutOrStdout(), "%s %s %s\n", line, info.GoVersion, info.Platform)
			return err
		},
	}
}
