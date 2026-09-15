package daemon

import (
	"github.com/enact-ai/enact/server/internal/daemon/execenv"
	"github.com/enact-ai/enact/server/pkg/contextstate"
	"strings"
	"testing"
)

func TestContextCompletePromptRemovesInitialReadsAndPreservesTrigger(t *testing.T) {
	task := Task{FinalDeliveryContract: true, IssueID: "issue", TriggerCommentID: "trigger", TriggerCommentContent: "User constraint", ContextEnvelope: &contextstate.Envelope{Protocol: "v1", Complete: true, SourceRevision: "7"}}
	prompt := BuildPrompt(task, "codex")
	if strings.Contains(prompt, "Start by running") || strings.Contains(prompt, "--roots-only") {
		t.Fatal("complete prompt still requests duplicate initial reads")
	}
	if !strings.Contains(prompt, "User constraint") || !strings.Contains(prompt, "--final") || !strings.Contains(prompt, "source_revision") {
		t.Fatal("complete prompt lost input or delivery contract")
	}
	task.ContextEnvelope.Complete = false
	if !strings.Contains(BuildPrompt(task, "codex"), "Start by running") {
		t.Fatal("incomplete envelope suppressed recovery reads")
	}
}

func TestContextCompletePromptAndRuntimeBriefAgree(t *testing.T) {
	task := Task{IssueID: "issue", ContextEnvelope: &contextstate.Envelope{Protocol: "v1", Complete: true}}
	brief, err := execenv.InjectRuntimeConfig(t.TempDir(), "codex", execenv.TaskContextForEnv{IssueID: "issue", AgentID: "agent", AgentName: "Fixture"})
	if err != nil {
		t.Fatal(err)
	}
	combined := brief + BuildPrompt(task, "codex")
	if !strings.Contains(combined, "complete") || strings.Contains(combined, "Start by running") {
		t.Fatal("combined context lost completeness routing")
	}
	if !strings.Contains(combined, "in_review") || !strings.Contains(combined, "no-write") {
		t.Fatal("human review/status boundaries disappeared")
	}
}
