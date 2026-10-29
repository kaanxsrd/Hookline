// Command hookline is the Hookline CLI: tunnels, live tails, replays and
// endpoint management from the terminal.
package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/kaanxsrd/hookline/cli/internal/cmd"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	code := cmd.Execute(ctx, os.Args[1:], os.Stdout, os.Stderr)
	stop()
	os.Exit(code)
}
