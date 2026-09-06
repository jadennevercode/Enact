// Package ontologizer implements the `enact ontologizer` integration layer:
// provisioning of the external Ontologizer checkout on a daemon host, and the
// agent portfolio that runs governed ontology construction in a workspace.
//
// The package deliberately knows nothing about Enact server internals; it
// orchestrates external tools (git, the claude CLI, and the checkout's own
// scripts) so the Ontologizer package stays an independently updatable
// repository that owns its own skills, validators, and knowledge base.
package ontologizer

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

const (
	// DefaultRuntimeGitURL is the upstream Ontologizer repository, cloned when
	// setup finds no checkout and no --runtime-dir; --repo overrides it.
	DefaultRuntimeGitURL = "https://github.com/jadennevercode/Ontologizer-Skill.git"
	// DefaultRuntimeRef is the ref tracked when none is pinned explicitly.
	DefaultRuntimeRef = "main"

	// PluginSpec is the Claude Code plugin identity declared by the
	// checkout's .claude-plugin/{plugin,marketplace}.json manifests.
	PluginSpec = "ontologizer@ontologizer"
	// MarketplaceName is the marketplace entry re-pointed on every setup run.
	MarketplaceName = "ontologizer"

	// HomeEnvVar is exported into every portfolio agent's environment so a
	// skill can spell `$ONTOLOGIZER_HOME/scripts/state.py` without knowing
	// where the operator put the checkout.
	HomeEnvVar = "ONTOLOGIZER_HOME"
	// PythonEnvVar overrides the interpreter used for the checkout's scripts.
	PythonEnvVar = "ONTOLOGIZER_PYTHON"

	configFileName    = "ontologizer.yaml"
	managedRuntimeDir = "ontologizer"
)

// Config pins the Ontologizer checkout used by `enact ontologizer` commands.
// It is persisted at ~/.enact/ontologizer.yaml so setup re-runs and agent
// bootstrap agree on which checkout is authoritative.
type Config struct {
	RuntimeGitURL string `yaml:"runtime_git_url,omitempty"`
	RuntimeRef    string `yaml:"runtime_ref,omitempty"`
	RuntimeDir    string `yaml:"runtime_dir,omitempty"`
}

// ConfigPath returns the location of the persisted config.
func ConfigPath(home func() (string, error)) (string, error) {
	dir, err := home()
	if err != nil {
		return "", fmt.Errorf("resolve home directory: %w", err)
	}
	return filepath.Join(dir, ".enact", configFileName), nil
}

// ManagedRuntimePath returns the default clone destination used when no
// existing checkout is adopted (~/.enact/ontologizer).
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
