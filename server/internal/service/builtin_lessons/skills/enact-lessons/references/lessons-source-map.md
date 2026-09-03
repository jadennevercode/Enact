# Source map — enact-lessons

Every product contract stated in `SKILL.md`, traced to the code that enforces
it. Update this file in the same change that alters any of them.

## Proposal requirements

| Contract | Source |
|---|---|
| `title`, `observation`, `applies_when`, `counterexample` and `change_summary` are all required | `server/internal/handler/lesson.go` — `prepareLessonProposal`, the required-field loop |
| A proposal that changes nothing is refused | `prepareLessonProposal`, the `hasChange` check |
| `evidence` entries must be `task`, `issue` or `comment` with a UUID | `prepareLessonProposal`, the evidence loop |
| At most 20 evidence references, 64 proposed files | `maxLessonEvidence`, `maxLessonFiles` in `lesson.go` |

## Versions

| Contract | Source |
|---|---|
| Every skill content write records an immutable snapshot | `server/internal/skillversion/record.go` — `Record` |
| A write that changes nothing records no version | same, the `content_hash` comparison |
| `base_version_id` must be the skill's current version at proposal time | `prepareLessonProposal`, the `CurrentVersionID` comparison; returns 409 naming the current version |
| The same check runs again inside the publishing transaction | `server/internal/handler/lesson_decision.go` — `publishLesson` |
| `GET /api/skills/{id}` returns `current_version_id` | `server/internal/handler/skill.go` — `skillToResponse` |

## Review

| Contract | Source |
|---|---|
| One open lesson per skill | `prepareLessonProposal` — `CountOpenLessonsForSkill`; `server/pkg/db/queries/lesson.sql` |
| Only a person may approve, reject or withdraw | `lesson_decision.go` — `requireHumanLessonActor`, plus `handler.RequireHumanActor` on the routes in `server/cmd/server/router.go` |
| Approving applies the change in the same transaction | `publishLesson` |
| Withdrawing reverts only when the skill still stands where the lesson left it | `DeprecateLesson` |
| Who a lesson affects is read from `agent_skill`, not stated by the proposer | `lesson.go` — `lessonAffectedAgents` |

## Retrospectives

| Contract | Source |
|---|---|
| A retrospective runs as an issue assigned to the Lesson Learner | `server/internal/handler/retrospective.go` — `startRetrospective` |
| The brief is generated server-side and names the scope and window | `retrospectiveBrief` |
| One retrospective is offered per issue, ever | migration `429_retrospective_issue_unique_index`; `SuggestIssueRetrospective` |
| Suggestions require agent work on the issue and a workspace opt-in | `server/internal/handler/retrospective_suggest.go` — `maybeSuggestRetrospective` |
| One scan at a time per workspace | `CreateRetrospective` — `CountActiveRetrospectives` |

## CLI

| Contract | Source |
|---|---|
| `enact lesson propose` | `server/cmd/enact/cmd_lesson.go` |
| `enact lesson digest` | same file — reads finished work for the scope |
| `enact skill get` includes `current_version_id` | `server/cmd/enact/cmd_skill.go` |
