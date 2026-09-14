package agent

import (
	"context"
	"log/slog"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestContextCodexNativeCompactionRequiresCompletionAfterACK(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX fixture")
	}
	for _, tc := range []struct{ name, event, want string }{
		{"completion", `echo '{"method":"item/completed","params":{"threadId":"native","item":{"id":"compact-1","type":"contextCompaction"}}}'`, "succeeded"},
		{"ack-only", "", "reconciliation_required"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := writeFakeCodexAppServer(t, `read line
 echo '{"id":1,"result":{}}'
 read line
 read line
 echo '{"id":2,"result":{"thread":{"id":"native"}}}'
 echo '{"method":"thread/tokenUsage/updated","params":{"threadId":"native","tokenUsage":{"last":{"totalTokens":80000},"modelContextWindow":200000}}}'
 read line
 case "$line" in *thread/compact/start*) ;; *) exit 91;; esac
 echo '{"id":3,"result":{}}'
 `+tc.event+`
 sleep 1
 `)
			backend, err := New("codex", Config{ExecutablePath: path, BuiltinRuntime: true, Logger: slog.Default(), Env: map[string]string{"CODEX_HOME": t.TempDir()}})
			if err != nil {
				t.Fatal(err)
			}
			session, err := backend.(NativeCompactor).Compact(context.Background(), ExecOptions{Cwd: t.TempDir(), ResumeSessionID: "native", Timeout: 5 * time.Second})
			if err != nil {
				t.Fatal(err)
			}
			for range session.Messages {
			}
			result := <-session.Result
			if result.MaintenanceStatus != tc.want {
				t.Fatalf("want %s got %+v", tc.want, result)
			}
			if !result.CleanupConfirmed {
				t.Fatal("native process was not reaped")
			}
			if result.Context != nil {
				t.Fatal("resume telemetry masqueraded as a post-compaction reading")
			}
		})
	}
}
func TestContextClaudeCompactionBoundaryAndSkip(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX fixture")
	}
	for _, tc := range []struct{ name, boundary, result, want string }{
		{"boundary", `echo '{"type":"system","subtype":"compact_boundary","session_id":"native"}'`, "Compacted", "succeeded"},
		{"insufficient", "", "Not enough messages to compact", "skipped"},
		{"no-evidence", "", "Request accepted", "closed_unknown"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "claude")
			writeTestExecutable(t, path, []byte("#!/bin/sh\nread line\n"+tc.boundary+"\n"+`echo '{"type":"result","subtype":"success","is_error":false,"session_id":"native","result":"`+tc.result+`"}'`+"\n"))
			backend, err := New("claude", Config{ExecutablePath: path, BuiltinRuntime: true, Logger: slog.Default(), Env: map[string]string{"IS_SANDBOX": "1"}})
			if err != nil {
				t.Fatal(err)
			}
			session, err := backend.(NativeCompactor).Compact(context.Background(), ExecOptions{Cwd: t.TempDir(), ResumeSessionID: "native", Timeout: 5 * time.Second})
			if err != nil {
				t.Fatal(err)
			}
			for range session.Messages {
			}
			result := <-session.Result
			if result.MaintenanceStatus != tc.want || !result.CleanupConfirmed {
				t.Fatalf("want %s and cleanup, got %+v", tc.want, result)
			}
		})
	}
}
