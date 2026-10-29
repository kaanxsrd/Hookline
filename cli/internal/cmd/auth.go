package cmd

import (
	"context"
	"errors"
	"fmt"
	"os"
	"regexp"
	"time"

	"github.com/spf13/cobra"

	"github.com/kaanxsrd/hookline/cli/internal/api"
	"github.com/kaanxsrd/hookline/cli/internal/config"
)

var unsafeClientName = regexp.MustCompile(`[^\w .@()-]`)

func clientName() string {
	host, err := os.Hostname()
	if err != nil || host == "" {
		return ""
	}
	name := unsafeClientName.ReplaceAllString(host, "")
	if len(name) > 64 {
		name = name[:64]
	}
	return name
}

func newLoginCmd(opts *globalOptions) *cobra.Command {
	var noBrowser bool
	cmd := &cobra.Command{
		Use:   "login",
		Short: "Sign in through the browser and store an API key",
		Long: "Opens the browser to approve this terminal, then stores an API key for the\n" +
			"organization you pick in " + configPathHint() + ".",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			p := opts.printer()
			client, cfg, err := opts.anonymousClient()
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			dc, err := client.StartLogin(ctx, clientName())
			if err != nil {
				return err
			}
			p.Println("Your one-time code: " + p.Bold(dc.UserCode))
			if !noBrowser && openBrowser(dc.VerificationURIComplete) {
				p.Status("Opened %s", dc.VerificationURIComplete)
			} else {
				p.Println("Open " + p.Info(dc.VerificationURIComplete) + " to approve this login.")
			}
			p.Status("Waiting for approval…")

			login, err := pollLogin(ctx, client, dc)
			if err != nil {
				return err
			}
			base := client.BaseURL
			if cfg.URL != "" && cfg.URL != base && len(cfg.Orgs) > 0 {
				p.Warn("Replacing logins for %s with %s", cfg.URL, base)
				cfg.Orgs = map[string]config.Profile{}
			}
			cfg.URL = base
			cfg.Orgs[login.Org.Slug] = config.Profile{
				APIKey: login.APIKey, KeyPrefix: login.KeyPrefix, OrgName: login.Org.Name, UserEmail: login.User.Email,
			}
			cfg.DefaultOrg = login.Org.Slug
			if err := cfg.Save(); err != nil {
				return fmt.Errorf("save credentials: %w", err)
			}
			if opts.json {
				p.JSONLine(map[string]any{"org": login.Org, "user": login.User, "key_prefix": login.KeyPrefix})
				return nil
			}
			p.Success("Logged in to %s (%s) as %s", login.Org.Name, login.Org.Slug, login.User.Email)
			return nil
		},
	}
	cmd.Flags().BoolVar(&noBrowser, "no-browser", false, "print the approval URL instead of opening a browser")
	return cmd
}

func pollLogin(ctx context.Context, client *api.Client, dc api.DeviceCode) (api.Login, error) {
	interval := time.Duration(max(dc.Interval, 1)) * time.Second
	deadline := time.Now().Add(time.Duration(dc.ExpiresIn) * time.Second)
	for {
		t := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			t.Stop()
			return api.Login{}, ctx.Err()
		case <-t.C:
		}
		login, err := client.PollLogin(ctx, dc.DeviceCode)
		switch {
		case err == nil:
			return login, nil
		case api.IsCode(err, "authorization_pending"):
		case api.IsCode(err, "slow_down"):
			interval += 5 * time.Second
		default:
			return api.Login{}, err
		}
		if time.Now().After(deadline) {
			return api.Login{}, errors.New("the code expired before it was approved: run `hookline login` again")
		}
	}
}

func configPathHint() string {
	if p, err := config.Path(); err == nil {
		return p
	}
	return "your config directory"
}

func newLogoutCmd(opts *globalOptions) *cobra.Command {
	return &cobra.Command{
		Use:   "logout",
		Short: "Revoke the stored API key and forget it",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			p := opts.printer()
			cfg, err := config.Load()
			if err != nil {
				return err
			}
			slug, _, err := cfg.Profile(opts.org)
			if err != nil {
				return err
			}
			s, err := opts.authed()
			if err != nil {
				return err
			}
			// A key that is already revoked is fine: the goal is to be logged out.
			if err := s.client.Logout(cmd.Context()); err != nil && !api.IsCode(err, "unauthorized") {
				return fmt.Errorf("revoke the API key: %w", err)
			}
			delete(cfg.Orgs, slug)
			if cfg.DefaultOrg == slug {
				cfg.DefaultOrg = ""
				for other := range cfg.Orgs {
					cfg.DefaultOrg = other
					break
				}
			}
			if err := cfg.Save(); err != nil {
				return err
			}
			p.Success("Logged out of %s; the API key is revoked", slug)
			return nil
		},
	}
}

func newWhoamiCmd(opts *globalOptions) *cobra.Command {
	return &cobra.Command{
		Use:   "whoami",
		Short: "Show the organization and API key in use",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			s, err := opts.authed()
			if err != nil {
				return err
			}
			me, err := s.client.Me(cmd.Context())
			if err != nil {
				return err
			}
			p := opts.printer()
			if opts.json {
				p.JSONLine(me)
				return nil
			}
			who := "an API key"
			if me.User != nil {
				who = me.User.Email
			}
			p.Println(fmt.Sprintf("%s in %s (%s, %s plan)", p.Bold(who), me.Org.Name, me.Org.Slug, me.Org.Plan))
			p.Println(fmt.Sprintf("Key %s… (%s) on %s", me.Key.Prefix, me.Key.Name, s.client.BaseURL))
			return nil
		},
	}
}
