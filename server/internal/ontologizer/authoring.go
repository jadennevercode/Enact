package ontologizer

import (
	"errors"
	"strings"
)

type InterviewState struct {
	Scope     map[string]any      `json:"scope,omitempty"`
	Status    string              `json:"status"`
	Round     int                 `json:"round"`
	Questions []InterviewQuestion `json:"questions"`
}

type InterviewQuestion struct {
	Key        string `json:"key"`
	Topic      string `json:"topic"`
	Prompt     string `json:"prompt"`
	Why        string `json:"why"`
	Status     string `json:"status"`
	Answer     string `json:"answer,omitempty"`
	AnswerKind string `json:"answer_kind,omitempty"`
	AnsweredBy string `json:"answered_by,omitempty"`
	DecisionID string `json:"decision_id,omitempty"`
}

type CandidateCard struct {
	Key            string   `json:"key"`
	Kind           string   `json:"kind"`
	Label          string   `json:"label"`
	Description    string   `json:"description"`
	Classification string   `json:"classification"`
	SourceRefs     []string `json:"source_refs,omitempty"`
	Status         string   `json:"status"`
	Rationale      string   `json:"rationale,omitempty"`
	DecidedBy      string   `json:"decided_by,omitempty"`
	DecisionID     string   `json:"decision_id,omitempty"`
}

func ValidateInterviewProposal(state InterviewState) error {
	if state.Round < 0 || len(state.Questions) > 5 {
		return errors.New("an interview proposal may contain at most five unanswered questions")
	}
	switch state.Status {
	case "collecting", "ready":
	default:
		return errors.New("interview status must be collecting or ready")
	}
	seen := map[string]bool{}
	for _, question := range state.Questions {
		if strings.TrimSpace(question.Key) == "" || strings.TrimSpace(question.Prompt) == "" || strings.TrimSpace(question.Why) == "" {
			return errors.New("interview questions require key, prompt and why")
		}
		if seen[question.Key] {
			return errors.New("interview question keys must be unique")
		}
		seen[question.Key] = true
		switch question.Topic {
		case "goal", "boundary", "decisions", "objects", "process", "exceptions", "terminology", "granularity":
		default:
			return errors.New("interview question has an invalid topic")
		}
		if question.Answer != "" || question.AnswerKind != "" || question.AnsweredBy != "" || question.DecisionID != "" {
			return errors.New("agents cannot write human interview answers")
		}
		if question.Status != "" && question.Status != "unanswered" {
			return errors.New("agents may only propose unanswered questions")
		}
	}
	return nil
}

func ValidateCandidateCardProposal(cards []CandidateCard) error {
	seen := map[string]bool{}
	for _, card := range cards {
		if strings.TrimSpace(card.Key) == "" || strings.TrimSpace(card.Label) == "" || strings.TrimSpace(card.Description) == "" {
			return errors.New("candidate cards require key, label and description")
		}
		if seen[card.Key] {
			return errors.New("candidate card keys must be unique")
		}
		seen[card.Key] = true
		switch card.Kind {
		case "entity", "attribute", "relationship", "action", "policy", "data_binding", "action_binding":
		default:
			return errors.New("candidate card kind must be an ontology element or binding")
		}
		switch card.Classification {
		case "fact":
			if len(card.SourceRefs) == 0 {
				return errors.New("fact cards require source references")
			}
		case "recommendation", "unknown":
		default:
			return errors.New("agents may classify cards only as fact, recommendation or unknown")
		}
		if card.Status != "" && card.Status != "proposed" || card.Rationale != "" || card.DecidedBy != "" || card.DecisionID != "" {
			return errors.New("agents cannot decide candidate cards")
		}
	}
	return nil
}
