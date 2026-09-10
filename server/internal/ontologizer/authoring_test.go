package ontologizer

import "testing"

func TestAgentCannotPersistHumanInterviewAnswer(t *testing.T) {
	state := InterviewState{Status: "collecting", Round: 1, Questions: []InterviewQuestion{{Key: "q1", Topic: "boundary", Prompt: "覆盖退款吗？", Why: "这会改变范围", Answer: "覆盖"}}}
	if err := ValidateInterviewProposal(state); err == nil {
		t.Fatal("agent-authored human answer must fail")
	}
}

func TestInterviewProposalCapsQuestions(t *testing.T) {
	state := InterviewState{Status: "collecting", Round: 1}
	for index := 0; index < 6; index++ {
		state.Questions = append(state.Questions, InterviewQuestion{Key: string(rune('a' + index)), Topic: "boundary", Prompt: "问题", Why: "改变范围"})
	}
	if err := ValidateInterviewProposal(state); err == nil {
		t.Fatal("six questions must fail")
	}
}

func TestAgentCannotConfirmCandidateCard(t *testing.T) {
	cards := []CandidateCard{{Key: "order", Kind: "entity", Label: "订单", Description: "客户提交的购买请求", Classification: "human_confirmation", Status: "confirmed"}}
	if err := ValidateCandidateCardProposal(cards); err == nil {
		t.Fatal("agent-confirmed card must fail")
	}
}
