// Package mmm implements the `enact mmm` integration layer: provisioning
// of the external mmm-runtime checkout on a daemon host and linking MMM
// engagement directories to Enact projects.
//
// The package deliberately knows nothing about Enact server internals; it
// orchestrates external tools (git, pip, npm, the claude CLI, and the
// runtime's own scripts) so the runtime stays an independently updatable
// repository.
package mmm

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

const (
	// DefaultRuntimeGitURL is the upstream mmm-runtime repository.
	DefaultRuntimeGitURL = "https://github.com/jadennevercode/AgenticMMM-Runtime"
	// DefaultRuntimeRef is the ref tracked when none is pinned explicitly.
	DefaultRuntimeRef = "main"

	// PluginSpec is the Claude Code plugin identity declared by the
	// runtime's .claude-plugin/{plugin,marketplace}.json manifests.
	PluginSpec = "mmm@mmm-runtime"

	configFileName    = "mmm.yaml"
	managedRuntimeDir = "mmm-runtime"
)

// Config pins the mmm-runtime checkout used by `enact mmm` commands. It is
// persisted at ~/.enact/mmm.yaml so setup re-runs and engagement commands
// agree on which checkout is authoritative.
type Config struct {
	RuntimeGitURL string `yaml:"runtime_git_url,omitempty"`
	RuntimeRef    string `yaml:"runtime_ref,omitempty"`
	RuntimeDir    string `yaml:"runtime_dir,omitempty"`
}

// ConfigPath returns the location of the persisted MMM config.
func ConfigPath(home func() (string, error)) (string, error) {
	dir, err := home()
	if err != nil {
		return "", fmt.Errorf("resolve home directory: %w", err)
	}
	return filepath.Join(dir, ".enact", configFileName), nil
}

// ManagedRuntimePath returns the default clone destination used when no
// existing checkout is adopted (~/.enact/mmm-runtime).
func ManagedRuntimePath(home func() (string, error)) (string, error) {
	dir, err := home()
	if err != nil {
		return "", fmt.Errorf("resolve home directory: %w", err)
	}
	return filepath.Join(dir, ".enact", managedRuntimeDir), nil
}

// LoadConfig reads the persisted config. A missing file is not an error and
// yields the zero Config.
func LoadConfig(home func() (string, error)) (Config, error) {
	path, err := ConfigPath(home)
	if err != nil {
		return Config{}, err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return Config{}, nil
	}
	if err != nil {
		return Config{}, fmt.Errorf("read %s: %w", path, err)
	}
	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return Config{}, fmt.Errorf("parse %s: %w", path, err)
	}
	return cfg, nil
}

// SaveConfig writes the config with private permissions, creating the
// ~/.enact directory when needed.
func SaveConfig(home func() (string, error), cfg Config) error {
	path, err := ConfigPath(home)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create config directory: %w", err)
	}
	data, err := yaml.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("encode config: %w", err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	return nil
}
