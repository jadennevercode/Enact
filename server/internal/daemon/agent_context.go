package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/enact-ai/enact/server/internal/daemon/execenv"
	"github.com/enact-ai/enact/server/pkg/agent"
	"github.com/enact-ai/enact/server/pkg/contextstate"
	"github.com/google/uuid"
)

type contextRun struct {
	mu      sync.Mutex
	session contextstate.Session
	update  contextstate.Update
	dirty   bool
	stop    chan struct{}
	done    chan struct{}
	launch  *contextLaunch
	daemon  *Daemon
}

// The launch sidecar is daemon-private, like the provider home it references.
// It contains the exact scoped environment; it must never leave this host.
type contextLaunch struct {
	SessionID        string
	RuntimeID        string
	TaskID           string
	NativeID         string
	Provider         string
	EnvRoot          string
	Config           agent.Config
	Options          agent.ExecOptions
	Receipt          *contextMaintenanceReceipt
	ProcessID        int
	ProcessStarting  bool
	CleanupConfirmed bool
}

type contextMaintenanceReceipt struct {
	OperationID string
	Update      contextstate.Update
}

func (d *Daemon) contextPath(id string) string {
	return filepath.Join(d.cfg.WorkspacesRoot, ".context-sessions", id+".json")
}

func writeContextFile(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".context-*")
	if err != nil {
		return err
	}
	name := file.Name()
	defer os.Remove(name)
	if err = file.Chmod(0o600); err == nil {
		_, err = file.Write(raw)
	}
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(name, path)
}

// A custom profile probe must not change a built-in runtime's control gate.
// Use the version acknowledged for this workspace/runtime, not the shared
// provider probe cache (which can also contain custom-profile versions).
func (d *Daemon) contextRuntimeVersion(runtimeID string) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	rt, ok := d.runtimeIndex[runtimeID]
	if !ok || rt.ProfileID != "" {
		return ""
	}
	for _, ws := range d.workspaces {
		for _, id := range ws.runtimeIDs {
			if id == runtimeID {
				return ws.builtinVersions[rt.Provider]
			}
		}
	}
	return ""
}

func (d *Daemon) beginContextRun(ctx context.Context, task Task, rt Runtime) (*contextRun, error) {
	if task.ContextProtocol != "v1" || (task.IssueID == "" && task.ChatSessionID == "") {
		return nil, nil
	}
	req := contextstate.TurnRequest{ProducerID: uuid.NewString(), FinalDelivery: true, Provider: rt.Provider, Capabilities: agent.RuntimeContextCapabilities(rt.Provider, rt.ProfileID == "", d.contextRuntimeVersion(rt.ID))}
	var session contextstate.Session
	stopLease := d.startTaskPrepareLeaseExtender(ctx, task, d.logger)
	defer stopLease()
	for {
		err := d.client.postJSON(ctx, "/api/daemon/tasks/"+task.ID+"/context", req, &session)
		if err == nil {
			break
		}
		var httpErr *requestError
		if errors.As(err, &httpErr) && httpErr.StatusCode == http.StatusNotFound {
			return nil, err
		}
		if !errors.As(err, &httpErr) || httpErr.StatusCode != http.StatusLocked {
			return nil, err
		}
		// The maintenance worker is independent of normal task capacity. This
		// prevents a claimed task waiting here from starving its own compact.
		d.wakeContextMaintenance(ctx, rt.ID)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(time.Second):
		}
	}
	if session.ID == "" {
		return nil, nil
	}
	run := &contextRun{session: session, stop: make(chan struct{}), done: make(chan struct{}), daemon: d,
		update: contextstate.Update{LeaseToken: session.LeaseToken, Epoch: session.Epoch}}
	d.contextRuns.Store(task.ID, run)
	go run.loop(ctx)
	return run, nil
}

func (r *contextRun) observe(nativeID string, snapshot *agent.ContextSnapshot) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if nativeID == "" && snapshot == nil {
		return
	}
	if snapshot != nil {
		nativeID = snapshot.SessionID
	}
	if nativeID != "" && nativeID != r.update.NativeID {
		r.update.NativeID = nativeID
		r.update.Snapshot = nil
		if r.launch != nil {
			r.launch.NativeID = nativeID
			_ = writeContextFile(r.daemon.contextPath(r.session.ID), r.launch)
		}
	}
	if snapshot != nil {
		if r.update.FirstSnapshot == nil {
			r.update.FirstSnapshot = snapshot
		}
		r.update.Snapshot = snapshot
		if snapshot.UsedTokens != nil && *snapshot.UsedTokens > r.update.PeakTokens {
			r.update.PeakTokens = *snapshot.UsedTokens
		}
	}
	r.update.EventSeq++
	r.dirty = true
}

func (r *contextRun) loop(ctx context.Context) {
	defer close(r.done)
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	last := time.Now()
	for {
		select {
		case <-r.stop:
			return
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.mu.Lock()
			dirty := r.dirty
			r.mu.Unlock()
			if dirty || time.Since(last) >= 20*time.Second {
				r.flush(false)
				last = time.Now()
			}
		}
	}
}

func (r *contextRun) flush(release bool) {
	r.mu.Lock()
	update := r.update
	dirty := r.dirty
	r.dirty = false
	r.mu.Unlock()
	if !dirty && !release {
		update.Snapshot = nil
		update.NativeID = ""
	}
	update.Release = release
	path := r.daemon.contextPath(r.session.ID) + ".pending"
	if release {
		if err := writeContextFile(path, update); err != nil {
			r.daemon.logger.Warn("persist context tail failed", "error", err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var result contextstate.Session
	err := r.daemon.client.postJSON(ctx, "/api/daemon/context-sessions/"+r.session.ID, update, &result)
	if err != nil {
		r.mu.Lock()
		r.dirty = true
		r.mu.Unlock()
		r.daemon.logger.Debug("context update pending", "session_id", r.session.ID, "error", err)
		return
	}
	if release {
		_ = os.Remove(path)
	}
}

func (d *Daemon) finishContextRun(taskID string, run *contextRun) {
	close(run.stop)
	<-run.done
	run.flush(true)
	d.contextRuns.Delete(taskID)
	d.wakeContextMaintenance(d.rootCtx, run.session.RuntimeID)
}

func (d *Daemon) observeContext(taskID, nativeID string, snapshot *agent.ContextSnapshot) {
	if value, ok := d.contextRuns.Load(taskID); ok {
		value.(*contextRun).observe(nativeID, snapshot)
	}
}

func (d *Daemon) saveContextLaunch(taskID, provider, envRoot string, cfg agent.Config, opts agent.ExecOptions) {
	value, ok := d.contextRuns.Load(taskID)
	if !ok {
		return
	}
	run := value.(*contextRun)
	if !run.session.Capabilities.NativeCompact {
		return
	}
	cfg.Logger = nil
	// Business credentials are deliberately absent from maintenance. Native
	// provider credentials remain scoped to the same private provider home.
	env := make(map[string]string, len(cfg.Env))
	for key, value := range cfg.Env {
		if !strings.HasPrefix(key, "ENACT_") {
			env[key] = value
		}
	}
	cfg.Env = env
	opts.SystemPrompt = ""
	run.mu.Lock()
	defer run.mu.Unlock()
	nativeID := run.update.NativeID
	if nativeID == "" {
		nativeID = opts.ResumeSessionID
	}
	run.launch = &contextLaunch{SessionID: run.session.ID, RuntimeID: run.session.RuntimeID, TaskID: taskID,
		NativeID: nativeID, Provider: provider, EnvRoot: envRoot, Config: cfg, Options: opts, ProcessStarting: true}
	if err := writeContextFile(d.contextPath(run.session.ID), run.launch); err != nil {
		d.logger.Warn("save native maintenance launch failed", "session_id", run.session.ID, "error", err)
	}
}

func (d *Daemon) contextProcessStarted(taskID string) func(int) error {
	value, ok := d.contextRuns.Load(taskID)
	if !ok {
		return nil
	}
	run := value.(*contextRun)
	return func(pid int) error {
		run.mu.Lock()
		defer run.mu.Unlock()
		if run.launch == nil {
			return nil
		}
		run.launch.ProcessID = pid
		run.launch.ProcessStarting = false
		return writeContextFile(d.contextPath(run.session.ID), run.launch)
	}
}

func (d *Daemon) replayContextTails(ctx context.Context) {
	paths, _ := filepath.Glob(filepath.Join(d.cfg.WorkspacesRoot, ".context-sessions", "*.json.pending"))
	for _, path := range paths {
		var update contextstate.Update
		raw, err := os.ReadFile(path)
		if err != nil || json.Unmarshal(raw, &update) != nil {
			continue
		}
		id := strings.TrimSuffix(filepath.Base(path), ".json.pending")
		var result contextstate.Session
		err = d.client.postJSON(ctx, "/api/daemon/context-sessions/"+id, update, &result)
		var requestErr *requestError
		if err == nil || (errors.As(err, &requestErr) && (requestErr.StatusCode == 409 || requestErr.StatusCode == 404)) {
			_ = os.Remove(path)
		}
	}
}

func (d *Daemon) wakeContextMaintenance(ctx context.Context, runtimeID string) {
	if d.rootCtx != nil {
		ctx = d.rootCtx
	}
	if ctx == nil || ctx.Err() != nil {
		return
	}
	rt := d.findRuntime(runtimeID)
	if rt == nil {
		return
	}
	if !agent.RuntimeContextCapabilities(rt.Provider, rt.ProfileID == "", d.contextRuntimeVersion(rt.ID)).NativeCompact {
		// Recovery can still drain receipts after a version becomes unavailable.
		sidecars, _ := filepath.Glob(filepath.Join(d.cfg.WorkspacesRoot, ".context-sessions", "*.json*"))
		if len(sidecars) == 0 {
			return
		}
	}
	if _, loaded := d.contextMaintenance.LoadOrStore(runtimeID, true); loaded {
		return
	}
	go func() {
		defer d.contextMaintenance.Delete(runtimeID)
		d.runContextMaintenance(ctx, runtimeID)
	}()
}

func (d *Daemon) runContextMaintenance(parent context.Context, runtimeID string) {
	ctx, cancel := context.WithTimeout(parent, 10*time.Minute)
	defer cancel()
	d.replayContextTails(ctx)
	var session contextstate.Session
	if err := d.client.postJSON(ctx, "/api/daemon/runtimes/"+runtimeID+"/context-maintenance/claim", nil, &session); err != nil || session.ID == "" {
		return
	}
	update := contextstate.Update{LeaseToken: session.LeaseToken, Epoch: session.Epoch, EventSeq: 1}
	stop := make(chan struct{})
	renewed := make(chan struct{})
	go func() {
		defer close(renewed)
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				heartbeat := contextstate.Update{LeaseToken: session.LeaseToken, Epoch: session.Epoch}
				var response contextstate.Session
				if err := d.client.postJSON(ctx, "/api/daemon/context-sessions/"+session.ID, heartbeat, &response); err != nil {
					cancel()
					return
				}
			}
		}
	}()
	defer func() { close(stop); <-renewed }()
	path := d.contextPath(session.ID)
	raw, err := os.ReadFile(path)
	var launch contextLaunch
	if err == nil {
		err = json.Unmarshal(raw, &launch)
	}
	if err == nil && (launch.SessionID != session.ID || launch.RuntimeID != session.RuntimeID ||
		launch.NativeID != session.NativeID || launch.TaskID != session.TaskID) {
		err = fmt.Errorf("native session launch identity changed")
	}
	if err != nil {
		update.Status = "reconciliation_required"
		update.Reason = "native session launch is unavailable; process ownership cannot be confirmed"
		d.reportContextMaintenance(session, update, nil)
		return
	}
	root, err := os.OpenRoot(d.cfg.WorkspacesRoot)
	if err != nil {
		update.Status = "failed"
		update.Reason = "session root is unavailable"
		d.reportContextMaintenance(session, update, &launch)
		return
	}
	defer root.Close()
	rel, err := filepath.Rel(d.cfg.WorkspacesRoot, launch.EnvRoot)
	if err != nil || !filepath.IsLocal(rel) {
		update.Status = "failed"
		update.Reason = "session root is outside the managed workspace"
		d.reportContextMaintenance(session, update, &launch)
		return
	}
	var claim *execenv.EnvRootClaim
	for {
		claim, _, err = execenv.LockEnvRootForReuse(root, rel, launch.EnvRoot)
		if !errors.Is(err, execenv.ErrEnvRootBusy) {
			break
		}
		select {
		case <-ctx.Done():
			err = ctx.Err()
		case <-time.After(time.Second):
			continue
		}
		break
	}
	if err != nil || claim == nil {
		update.Status = "reconciliation_required"
		update.Reason = "session is still locked or unavailable"
		d.reportContextMaintenance(session, update, &launch)
		return
	}
	defer claim.Release()
	d.markActiveEnvRoot(launch.EnvRoot)
	defer d.unmarkActiveEnvRoot(launch.EnvRoot)
	if d.localPathLocks != nil {
		release, lockErr := d.localPathLocks.Acquire(ctx, launch.Options.Cwd, session.Operation.ID, nil)
		if lockErr != nil {
			update.Status = "failed"
			update.Reason = "session directory is busy"
			d.reportContextMaintenance(session, update, &launch)
			return
		}
		defer release()
	}
	if !launch.CleanupConfirmed && (launch.ProcessStarting || !agent.NativeProcessGroupGone(launch.ProcessID)) {
		update.Status = "reconciliation_required"
		update.Reason = "waiting for confirmation that the previous native process has exited"
		d.reportContextMaintenance(session, update, &launch)
		return
	}

	if session.Operation.Status == "reconciliation_required" {
		if launch.Receipt != nil && launch.Receipt.OperationID == session.Operation.ID && contextstate.Terminal(launch.Receipt.Update.Status) {
			update = launch.Receipt.Update
			update.LeaseToken = session.LeaseToken
			update.Epoch = session.Epoch
		} else {
			update.Status = "closed_unknown"
			update.Reason = "previous maintenance result could not be confirmed"
		}
		d.reportContextMaintenance(session, update, &launch)
		return
	}
	if session.Capabilities.RuntimeVersion != d.contextRuntimeVersion(session.RuntimeID) {
		update.Status = "stale_target"
		update.Reason = "runtime version changed; start a normal turn before requesting maintenance"
		d.reportContextMaintenance(session, update, &launch)
		return
	}
	launch.Config.Logger = d.logger
	backend, err := agent.ResolveBackend(launch.Provider, launch.Config)
	if err != nil {
		update.Status = "failed"
		update.Reason = "native runtime unavailable"
		d.reportContextMaintenance(session, update, &launch)
		return
	}
	compactor, ok := backend.(agent.NativeCompactor)
	if !ok {
		update.Status = "failed"
		update.Reason = "native compaction unsupported"
		d.reportContextMaintenance(session, update, &launch)
		return
	}
	opts := launch.Options
	opts.ResumeSessionID = session.NativeID
	opts.Timeout = 8 * time.Minute
	launch.ProcessStarting = true
	launch.ProcessID = 0
	launch.CleanupConfirmed = false
	launch.Receipt = nil
	if err := writeContextFile(path, &launch); err != nil {
		update.Status = "failed"
		update.Reason = "could not persist maintenance launch"
		d.reportContextMaintenance(session, update, nil)
		return
	}
	opts.ProcessStarted = func(pid int) error {
		launch.ProcessID = pid
		launch.ProcessStarting = false
		return writeContextFile(path, &launch)
	}
	native, err := compactor.Compact(ctx, opts)
	if err != nil {
		launch.CleanupConfirmed = launch.ProcessID == 0 || agent.NativeProcessGroupGone(launch.ProcessID)
		update.Status = "failed"
		if !launch.CleanupConfirmed {
			update.Status = "reconciliation_required"
		}
		update.Reason = "could not start native compaction"
		d.reportContextMaintenance(session, update, &launch)
		return
	}
	// Drain through channel closure before releasing any lock. Provider
	// adapters close Messages only after process cleanup has completed.
	for msg := range native.Messages {
		if msg.Context != nil {
			update.Snapshot = msg.Context
			update.EventSeq++
		}
	}
	result := <-native.Result
	update.Status = result.MaintenanceStatus
	if update.Status == "" {
		update.Status = "failed"
	}
	update.Reason = result.Error
	update.Usage = result.Usage
	update.DurationMs = &result.DurationMs
	// The result contains only post-compaction telemetry; resume snapshots
	// observed above must not masquerade as a refreshed context.
	update.Snapshot = result.Context
	launch.CleanupConfirmed = result.CleanupConfirmed || agent.NativeProcessGroupGone(launch.ProcessID)
	if !launch.CleanupConfirmed {
		update.Status = "reconciliation_required"
		update.Reason = "native process cleanup is not confirmed"
	} else if update.Status == "reconciliation_required" {
		update.Status = "closed_unknown"
	}
	d.reportContextMaintenance(session, update, &launch)
}

func (d *Daemon) reportContextMaintenance(session contextstate.Session, update contextstate.Update, launch *contextLaunch) {
	if contextstate.Terminal(update.Status) && launch != nil && !launch.CleanupConfirmed && (launch.ProcessStarting || !agent.NativeProcessGroupGone(launch.ProcessID)) {
		update.Status = "reconciliation_required"
		update.Reason = "native process exit is not confirmed"
	}
	update.Release = contextstate.Terminal(update.Status)
	if launch != nil {
		launch.Config.Logger = nil
		launch.Receipt = &contextMaintenanceReceipt{OperationID: session.Operation.ID, Update: update}
		if err := writeContextFile(d.contextPath(session.ID), launch); err != nil {
			d.logger.Error("persist native maintenance result failed", "operation_id", session.Operation.ID, "error", err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var result contextstate.Session
	if err := d.client.postJSON(ctx, "/api/daemon/context-sessions/"+session.ID, update, &result); err != nil {
		d.logger.Warn("native maintenance result awaiting reconciliation", "operation_id", session.Operation.ID, "error", err)
	}
}
