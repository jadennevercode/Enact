package handler

import "strings"

// teamRolePresetEntry is one role in an importable preset. Names are stored
// per locale because a preset is imported once and then owned by the
// workspace: the stored name is what everyone sees afterwards, so it should be
// written in the language of the admin who imported it.
type teamRolePresetEntry struct {
	Key   string
	Color string
	Names map[string][2]string // locale -> {name, description}
}

func (e teamRolePresetEntry) localized(locale string) (string, string) {
	normalized := strings.ToLower(strings.TrimSpace(locale))
	switch {
	case strings.HasPrefix(normalized, "zh"):
		normalized = "zh-hans"
	case strings.HasPrefix(normalized, "ja"):
		normalized = "ja"
	case strings.HasPrefix(normalized, "ko"):
		normalized = "ko"
	default:
		normalized = "en"
	}
	v := e.Names[normalized]
	return v[0], v[1]
}

// teamRolePresets are the importable role sets.
//
// "aisdlc" mirrors the AI-SDLC suite's controlled role vocabulary
// (builtin_sdlc/skills/sdlc-core/scripts/_common.py TEAM_ROLE_KEYS). The KEYS
// are the contract — the suite's phase_review config names them — so they must
// not change here without changing the suite in the same commit.
var teamRolePresets = map[string][]teamRolePresetEntry{
	"aisdlc": {
		{
			Key:   "business_owner",
			Color: "#8b5cf6",
			Names: map[string][2]string{
				"en":      {"Business owner", "Owns the business outcome and acceptance criteria"},
				"zh-hans": {"业务负责人", "对业务结果与验收标准负责"},
				"ja":      {"ビジネスオーナー", "ビジネス成果と受け入れ基準に責任を持つ"},
				"ko":      {"비즈니스 오너", "비즈니스 성과와 인수 기준을 책임집니다"},
			},
		},
		{
			Key:   "architect",
			Color: "#3b82f6",
			Names: map[string][2]string{
				"en":      {"Architect", "Owns the design, change boundaries and technical decisions"},
				"zh-hans": {"架构", "对方案、变更边界、技术决定负责"},
				"ja":      {"アーキテクト", "設計、変更範囲、技術的判断に責任を持つ"},
				"ko":      {"아키텍트", "설계, 변경 범위, 기술 결정을 책임집니다"},
			},
		},
		{
			Key:   "developer",
			Color: "#22c55e",
			Names: map[string][2]string{
				"en":      {"Developer", "Owns how the change is implemented"},
				"zh-hans": {"开发", "对实现方式负责"},
				"ja":      {"開発", "実装方法に責任を持つ"},
				"ko":      {"개발", "구현 방식을 책임집니다"},
			},
		},
		{
			Key:   "qa",
			Color: "#f59e0b",
			Names: map[string][2]string{
				"en":      {"QA", "Owns whether verification is sufficient"},
				"zh-hans": {"QA", "对验证充分性负责"},
				"ja":      {"QA", "検証が十分かどうかに責任を持つ"},
				"ko":      {"QA", "검증이 충분한지 책임집니다"},
			},
		},
		{
			Key:   "ops",
			Color: "#ef4444",
			Names: map[string][2]string{
				"en":      {"Ops", "Owns release, rollback and monitoring"},
				"zh-hans": {"运维", "对发布、回退、监控负责"},
				"ja":      {"運用", "リリース、ロールバック、監視に責任を持つ"},
				"ko":      {"운영", "릴리스, 롤백, 모니터링을 책임집니다"},
			},
		},
	},
}
