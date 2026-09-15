package ontologizer

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

type ReviewGate string

const (
	ReviewGateScope      ReviewGate = "scope"
	ReviewGateModel      ReviewGate = "model"
	ReviewGateOperations ReviewGate = "operations"
	ReviewGateRelease    ReviewGate = "release"
)

var ReviewGates = []ReviewGate{
	ReviewGateScope,
	ReviewGateModel,
	ReviewGateOperations,
	ReviewGateRelease,
}

type ReviewPacket struct {
	Title      string              `json:"title"`
	Summary    string              `json:"summary"`
	Groups     []ReviewPacketGroup `json:"groups"`
	Checks     []ReviewPacketCheck `json:"checks"`
	Unresolved []string            `json:"unresolved"`
	Proposal   json.RawMessage     `json:"proposal"`
}

type ReviewPacketGroup struct {
	Title string             `json:"title"`
	Items []ReviewPacketItem `json:"items"`
}

type ReviewPacketItem struct {
	Label          string   `json:"label"`
	Value          string   `json:"value"`
	Classification string   `json:"classification"`
	SourceRefs     []string `json:"source_refs,omitempty"`
	DecisionID     string   `json:"decision_id,omitempty"`
}

type ReviewPacketCheck struct {
	Label  string `json:"label"`
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
}

func ParseReviewGate(value string) (ReviewGate, bool) {
	gate := ReviewGate(value)
	for _, candidate := range ReviewGates {
		if candidate == gate {
			return gate, true
		}
	}
	return "", false
}

func PreviousReviewGate(gate ReviewGate) (ReviewGate, bool) {
	for index, candidate := range ReviewGates {
		if candidate == gate {
			if index == 0 {
				return "", false
			}
			return ReviewGates[index-1], true
		}
	}
	return "", false
}

func NextReviewGate(gate ReviewGate) (ReviewGate, bool) {
	for index, candidate := range ReviewGates {
		if candidate == gate {
			if index == len(ReviewGates)-1 {
				return "", false
			}
			return ReviewGates[index+1], true
		}
	}
	return "", false
}

func ReviewGateAndDownstream(gate ReviewGate) []ReviewGate {
	for index, candidate := range ReviewGates {
		if candidate == gate {
			return append([]ReviewGate(nil), ReviewGates[index:]...)
		}
	}
	return nil
}

func ValidateReviewPacket(packet ReviewPacket) error {
	if strings.TrimSpace(packet.Title) == "" || strings.TrimSpace(packet.Summary) == "" {
		return errors.New("review packet title and summary are required")
	}
	if len(packet.Groups) == 0 {
		return errors.New("review packet must contain at least one group")
	}
	for groupIndex, group := range packet.Groups {
		if strings.TrimSpace(group.Title) == "" || len(group.Items) == 0 || len(group.Items) > 9 {
			return fmt.Errorf("review packet group %d must have a title and between one and nine items", groupIndex+1)
		}
		for itemIndex, item := range group.Items {
			if strings.TrimSpace(item.Label) == "" || strings.TrimSpace(item.Value) == "" {
				return fmt.Errorf("review packet group %d item %d requires label and value", groupIndex+1, itemIndex+1)
			}
			switch item.Classification {
			case "fact", "recommendation", "unknown":
				if item.DecisionID != "" {
					return errors.New("only a human confirmation may reference a decision")
				}
			case "human_confirmation":
				if strings.TrimSpace(item.DecisionID) == "" {
					return errors.New("human confirmations must reference a recorded decision")
				}
			default:
				return errors.New("review packet item classification must be fact, recommendation, human_confirmation or unknown")
			}
		}
	}
	for _, check := range packet.Checks {
		if strings.TrimSpace(check.Label) == "" {
			return errors.New("review packet checks require labels")
		}
		switch check.Status {
		case "pass", "warning", "fail":
		default:
			return errors.New("review packet check status must be pass, warning or fail")
		}
	}
	if len(packet.Proposal) == 0 || string(packet.Proposal) == "null" || !json.Valid(packet.Proposal) {
		return errors.New("review packet proposal must be a JSON value")
	}
	return nil
}
