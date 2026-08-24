package main

import (
	"fmt"

	"github.com/enact-ai/enact/server/internal/agentconfig"
)

func validateAgentMaxConcurrentTasksFlag(value int32) error {
	if err := agentconfig.ValidateMaxConcurrentTasks(value); err != nil {
		return fmt.Errorf(
			"--max-concurrent-tasks %w (got %d)",
			err,
			value,
		)
	}
	return nil
}
