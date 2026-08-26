package main

import "testing"

func TestMMMCommandRegistered(t *testing.T) {
	var found bool
	for _, c := range rootCmd.Commands() {
		if c.Name() == "mmm" {
			found = true
		}
	}
	if !found {
		t.Fatal("mmm command not registered on root")
	}

	setup, _, err := mmmCmd.Find([]string{"setup"})
	if err != nil || setup.Name() != "setup" {
		t.Fatalf("mmm setup subcommand not found: %v", err)
	}
	for _, flag := range []string{"runtime-dir", "ref", "repo", "skip-doctor"} {
		if setup.Flags().Lookup(flag) == nil {
			t.Errorf("mmm setup missing --%s flag", flag)
		}
	}

	importCmd, _, err := mmmCmd.Find([]string{"skill", "import"})
	if err != nil || importCmd.Name() != "import" {
		t.Fatalf("mmm skill import subcommand not found: %v", err)
	}
	if importCmd.Flags().Lookup("runtime-id") == nil {
		t.Error("mmm skill import missing --runtime-id flag")
	}
}
