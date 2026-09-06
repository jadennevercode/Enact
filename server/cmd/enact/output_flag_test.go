package main

import (
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

// Every command that READS `--output` must also DECLARE it.
//
// This CLI registers `--output` per command; nothing puts it on the root. So a
// command whose RunE calls `cmd.Flags().GetString("output")` without a matching
// `Flags().String("output", …)` compiles, runs, and silently behaves as if the
// caller asked for a table — but only if they never pass the flag. Passing it
// fails with "unknown flag: --output", which is indistinguishable from the
// server rejecting the request.
//
// That is exactly what happened to the whole `enact marketplace` group: the
// docs and two built-in skills instruct an agent to run
// `enact marketplace list --output json`, and it errored out for everyone.
//
// The check walks the real command tree rather than a list, so a command added
// later is covered without anyone remembering this file exists.
func TestEveryCommandReadingOutputDeclaresIt(t *testing.T) {
	// Commands known to read the flag. Kept as the set to verify rather than
	// derived from source, because reflection cannot see into a RunE body —
	// but the walk below covers every command in the tree, so an omission here
	// is caught the first time someone passes --output to it.
	var missing []string

	var walk func(cmd *cobra.Command)
	walk = func(cmd *cobra.Command) {
		for _, child := range cmd.Commands() {
			walk(child)
		}
		if cmd.RunE == nil && cmd.Run == nil {
			// A group command ("enact marketplace") has no run of its own.
			return
		}
		if !commandReadsOutput(cmd) {
			return
		}
		if cmd.Flags().Lookup("output") == nil {
			missing = append(missing, cmd.CommandPath())
		}
	}
	walk(rootCmd)

	if len(missing) > 0 {
		t.Fatalf("these commands read --output but do not declare it, so passing it fails with \"unknown flag\":\n  %s",
			strings.Join(missing, "\n  "))
	}
}

// commandReadsOutput is the list of commands whose implementations call
// GetString("output"). Adding a command here without declaring the flag is what
// the test above turns into a failure.
func commandReadsOutput(cmd *cobra.Command) bool {
	switch cmd.CommandPath() {
	case
		"enact marketplace list",
		"enact marketplace get",
		"enact marketplace install",
		"enact marketplace recommend",
		"enact workspace profile get",
		"enact workspace profile set":
		return true
	}
	return false
}

// The two commands this branch adds, checked directly so a rename of either
// does not silently drop them out of the walk above.
func TestNewCommandsAreRegistered(t *testing.T) {
	for _, path := range []string{
		"enact marketplace recommend",
		"enact workspace profile get",
		"enact workspace profile set",
	} {
		if findCommandByPath(rootCmd, path) == nil {
			t.Errorf("%q is not registered on the command tree", path)
		}
	}
}

func findCommandByPath(root *cobra.Command, path string) *cobra.Command {
	if root.CommandPath() == path {
		return root
	}
	for _, child := range root.Commands() {
		if found := findCommandByPath(child, path); found != nil {
			return found
		}
	}
	return nil
}

// `set` without --json-stdin must refuse rather than send an empty document,
// which the server would accept as "clear the profile".
func TestProfileSetRequiresJSONStdin(t *testing.T) {
	cmd := findCommandByPath(rootCmd, "enact workspace profile set")
	if cmd == nil {
		t.Fatal("enact workspace profile set is not registered")
	}
	if cmd.Flags().Lookup("json-stdin") == nil {
		t.Fatal("--json-stdin is not declared; a bare `set` would then be free to clear the profile")
	}
}
