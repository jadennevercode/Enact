package handler

import (
	"encoding/json"
	"strings"

	"github.com/enact-ai/enact/server/internal/semantic"
)

type semanticReleaseInstallTestDataSummary struct {
	Included         bool           `json:"included"`
	Digest           string         `json:"digest,omitempty"`
	Format           string         `json:"format,omitempty"`
	ContentBytes     int            `json:"content_bytes,omitempty"`
	SubjectCount     int            `json:"subject_count,omitempty"`
	TypedTargetCount int            `json:"typed_target_count,omitempty"`
	Classification   map[string]any `json:"classification,omitempty"`
	Warning          string         `json:"warning,omitempty"`
}

func semanticReleaseInstallSelectTestData(source semanticPublishedRelease, input semanticReleaseInstallInput) (json.RawMessage, semanticReleaseInstallTestDataSummary, error) {
	if !input.IncludeTestData {
		return json.RawMessage(`{}`), semanticReleaseInstallTestDataSummary{Included: false}, nil
	}

	testDataDigest := semantic.Digest(semanticCanonicalJSONValue(source.TestData))
	if strings.TrimSpace(input.ExpectedTestDataDigest) != testDataDigest {
		return nil, semanticReleaseInstallTestDataSummary{}, semanticInstallConflict("source release test data digest changed; preview again")
	}

	var fixture struct {
		Format  string         `json:"format"`
		Content string         `json:"content"`
		Facts   map[string]any `json:"facts"`
	}
	var fixtureDocument map[string]any
	if json.Unmarshal(source.TestData, &fixture) != nil || json.Unmarshal(source.TestData, &fixtureDocument) != nil ||
		len(fixtureDocument) != 3 || fixture.Format != "turtle" || fixture.Content == "" {
		return nil, semanticReleaseInstallTestDataSummary{}, semanticInstallConflict("source release test data is not a supported synthetic Turtle fixture")
	}
	fixtureKind, _ := fixture.Facts["fixture_kind"].(string)
	liveBusinessData, liveBusinessDataIsBool := fixture.Facts["live_business_data"].(bool)
	if len(fixture.Facts) != 2 || fixtureKind != "synthetic_positive_schema_coverage" || !liveBusinessDataIsBool || liveBusinessData {
		return nil, semanticReleaseInstallTestDataSummary{}, semanticInstallConflict("source release test data is not classified as synthetic-only")
	}
	for _, line := range strings.Split(fixture.Content, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "@prefix ") {
			if !strings.HasSuffix(line, " .") || strings.Count(line, " .") != 1 {
				return nil, semanticReleaseInstallTestDataSummary{}, semanticInstallConflict("synthetic fixture contains an invalid Turtle prefix declaration")
			}
			continue
		}
		if !strings.HasPrefix(line, "<urn:fixture:") {
			return nil, semanticReleaseInstallTestDataSummary{}, semanticInstallConflict("synthetic fixture contains a non-fixture RDF subject")
		}
	}

	var sourceValidation struct {
		Valid    bool `json:"valid"`
		Conforms bool `json:"conforms"`
		Coverage struct {
			TargetCount       int `json:"target_count"`
			CoveredTargets    int `json:"covered_targets"`
			TargetedInstances int `json:"targeted_instances"`
		} `json:"coverage"`
	}
	if json.Unmarshal(source.Validation, &sourceValidation) != nil || !sourceValidation.Valid || !sourceValidation.Conforms ||
		sourceValidation.Coverage.TargetCount < 1 ||
		sourceValidation.Coverage.CoveredTargets != sourceValidation.Coverage.TargetCount ||
		sourceValidation.Coverage.TargetedInstances < sourceValidation.Coverage.TargetCount {
		return nil, semanticReleaseInstallTestDataSummary{}, semanticInstallConflict("source release synthetic fixture does not retain full validation coverage")
	}

	return append(json.RawMessage(nil), source.TestData...), semanticReleaseInstallTestDataSummary{
		Included: true, Digest: testDataDigest, Format: fixture.Format, ContentBytes: len([]byte(fixture.Content)),
		SubjectCount: sourceValidation.Coverage.TargetedInstances, TypedTargetCount: sourceValidation.Coverage.CoveredTargets,
		Classification: map[string]any{"fixture_kind": fixtureKind, "live_business_data": false},
		Warning:        "synthetic validation fixtures will be copied into the target ontology and release; no live business data is included",
	}, nil
}
