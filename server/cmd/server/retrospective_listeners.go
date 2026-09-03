package main

import (
	"context"

	"github.com/enact-ai/enact/server/internal/events"
	"github.com/enact-ai/enact/server/internal/service"
	"github.com/enact-ai/enact/server/pkg/protocol"
)

// registerRetrospectiveListeners keeps a retrospective in step with the Lesson
// Learner run it launched.
//
// It listens to the same task lifecycle events the autopilot listener does, and
// for the same reason: the run finishes on the daemon's schedule, and a status
// that only updates when someone opens the page is a status that is wrong most
// of the time.
func registerRetrospectiveListeners(bus *events.Bus, svc *service.RetrospectiveService) {
	ctx := context.Background()

	for _, eventType := range []string{
		protocol.EventTaskRunning,
		protocol.EventTaskCompleted,
		protocol.EventTaskFailed,
		protocol.EventTaskCancelled,
	} {
		bus.Subscribe(eventType, func(e events.Event) {
			payload, ok := e.Payload.(map[string]any)
			if !ok {
				return
			}
			taskID, ok := payload["task_id"].(string)
			if !ok || taskID == "" {
				return
			}
			task, err := svc.Queries.GetAgentTask(ctx, parseUUID(taskID))
			if err != nil {
				return
			}
			svc.SyncFromTask(ctx, task)
		})
	}
}
