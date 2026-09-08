package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/enact-ai/enact/server/internal/modeloperation"
	"github.com/enact-ai/enact/server/pkg/agent"
)

func (c *Client) claimModelOperation(ctx context.Context, runtimeID string) (*modeloperation.Operation, error) {
	var out struct {
		Operation *modeloperation.Operation `json:"operation"`
	}
	err := c.postJSON(ctx, fmt.Sprintf("/api/daemon/runtimes/%s/model-operations/claim", runtimeID), map[string]any{}, &out)
	return out.Operation, err
}

// modelOperationLoop owns a separate lane. It never acquires the parent task
// semaphore or repository lock, so MaxConcurrentTasks=1 cannot deadlock when a
// running task synchronously waits for a semantic extraction callback.
func (d *Daemon) modelOperationLoop(ctx context.Context) {
	slots := make(chan struct{}, 2)
	var running sync.WaitGroup
	defer running.Wait()
	ticker := time.NewTicker(1500 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		for _, runtimeID := range d.allRuntimeIDs() {
			rt := d.findRuntime(runtimeID)
			if rt == nil || (rt.Provider != "codex" && rt.Provider != "claude") {
				continue
			}
			select {
			case slots <- struct{}{}:
			default:
				continue
			}
			op, err := d.client.claimModelOperation(ctx, runtimeID)
			if err != nil || op == nil {
				<-slots
				continue
			}
			running.Add(1)
			go func(rt Runtime, op modeloperation.Operation) {
				defer running.Done()
				defer func() { <-slots }()
				d.runModelOperation(ctx, rt, op)
			}(*rt, *op)
		}
	}
}

func (d *Daemon) runModelOperation(ctx context.Context, rt Runtime, op modeloperation.Operation) {
	runCtx, cancel := context.WithTimeout(ctx, time.Duration(op.TimeoutSeconds)*time.Second)
	defer cancel()
	// Parent cancellation uses the existing daemon status contract. Failure to
	// check does not extend the bounded operation deadline.
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-runCtx.Done():
				return
			case <-ticker.C:
				status, err := d.client.GetTaskStatus(runCtx, op.TaskID)
				if (err == nil && status != "running") || isTaskNotFoundError(err) {
					cancel()
					return
				}
			}
		}
	}()
	var result agent.Result
	var err error
	entry, exists := d.agents()[rt.Provider]
	if _, custom := d.customProfileLaunchForRuntime(rt.ID); custom {
		err = fmt.Errorf("structured model operation requires a built-in Codex or Claude runtime")
	} else if !exists {
		err = fmt.Errorf("runtime executable unavailable")
	} else {
		entry, _ = d.resolveAgentEntry(runCtx, rt.Provider, entry)
		result, err = agent.ExecuteModelOperation(runCtx, rt.Provider, agent.Config{ExecutablePath: entry.Path, Logger: d.logger, TaskID: op.TaskID, RuntimeID: rt.ID}, op.Prompt, agent.ExecOptions{Model: op.Model, ResponseSchema: op.ResponseSchema, Timeout: time.Duration(op.TimeoutSeconds) * time.Second})
	}
	status := "completed"
	errorText := ""
	var output json.RawMessage
	if err != nil {
		status = "failed"
		errorText = err.Error()
	} else if result.Status != "completed" {
		status = "failed"
		errorText = result.Error
	} else {
		output = json.RawMessage(result.Output)
		if err = modeloperation.ValidateResult(op.ResponseSchema, output); err != nil {
			status = "failed"
			errorText = "structured output validation failed: " + err.Error()
			output = nil
		}
	}
	if runCtx.Err() != nil {
		status = "cancelled"
		errorText = runCtx.Err().Error()
		output = nil
	}
	// Retry only delivery of this completed result, never model execution. The
	// same lease makes a callback idempotent when its first response was lost.
	reportCtx, reportCancel := context.WithTimeout(context.WithoutCancel(ctx), 20*time.Second)
	defer reportCancel()
	err = d.client.postJSONWithRetry(reportCtx, fmt.Sprintf("/api/daemon/runtimes/%s/model-operations/%s/result", rt.ID, op.ID), map[string]any{"lease_token": op.LeaseToken, "status": status, "result": output, "usage": result.Usage, "error": errorText}, nil, []time.Duration{500 * time.Millisecond, time.Second, 2 * time.Second, 4 * time.Second, 4 * time.Second})
	if err != nil {
		d.logger.Warn("model operation result delivery failed", "operation_id", op.ID, "error", err)
	}
}
