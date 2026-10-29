// Package config stores the CLI's credentials in
// os.UserConfigDir()/hookline/config.json (mode 0600). HOOKLINE_URL and
// HOOKLINE_API_KEY override it, for CI.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// Profile is one signed-in organization.
type Profile struct {
	APIKey    string `json:"api_key"`
	KeyPrefix string `json:"key_prefix"`
	OrgName   string `json:"org_name"`
	UserEmail string `json:"user_email,omitempty"`
}

// Config is the file's content.
type Config struct {
	// URL is the Hookline instance the profiles belong to.
	URL        string             `json:"url,omitempty"`
	DefaultOrg string             `json:"default_org,omitempty"`
	Orgs       map[string]Profile `json:"orgs,omitempty"`
}

// Dir is where the config lives; HOOKLINE_CONFIG_DIR overrides it (tests).
func Dir() (string, error) {
	if d := os.Getenv("HOOKLINE_CONFIG_DIR"); d != "" {
		return d, nil
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("find the config directory: %w", err)
	}
	return filepath.Join(base, "hookline"), nil
}

// Path is the config file.
func Path() (string, error) {
	d, err := Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(d, "config.json"), nil
}

// Load reads the config; a missing file is an empty config.
func Load() (*Config, error) {
	p, err := Path()
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(p) //nolint:gosec // the path is our own config file
	if errors.Is(err, fs.ErrNotExist) {
		return &Config{Orgs: map[string]Profile{}}, nil
	}
	if err != nil {
		return nil, err
	}
	var c Config
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, fmt.Errorf("%s is not valid JSON: %w", p, err)
	}
	if c.Orgs == nil {
		c.Orgs = map[string]Profile{}
	}
	return &c, nil
}

// Save writes the config with owner-only permissions.
func (c *Config) Save() error {
	p, err := Path()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, append(b, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

// Profile picks the organization: org if given, else the default, else the only one.
func (c *Config) Profile(org string) (string, Profile, error) {
	if org == "" {
		org = c.DefaultOrg
	}
	if org == "" && len(c.Orgs) == 1 {
		for slug := range c.Orgs {
			org = slug
		}
	}
	if org == "" {
		if len(c.Orgs) == 0 {
			return "", Profile{}, errors.New("not logged in: run `hookline login`")
		}
		return "", Profile{}, fmt.Errorf("several organizations are logged in (%s): pass --org", strings.Join(c.slugs(), ", "))
	}
	p, ok := c.Orgs[org]
	if !ok {
		return "", Profile{}, fmt.Errorf("not logged in to %q: run `hookline login`", org)
	}
	return org, p, nil
}

func (c *Config) slugs() []string {
	out := make([]string, 0, len(c.Orgs))
	for s := range c.Orgs {
		out = append(out, s)
	}
	slices.Sort(out)
	return out
}
