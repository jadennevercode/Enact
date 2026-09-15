package ontologizer

import (
	"encoding/json"
	"slices"
	"testing"
)

func TestReviewGateDependencies(t *testing.T) {
	previous, ok := PreviousReviewGate(ReviewGateOperations)
	if !ok || previous != ReviewGateModel {
		t.Fatalf("operations previous gate = %q, %v", previous, ok)
	}
	if got := ReviewGateAndDownstream(ReviewGateModel); !slices.Equal(got, []ReviewGate{ReviewGateModel, ReviewGateOperations, ReviewGateRelease}) {
		t.Fatalf("model downstream = %v", got)
	}
	if _, ok := PreviousReviewGate(ReviewGateScope); ok {
		t.Fatal("scope must not have a previous gate")
	}
}

func TestReviewPacketRequiresRealDecisionReference(t *testing.T) {
	packet := ReviewPacket{
		Title: "范围确认", Summary: "确认本轮范围", Proposal: json.RawMessage(`{}`),
		Groups: []ReviewPacketGroup{{Title: "边界", Items: []ReviewPacketItem{{Label: "范围", Value: "订单", Classification: "human_confirmation"}}}},
	}
	if err := ValidateReviewPacket(packet); err == nil {
		t.Fatal("human_confirmation without decision_id must fail")
	}
	packet.Groups[0].Items[0].DecisionID = "decision-1"
	if err := ValidateReviewPacket(packet); err != nil {
		t.Fatalf("valid packet rejected: %v", err)
	}
}

func TestReviewPacketLimitsReadableGroups(t *testing.T) {
	items := make([]ReviewPacketItem, 10)
	for index := range items {
		items[index] = ReviewPacketItem{Label: "对象", Value: "说明", Classification: "fact"}
	}
	packet := ReviewPacket{Title: "模型确认", Summary: "确认对象", Proposal: json.RawMessage(`{}`), Groups: []ReviewPacketGroup{{Title: "对象", Items: items}}}
	if err := ValidateReviewPacket(packet); err == nil {
		t.Fatal("ten-item group must be split")
	}
}
