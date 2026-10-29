package cmd

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/spf13/cobra"
	"go.yaml.in/yaml/v3"

	"github.com/kaanxsrd/hookline/cli/internal/api"
	"github.com/kaanxsrd/hookline/cli/internal/forward"
	"github.com/kaanxsrd/hookline/packages/protocol"
)

// editable is the YAML document `replay --edit` opens.
type editable struct {
	Method  string      `yaml:"method"`
	Path    string      `yaml:"path"`
	Query   string      `yaml:"query"`
	Headers [][2]string `yaml:"headers"`
	// Body is UTF-8 text; binary bodies use BodyB64 instead.
	Body    string `yaml:"body,omitempty"`
	BodyB64 string `yaml:"body_b64,omitempty"`
}

const editHeader = "# Edit the request, then save and close the editor to send it.\n" +
	"# Delete everything to cancel. Headers are [name, value] pairs.\n"

func toEditable(r api.Request) (editable, error) {
	e := editable{Method: r.Method, Path: r.Path, Headers: r.Headers}
	parts := make([]string, 0, len(r.Query))
	for _, q := range r.Query {
		parts = append(parts, url.QueryEscape(q[0])+"="+url.QueryEscape(q[1]))
	}
	e.Query = strings.Join(parts, "&")
	if r.BodyOmitted {
		return e, errors.New("the body is too large to edit; replay without --edit")
	}
	if r.BodyB64 != nil {
		body, err := base64.StdEncoding.DecodeString(*r.BodyB64)
		if err != nil {
			return e, err
		}
		if utf8.Valid(body) {
			e.Body = string(body)
		} else {
			e.BodyB64 = *r.BodyB64
		}
	}
	return e, nil
}

func (e editable) body() []byte {
	if e.BodyB64 != "" {
		b, _ := base64.StdEncoding.DecodeString(e.BodyB64)
		return b
	}
	return []byte(e.Body)
}

func editorCommand() []string {
	for _, v := range []string{"HOOKLINE_EDITOR", "VISUAL", "EDITOR"} {
		if e := strings.TrimSpace(os.Getenv(v)); e != "" {
			return strings.Fields(e)
		}
	}
	if runtime.GOOS == "windows" {
		return []string{"notepad"}
	}
	return []string{"vi"}
}

// editInEditor opens the request as YAML and returns the edited version, or
// nil when the user emptied the file.
func editInEditor(ctx context.Context, cmd *cobra.Command, e editable) (*editable, error) {
	doc, err := yaml.Marshal(e)
	if err != nil {
		return nil, err
	}
	dir, err := os.MkdirTemp("", "hookline-replay-")
	if err != nil {
		return nil, err
	}
	defer func() { _ = os.RemoveAll(dir) }()
	file := filepath.Join(dir, "request.yaml")
	if err := os.WriteFile(file, append([]byte(editHeader), doc...), 0o600); err != nil {
		return nil, err
	}
	argv := append(editorCommand(), file)
	c := exec.CommandContext(ctx, argv[0], argv[1:]...) //nolint:gosec // the user's own editor
	c.Stdin, c.Stdout, c.Stderr = cmd.InOrStdin(), cmd.OutOrStdout(), cmd.ErrOrStderr()
	if err := c.Run(); err != nil {
		return nil, fmt.Errorf("editor %s: %w", argv[0], err)
	}
	edited, err := os.ReadFile(file) //nolint:gosec // the file we just wrote
	if err != nil {
		return nil, err
	}
	trimmed := bytes.TrimSpace(edited)
	if len(trimmed) == 0 || string(trimmed) == strings.TrimSpace(editHeader) {
		return nil, nil
	}
	var out editable
	if err := yaml.Unmarshal(edited, &out); err != nil {
		return nil, fmt.Errorf("the edited request is not valid YAML: %w", err)
	}
	out.Method = strings.ToUpper(strings.TrimSpace(out.Method))
	if out.Method == "" || !strings.HasPrefix(out.Path, "/") {
		return nil, errors.New("the edited request needs a method and a path starting with /")
	}
	return &out, nil
}

func newReplayCmd(opts *globalOptions) *cobra.Command {
	var (
		to          string
		cli         bool
		destination string
		edit        bool
	)
	cmd := &cobra.Command{
		Use:   "replay <requestId>",
		Short: "Send a captured request again",
		Long: "Sends a captured request again: to any URL from this machine (--to), to the CLIs\n" +
			"listening on its endpoint (--cli), or to one of its destinations (--destination).\n" +
			"With --edit the request opens in $EDITOR as YAML first.",
		Example: "  hookline replay 0192f3a4-... --to http://localhost:3000/api/webhooks\n" +
			"  hookline replay 0192f3a4-... --cli --edit",
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			chosen := 0
			for _, set := range []bool{to != "", cli, destination != ""} {
				if set {
					chosen++
				}
			}
			if chosen != 1 {
				return errors.New("choose one target: --to URL, --cli or --destination ID")
			}
			s, err := opts.authed()
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			p := opts.printer()

			var original api.Request
			var edited *editable
			if edit || to != "" {
				if original, err = s.client.GetRequest(ctx, args[0]); err != nil {
					return err
				}
			}
			if edit {
				e, err := toEditable(original)
				if err != nil {
					return err
				}
				if edited, err = editInEditor(ctx, cmd, e); err != nil {
					return err
				}
				if edited == nil {
					p.Status("Cancelled: the file was empty")
					return nil
				}
			}

			if to != "" {
				return replayLocally(ctx, opts, original, edited, to)
			}
			var override *api.Override
			if edited != nil {
				b64 := base64.StdEncoding.EncodeToString(edited.body())
				override = &api.Override{Method: edited.Method, Path: edited.Path, Query: edited.Query, Headers: edited.Headers, BodyB64: &b64}
			}
			res, err := s.client.Replay(ctx, args[0], destination, override)
			if err != nil {
				return err
			}
			if opts.json {
				p.JSONLine(res)
				return nil
			}
			if res.Target == "cli" {
				p.Success("Sent to the CLIs listening on the endpoint")
			} else {
				p.Success("Queued delivery %s", res.DeliveryID)
			}
			return nil
		},
	}
	f := cmd.Flags()
	f.StringVar(&to, "to", "", "send the request to this URL from your machine")
	f.BoolVar(&cli, "cli", false, "send it to the CLIs listening on its endpoint")
	f.StringVar(&destination, "destination", "", "send it to this destination (ID)")
	f.BoolVar(&edit, "edit", false, "edit the request in $EDITOR before sending")
	return cmd
}

// replayLocally sends the request from this machine, like `listen` would.
func replayLocally(ctx context.Context, opts *globalOptions, r api.Request, edited *editable, target string) error {
	fwd, err := forward.New(target, nil, nil)
	if err != nil {
		return errors.New(strings.Replace(err.Error(), "--forward", "--to", 1))
	}
	// Like `listen`, the captured path below /h/{slug} is appended to the target.
	req := protocol.Request{ID: r.ID, Method: r.Method, Path: r.Path, Headers: r.Headers, ReceivedAt: r.ReceivedAt}
	parts := make([]string, 0, len(r.Query))
	for _, q := range r.Query {
		parts = append(parts, url.QueryEscape(q[0])+"="+url.QueryEscape(q[1]))
	}
	req.Query = strings.Join(parts, "&")
	if r.BodyB64 != nil {
		req.BodyB64 = *r.BodyB64
	}
	if edited != nil {
		req.Method, req.Path, req.Query, req.Headers = edited.Method, edited.Path, edited.Query, edited.Headers
		req.BodyB64 = base64.StdEncoding.EncodeToString(edited.body())
	} else if r.BodyOmitted {
		return errors.New("the body is too large to download; replay to a destination instead")
	}
	start := time.Now()
	resp, perr := fwd.Handle(ctx, req)
	p := opts.printer()
	if perr != nil {
		return errors.New(perr.Message)
	}
	p.Forwarded(r.Endpoint.Slug, protocol.Request{Method: req.Method, Path: req.Path, Query: req.Query, ReceivedAt: time.Now(), ReplayOf: r.ID, Headers: req.Headers, BodyB64: req.BodyB64}, resp, nil, time.Since(start))
	return nil
}
