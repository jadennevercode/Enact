package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/enact-ai/enact/server/internal/cli"
	"github.com/enact-ai/enact/server/pkg/contextstate"
	"github.com/spf13/cobra"
)

func init() {
	command := &cobra.Command{Use: "context", Short: "Inspect this task's versioned context and save a handoff"}
	get := &cobra.Command{Use: "get", Short: "Read the exact delivered issue context and source revision", Args: exactArgs(0), RunE: func(cmd *cobra.Command, args []string) error {
		client, err := newAPIClient(cmd)
		if err != nil {
			return err
		}
		ctx, cancel := cli.APIContext(context.Background())
		defer cancel()
		var result contextstate.Envelope
		if err = client.GetJSON(ctx, "/api/context/current", &result); err != nil {
			return err
		}
		return cli.PrintJSON(os.Stdout, result)
	}}
	save := &cobra.Command{Use: "checkpoint", Short: "Save summary, decisions, pending work, evidence and acknowledged input versions", Args: exactArgs(0), RunE: func(cmd *cobra.Command, args []string) error {
		content, ok, err := resolveTextFlag(cmd, "content")
		if err != nil {
			return err
		}
		if !ok {
			return fmt.Errorf("--content-file or --content-stdin is required")
		}
		var request contextstate.Checkpoint
		if err = json.Unmarshal([]byte(content), &request); err != nil {
			return err
		}
		client, err := newAPIClient(cmd)
		if err != nil {
			return err
		}
		ctx, cancel := cli.APIContext(context.Background())
		defer cancel()
		var result contextstate.Checkpoint
		if err = client.PostJSON(ctx, "/api/context/checkpoint", request, &result); err != nil {
			return err
		}
		return cli.PrintJSON(os.Stdout, result)
	}}
	save.Flags().String("content", "", "Checkpoint JSON")
	save.Flags().String("content-file", "", "Read checkpoint JSON from a file in the working directory")
	save.Flags().Bool("content-stdin", false, "Read checkpoint JSON from stdin")
	save.Flags().Bool("allow-external-file", false, "Allow a file outside the working directory")
	command.AddCommand(get, save)
	rootCmd.AddCommand(command)
}
