// Package cmd defines the hookline command tree.
package cmd

import (
	"context"
	"io"

	"github.com/spf13/cobra"
)

// globalOptions holds flags shared by every command.
type globalOptions struct {
	json bool
}

// NewRoot builds the root command. Output goes to stdout and stderr so tests
// can capture it.
func NewRoot(stdout, stderr io.Writer) *cobra.Command {
	opts := &globalOptions{}
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
	root.PersistentFlags().BoolVar(&opts.json, "json", false, "print machine-readable JSON")

	root.AddCommand(newVersionCmd(opts))
	return root
}

// Execute runs the CLI with args and returns the process exit code.
func Execute(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	root := NewRoot(stdout, stderr)
	root.SetArgs(args)
	if err := root.ExecuteContext(ctx); err != nil {
		_, _ = io.WriteString(stderr, "Error: "+err.Error()+"\n")
		return 1
	}
	return 0
}
