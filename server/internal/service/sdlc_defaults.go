package service

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"path"
	"strings"

	"github.com/enact-ai/enact/server/internal/skillversion"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"gopkg.in/yaml.v3"
)

// SDLCDefaultsVersion is persisted per workspace after the product-owned
// bundle has been provisioned. Bump it whenever an existing deployment must
// re-apply changed skill files or portfolio metadata.
const SDLCDefaultsVersion int32 = 2

const (
	sdlcSkillsRoot       = "builtin_sdlc/skills"
	SDLCSquadSystemKey   = "sdlc:delivery"
	SDLCSquadDefaultName = "AI-SDLC Delivery"
)

// Include underscore-prefixed Python modules such as _common.py and
// __init__.py; the default embed pattern intentionally skips them.
//
//go:embed all:builtin_sdlc/skills
var sdlcSkillsFS embed.FS

type SDLCAgentSpec struct {
	SystemKey    string
	Name         string
	Description  string
	AvatarURL    string
	Instructions string
	SkillNames   []string
	SquadRole    string
}

type SDLCSquadSpec struct {
	SystemKey    string
	Name         string
	Description  string
	Instructions string
	LeaderKey    string
}

var sdlcDefaultAgents = []SDLCAgentSpec{
	{
		SystemKey:    "sdlc:intake",
		Name:         "SDLC Intake",
		Description:  "登记新工作、读取状态与度量；不做跨 Work Item 判断。",
		AvatarURL:    "emoji:🐵",
		Instructions: "使用 sdlc-intake 登记、报账与度量；只读出账本事实，不排序、不验收、不关闭 Work Item。回答流程路由或最小输入问题时严格依据 Skill：新需求首先由 sdlc-intake 接管，实际登记的两个最小输入是 objective（要改变的可观察结果）与具名 owner；项目上下文缺失时停止实际登记并请求补充，不猜测。只有 .sdlc/config.yaml 中具名 approver 的明确人工批准才算批准；绝不把 Agent、workspace owner、沉默或状态变化自动视为批准。",
		SkillNames:   []string{"sdlc-core", "sdlc-intake"},
		SquadRole:    "Intake：登记、状态与度量",
	},
	{
		SystemKey:    "sdlc:explore",
		Name:         "SDLC Explorer",
		Description:  "澄清事实、假设、范围和未决；不写 Contract 或代码。",
		AvatarURL:    "emoji:🧠",
		Instructions: "使用 sdlc-explore 收敛事实、假设、冲突与未决；不写 contract.yaml、design.md 或实现代码。只有 .sdlc/config.yaml 中具名 approver 的明确人工批准才算批准；绝不把 Agent、workspace owner、沉默或状态变化自动视为批准。",
		SkillNames:   []string{"sdlc-core", "sdlc-explore"},
		SquadRole:    "Explore：事实、假设与未决收敛",
	},
	{
		SystemKey:    "sdlc:contract",
		Name:         "SDLC Contract",
		Description:  "产出 Contract、EARS、设计并执行人工批准 Gate。",
		AvatarURL:    "emoji:👾",
		Instructions: "使用 sdlc-contract 固化已探索的意图、EARS 验收标准与 Human Design View；不实施代码，Contract Gate 未获具名批准必须停止。只有 .sdlc/config.yaml 中具名 approver 的明确人工批准才算批准；绝不把 Agent、workspace owner、沉默或状态变化自动视为批准。",
		SkillNames:   []string{"sdlc-core", "sdlc-contract"},
		SquadRole:    "Contract：EARS、设计与人工 Gate",
	},
	{
		SystemKey:    "sdlc:build",
		Name:         "SDLC Builder",
		Description:  "只在已批准范围内实施；不承担独立 QA。",
		AvatarURL:    "emoji:🦉",
		Instructions: "使用 sdlc-build 仅在 approved Contract 与 change-scope 内实施；范围扩大必须停下等待具名批准，Build 自测不替代 QA。只有 .sdlc/config.yaml 中具名 approver 的明确人工批准才算批准；绝不把 Agent、workspace owner、沉默或状态变化自动视为批准。",
		SkillNames:   []string{"sdlc-core", "sdlc-build"},
		SquadRole:    "Build：批准范围内实施",
	},
	{
		SystemKey:    "sdlc:qa",
		Name:         "SDLC QA",
		Description:  "独立冻结 Test Intent、验证与归因；不修业务实现。",
		AvatarURL:    "emoji:🐨",
		Instructions: "使用 sdlc-qa，在读取实现前仅依据 approved Contract 冻结 Test Intent；保持与 Builder 的上下文隔离，不修业务代码，只记录归因、Defect 或 Amendment。只有 .sdlc/config.yaml 中具名 approver 的明确人工批准才算批准；绝不把 Agent、workspace owner、沉默或状态变化自动视为批准。",
		SkillNames:   []string{"sdlc-core", "sdlc-qa"},
		SquadRole:    "QA：独立 Test Intent、验证与归因",
	},
	{
		SystemKey:    "sdlc:release",
		Name:         "SDLC Release",
		Description:  "执行发布预检并组装 Evidence Case；不部署、不自签。",
		AvatarURL:    "emoji:🔥",
		Instructions: "使用 sdlc-release 做确定性预检与 Evidence Case；不部署、不补测试、不自签，Release Gate 未获具名批准必须停止。只有 .sdlc/config.yaml 中具名 approver 的明确人工批准才算批准；绝不把 Agent、workspace owner、沉默或状态变化自动视为批准。",
		SkillNames:   []string{"sdlc-core", "sdlc-release"},
		SquadRole:    "Release：预检与 Evidence Case",
	},
	{
		SystemKey:    "sdlc:operate",
		Name:         "SDLC Operator",
		Description:  "诊断事故并把根因归位上游；修改转为新 Work Item。",
		AvatarURL:    "emoji:🦉",
		Instructions: "使用 sdlc-operate 记录与诊断线上事故、关联发布并归位根因；不在事故诊断中顺手改业务实现，缓解或修复作为新 Work Item 路由。只有 .sdlc/config.yaml 中具名 approver 的明确人工批准才算批准；绝不把 Agent、workspace owner、沉默或状态变化自动视为批准。",
		SkillNames:   []string{"sdlc-core", "sdlc-operate"},
		SquadRole:    "Operate：事故诊断与上游归位",
	},
	{
		SystemKey:    "sdlc:learn",
		Name:         "SDLC Learner",
		Description:  "治理 Lesson 生命周期；批准后才能发布经验。",
		AvatarURL:    "emoji:🐵",
		Instructions: "使用 sdlc-learn 登记、验证和发布 Lesson；这是能力资产修改入口，lesson-approval 未获具名批准不得 Publish。只有 .sdlc/config.yaml 中具名 approver 的明确人工批准才算批准；绝不把 Agent、workspace owner、沉默或状态变化自动视为批准。",
		SkillNames:   []string{"sdlc-core", "sdlc-learn"},
		SquadRole:    "Learn：Lesson 生命周期与发布",
	},
	{
		SystemKey:    "sdlc:orchestrator",
		Name:         "SDLC Orchestrator",
		Description:  "排程、审计、验收与路由；不产出阶段交付物。",
		AvatarURL:    "emoji:🧠",
		Instructions: "使用 sdlc-orchestrator 做跨记录判断、排程、审计、阶段接收和路由；不写 Contract、代码、测试或 Evidence Case，不替任何阶段产出交付物。只有 .sdlc/config.yaml 中具名 approver 的明确人工批准才算批准；绝不把 Agent、workspace owner、沉默或状态变化自动视为批准。",
		SkillNames:   []string{"sdlc-core", "sdlc-orchestrator"},
		SquadRole:    "leader",
	},
}

var sdlcDefaultSquad = SDLCSquadSpec{
	SystemKey:    SDLCSquadSystemKey,
	Name:         SDLCSquadDefaultName,
	Description:  "受治理的 AI-SDLC 串行交付小队。",
	Instructions: "Leader 只负责排程、审计、阶段接收和路由，不产出阶段交付物。按 .sdlc 当前状态串行推进：Intake → Explore → Contract → Build → QA → Release。Incident 路由给 Operator，Lesson Proposal 路由给 Learner。Build 与 QA 绝不并行，QA 必须在独立上下文中先冻结 Test Intent。Contract approval、任何 scope expansion、Release、Lesson Publish 都必须等待 .sdlc/config.yaml 中具名 approver 的明确人工批准；不得把 Agent、workspace owner、沉默或状态变化视为批准。阶段缺输入或 Gate 未满足时停止并报告 blocker，不越级代做。",
	LeaderKey:    "sdlc:orchestrator",
}

func SDLCDefaultAgentSpecs() []SDLCAgentSpec {
	out := make([]SDLCAgentSpec, len(sdlcDefaultAgents))
	copy(out, sdlcDefaultAgents)
	return out
}

func SDLCDefaultSquadSpec() SDLCSquadSpec { return sdlcDefaultSquad }

func SDLCDefaultSystemKeys() []string {
	keys := make([]string, 0, len(sdlcDefaultAgents))
	for _, spec := range sdlcDefaultAgents {
		keys = append(keys, spec.SystemKey)
	}
	return keys
}

func SDLCDefaultAgentSystemInstructions(systemKey string) (string, bool) {
	for _, spec := range sdlcDefaultAgents {
		if spec.SystemKey == systemKey {
			return spec.Instructions, true
		}
	}
	return "", false
}

func LoadSDLCDefaultSkills() ([]AgentSkillData, error) {
	entries, err := fs.ReadDir(sdlcSkillsFS, sdlcSkillsRoot)
	if err != nil {
		return nil, err
	}
	skills := make([]AgentSkillData, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dir := path.Join(sdlcSkillsRoot, entry.Name())
		content, err := fs.ReadFile(sdlcSkillsFS, path.Join(dir, "SKILL.md"))
		if err != nil {
			return nil, fmt.Errorf("load %s/SKILL.md: %w", entry.Name(), err)
		}
		description, err := skillFrontmatterDescription(content)
		if err != nil {
			return nil, fmt.Errorf("load %s frontmatter: %w", entry.Name(), err)
		}
		skill := AgentSkillData{
			Name:        entry.Name(),
			Description: description,
			Content:     string(content),
		}
		err = fs.WalkDir(sdlcSkillsFS, dir, func(filePath string, d fs.DirEntry, walkErr error) error {
			if walkErr != nil || d.IsDir() {
				return walkErr
			}
			rel := strings.TrimPrefix(filePath, dir+"/")
			if rel == "SKILL.md" {
				return nil
			}
			data, err := fs.ReadFile(sdlcSkillsFS, filePath)
			if err != nil {
				return err
			}
			skill.Files = append(skill.Files, AgentSkillFileData{Path: rel, Content: string(data)})
			return nil
		})
		if err != nil {
			return nil, fmt.Errorf("load %s files: %w", entry.Name(), err)
		}
		skills = append(skills, skill)
	}
	return skills, nil
}

func skillFrontmatterDescription(content []byte) (string, error) {
	text := string(content)
	if !strings.HasPrefix(text, "---\n") {
		return "", errors.New("missing YAML frontmatter")
	}
	rest := text[len("---\n"):]
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return "", errors.New("unterminated YAML frontmatter")
	}
	var frontmatter struct {
		Name        string `yaml:"name"`
		Description string `yaml:"description"`
	}
	if err := yaml.Unmarshal([]byte(rest[:end]), &frontmatter); err != nil {
		return "", err
	}
	if strings.TrimSpace(frontmatter.Name) == "" || strings.TrimSpace(frontmatter.Description) == "" {
		return "", errors.New("name and description are required")
	}
	return strings.TrimSpace(frontmatter.Description), nil
}

func sdlcSkillConfig(name string) []byte {
	config, _ := json.Marshal(map[string]any{
		"origin": map[string]any{
			"type":    "enact_builtin_sdlc",
			"key":     name,
			"version": SDLCDefaultsVersion,
		},
	})
	return config
}

func isManagedSDLCSkill(skill db.Skill) bool {
	var config struct {
		Origin struct {
			Type string `json:"type"`
			Key  string `json:"key"`
		} `json:"origin"`
	}
	return json.Unmarshal(skill.Config, &config) == nil &&
		config.Origin.Type == "enact_builtin_sdlc" &&
		config.Origin.Key == skill.Name
}

// EnsureSDLCDefaultsInTx provisions the versioned bundle into one workspace.
// The caller must pass transaction-scoped queries; the advisory xact lock is
// the one-per-workspace concurrency guard for startup, workspace creation, and
// daemon registration racing on different server replicas.
func EnsureSDLCDefaultsInTx(ctx context.Context, q *db.Queries, workspaceID, ownerID, runtimeID pgtype.UUID) error {
	if !workspaceID.Valid || !ownerID.Valid {
		return errors.New("workspace and owner are required")
	}
	if err := q.AcquireSDLCDefaultsLock(ctx, workspaceID); err != nil {
		return fmt.Errorf("lock workspace defaults: %w", err)
	}

	skills, err := LoadSDLCDefaultSkills()
	if err != nil {
		return err
	}
	skillIDs := make(map[string]pgtype.UUID, len(skills))
	for _, skill := range skills {
		row, err := q.GetSkillByWorkspaceAndName(ctx, db.GetSkillByWorkspaceAndNameParams{
			WorkspaceID: workspaceID,
			Name:        skill.Name,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			row, err = q.CreateSkill(ctx, db.CreateSkillParams{
				WorkspaceID: workspaceID,
				Name:        skill.Name,
				Description: skill.Description,
				Content:     skill.Content,
				Config:      sdlcSkillConfig(skill.Name),
				CreatedBy:   ownerID,
			})
		} else if err == nil {
			if !isManagedSDLCSkill(row) && strings.TrimSpace(row.Content) != strings.TrimSpace(skill.Content) {
				return fmt.Errorf("skill %q already exists with non-SDLC content", skill.Name)
			}
			row, err = q.UpdateSkill(ctx, db.UpdateSkillParams{
				ID:          row.ID,
				Description: pgtype.Text{String: skill.Description, Valid: true},
				Content:     pgtype.Text{String: skill.Content, Valid: true},
				Config:      sdlcSkillConfig(skill.Name),
			})
		}
		if err != nil {
			return fmt.Errorf("upsert skill %s: %w", skill.Name, err)
		}
		if err := q.DeleteSkillFilesBySkill(ctx, row.ID); err != nil {
			return fmt.Errorf("replace files for %s: %w", skill.Name, err)
		}
		versionFiles := make([]skillversion.File, 0, len(skill.Files))
		for _, file := range skill.Files {
			if _, err := q.UpsertSkillFile(ctx, db.UpsertSkillFileParams{
				SkillID: row.ID,
				Path:    file.Path,
				Content: file.Content,
			}); err != nil {
				return fmt.Errorf("write %s/%s: %w", skill.Name, file.Path, err)
			}
			versionFiles = append(versionFiles, skillversion.File{Path: file.Path, Content: file.Content})
		}
		// Snapshot the bundle the way every other skill write does. Record()
		// skips unchanged content, so the reconciliation this function runs on
		// every boot adds a version only when the shipped bundle actually moved
		// — which is exactly the event a workspace owner wants to see in the
		// history when a product-owned skill changes under them.
		if _, _, err := skillversion.Record(ctx, q, skillversion.Input{
			Skill:   row,
			Files:   versionFiles,
			Source:  skillversion.SourceSeed,
			ActorID: ownerID,
			Summary: fmt.Sprintf("Provisioned by Enact (bundle v%d)", SDLCDefaultsVersion),
		}); err != nil {
			return fmt.Errorf("record version for %s: %w", skill.Name, err)
		}
		skillIDs[skill.Name] = row.ID
	}

	agentIDs := make(map[string]pgtype.UUID, len(sdlcDefaultAgents))
	for _, spec := range sdlcDefaultAgents {
		agent, err := q.FindSDLCDefaultAgentForUpdate(ctx, db.FindSDLCDefaultAgentForUpdateParams{
			WorkspaceID: workspaceID,
			SystemKey:   pgtype.Text{String: spec.SystemKey, Valid: true},
			DefaultName: spec.Name,
			LegacyName:  "VOMS " + spec.Name,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			agent, err = q.CreateSystemUserAgent(ctx, db.CreateSystemUserAgentParams{
				WorkspaceID:        workspaceID,
				Name:               spec.Name,
				Description:        spec.Description,
				AvatarUrl:          pgtype.Text{String: spec.AvatarURL, Valid: spec.AvatarURL != ""},
				RuntimeMode:        "local",
				RuntimeID:          runtimeID,
				Visibility:         "workspace",
				PermissionMode:     "public_to",
				MaxConcurrentTasks: 1,
				OwnerID:            ownerID,
				SystemKey:          pgtype.Text{String: spec.SystemKey, Valid: true},
			})
		}
		if err != nil {
			return fmt.Errorf("find or create agent %s: %w", spec.Name, err)
		}
		agent, err = q.ApplySDLCDefaultAgent(ctx, db.ApplySDLCDefaultAgentParams{
			ID:                 agent.ID,
			SystemKey:          pgtype.Text{String: spec.SystemKey, Valid: true},
			Name:               spec.Name,
			Description:        spec.Description,
			AvatarUrl:          pgtype.Text{String: spec.AvatarURL, Valid: spec.AvatarURL != ""},
			RuntimeID:          runtimeID,
			LegacyInstructions: spec.Instructions,
		})
		if err != nil {
			return fmt.Errorf("apply agent %s: %w", spec.Name, err)
		}
		if err := q.CreateAgentInvocationTarget(ctx, db.CreateAgentInvocationTargetParams{
			AgentID:    agent.ID,
			TargetType: "workspace",
			TargetID:   workspaceID,
			CreatedBy:  ownerID,
		}); err != nil {
			return fmt.Errorf("grant workspace access to %s: %w", spec.Name, err)
		}
		for _, skillName := range spec.SkillNames {
			skillID, ok := skillIDs[skillName]
			if !ok {
				return fmt.Errorf("agent %s references unknown skill %s", spec.Name, skillName)
			}
			if err := q.AddAgentSkill(ctx, db.AddAgentSkillParams{AgentID: agent.ID, SkillID: skillID}); err != nil {
				return fmt.Errorf("bind %s to %s: %w", skillName, spec.Name, err)
			}
		}
		agentIDs[spec.SystemKey] = agent.ID
	}

	leaderID := agentIDs[sdlcDefaultSquad.LeaderKey]
	squad, err := q.FindSDLCDefaultSquadForUpdate(ctx, db.FindSDLCDefaultSquadForUpdateParams{
		WorkspaceID: workspaceID,
		SystemKey:   pgtype.Text{String: sdlcDefaultSquad.SystemKey, Valid: true},
		DefaultName: sdlcDefaultSquad.Name,
		LeaderID:    leaderID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		squad, err = q.CreateSquad(ctx, db.CreateSquadParams{
			WorkspaceID: workspaceID,
			Name:        sdlcDefaultSquad.Name,
			Description: sdlcDefaultSquad.Description,
			LeaderID:    leaderID,
			CreatorID:   ownerID,
			SystemKey:   pgtype.Text{String: sdlcDefaultSquad.SystemKey, Valid: true},
		})
	}
	if err != nil {
		return fmt.Errorf("find or create SDLC squad: %w", err)
	}
	if squad.ArchivedAt.Valid {
		squad, err = q.RestoreSquad(ctx, squad.ID)
		if err != nil {
			return fmt.Errorf("restore SDLC squad: %w", err)
		}
	}
	squad, err = q.UpdateSquad(ctx, db.UpdateSquadParams{
		ID:           squad.ID,
		Description:  pgtype.Text{String: sdlcDefaultSquad.Description, Valid: true},
		LeaderID:     leaderID,
		Instructions: pgtype.Text{String: sdlcDefaultSquad.Instructions, Valid: true},
		SystemKey:    pgtype.Text{String: sdlcDefaultSquad.SystemKey, Valid: true},
	})
	if err != nil {
		return fmt.Errorf("apply SDLC squad: %w", err)
	}
	for _, spec := range sdlcDefaultAgents {
		memberID := agentIDs[spec.SystemKey]
		present, err := q.IsSquadMember(ctx, db.IsSquadMemberParams{
			SquadID:    squad.ID,
			MemberType: "agent",
			MemberID:   memberID,
		})
		if err != nil {
			return fmt.Errorf("check squad member %s: %w", spec.Name, err)
		}
		if present {
			_, err = q.UpdateSquadMemberRole(ctx, db.UpdateSquadMemberRoleParams{
				SquadID:    squad.ID,
				MemberType: "agent",
				MemberID:   memberID,
				Role:       spec.SquadRole,
			})
		} else {
			_, err = q.AddSquadMember(ctx, db.AddSquadMemberParams{
				SquadID:    squad.ID,
				MemberType: "agent",
				MemberID:   memberID,
				Role:       spec.SquadRole,
			})
		}
		if err != nil {
			return fmt.Errorf("upsert squad member %s: %w", spec.Name, err)
		}
	}

	if err := q.SetWorkspaceSDLCDefaultsVersion(ctx, db.SetWorkspaceSDLCDefaultsVersionParams{
		ID:                  workspaceID,
		SdlcDefaultsVersion: SDLCDefaultsVersion,
	}); err != nil {
		return fmt.Errorf("mark SDLC defaults version: %w", err)
	}
	return nil
}

type SDLCTxStarter interface {
	Begin(context.Context) (pgx.Tx, error)
}

// EnsureSDLCDefaultsForAllWorkspaces upgrades every workspace that is behind
// the embedded bundle. One conflicting workspace does not prevent the server
// from repairing the rest; callers receive an errors.Join summary to log.
func EnsureSDLCDefaultsForAllWorkspaces(ctx context.Context, txStarter SDLCTxStarter, q *db.Queries) error {
	targets, err := q.ListWorkspacesNeedingSDLCDefaults(ctx, SDLCDefaultsVersion)
	if err != nil {
		return fmt.Errorf("list workspaces needing SDLC defaults: %w", err)
	}
	var failures []error
	for _, target := range targets {
		tx, err := txStarter.Begin(ctx)
		if err != nil {
			failures = append(failures, fmt.Errorf("workspace %v: begin: %w", target.WorkspaceID.Bytes, err))
			continue
		}
		qtx := q.WithTx(tx)
		err = EnsureSDLCDefaultsInTx(ctx, qtx, target.WorkspaceID, target.OwnerID, target.RuntimeID)
		if err == nil {
			err = tx.Commit(ctx)
		}
		if err != nil {
			_ = tx.Rollback(ctx)
			failures = append(failures, fmt.Errorf("workspace %v: %w", target.WorkspaceID.Bytes, err))
		}
	}
	return errors.Join(failures...)
}

// BindUnboundSDLCDefaultAgents attaches newly provisioned portable roles to a
// real runtime once a daemon has registered one for the workspace.
func BindUnboundSDLCDefaultAgents(ctx context.Context, txStarter SDLCTxStarter, q *db.Queries, workspaceID, runtimeID pgtype.UUID) error {
	if !workspaceID.Valid || !runtimeID.Valid {
		return nil
	}
	tx, err := txStarter.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	qtx := q.WithTx(tx)
	if err := qtx.AcquireSDLCDefaultsLock(ctx, workspaceID); err != nil {
		return err
	}
	if _, err := qtx.BindUnboundSDLCDefaultAgents(ctx, db.BindUnboundSDLCDefaultAgentsParams{
		WorkspaceID: workspaceID,
		RuntimeID:   runtimeID,
		SystemKeys:  SDLCDefaultSystemKeys(),
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
