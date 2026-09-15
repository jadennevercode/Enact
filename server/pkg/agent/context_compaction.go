package agent

import (
	"context"
	"fmt"
	"time"
)

func (c *codexClient) compactNative(ctx context.Context, threadID string, turnDone <-chan bool) (result Result) {
	start := time.Now()
	result = Result{SessionID: threadID, Status: "failed", MaintenanceStatus: "failed"}
	defer func() { result.DurationMs = time.Since(start).Milliseconds() }()
	_, err := c.request(ctx, "thread/compact/start", map[string]any{"threadId": threadID})
	if err != nil {
		result.Error = fmt.Sprintf("native compaction request failed: %v", err)
		if isCodexTransportError(err) || ctx.Err() != nil {
			result.MaintenanceStatus = "reconciliation_required"
		}
		return result
	}
	select {
	case <-c.compactionDone:
		result.Status = "completed"
		result.MaintenanceStatus = "succeeded"
	case <-turnDone:
		select {
		case <-c.compactionDone:
			result.Status = "completed"
			result.MaintenanceStatus = "succeeded"
		default:
			result.Error = c.getTurnError()
			if result.Error == "" {
				result.Error = "native compaction ended without completion evidence"
				result.MaintenanceStatus = "reconciliation_required"
			}
		}
	case <-ctx.Done():
		result.Error = ctx.Err().Error()
		result.MaintenanceStatus = "reconciliation_required"
	case <-c.processDone:
		result.Error = "native compaction process exited without completion evidence"
		result.MaintenanceStatus = "reconciliation_required"
	}
	return result
}
