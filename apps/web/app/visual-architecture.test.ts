// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const readRepoFile = (path: string) =>
  readFileSync(resolve(repoRoot, path), "utf8");
const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const productScanRoots = [
  "packages/ui",
  "packages/views",
  "apps/web",
  "apps/desktop/src/renderer/src",
] as const;
const skippedProductDirectories = new Set([
  "node_modules",
  ".next",
  "dist",
  "out",
  "build",
  ".turbo",
  "coverage",
]);

const collectProductFiles = (
  directory: string,
  extension: ".css" | ".tsx",
  found: string[] = [],
): string[] => {
  for (const entry of readdirSync(resolve(repoRoot, directory), {
    withFileTypes: true,
  })) {
    if (skippedProductDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectProductFiles(path, extension, found);
      continue;
    }
    if (!entry.name.endsWith(extension)) continue;
    if (/\.(?:test|spec)\.tsx$/.test(entry.name)) continue;
    found.push(relative(repoRoot, resolve(repoRoot, path)).replace(/\\/g, "/"));
  }
  return found;
};

const productStylePaths = productScanRoots
  .flatMap((root) => collectProductFiles(root, ".css"))
  .filter((path) => path !== "packages/ui/styles/tokens.css");
const productComponentPaths = productScanRoots.flatMap((root) =>
  collectProductFiles(root, ".tsx"),
);
const marketingComponentRoots = [
  "apps/web/app/(landing)/",
  "apps/web/features/landing/",
] as const;
const governedProductComponentPaths = productComponentPaths.filter(
  (path) => !marketingComponentRoots.some((root) => path.startsWith(root)),
);

const governedStylePaths = productStylePaths;

const governedComponentPaths = [
  "packages/ui/components/ui/button.tsx",
  "packages/ui/components/ui/input.tsx",
  "packages/ui/components/ui/textarea.tsx",
  "packages/ui/components/ui/select.tsx",
  "packages/ui/components/ui/checkbox.tsx",
  "packages/ui/components/ui/switch.tsx",
  "packages/ui/components/ui/dialog.tsx",
  "packages/ui/components/ui/alert-dialog.tsx",
  "packages/ui/components/ui/dropdown-menu.tsx",
  "packages/ui/components/ui/context-menu.tsx",
  "packages/ui/components/ui/popover.tsx",
  "packages/ui/components/ui/tooltip.tsx",
  "packages/ui/components/ui/tabs.tsx",
  "packages/ui/components/ui/table.tsx",
  "packages/ui/components/ui/data-table.tsx",
  "packages/ui/components/ui/sidebar.tsx",
  "packages/ui/components/ui/card.tsx",
  "packages/ui/components/ui/empty.tsx",
  "packages/ui/components/ui/sonner.tsx",
  "packages/views/layout/dashboard-layout.tsx",
  "packages/views/layout/app-sidebar.tsx",
  "packages/views/layout/page-header.tsx",
  "packages/views/layout/collection-page.tsx",
  "packages/views/layout/animated-right-sidebar.tsx",
  "apps/desktop/src/renderer/src/components/desktop-layout.tsx",
  "apps/desktop/src/renderer/src/components/tab-bar.tsx",
  "apps/desktop/src/renderer/src/components/tab-content.tsx",
  "apps/desktop/src/renderer/src/components/window-overlay.tsx",
  "apps/desktop/src/renderer/src/components/app-crash-boundary.tsx",
  "apps/desktop/src/renderer/src/components/route-error-page.tsx",
  "packages/views/issues/components/issues-page.tsx",
  "packages/views/my-issues/components/my-issues-page.tsx",
  "packages/views/issues/surface/issue-surface.tsx",
  "packages/views/issues/components/issues-header.tsx",
  "packages/views/my-issues/components/my-issues-header.tsx",
  "packages/views/issues/components/filter-chips-bar.tsx",
  "packages/views/issues/components/view-bar.tsx",
  "packages/views/issues/components/batch-action-toolbar.tsx",
  "packages/views/issues/components/list-view.tsx",
  "packages/views/issues/components/list-row.tsx",
  "packages/views/issues/components/board-view.tsx",
  "packages/views/issues/components/board-column.tsx",
  "packages/views/issues/components/board-card.tsx",
  "packages/views/issues/components/swimlane-view.tsx",
  "packages/views/issues/components/table-view.tsx",
  "packages/views/issues/components/gantt-view.tsx",
  "packages/views/issues/components/pickers/property-picker.tsx",
  "packages/views/issues/components/issue-detail.tsx",
  "packages/views/issues/components/comment-card.tsx",
  "packages/views/issues/components/comment-input.tsx",
  "packages/views/issues/components/thread-minimap.tsx",
  "apps/desktop/src/renderer/src/components/issue-window.tsx",
  "packages/views/chat/chat-page.tsx",
  "packages/views/chat/floating-chat.tsx",
  "packages/views/chat/components/chat-window.tsx",
  "packages/views/chat/components/chat-fab.tsx",
  "packages/views/chat/components/chat-resize-handles.tsx",
  "packages/views/chat/components/chat-thread-list.tsx",
  "packages/views/chat/components/chat-session-header.tsx",
  "packages/views/chat/components/chat-message-list.tsx",
  "packages/views/chat/components/chat-input.tsx",
  "packages/views/chat/components/chat-queue.tsx",
  "packages/views/chat/components/chat-empty-state.tsx",
  "packages/views/chat/components/offline-banner.tsx",
  "packages/views/chat/components/no-agent-banner.tsx",
  "packages/views/chat/components/archived-agent-banner.tsx",
  "packages/views/chat/components/agent-access-revoked-banner.tsx",
  "packages/views/chat/components/runtime-required-banner.tsx",
  "packages/views/chat/components/task-status-pill.tsx",
  "packages/views/inbox/components/inbox-page.tsx",
  "packages/views/inbox/components/inbox-list.tsx",
  "packages/views/inbox/components/inbox-list-item.tsx",
  "packages/views/agents/components/agent-list-page.tsx",
  "packages/views/agents/components/agent-list-toolbar.tsx",
  "packages/views/agents/components/agent-batch-toolbar.tsx",
  "packages/views/agents/components/agent-row-actions.tsx",
  "packages/views/agents/components/agent-presence-indicator.tsx",
  "packages/views/agents/components/visibility-badge.tsx",
  "packages/views/runtimes/components/runtimes-page.tsx",
  "packages/views/runtimes/components/runtime-list.tsx",
  "packages/views/runtimes/components/shared.tsx",
  "packages/views/runtimes/components/usage-section.tsx",
  "packages/views/skills/components/skills-page.tsx",
  "packages/views/skills/components/skill-list-toolbar.tsx",
  "packages/views/skills/components/skill-list-actions.tsx",
  "packages/views/squads/components/squads-page.tsx",
  "packages/views/autopilots/components/autopilots-page.tsx",
  "packages/views/autopilots/components/autopilot-list-toolbar.tsx",
  "packages/views/autopilots/components/autopilot-list-actions.tsx",
  "packages/views/dashboard/components/dashboard-page.tsx",
  "packages/views/dashboard/components/dashboard-filters.tsx",
  "packages/views/dashboard/components/dashboard-shared.tsx",
  "packages/views/dashboard/components/usage-trend-card.tsx",
  "packages/views/dashboard/components/leaderboard.tsx",
  "packages/views/dashboard/components/errors-tab.tsx",
  "apps/desktop/src/renderer/src/components/daemon-panel.tsx",
  "apps/desktop/src/renderer/src/components/daemon-runtime-card.tsx",
  "packages/views/settings/components/settings-layout.tsx",
  "packages/views/settings/components/settings-page.tsx",
  "packages/views/settings/components/workspace-tab.tsx",
  "packages/views/settings/components/delete-workspace-dialog.tsx",
  "packages/views/settings/components/billing-tab.tsx",
  "packages/views/settings/components/labels-tab.tsx",
  "packages/views/settings/components/issue-statuses-tab.tsx",
  "packages/views/settings/components/properties-tab.tsx",
  "packages/views/settings/components/quick-actions-tab.tsx",
  "packages/views/settings/components/integrations-tab.tsx",
  "packages/views/settings/components/composio-tab.tsx",
  "packages/views/settings/components/github-tab.tsx",
  "packages/views/settings/components/lark-tab.tsx",
  "packages/views/settings/components/slack-tab.tsx",
  "packages/views/settings/components/dingtalk-tab.tsx",
  "packages/views/settings/components/wecom-tab.tsx",
  "packages/views/settings/components/telegram-tab.tsx",
  "packages/views/lark/bind-page.tsx",
  "packages/views/slack/bind-page.tsx",
  "packages/views/dingtalk/bind-page.tsx",
  "packages/views/wecom/bind-page.tsx",
  "packages/views/telegram/bind-page.tsx",
  "apps/desktop/src/renderer/src/components/daemon-settings-tab.tsx",
  "apps/desktop/src/renderer/src/components/updates-settings-tab.tsx",
  "apps/desktop/src/renderer/src/components/update-notification.tsx",
  "packages/views/attachments/attachment-preview-page.tsx",
  "packages/views/editor/attachment-card.tsx",
  "packages/views/editor/attachment-preview-modal.tsx",
  "packages/views/editor/attachment.tsx",
  "packages/views/editor/bubble-menu.tsx",
  "packages/views/editor/code-block-iframe.tsx",
  "packages/views/editor/code-block-static.tsx",
  "packages/views/editor/content-editor.tsx",
  "packages/views/editor/extensions/code-block-view.tsx",
  "packages/views/editor/extensions/file-card.tsx",
  "packages/views/editor/extensions/math.tsx",
  "packages/views/editor/extensions/mention-suggestion.tsx",
  "packages/views/editor/extensions/mention-view.tsx",
  "packages/views/editor/extensions/slash-command-suggestion.tsx",
  "packages/views/editor/extensions/slash-command-view.tsx",
  "packages/views/editor/file-drop-overlay.tsx",
  "packages/views/editor/html-attachment-preview.tsx",
  "packages/views/editor/html-block-preview.tsx",
  "packages/views/editor/html-preview-body.tsx",
  "packages/views/editor/link-hover-card.tsx",
  "packages/views/editor/mermaid-diagram.tsx",
  "packages/views/editor/mermaid-viewer.tsx",
  "packages/views/editor/title-editor.tsx",
  "packages/views/editor/zoom-canvas.tsx",
  "packages/views/rich-content/lazy-rich-block.tsx",
  "packages/views/rich-content/rich-code-block.tsx",
  "packages/views/rich-content/rich-content.tsx",
  "packages/views/modals/create-issue-dialog.tsx",
  "packages/views/modals/create-issue.tsx",
  "packages/views/modals/create-squad.tsx",
  "packages/views/modals/delete-issue-confirm.tsx",
  "packages/views/modals/feedback.tsx",
  "packages/views/modals/issue-picker-modal.tsx",
  "packages/views/modals/quick-create-issue.tsx",
  "packages/views/modals/registry.tsx",
  "packages/views/modals/run-confirm.tsx",
  "packages/views/auth/login-page.tsx",
  "packages/views/invite/invite-page.tsx",
  "packages/views/invitations/invitations-page.tsx",
  "packages/views/onboarding/components/cloud-waitlist-expand.tsx",
  "packages/views/onboarding/components/icon-option-card.tsx",
  "packages/views/onboarding/components/mika-intro.tsx",
  "packages/views/onboarding/components/onboarding-logout-button.tsx",
  "packages/views/onboarding/components/option-card.tsx",
  "packages/views/onboarding/components/step-shell.tsx",
  "packages/views/onboarding/components/step-sidebar.tsx",
  "packages/views/onboarding/source-backfill-modal.tsx",
  "packages/views/onboarding/steps/cli-install-instructions.tsx",
  "packages/views/onboarding/steps/step-about-you.tsx",
  "packages/views/onboarding/steps/step-platform-fork.tsx",
  "packages/views/onboarding/steps/step-runtime-connect.tsx",
  "packages/views/onboarding/steps/step-welcome.tsx",
  "packages/views/onboarding/steps/step-workspace.tsx",
  "packages/views/workspace/no-access-page.tsx",
  "packages/views/workspace/welcome-after-onboarding.tsx",
  "packages/views/workspace/workspace-avatar.tsx",
  "apps/desktop/src/renderer/src/pages/login.tsx",
  "apps/desktop/src/renderer/src/pages/auth-recovery.tsx",
] as const;

type GovernedComponentPath = string;

type DynamicStyleRule = {
  description: string;
  expectedMatches: number;
  pattern: RegExp;
};

type RawVisualRule = {
  description: string;
  expectedMatches: number;
  pattern: RegExp;
};

const dynamicStyleAllowlist: Partial<
  Record<GovernedComponentPath, readonly DynamicStyleRule[]>
> = {
  "packages/ui/components/common/actor-avatar.tsx": [
    {
      description: "prop-driven avatar box and fallback type geometry",
      expectedMatches: 1,
      pattern: /style=\{\{ width: px, height: px, fontSize: px \* 0\.45 \}\}/g,
    },
    {
      description: "prop-driven emoji scale",
      expectedMatches: 1,
      pattern: /style=\{\{ fontSize: px \* 0\.58 \}\}/g,
    },
    {
      description: "prop-driven avatar glyph size",
      expectedMatches: 3,
      pattern: /style=\{\{ width: px \* 0\.55, height: px \* 0\.55 \}\}/g,
    },
  ],
  "packages/ui/components/ui/chart.tsx": [
    {
      description: "chart payload indicator CSS color variables",
      expectedMatches: 1,
      pattern: /style=\{\s*\{\s*"--color-bg": indicatorColor,\s*"--color-border": indicatorColor,\s*\} as React\.CSSProperties\s*\}/g,
    },
    {
      description: "chart legend payload color",
      expectedMatches: 1,
      pattern: /style=\{\{\s*backgroundColor: item\.color,\s*\}\}/g,
    },
  ],
  "packages/views/agents/components/agent-avatar-stack.tsx": [
    {
      description: "computed avatar stack origin",
      expectedMatches: 1,
      pattern: /style=\{\{ paddingLeft: 0 \}\}/g,
    },
    {
      description: "computed avatar overlap",
      expectedMatches: 1,
      pattern: /style=\{\{ marginLeft: i === 0 \? 0 : -overlap \}\}/g,
    },
    {
      description: "computed avatar overflow badge geometry",
      expectedMatches: 1,
      pattern: /style=\{\{\s*marginLeft: -overlap,\s*width: px,\s*height: px,\s*fontSize: Math\.max\(9, Math\.round\(px \* 0\.45\)\),\s*\}\}/g,
    },
  ],
  "packages/views/common/avatar-upload-control.tsx": [
    {
      description: "prop-driven fallback glyph size",
      expectedMatches: 2,
      pattern: /style=\{\{ width: size \* 0\.5, height: size \* 0\.5 \}\}/g,
    },
    {
      description: "prop-driven fallback initials size",
      expectedMatches: 1,
      pattern: /style=\{\{ fontSize: size \* 0\.4 \}\}/g,
    },
    {
      description: "prop-driven avatar control dimensions",
      expectedMatches: 2,
      pattern: /style=\{\{ width: size, height: size \}\}/g,
    },
    {
      description: "prop-driven avatar emoji size",
      expectedMatches: 1,
      pattern: /style=\{\{ fontSize: size \* 0\.58 \}\}/g,
    },
  ],
  "packages/views/common/color-picker.tsx": [
    {
      description: "HSV saturation canvas",
      expectedMatches: 1,
      pattern: /style=\{\{\s*backgroundColor: `hsl\(\$\{hsv\.h\} 100% 50%\)`,\s*backgroundImage:\s*"linear-gradient\(to top, #000, transparent\), linear-gradient\(to right, #fff, transparent\)",\s*\}\}/g,
    },
    {
      description: "HSV saturation-value handle",
      expectedMatches: 1,
      pattern: /style=\{\{\s*left: `\$\{hsv\.s \* 100\}%`,\s*top: `\$\{\(1 - hsv\.v\) \* 100\}%`,\s*backgroundColor: currentHex,\s*\}\}/g,
    },
    {
      description: "functional hue spectrum",
      expectedMatches: 1,
      pattern: /style=\{\{ background: HUE_GRADIENT \}\}/g,
    },
    {
      description: "HSV hue handle",
      expectedMatches: 1,
      pattern: /style=\{\{\s*left: `\$\{\(hsv\.h \/ 360\) \* 100\}%`,\s*backgroundColor: `hsl\(\$\{hsv\.h\} 100% 50%\)`,\s*\}\}/g,
    },
    {
      description: "current user color swatch",
      expectedMatches: 1,
      pattern: /style=\{\{ backgroundColor: currentHex \}\}/g,
    },
    {
      description: "user-selectable preset swatches",
      expectedMatches: 1,
      pattern: /style=\{\{ backgroundColor: preset \}\}/g,
    },
  ],
  "packages/views/common/task-transcript/run-timeline.tsx": [
    {
      description: "timeline lane segment geometry",
      expectedMatches: 1,
      pattern: /style=\{laneSegmentPosition\(segment, totalMs\)\}/g,
    },
    {
      description: "timeline fixed label rail width",
      expectedMatches: 1,
      pattern: /style=\{\{ width: LABEL_WIDTH \}\}/g,
    },
    {
      description: "timeline zoom width",
      expectedMatches: 1,
      pattern: /style=\{\{ width: `\$\{zoom \* 100\}%` \}\}/g,
    },
    {
      description: "timeline tick position",
      expectedMatches: 1,
      pattern: /style=\{\{ left: `\$\{\(tick \/ lanes\.totalMs\) \* 100\}%` \}\}/g,
    },
    {
      description: "timeline selected playhead position",
      expectedMatches: 1,
      pattern: /style=\{\{\s*left: `\$\{\s*\(Math\.min\(Math\.max\(selectedOffsetMs, 0\), lanes\.totalMs\) \/ lanes\.totalMs\) \* 100\s*\}%`,\s*\}\}/g,
    },
  ],
  "packages/views/common/virtuoso-seed.tsx": [
    {
      description: "virtualized first-frame spacer height",
      expectedMatches: 1,
      pattern: /style=\{\{ height: remaining \* estimatedItemHeight \}\}/g,
    },
  ],
  "packages/views/editor/extensions/suggestion-popup.tsx": [
    {
      description: "floating suggestion available-height CSS variable",
      expectedMatches: 1,
      pattern: /el\.style\.setProperty/g,
    },
    {
      description: "floating suggestion coordinates",
      expectedMatches: 2,
      pattern: /el\.style\.(?:left|top)/g,
    },
    {
      description: "imperative suggestion portal positioning",
      expectedMatches: 2,
      pattern: /popup\.style\.(?:position|zIndex)/g,
    },
  ],
  "packages/views/issues/actions/issue-actions-context-menu.tsx": [
    {
      description: "context-menu picker anchor coordinates",
      expectedMatches: 1,
      pattern: /style=\{\{\s*left: position\.x,\s*top: position\.y,\s*width: 0,\s*height: 0,\s*\}\}/g,
    },
  ],
  "packages/views/issues/components/comment-trigger-chips.tsx": [
    {
      description: "computed agent avatar overlap",
      expectedMatches: 1,
      pattern: /style=\{\{ marginLeft: i === 0 \? 0 : -overlap \}\}/g,
    },
    {
      description: "computed agent overflow badge geometry",
      expectedMatches: 1,
      pattern: /style=\{\{\s*marginLeft: -overlap,\s*width: AVATAR_SIZE,\s*height: AVATAR_SIZE,\s*fontSize: Math\.max\(9, Math\.round\(AVATAR_SIZE \* 0\.45\)\),\s*\}\}/g,
    },
  ],
  "packages/views/issues/components/issue-usage-dialog.tsx": [
    {
      description: "usage bar widths computed from task data",
      expectedMatches: 2,
      pattern: /style=\{\{ width: `\$\{[^`]+\}%` \}\}/g,
    },
  ],
  "packages/views/issues/components/manage-views-dialog.tsx": [
    {
      description: "dnd sortable view transform",
      expectedMatches: 1,
      pattern: /style=\{\{ transform: CSS\.Translate\.toString\(transform\), transition \}\}/g,
    },
  ],
  "packages/views/issues/components/pickers/custom-property-picker.tsx": [
    {
      description: "user-defined custom property option colors",
      expectedMatches: 4,
      pattern: /style=\{\{ backgroundColor: option\.color \}\}/g,
    },
  ],
  "packages/views/issues/components/pickers/label-picker.tsx": [
    {
      description: "persisted label colors",
      expectedMatches: 1,
      pattern: /style=\{\{ backgroundColor: label\.color \}\}/g,
    },
    {
      description: "new label color preview",
      expectedMatches: 1,
      pattern: /style=\{\{ backgroundColor: pickInlineColor\(query\) \}\}/g,
    },
  ],
  "packages/views/issues/components/status-icon.tsx": [
    {
      description: "user-defined status color",
      expectedMatches: 1,
      pattern: /style=\{useCustomColor \? \{ color: color \?\? undefined \} : undefined\}/g,
    },
  ],
  "packages/views/issues/components/view-bar-popover.tsx": [
    {
      description: "dnd sortable view transform",
      expectedMatches: 1,
      pattern: /style=\{\{ transform: CSS\.Translate\.toString\(transform\), transition \}\}/g,
    },
  ],
  "packages/views/labels/label-chip.tsx": [
    {
      description: "label background and computed contrast foreground",
      expectedMatches: 1,
      pattern: /style=\{\{ backgroundColor: label\.color, color: textColor \}\}/g,
    },
  ],
  "packages/views/labels/resource-label-picker.tsx": [
    {
      description: "persisted resource label color",
      expectedMatches: 1,
      pattern: /style=\{\{ backgroundColor: label\.color \}\}/g,
    },
  ],
  "packages/views/platform/drag-strip.tsx": [
    {
      description: "Electron window drag region",
      expectedMatches: 1,
      pattern: /style=\{\{ WebkitAppRegion: "drag" \} as CSSProperties\}/g,
    },
  ],
  "packages/views/plugins/plugin-surface-frame.tsx": [
    {
      description: "plugin iframe negotiated height",
      expectedMatches: 1,
      pattern: /style=\{\{ height \}\}/g,
    },
  ],
  "packages/views/runtimes/components/charts/activity-heatmap.tsx": [
    {
      description: "data-derived heatmap legend color",
      expectedMatches: 1,
      pattern: /style=\{\{ backgroundColor: getHeatmapColor\(level\) \}\}/g,
    },
  ],
  "packages/views/runtimes/components/provider-logo.tsx": [
    {
      description: "SVG luminance mask interoperability",
      expectedMatches: 1,
      pattern: /style=\{\{ maskType: "luminance" \}\}/g,
    },
  ],
  "packages/views/settings/components/members-tab.tsx": [
    {
      description: "legacy clipboard fallback offscreen geometry",
      expectedMatches: 2,
      pattern: /textArea\.style\.(?:position|left)/g,
    },
  ],
  "packages/views/skills/components/create-skill-dialog.tsx": [
    {
      description: "skill form scroll-fade mask",
      expectedMatches: 2,
      pattern: /style=\{fadeStyle\}/g,
    },
  ],
  "packages/views/skills/components/file-tree.tsx": [
    {
      description: "recursive file-tree indentation",
      expectedMatches: 3,
      pattern: /style=\{\{ paddingLeft: `\$\{depth \* 12 \+ 10\}px` \}\}/g,
    },
  ],
  "packages/views/skills/components/runtime-local-skill-import-panel.tsx": [
    {
      description: "runtime import panel scroll-fade mask",
      expectedMatches: 1,
      pattern: /style=\{fadeStyle\}/g,
    },
  ],
  "packages/ui/components/ui/data-table.tsx": [
    {
      description: "auto-fit tableLayout measurement",
      expectedMatches: 3,
      pattern: /tableElement\.style\.tableLayout/g,
    },
    {
      description: "auto-fit cell width/maxWidth/overflow measurement",
      expectedMatches: 9,
      pattern: /(?:entry\.)?cell\.style\.(?:width|maxWidth|overflow)/g,
    },
    {
      description: "table minWidth and column CSS variables",
      expectedMatches: 1,
      pattern:
        /style=\{\{\s*minWidth:\s*`\$\{table\.getTotalSize\(\)\}px`,\s*\.\.\.columnSizeVars,\s*\}\}/g,
    },
    {
      description: "cell width and pinned position geometry",
      expectedMatches: 2,
      pattern: /style=\{getCellStyle\([\s\S]*?\)\}/g,
    },
    {
      description: "pinned shadow left offset",
      expectedMatches: 1,
      pattern: /style=\{\{\s*left:\s*`\$\{pinnedEdge\}px`\s*\}\}/g,
    },
    {
      description: "virtual spacer height",
      expectedMatches: 1,
      pattern: /style=\{\{\s*height:\s*`\$\{height\}px`\s*\}\}/g,
    },
  ],
  "packages/ui/components/ui/sidebar.tsx": [
    {
      description: "provider widths and public style merge",
      expectedMatches: 1,
      pattern:
        /style=\{\s*\{\s*"--sidebar-width":\s*`\$\{width\}px`,\s*"--sidebar-width-icon":\s*SIDEBAR_WIDTH_ICON,\s*\.\.\.style,\s*\}\s*as React\.CSSProperties\s*\}/g,
    },
    {
      description: "compact sheet width",
      expectedMatches: 1,
      pattern:
        /style=\{\s*\{\s*"--sidebar-width":\s*SIDEBAR_WIDTH_MOBILE,\s*\}\s*as React\.CSSProperties\s*\}/g,
    },
    {
      description: "committed provider width",
      expectedMatches: 1,
      pattern:
        /drag\.wrapperEl\.style\.setProperty\(\s*"--sidebar-width",\s*`\$\{drag\.latestWidth\}px`\s*\)/g,
    },
    {
      description: "imperative gap/container width preview and cleanup",
      expectedMatches: 4,
      pattern:
        /drag\.(?:gapEl|containerEl)\.style\.(?:width|removeProperty\("width"\))/g,
    },
    {
      description: "skeleton width CSS variable",
      expectedMatches: 1,
      pattern:
        /style=\{\s*\{\s*"--skeleton-width":\s*width,\s*\}\s*as React\.CSSProperties\s*\}/g,
    },
  ],
  "packages/views/layout/app-sidebar.tsx": [
    {
      description: "dnd transform and transition geometry",
      expectedMatches: 1,
      pattern:
        /const style = \{ transform: CSS\.Transform\.toString\(transform\), transition \};/g,
    },
    {
      description: "dnd style application",
      expectedMatches: 1,
      pattern: /style=\{style\}/g,
    },
    {
      description: "runtime sidebar scroll mask",
      expectedMatches: 1,
      pattern: /style=\{sidebarFadeStyle\}/g,
    },
  ],
  "apps/desktop/src/renderer/src/components/desktop-layout.tsx": [
    {
      // Seven since the session controls joined the tab bar: their wrapper
      // has to opt out of the drag region or the bell and account menu
      // would move the window instead of opening.
      description: "Electron drag and no-drag regions",
      expectedMatches: 7,
      pattern:
        /style=\{\{ WebkitAppRegion: "(?:drag|no-drag)" \} as React\.CSSProperties\}/g,
    },
  ],
  "apps/desktop/src/renderer/src/components/tab-bar.tsx": [
    {
      description: "dnd transform, transition, no-drag, and stacking geometry",
      expectedMatches: 1,
      pattern:
        /const style = \{\s*transform: CSS\.Transform\.toString\(transform\),\s*transition,\s*WebkitAppRegion: "no-drag",\s*zIndex: isDragging \? 20 : undefined,\s*\} as React\.CSSProperties;/g,
    },
    {
      description: "dnd style application",
      expectedMatches: 1,
      pattern: /style=\{style\}/g,
    },
    {
      description: "Electron no-drag controls",
      expectedMatches: 2,
      pattern:
        /style=\{\{ WebkitAppRegion: "no-drag" \} as React\.CSSProperties\}/g,
    },
    {
      description: "runtime horizontal tab scroll mask",
      expectedMatches: 1,
      pattern: /style=\{tabFadeStyle\}/g,
    },
  ],
  "packages/views/chat/components/chat-message-list.tsx": [
    {
      description: "runtime transcript scroll fade",
      expectedMatches: 1,
      pattern: /style=\{fadeStyle\}/g,
    },
  ],
  "packages/views/chat/components/chat-window.tsx": [
    {
      description: "visual viewport floating-window geometry",
      expectedMatches: 1,
      pattern: /style=\{containerStyle\}/g,
    },
  ],
  "packages/views/issues/components/issues-header.tsx": [
    {
      description: "catalog option color CSS variable",
      expectedMatches: 1,
      pattern:
        /style=\{\{ "--enact-issue-color": option\.color \} as React\.CSSProperties\}/g,
    },
  ],
  "packages/views/issues/components/filter-chips-bar.tsx": [
    {
      description: "catalog color CSS variable",
      expectedMatches: 1,
      pattern:
        /style=\{\{ "--enact-issue-color": color \} as React\.CSSProperties\}/g,
    },
  ],
  "packages/views/issues/components/view-bar.tsx": [
    {
      description: "sortable tab transform and transition",
      expectedMatches: 1,
      pattern:
        /style=\{\{ transform: CSS\.Translate\.toString\(transform\), transition \}\}/g,
    },
  ],
  "packages/views/issues/components/list-row.tsx": [
    {
      description: "sortable row transform and transition",
      expectedMatches: 1,
      pattern:
        /const style = \{\s*transform: CSS\.Transform\.toString\(transform\),\s*transition,\s*\};/g,
    },
    {
      description: "sortable row style application",
      expectedMatches: 1,
      pattern: /style=\{containerStyle\}/g,
    },
  ],
  "packages/views/issues/components/board-view.tsx": [
    {
      description: "board drag overlay width",
      expectedMatches: 1,
      pattern: /style=\{\{ width: BOARD_CARD_WIDTH \}\}/g,
    },
  ],
  "packages/views/issues/components/board-column.tsx": [
    {
      description: "board column width",
      expectedMatches: 1,
      pattern: /style=\{\{ width: BOARD_COL_WIDTH \}\}/g,
    },
    {
      description: "catalog option color CSS variable",
      expectedMatches: 1,
      pattern:
        /style=\{\s*group\.propertyOptionColor\s*\? \(\{ "--enact-issue-color": group\.propertyOptionColor \} as React\.CSSProperties\)\s*: undefined\s*\}/g,
    },
  ],
  "packages/views/issues/components/board-card.tsx": [
    {
      description: "sortable card transform and transition",
      expectedMatches: 1,
      pattern:
        /const style = \{\s*transform: CSS\.Transform\.toString\(transform\),\s*transition,\s*\};/g,
    },
    {
      description: "sortable card style application",
      expectedMatches: 1,
      pattern: /style=\{style\}/g,
    },
  ],
  "packages/views/issues/components/swimlane-view.tsx": [
    {
      description: "computed swimlane track width",
      expectedMatches: 1,
      pattern: /style=\{\{ width: `\$\{trackWidth\}px` \}\}/g,
    },
    {
      description: "computed swimlane grid geometry",
      expectedMatches: 2,
      pattern: /style=\{gridStyle\}/g,
    },
    {
      description: "sortable swimlane transform and transition",
      expectedMatches: 1,
      pattern:
        /const style = \{\s*transform: CSS\.Transform\.toString\(transform\),\s*transition,\s*\};/g,
    },
    {
      description: "sortable swimlane style application",
      expectedMatches: 1,
      pattern: /style=\{style\}/g,
    },
  ],
  "packages/views/issues/components/table-view.tsx": [
    {
      description: "header reorder overflow and stacking",
      expectedMatches: 4,
      pattern:
        /cell\.style\.(?:overflow = "visible"|zIndex = "20"|removeProperty\("overflow"\)|removeProperty\("z-index"\))/g,
    },
    {
      description: "header reorder transform and transition",
      expectedMatches: 1,
      pattern:
        /style=\{\{\s*transform: transform \? `translate3d\(\$\{transform\.x\}px, 0, 0\)` : undefined,\s*transition,\s*\}\}/g,
    },
    {
      description: "hierarchy indentation",
      expectedMatches: 1,
      pattern: /style=\{\{ paddingLeft: row\.depth \* 18 \}\}/g,
    },
  ],
  "packages/views/issues/components/gantt-view.tsx": [
    {
      description: "timeline height and width geometry",
      expectedMatches: 5,
      pattern:
        /style=\{\{ (?:height: HEADER_HEIGHT, width|height, width: totalDays \* dayPx|height: ROW_HEIGHT|width: LEFT_COL_WIDTH|width: totalDays \* dayPx) \}\}/g,
    },
    {
      description: "timeline left and width geometry",
      expectedMatches: 5,
      pattern:
        /style=\{\{ left: (?:b\.left|i \* dayPx|bar\.left|LEFT_COL_WIDTH), width: (?:b\.width|dayPx|bar\.width|timelineWidth) \}\}/g,
    },
    {
      description: "today marker position",
      expectedMatches: 2,
      pattern: /style=\{\{ left: todayOffsetDays \* dayPx \}\}/g,
    },
    {
      description: "timeline minimum width",
      expectedMatches: 1,
      pattern:
        /style=\{\{ minWidth: LEFT_COL_WIDTH \+ timelineWidth \}\}/g,
    },
    {
      description: "sticky header geometry",
      expectedMatches: 1,
      pattern:
        /style=\{\{ width: LEFT_COL_WIDTH, height: HEADER_HEIGHT \}\}/g,
    },
  ],
  "packages/views/issues/components/thread-minimap.tsx": [
    {
      description: "measured minimap tick scale",
      expectedMatches: 2,
      pattern:
        /tick\.style\.(?:setProperty\("scale", s\)|removeProperty\("scale"\))/g,
    },
    {
      description: "measured minimap preview translation",
      expectedMatches: 1,
      pattern:
        /style=\{\{ transform: `translateY\(\$\{preview\.y\}px\) translateY\(-50%\)` \}\}/g,
    },
  ],
  "packages/views/agents/components/agent-list-page.tsx": [
    {
      description: "agent collection column track variables",
      expectedMatches: 2,
      pattern: /style=\{columnTrackVars\([\s\S]*?\)\}/g,
    },
    {
      description: "agent virtual list padding and launcher clearance",
      expectedMatches: 1,
      pattern:
        /style=\{\{\s*paddingTop:\s*virtualPadding\.top,\s*paddingBottom:\s*virtualPadding\.bottom \+ LIST_GRID_BOTTOM_CLEARANCE,\s*\}\}/g,
    },
  ],
  "packages/views/skills/components/skills-page.tsx": [
    {
      description: "skill collection column track variables",
      expectedMatches: 2,
      pattern: /style=\{columnTrackVars\([\s\S]*?\)\}/g,
    },
    {
      description: "skill virtual list padding and launcher clearance",
      expectedMatches: 1,
      pattern:
        /style=\{\{\s*paddingTop:\s*virtualPadding\.top,\s*paddingBottom:\s*virtualPadding\.bottom \+ LIST_GRID_BOTTOM_CLEARANCE,\s*\}\}/g,
    },
  ],
  "packages/views/autopilots/components/autopilots-page.tsx": [
    {
      description: "autopilot collection column track variables",
      expectedMatches: 2,
      pattern: /style=\{columnTrackVars\([\s\S]*?\)\}/g,
    },
    {
      description: "autopilot virtual list padding and launcher clearance",
      expectedMatches: 1,
      pattern:
        /style=\{\{\s*paddingTop:\s*virtualPadding\.top,\s*paddingBottom:\s*virtualPadding\.bottom \+ LIST_GRID_BOTTOM_CLEARANCE,\s*\}\}/g,
    },
  ],
  "packages/views/squads/components/squads-page.tsx": [
    {
      description: "squad collection columns and launcher clearance",
      expectedMatches: 1,
      pattern:
        /style=\{\{\s*\.\.\.columnTrackVars\(isColVisible, canManageAnyRow\),\s*paddingBottom:\s*LIST_GRID_BOTTOM_CLEARANCE,\s*\}\}/g,
    },
    {
      description: "squad loading column track variables",
      expectedMatches: 1,
      pattern:
        /style=\{columnTrackVars\(\s*\(key\) => !SQUAD_DEFAULT_HIDDEN_COLUMNS\.includes\(key\),\s*true,\s*\)\}/g,
    },
  ],
  "packages/views/runtimes/components/runtime-list.tsx": [
    {
      description: "runtime collection column track variables",
      expectedMatches: 1,
      pattern: /style=\{columnTrackVars\(showOwner, showActions\)\}/g,
    },
  ],
  "packages/views/runtimes/components/usage-section.tsx": [
    {
      description: "runtime cost ranking width",
      expectedMatches: 1,
      pattern: /style=\{\{ width: `\$\{pct\}%` \}\}/g,
    },
  ],
  "packages/views/dashboard/components/leaderboard.tsx": [
    {
      description: "dashboard leaderboard ranking width",
      expectedMatches: 1,
      pattern: /style=\{\{ width: `\$\{pct\}%` \}\}/g,
    },
  ],
  "packages/views/dashboard/components/errors-tab.tsx": [
    {
      description: "failure composition share width",
      expectedMatches: 1,
      pattern:
        /style=\{\{ width: `\$\{\(row\.count \/ total\) \* 100\}%` \}\}/g,
    },
    {
      description: "failure offender ranking width",
      expectedMatches: 1,
      pattern: /style=\{\{ width: `\$\{pct\}%` \}\}/g,
    },
    {
      description: "failure offender class share width",
      expectedMatches: 1,
      pattern:
        /style=\{\{ width: `\$\{\(row\.classes\[c\] \/ row\.failed\) \* 100\}%` \}\}/g,
    },
  ],
  "packages/views/settings/components/labels-tab.tsx": [
    {
      description: "settings label color CSS custom property",
      expectedMatches: 2,
      pattern:
        /style=\{\{ "--enact-settings-color": (?:label|draft)\.color \} as React\.CSSProperties\}/g,
    },
  ],
  "packages/views/settings/components/issue-statuses-tab.tsx": [
    {
      description: "settings status dnd transform and transition geometry",
      expectedMatches: 1,
      pattern:
        /style=\{\{ transform: CSS\.Transform\.toString\(transform\), transition \}\}/g,
    },
    {
      description: "settings status color CSS custom property",
      expectedMatches: 1,
      pattern:
        /style=\{\{ "--enact-settings-color": draft\.color \} as React\.CSSProperties\}/g,
    },
  ],
  "packages/views/settings/components/properties-tab.tsx": [
    {
      description: "settings property option color CSS custom property",
      expectedMatches: 2,
      pattern:
        /style=\{\{ "--enact-settings-color": option\.color \} as React\.CSSProperties\}/g,
    },
  ],
  "packages/views/editor/mermaid-diagram.tsx": [
    {
      description: "theme token probes for exported diagram colors",
      expectedMatches: 2,
      pattern: /probe\.style\.(?:color|display)/g,
    },
    {
      description: "measured diagram container geometry producer",
      expectedMatches: 1,
      pattern:
        /const containerStyle: CSSProperties \| undefined = rendered\s*\? undefined\s*: \{ minHeight: skeletonLayout\?\.height \?\? MERMAID_SKELETON_HEIGHT_PX \};/g,
    },
    {
      description: "measured diagram container geometry application",
      expectedMatches: 1,
      pattern: /style=\{containerStyle\}/g,
    },
    {
      description: "measured sandboxed diagram frame geometry",
      expectedMatches: 1,
      pattern:
        /style=\{\{\s*height: rendered\.layout \? `\$\{rendered\.layout\.height\}px` : undefined,\s*width: rendered\.layout \? `\$\{rendered\.layout\.width\}px` : undefined,\s*\}\}/g,
    },
  ],
  "packages/views/editor/zoom-canvas.tsx": [
    {
      description: "computed pan and zoom transform geometry",
      expectedMatches: 1,
      pattern:
        /style=\{\s*content\s*\? \{\s*width: `\$\{content\.width\}px`,\s*height: `\$\{content\.height\}px`,\s*transform: `translate\(\$\{canvas\.transform\.x\}px, \$\{canvas\.transform\.y\}px\) scale\(\$\{canvas\.transform\.scale\}\)`,\s*\}\s*: undefined\s*\}/g,
    },
  ],
  "packages/views/editor/bubble-menu.tsx": [
    {
      description: "Floating UI visibility and coordinates",
      expectedMatches: 3,
      pattern: /el\.style\.(?:visibility|left|top)/g,
    },
    {
      description: "initial floating visibility before positioning",
      expectedMatches: 1,
      pattern: /style=\{\{ visibility: visible \? "visible" : "hidden" \}\}/g,
    },
  ],
  "packages/views/editor/link-hover-card.tsx": [
    {
      description: "computed hover-card viewport coordinates",
      expectedMatches: 1,
      pattern:
        /style=\{\{\s*top: pos\.top,\s*left: pos\.left,\s*display: positioned \? undefined : "none",\s*\}\}/g,
    },
  ],
  "packages/views/editor/mermaid-viewer.tsx": [
    {
      description: "natural diagram frame geometry",
      expectedMatches: 1,
      pattern:
        /style=\{\{ width: `\$\{layout\.width\}px`, height: `\$\{layout\.height\}px` \}\}/g,
    },
  ],
  "packages/views/rich-content/lazy-rich-block.tsx": [
    {
      description: "reserved rich-block viewport height",
      expectedMatches: 1,
      pattern: /style=\{\{ minHeight: reservedHeightPx \}\}/g,
    },
  ],
  "packages/views/onboarding/components/step-shell.tsx": [
    {
      description: "runtime onboarding scroll fade mask producer",
      expectedMatches: 1,
      pattern: /const fadeStyle = useScrollFade\(mainRef\);/g,
    },
    {
      description: "runtime onboarding scroll fade mask application",
      expectedMatches: 1,
      pattern: /style=\{fadeStyle\}/g,
    },
  ],
  "packages/views/onboarding/components/onboarding-logout-button.tsx": [
    {
      description: "Electron onboarding no-drag logout control",
      expectedMatches: 1,
      pattern:
        /style=\{\{ WebkitAppRegion: "no-drag" \} as React\.CSSProperties\}/g,
    },
  ],
  "packages/views/onboarding/components/step-sidebar.tsx": [
    {
      description: "Electron onboarding no-drag back controls",
      expectedMatches: 2,
      pattern:
        /style=\{\{ WebkitAppRegion: "no-drag" \} as CSSProperties\}/g,
    },
  ],
};

const rawVisualAllowlist: Partial<
  Record<GovernedComponentPath, readonly RawVisualRule[]>
> = {
  "packages/ui/styles/base.css": [
    {
      description: "iOS editable-text zoom prevention",
      expectedMatches: 1,
      pattern: /font-size:\s*16px\s*!important;/g,
    },
  ],
  "packages/ui/components/ui/chart.tsx": [
    {
      description: "Recharts emitted stroke selector literals",
      expectedMatches: 5,
      pattern: /#(?:ccc|fff)\b/g,
    },
  ],
  "packages/views/common/avatar-crop-dialog.tsx": [
    {
      description: "JPEG alpha-flattening canvas background",
      expectedMatches: 1,
      pattern: /"#ffffff"/g,
    },
  ],
  "packages/views/common/color-picker.tsx": [
    {
      description: "user-selectable color palette and HSV gradients",
      expectedMatches: 21,
      pattern: /#[\da-f]{3,8}\b|`hsl\(\$\{hsv\.h\} 100% 50%\)`/gi,
    },
    {
      description: "color-picker contrast handles",
      expectedMatches: 2,
      pattern: /border-white/g,
    },
  ],
  "packages/views/issues/components/pickers/label-picker.tsx": [
    {
      description: "user-selectable label palette",
      expectedMatches: 10,
      pattern: /#[\da-f]{6}\b/gi,
    },
  ],
  "packages/views/labels/label-chip.tsx": [
    {
      description: "computed label foreground contrast outputs",
      expectedMatches: 3,
      pattern: /#(?:111827|f9fafb)\b/gi,
    },
  ],
  "packages/views/onboarding/components/brand-icons.tsx": [
    {
      description: "official onboarding provider SVG colors",
      expectedMatches: 7,
      pattern: /(?:fill|stroke)="#[\da-f]{3,8}"/gi,
    },
  ],
  "packages/views/runtimes/components/provider-logo.tsx": [
    {
      description: "official runtime provider SVG colors",
      expectedMatches: 28,
      pattern: /(?:fill|stroke)="#[\da-f]{3,8}"/gi,
    },
  ],
  "apps/web/app/layout.tsx": [
    {
      description: "browser light and dark theme metadata",
      expectedMatches: 2,
      pattern: /color:\s*"#(?:ffffff|05070b)"/gi,
    },
  ],
  "packages/views/editor/mermaid-diagram.tsx": [
    {
      description: "Canvas legacy-color normalization probe",
      expectedMatches: 1,
      pattern: /"#000"/g,
    },
    {
      description: "Canvas-normalized computed Mermaid color",
      expectedMatches: 1,
      pattern: /`rgb\(\$\{red\}, \$\{green\}, \$\{blue\}\)`/g,
    },
    {
      description: "export background fallback",
      expectedMatches: 1,
      pattern: /"rgb\(255, 255, 255\)"/g,
    },
    {
      description: "Mermaid primary color fallback",
      expectedMatches: 2,
      pattern: /"rgb\(245, 245, 245\)"/g,
    },
    {
      description: "Mermaid primary border fallback",
      expectedMatches: 2,
      pattern: /"rgb\(59, 130, 246\)"/g,
    },
    {
      description: "Mermaid primary text fallback",
      expectedMatches: 2,
      pattern: /"rgb\(17, 24, 39\)"/g,
    },
    {
      description: "Mermaid line color fallback",
      expectedMatches: 2,
      pattern: /"rgb\(107, 114, 128\)"/g,
    },
  ],
  "packages/views/auth/login-page.tsx": [
    {
      description: "official Google blue logo color",
      expectedMatches: 1,
      pattern: /#4285F4\b/g,
    },
    {
      description: "official Google green logo color",
      expectedMatches: 1,
      pattern: /#34A853\b/g,
    },
    {
      description: "official Google yellow logo color",
      expectedMatches: 1,
      pattern: /#FBBC05\b/g,
    },
    {
      description: "official Google red logo color",
      expectedMatches: 1,
      pattern: /#EA4335\b/g,
    },
  ],
};

const requiredPrimitives = [
  ".enact-surface-canvas",
  ".enact-surface-panel",
  ".enact-surface-card",
  ".enact-surface-raised",
  ".enact-feedback",
  ".enact-toolbar",
  ".enact-selection-item",
  ".enact-overlay-surface",
  ".enact-control",
  ".enact-form-control",
  ".enact-popup-surface",
  ".enact-dialog-backdrop",
  ".enact-menu-item",
  ".enact-tab-trigger",
  ".enact-table-row",
  ".enact-data-table-pinned-shadow",
  ".enact-sonner-theme",
] as const;

const requiredShellClasses = [
  ".enact-dashboard-shell",
  ".enact-sidebar-nav-item",
  ".enact-page-header",
  ".enact-collection-title",
  ".enact-right-sidebar-frame",
  ".enact-right-sidebar-panel",
  ".enact-desktop-shell",
  ".enact-desktop-canvas",
  ".enact-desktop-tab-button",
  ".enact-desktop-tab-content",
  ".enact-desktop-crash-shell",
  ".enact-desktop-edge-page",
  ".enact-desktop-edge-icon",
  ".enact-window-overlay",
] as const;

const requiredIssueClasses = [
  ".enact-issue-page",
  ".enact-issue-toolbar",
  ".enact-issue-state",
  ".enact-issue-filter-bar",
  ".enact-issue-filter-chip",
  ".enact-issue-view-bar",
  ".enact-issue-view-tab",
  ".enact-issue-batch-toolbar",
  ".enact-issue-list",
  ".enact-issue-list-row",
  ".enact-issue-board",
  ".enact-issue-board-column",
  ".enact-issue-board-card",
  ".enact-issue-swimlane-view",
  ".enact-issue-swimlane-cell",
  ".enact-issue-table",
  ".enact-issue-gantt",
  ".enact-issue-metadata-chip",
  ".enact-issue-picker-trigger",
  ".enact-issue-detail-content",
  ".enact-issue-inspector",
  ".enact-issue-comment-card",
  ".enact-issue-composer",
  ".enact-issue-thread-minimap",
  ".enact-issue-window",
] as const;

const requiredChatInboxClasses = [
  ".enact-chat-page",
  ".enact-chat-window",
  ".enact-chat-launcher",
  ".enact-chat-transcript",
  ".enact-chat-message-user",
  ".enact-chat-composer-surface",
  ".enact-chat-queue",
  ".enact-chat-banner",
  ".enact-chat-thread-row",
  ".enact-chat-history-title",
  ".enact-inbox-page",
  ".enact-inbox-list",
  ".enact-inbox-row",
  ".enact-inbox-compact-back",
] as const;

const requiredManagementClasses = [
  ".enact-management-page",
  ".enact-management-toolbar",
  ".enact-management-scope-trigger",
  ".enact-management-filter-trigger",
  ".enact-management-filter-clear",
  ".enact-management-row",
  ".enact-management-row-action",
  ".enact-management-batch-toolbar",
  ".enact-management-warning",
  ".enact-agent-status",
  ".enact-agent-status-dot",
  ".enact-agent-visibility-badge",
  ".enact-runtime-page",
  ".enact-runtime-status",
  ".enact-runtime-health-dot",
  ".enact-runtime-health-icon",
  ".enact-runtime-status-badge",
  ".enact-runtime-kind-badge",
  ".enact-runtime-machine-row",
  ".enact-usage-page",
  ".enact-usage-toolbar",
  ".enact-usage-segmented",
  ".enact-usage-segment",
  ".enact-usage-card",
  ".enact-usage-kpi-grid",
  ".enact-usage-bar-track",
  ".enact-usage-bar-fill",
  ".enact-usage-failure-segment",
  ".enact-usage-failure-swatch",
  ".enact-usage-legend-swatch",
  ".enact-autopilot-status",
  ".enact-autopilot-status-dot",
  ".enact-autopilot-template-card",
  ".enact-daemon-panel",
  ".enact-daemon-filter-chip",
  ".enact-daemon-log-row",
  ".enact-daemon-repeat-toggle",
  ".enact-daemon-runtime-actions",
  ".enact-daemon-status",
  ".enact-daemon-status-dot",
  ".enact-daemon-level-badge",
] as const;

const requiredSettingsClasses = [
  ".enact-settings-page",
  ".enact-settings-navigation",
  ".enact-settings-tab-list",
  ".enact-settings-tab-trigger",
  ".enact-settings-content",
  ".enact-settings-tab",
  ".enact-settings-section",
  ".enact-settings-card",
  ".enact-settings-row",
  ".enact-settings-save-state",
  ".enact-settings-field",
  ".enact-settings-field-error",
  ".enact-settings-notice",
  ".enact-settings-diagnostics",
  ".enact-settings-update-status",
  ".enact-update-notification",
  ".enact-settings-danger-zone",
  ".enact-settings-catalog",
  ".enact-settings-color-swatch",
  ".enact-billing-return-page",
  ".enact-billing-tier",
  ".enact-billing-status",
  ".enact-billing-interval-option",
  ".enact-billing-seat-preview",
] as const;

const requiredIntegrationClasses = [
  ".enact-integrations-stack",
  ".enact-integration-section",
  ".enact-integration-section-heading",
  ".enact-integration-provider-grid",
  ".enact-integration-provider-card",
  ".enact-integration-state-card",
  ".enact-integration-row",
  ".enact-integration-actions",
  ".enact-integration-status",
  ".enact-integration-status-dot",
  ".enact-integration-connected",
  ".enact-integration-form",
  ".enact-integration-dialog",
  ".enact-integration-bind-page",
  ".enact-integration-bind-card",
  ".enact-integration-bind-content",
  ".enact-integration-feature-row",
  ".enact-integration-resource-row",
  ".enact-integration-permission-trigger",
  ".enact-integration-installation-row",
] as const;

const requiredEditorClasses = [
  ".enact-editor-root",
  ".enact-editor-content",
  ".enact-editor-title",
  ".enact-editor-drop-overlay",
  ".enact-editor-bubble-menu",
  ".enact-editor-toolbar-action",
  ".enact-editor-suggestion",
  ".enact-rich-content",
  ".enact-rich-content-code-shell",
  ".enact-rich-content-mermaid",
  ".enact-attachment-card",
  ".enact-attachment-html-toolbar",
  ".enact-attachment-preview-page",
  ".enact-attachment-modal",
  ".enact-modal-create-issue",
  ".enact-modal-editor-region",
  ".enact-modal-footer",
  ".enact-modal-squad",
  ".enact-modal-feedback",
  ".enact-modal-mermaid",
] as const;

const requiredOnboardingAuthClasses = [
  ".enact-auth-page",
  ".enact-auth-desktop-shell",
  ".enact-invite-page",
  ".enact-invite-selection-item",
  ".enact-onboarding-shell",
  ".enact-onboarding-scroller",
  ".enact-onboarding-step-column",
  ".enact-onboarding-sidebar",
  ".enact-onboarding-compact-progress",
  ".enact-onboarding-option-card",
  ".enact-onboarding-runtime-card",
  ".enact-onboarding-workspace-card",
  ".enact-onboarding-workspace-create-card",
  ".enact-workspace-avatar",
  ".enact-workspace-no-access",
  ".enact-workspace-welcome-dialog",
  ".enact-workspace-welcome-loading",
] as const;

const requiredTokens = [
  "--space-unit",
  "--border-width",
  "--focus-ring-width",
  "--focus-ring-offset",
  "--disabled-opacity",
  "--motion-fast",
  "--motion-standard",
  "--motion-slow",
  "--ease-standard",
] as const;

const statusForegrounds = [
  "success",
  "warning",
  "info",
  "destructive",
] as const;

const requiredComponentClasses: Partial<
  Record<GovernedComponentPath, readonly string[]>
> = {
  "packages/ui/components/ui/button.tsx": ["enact-control"],
  "packages/ui/components/ui/input.tsx": [
    "enact-control",
    "enact-form-control",
  ],
  "packages/ui/components/ui/textarea.tsx": [
    "enact-control",
    "enact-form-control",
  ],
  "packages/ui/components/ui/select.tsx": [
    "enact-control",
    "enact-form-control",
    "enact-popup-surface",
    "enact-menu-item",
  ],
  "packages/ui/components/ui/checkbox.tsx": [
    "enact-control",
    "enact-form-control",
  ],
  "packages/ui/components/ui/switch.tsx": ["enact-control"],
  "packages/ui/components/ui/dialog.tsx": [
    "enact-dialog-backdrop",
    "enact-overlay-surface",
  ],
  "packages/ui/components/ui/alert-dialog.tsx": [
    "enact-dialog-backdrop",
    "enact-overlay-surface",
  ],
  "packages/ui/components/ui/dropdown-menu.tsx": [
    "enact-popup-surface",
    "enact-menu-item",
  ],
  "packages/ui/components/ui/context-menu.tsx": [
    "enact-popup-surface",
    "enact-menu-item",
  ],
  "packages/ui/components/ui/popover.tsx": ["enact-popup-surface"],
  "packages/ui/components/ui/tooltip.tsx": ["enact-popup-surface"],
  "packages/ui/components/ui/tabs.tsx": ["enact-tab-trigger"],
  "packages/ui/components/ui/table.tsx": ["enact-table-row"],
  "packages/ui/components/ui/data-table.tsx": [
    "enact-data-table-pinned-shadow",
  ],
  "packages/ui/components/ui/sidebar.tsx": ["enact-control"],
  "packages/ui/components/ui/card.tsx": ["enact-surface-card"],
  "packages/ui/components/ui/empty.tsx": ["enact-surface-panel"],
  "packages/ui/components/ui/sonner.tsx": ["enact-sonner-theme"],
  "packages/views/layout/dashboard-layout.tsx": ["enact-dashboard-shell"],
  "packages/views/layout/app-sidebar.tsx": ["enact-sidebar-nav-item"],
  "packages/views/layout/page-header.tsx": ["enact-page-header"],
  "packages/views/layout/collection-page.tsx": ["enact-collection-title"],
  "packages/views/layout/animated-right-sidebar.tsx": [
    "enact-right-sidebar-frame",
    "enact-right-sidebar-panel",
  ],
  "apps/desktop/src/renderer/src/components/desktop-layout.tsx": [
    "enact-desktop-shell",
    "enact-desktop-canvas",
  ],
  "apps/desktop/src/renderer/src/components/tab-bar.tsx": [
    "enact-desktop-tab-button",
  ],
  "apps/desktop/src/renderer/src/components/tab-content.tsx": [
    "enact-desktop-tab-content",
  ],
  "apps/desktop/src/renderer/src/components/window-overlay.tsx": [
    "enact-window-overlay",
  ],
  "apps/desktop/src/renderer/src/components/app-crash-boundary.tsx": [
    "enact-desktop-crash-shell",
    "enact-desktop-crash-card",
  ],
  "apps/desktop/src/renderer/src/components/route-error-page.tsx": [
    "enact-desktop-edge-page",
    "enact-desktop-edge-icon",
    "enact-desktop-edge-actions",
  ],
  "packages/views/issues/components/issues-page.tsx": ["enact-issue-page"],
  "packages/views/my-issues/components/my-issues-page.tsx": ["enact-issue-page"],
  "packages/views/issues/surface/issue-surface.tsx": ["enact-issue-state"],
  "packages/views/issues/components/issues-header.tsx": ["enact-issue-toolbar"],
  "packages/views/my-issues/components/my-issues-header.tsx": ["enact-issue-toolbar"],
  "packages/views/issues/components/filter-chips-bar.tsx": [
    "enact-issue-filter-bar",
    "enact-issue-filter-chip",
  ],
  "packages/views/issues/components/view-bar.tsx": [
    "enact-issue-view-bar",
    "enact-issue-view-tab",
  ],
  "packages/views/issues/components/batch-action-toolbar.tsx": ["enact-issue-batch-toolbar"],
  "packages/views/issues/components/list-view.tsx": ["enact-issue-list"],
  "packages/views/issues/components/list-row.tsx": ["enact-issue-list-row"],
  "packages/views/issues/components/board-view.tsx": ["enact-issue-board"],
  "packages/views/issues/components/board-column.tsx": ["enact-issue-board-column"],
  "packages/views/issues/components/board-card.tsx": ["enact-issue-board-card"],
  "packages/views/issues/components/swimlane-view.tsx": ["enact-issue-swimlane-view"],
  "packages/views/issues/components/table-view.tsx": ["enact-issue-table"],
  "packages/views/issues/components/gantt-view.tsx": ["enact-issue-gantt"],
  "packages/views/issues/components/pickers/property-picker.tsx": ["enact-issue-picker-trigger"],
  "packages/views/issues/components/issue-detail.tsx": [
    "enact-issue-detail-content",
    "enact-issue-inspector",
  ],
  "packages/views/issues/components/comment-card.tsx": ["enact-issue-comment-card"],
  "packages/views/issues/components/comment-input.tsx": ["enact-issue-composer"],
  "packages/views/issues/components/thread-minimap.tsx": ["enact-issue-thread-minimap"],
  "apps/desktop/src/renderer/src/components/issue-window.tsx": ["enact-issue-window"],
  "packages/views/chat/chat-page.tsx": ["enact-chat-page"],
  "packages/views/chat/components/chat-window.tsx": [
    "enact-chat-window",
    "enact-chat-history-title",
  ],
  "packages/views/chat/components/chat-fab.tsx": ["enact-chat-launcher"],
  "packages/views/chat/components/chat-resize-handles.tsx": ["enact-chat-resize-handle"],
  "packages/views/chat/components/chat-thread-list.tsx": ["enact-chat-thread-row"],
  "packages/views/chat/components/chat-session-header.tsx": ["enact-chat-session-header"],
  "packages/views/chat/components/chat-message-list.tsx": [
    "enact-chat-transcript",
    "enact-chat-message-user",
  ],
  "packages/views/chat/components/chat-input.tsx": ["enact-chat-composer-surface"],
  "packages/views/chat/components/chat-queue.tsx": ["enact-chat-queue"],
  "packages/views/chat/components/chat-empty-state.tsx": ["enact-chat-empty-state"],
  "packages/views/chat/components/offline-banner.tsx": ["enact-chat-banner"],
  "packages/views/chat/components/no-agent-banner.tsx": ["enact-chat-banner"],
  "packages/views/chat/components/archived-agent-banner.tsx": ["enact-chat-banner"],
  "packages/views/chat/components/agent-access-revoked-banner.tsx": ["enact-chat-banner"],
  "packages/views/chat/components/runtime-required-banner.tsx": ["enact-chat-banner"],
  "packages/views/chat/components/task-status-pill.tsx": ["enact-chat-task-status"],
  "packages/views/inbox/components/inbox-page.tsx": [
    "enact-inbox-page",
    "enact-inbox-list-panel",
    "enact-inbox-compact-back",
  ],
  "packages/views/inbox/components/inbox-list.tsx": ["enact-inbox-list"],
  "packages/views/inbox/components/inbox-list-item.tsx": ["enact-inbox-row"],
  "packages/views/agents/components/agent-list-page.tsx": [
    "enact-management-page",
    "enact-management-row",
    "enact-agent-status",
  ],
  "packages/views/agents/components/agent-list-toolbar.tsx": [
    "enact-management-toolbar",
    "enact-management-scope-trigger",
    "enact-management-filter-trigger",
  ],
  "packages/views/agents/components/agent-batch-toolbar.tsx": [
    "enact-management-batch-toolbar",
  ],
  "packages/views/agents/components/agent-row-actions.tsx": [
    "enact-management-row-action",
  ],
  "packages/views/agents/components/agent-presence-indicator.tsx": [
    "enact-agent-status",
    "enact-agent-status-dot",
  ],
  "packages/views/agents/components/visibility-badge.tsx": [
    "enact-agent-visibility-badge",
  ],
  "packages/views/runtimes/components/runtimes-page.tsx": [
    "enact-runtime-page",
    "enact-runtime-machine-row",
  ],
  "packages/views/runtimes/components/runtime-list.tsx": [
    "enact-management-row",
    "enact-runtime-status",
  ],
  "packages/views/runtimes/components/shared.tsx": [
    "enact-runtime-health-dot",
    "enact-runtime-health-icon",
    "enact-runtime-status-badge",
  ],
  "packages/views/runtimes/components/usage-section.tsx": [
    "enact-usage-segmented",
    "enact-usage-card",
    "enact-usage-bar-fill",
  ],
  "packages/views/skills/components/skills-page.tsx": [
    "enact-management-page",
    "enact-management-row",
  ],
  "packages/views/skills/components/skill-list-toolbar.tsx": [
    "enact-management-toolbar",
    "enact-management-filter-trigger",
  ],
  "packages/views/skills/components/skill-list-actions.tsx": [
    "enact-management-row-action",
    "enact-management-batch-toolbar",
  ],
  "packages/views/squads/components/squads-page.tsx": [
    "enact-management-page",
    "enact-management-row",
    "enact-management-row-action",
  ],
  "packages/views/autopilots/components/autopilots-page.tsx": [
    "enact-management-page",
    "enact-management-row",
    "enact-autopilot-template-card",
  ],
  "packages/views/autopilots/components/autopilot-list-toolbar.tsx": [
    "enact-management-toolbar",
    "enact-management-filter-trigger",
  ],
  "packages/views/autopilots/components/autopilot-list-actions.tsx": [
    "enact-management-row-action",
    "enact-management-batch-toolbar",
  ],
  "packages/views/dashboard/components/dashboard-page.tsx": [
    "enact-usage-page",
    "enact-usage-toolbar",
    "enact-usage-kpi-grid",
  ],
  "packages/views/dashboard/components/dashboard-filters.tsx": [
    "enact-management-filter-trigger",
  ],
  "packages/views/dashboard/components/dashboard-shared.tsx": [
    "enact-usage-segmented",
    "enact-usage-segment",
  ],
  "packages/views/dashboard/components/usage-trend-card.tsx": [
    "enact-usage-card",
  ],
  "packages/views/dashboard/components/leaderboard.tsx": [
    "enact-usage-card",
    "enact-usage-bar-fill",
  ],
  "packages/views/dashboard/components/errors-tab.tsx": [
    "enact-usage-card",
    "enact-usage-failure-segment",
  ],
  "apps/desktop/src/renderer/src/components/daemon-panel.tsx": [
    "enact-daemon-panel",
    "enact-daemon-log-row",
    "enact-daemon-status",
  ],
  "apps/desktop/src/renderer/src/components/daemon-runtime-card.tsx": [
    "enact-daemon-runtime-actions",
    "enact-daemon-status",
  ],
  "packages/views/settings/components/settings-layout.tsx": [
    "enact-settings-tab",
    "enact-settings-section",
    "enact-settings-card",
    "enact-settings-row",
    "enact-settings-save-state",
  ],
  "packages/views/settings/components/settings-page.tsx": [
    "enact-settings-page",
    "enact-settings-navigation",
    "enact-settings-tab-list",
    "enact-settings-tab-trigger",
    "enact-settings-content",
  ],
  "packages/views/settings/components/delete-workspace-dialog.tsx": [
    "enact-settings-field",
    "enact-settings-field-label",
  ],
  "packages/views/settings/components/billing-tab.tsx": [
    "enact-billing-interval-option",
    "enact-billing-seat-preview",
  ],
  "packages/views/settings/components/labels-tab.tsx": [
    "enact-settings-catalog",
    "enact-settings-color-swatch",
  ],
  "packages/views/settings/components/issue-statuses-tab.tsx": [
    "enact-settings-color-swatch",
  ],
  "packages/views/settings/components/properties-tab.tsx": [
    "enact-settings-catalog",
    "enact-settings-color-swatch",
  ],
  "packages/views/settings/components/quick-actions-tab.tsx": [
    "enact-settings-catalog",
  ],
  "packages/views/settings/components/integrations-tab.tsx": [
    "enact-integration-section-heading",
  ],
  "packages/views/settings/components/composio-tab.tsx": [
    "enact-integrations-stack",
    "enact-integration-provider-grid",
    "enact-integration-status",
  ],
  "packages/views/settings/components/lark-tab.tsx": [
    "enact-integrations-stack",
    "enact-integration-row",
  ],
  "packages/views/settings/components/slack-tab.tsx": [
    "enact-integrations-stack",
    "enact-integration-row",
  ],
  "packages/views/settings/components/dingtalk-tab.tsx": [
    "enact-integrations-stack",
    "enact-integration-installation-row",
  ],
  "packages/views/settings/components/wecom-tab.tsx": [
    "enact-integrations-stack",
    "enact-integration-row",
  ],
  "packages/views/settings/components/telegram-tab.tsx": [
    "enact-integrations-stack",
    "enact-integration-row",
  ],
  "packages/views/lark/bind-page.tsx": [
    "enact-integration-bind-page",
    "enact-integration-bind-card",
    "enact-integration-bind-content",
  ],
  "packages/views/slack/bind-page.tsx": [
    "enact-integration-bind-page",
    "enact-integration-bind-card",
    "enact-integration-bind-content",
  ],
  "packages/views/dingtalk/bind-page.tsx": [
    "enact-integration-bind-page",
    "enact-integration-bind-card",
    "enact-integration-bind-content",
  ],
  "packages/views/wecom/bind-page.tsx": [
    "enact-integration-bind-page",
    "enact-integration-bind-card",
    "enact-integration-bind-content",
  ],
  "packages/views/telegram/bind-page.tsx": [
    "enact-integration-bind-page",
    "enact-integration-bind-card",
    "enact-integration-bind-content",
  ],
  "apps/desktop/src/renderer/src/components/daemon-settings-tab.tsx": [
    "enact-settings-notice",
    "enact-settings-diagnostics",
  ],
  "apps/desktop/src/renderer/src/components/updates-settings-tab.tsx": [
    "enact-settings-update-status",
  ],
  "apps/desktop/src/renderer/src/components/update-notification.tsx": [
    "enact-update-notification",
  ],
  "packages/views/attachments/attachment-preview-page.tsx": [
    "enact-attachment-preview-page",
  ],
  "packages/views/editor/attachment-card.tsx": ["enact-attachment-card"],
  "packages/views/editor/attachment-preview-modal.tsx": [
    "enact-attachment-modal",
  ],
  "packages/views/editor/attachment.tsx": ["enact-attachment-image"],
  "packages/views/editor/bubble-menu.tsx": ["enact-editor-bubble-menu"],
  "packages/views/editor/code-block-iframe.tsx": [
    "enact-rich-content-frame",
  ],
  "packages/views/editor/code-block-static.tsx": [
    "enact-rich-content-code-static",
  ],
  "packages/views/editor/content-editor.tsx": ["enact-editor-root"],
  "packages/views/editor/file-drop-overlay.tsx": [
    "enact-editor-drop-overlay",
  ],
  "packages/views/editor/html-attachment-preview.tsx": [
    "enact-attachment-html",
  ],
  "packages/views/editor/link-hover-card.tsx": ["enact-editor-link-hover"],
  "packages/views/editor/mermaid-diagram.tsx": [
    "enact-rich-content-mermaid",
  ],
  "packages/views/editor/mermaid-viewer.tsx": ["enact-modal-mermaid"],
  "packages/views/editor/title-editor.tsx": ["enact-editor-title"],
  "packages/views/editor/zoom-canvas.tsx": ["enact-editor-zoom-controls"],
  "packages/views/rich-content/lazy-rich-block.tsx": [
    "enact-rich-content-lazy-placeholder",
  ],
  "packages/views/rich-content/rich-code-block.tsx": [
    "enact-rich-content-code-shell",
  ],
  "packages/views/rich-content/rich-content.tsx": ["enact-rich-content"],
  "packages/views/modals/create-issue-dialog.tsx": [
    "enact-modal-create-issue",
  ],
  "packages/views/modals/create-issue.tsx": [
    "enact-modal-editor-region",
    "enact-modal-toast-status",
  ],
  "packages/views/modals/create-squad.tsx": ["enact-modal-squad"],
  "packages/views/modals/delete-issue-confirm.tsx": [
    "enact-modal-confirm-hint",
    "enact-modal-danger-action",
  ],
  "packages/views/modals/feedback.tsx": ["enact-modal-feedback"],
  "packages/views/modals/issue-picker-modal.tsx": [
    "enact-modal-picker-row",
  ],
  "packages/views/modals/quick-create-issue.tsx": [
    "enact-modal-create-footer",
    "enact-modal-success-state",
  ],
  "packages/views/modals/run-confirm.tsx": ["enact-modal-run-field"],
  "packages/views/auth/login-page.tsx": ["enact-auth-page"],
  "packages/views/invite/invite-page.tsx": ["enact-invite-page"],
  "packages/views/invitations/invitations-page.tsx": ["enact-invite-page"],
  "packages/views/onboarding/components/cloud-waitlist-expand.tsx": [
    "enact-onboarding-cloud-panel",
  ],
  "packages/views/onboarding/components/icon-option-card.tsx": [
    "enact-onboarding-icon-option",
  ],
  "packages/views/onboarding/components/mika-intro.tsx": [
    "enact-onboarding-mika-intro",
  ],
  "packages/views/onboarding/components/onboarding-logout-button.tsx": [
    "enact-onboarding-logout",
  ],
  "packages/views/onboarding/components/option-card.tsx": [
    "enact-onboarding-option-card",
  ],
  "packages/views/onboarding/components/step-shell.tsx": [
    "enact-onboarding-shell",
    "enact-onboarding-scroller",
  ],
  "packages/views/onboarding/components/step-sidebar.tsx": [
    "enact-onboarding-sidebar",
    "enact-onboarding-compact-progress",
  ],
  "packages/views/onboarding/source-backfill-modal.tsx": [
    "enact-onboarding-backfill-dialog",
  ],
  "packages/views/onboarding/steps/cli-install-instructions.tsx": [
    "enact-onboarding-cli-card",
  ],
  "packages/views/onboarding/steps/step-about-you.tsx": [
    "enact-onboarding-option-grid",
  ],
  "packages/views/onboarding/steps/step-platform-fork.tsx": [
    "enact-onboarding-fork-list",
    "enact-onboarding-cli-dialog",
  ],
  "packages/views/onboarding/steps/step-runtime-connect.tsx": [
    "enact-onboarding-runtime-summary",
  ],
  "packages/views/onboarding/steps/step-welcome.tsx": [
    "enact-onboarding-welcome",
  ],
  "packages/views/onboarding/steps/step-workspace.tsx": [
    "enact-onboarding-workspace-fields",
    "enact-onboarding-workspace-card",
  ],
  "packages/views/workspace/no-access-page.tsx": [
    "enact-workspace-no-access",
  ],
  "packages/views/workspace/welcome-after-onboarding.tsx": [
    "enact-workspace-welcome-dialog",
  ],
  "packages/views/workspace/workspace-avatar.tsx": ["enact-workspace-avatar"],
  "apps/desktop/src/renderer/src/pages/login.tsx": [
    "enact-auth-desktop-shell",
  ],
  "apps/desktop/src/renderer/src/pages/auth-recovery.tsx": [
    "enact-auth-desktop-shell",
    "enact-auth-recovery-body",
  ],
};

const removeAllowedDynamicStyles = (
  path: GovernedComponentPath,
  source: string,
) => {
  let remaining = source;
  for (const rule of dynamicStyleAllowlist[path] ?? []) {
    const matches = remaining.match(rule.pattern) ?? [];
    expect(
      matches,
      `${path}: ${rule.description} whitelist changed`,
    ).toHaveLength(rule.expectedMatches);
    remaining = remaining.replace(rule.pattern, "");
  }
  return remaining;
};

const removeAllowedRawVisuals = (
  path: GovernedComponentPath,
  source: string,
) => {
  let remaining = source;
  for (const rule of rawVisualAllowlist[path] ?? []) {
    const matches = remaining.match(rule.pattern) ?? [];
    expect(
      matches,
      `${path}: ${rule.description} whitelist changed`,
    ).toHaveLength(rule.expectedMatches);
    remaining = remaining.replace(rule.pattern, "");
  }
  return remaining;
};

describe("visual architecture", () => {
  const primitives = stripComments(
    readRepoFile("packages/ui/styles/primitives.css"),
  );
  const shell = stripComments(
    readRepoFile("packages/ui/styles/features/shell.css"),
  );
  const issues = stripComments(
    readRepoFile("packages/ui/styles/features/issues.css"),
  );
  const chatInbox = stripComments(
    readRepoFile("packages/ui/styles/features/chat-inbox.css"),
  );
  const management = stripComments(
    readRepoFile("packages/ui/styles/features/agents-runtimes.css"),
  );
  const settings = stripComments(
    readRepoFile("packages/ui/styles/features/settings.css"),
  );
  const integrations = stripComments(
    readRepoFile("packages/ui/styles/features/integrations.css"),
  );
  const editor = stripComments(
    readRepoFile("packages/ui/styles/features/editor.css"),
  );
  const onboardingAuth = stripComments(
    readRepoFile("packages/ui/styles/features/onboarding-auth.css"),
  );
  const tokens = stripComments(readRepoFile("packages/ui/styles/tokens.css"));

  it("defines the shared semantic primitives", () => {
    for (const className of requiredPrimitives) {
      expect(primitives, `${className} is missing`).toContain(className);
    }
  });

  it("defines the shared shell and desktop chrome classes", () => {
    for (const className of requiredShellClasses) {
      expect(shell, `${className} is missing`).toContain(className);
    }
  });

  it("preserves tuned desktop tab flares and forced-color canvas boundaries", () => {
    const flareRule = shell.match(
      /\.enact-desktop-tab-flare\s*\{([\s\S]*?)\n\s*\}/,
    )?.[1] ?? "";

    expect(flareRule.match(/radial-gradient\(/g)).toHaveLength(3);
    expect(flareRule).toContain(
      "transparent calc(var(--enact-tab-flare-radius) - calc(var(--border-width) * 1.2))",
    );
    expect(flareRule).toContain(
      "var(--surface-border) calc(var(--enact-tab-flare-radius) - calc(var(--border-width) * 0.8))",
    );
    expect(flareRule).toContain(
      "var(--surface-border) calc(var(--enact-tab-flare-radius) - calc(var(--border-width) * 0.2))",
    );
    expect(flareRule).toContain(
      "var(--page-canvas) calc(var(--enact-tab-flare-radius) + calc(var(--border-width) * 0.2))",
    );
    expect(flareRule).toContain("mask-image: radial-gradient(");
    expect(flareRule).toContain("-webkit-mask-image: radial-gradient(");
    expect(flareRule).toContain(
      "transparent calc(var(--enact-tab-flare-radius) - calc(var(--border-width) * 1.6))",
    );
    expect(shell).toMatch(
      /\.enact-desktop-tab-flare\[data-side="left"\][\s\S]*?--enact-tab-flare-side:\s*left;[\s\S]*?left:\s*calc\(\(var\(--enact-tab-flare-radius\) - var\(--border-width\)\) \* -1\);/,
    );
    expect(shell).toMatch(
      /\.enact-desktop-tab-flare\[data-side="right"\][\s\S]*?--enact-tab-flare-side:\s*right;[\s\S]*?right:\s*calc\(\(var\(--enact-tab-flare-radius\) - var\(--border-width\)\) \* -1\);/,
    );

    const forcedColors = shell.slice(shell.indexOf("@media (forced-colors: active)"));
    expect(forcedColors).toMatch(
      /\.enact-desktop-canvas\s*\{[^}]*outline:\s*var\(--border-width\) solid CanvasText;[^}]*outline-offset:\s*calc\(var\(--border-width\) \* -1\);/,
    );
  });

  it("defines shared issue-domain classes", () => {
    for (const className of requiredIssueClasses) {
      expect(issues, `${className} is missing`).toContain(className);
    }
    expect(issues).toMatch(
      /\.enact-issue-list-row\[data-selected="true"\],[\s\S]*?\.enact-issue-list-row\[data-selected="true"\]:hover,[\s\S]*?background-color:\s*var\(--surface-selected\);/,
    );
    expect(issues).toMatch(
      /\.enact-issue-board-column[\s\S]*?--enact-issue-status:[\s\S]*?color-mix\(/,
    );
    expect(issues).toMatch(
      /\.enact-issue-picker-item:not\(\[data-custom-hover\]\):hover,[\s\S]*?background-color:\s*var\(--accent\);/,
    );
    expect(issues).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.enact-issue-list-section,[\s\S]*?transition:\s*none;/,
    );
    expect(issues).toMatch(
      /@media \(forced-colors: active\)[\s\S]*?\.enact-issue-filter-chip\s*\{[^}]*outline:\s*var\(--border-width\) solid CanvasText;[^}]*\}/,
    );
  });

  it("defines Task 6 chat and inbox classes and cascade order", () => {
    const entry = readRepoFile("packages/ui/styles/application-theme.css");
    expect(entry).toMatch(
      /@import "\.\/features\/issues\.css";\s*@import "\.\/features\/chat-inbox\.css";/,
    );

    for (const className of requiredChatInboxClasses) {
      const selector = className.replace(".", "\\.");
      expect(chatInbox, `${className} is missing`).toMatch(
        new RegExp(`${selector}(?=[\\s,:{\\[])`),
      );
    }

    expect(chatInbox).toMatch(
      /\.enact-inbox-row\[data-selected="true"\],[\s\S]*?\.enact-inbox-row\[data-selected="true"\]:hover[\s\S]*?background-color:\s*var\(--surface-selected\);/,
    );
    expect(chatInbox).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.enact-chat-launcher[\s\S]*?transition:\s*none;/,
    );
    expect(chatInbox).toMatch(
      /@media \(forced-colors: active\)[\s\S]*?\.enact-inbox-row\[data-selected="true"\][\s\S]*?outline:\s*var\(--border-width\) solid Highlight;/,
    );
    expect(chatInbox).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.enact-chat-launcher,\s*\.enact-chat-quick-actions,\s*\.enact-chat-queue,[\s\S]*?animation:\s*none;/,
    );
    expect(chatInbox).toMatch(
      /\.enact-chat-composer-context-warning\s*\{[^}]*color:\s*var\(--foreground\);/,
    );
    expect(chatInbox).toMatch(
      /\.enact-chat-running-indicator\s*\{[^}]*color:\s*var\(--foreground\);/,
    );
    expect(chatInbox).toMatch(
      /\.enact-chat-runtime-warning\s*\{[^}]*color:\s*var\(--foreground\);/,
    );
    expect(chatInbox).toMatch(
      /\.enact-chat-banner-icon\s*\{[^}]*color:\s*currentColor;/,
    );
  });

  it("defines Task 7 management, status, usage, and Desktop daemon presentation", () => {
    const entry = readRepoFile("packages/ui/styles/application-theme.css");
    expect(entry).toMatch(
      /@import "\.\/features\/chat-inbox\.css";\s*@import "\.\/features\/agents-runtimes\.css";/,
    );

    for (const className of requiredManagementClasses) {
      const selector = className.replace(".", "\\.");
      expect(management, `${className} is missing`).toMatch(
        new RegExp(`${selector}(?=[\\s,:{\\[])`),
      );
    }

    expect(management).toMatch(
      /\.enact-management-row\[data-selected="true"\],[\s\S]*?\.enact-management-row\[data-selected="true"\]:hover[\s\S]*?background-color:\s*var\(--surface-selected\);/,
    );
    expect(management).toMatch(
      /\.enact-management-row-action:focus-visible\s*\{[^}]*outline:\s*var\(--focus-ring-width\) solid var\(--ring\);[^}]*outline-offset:\s*var\(--focus-ring-offset\);/,
    );
    expect(management).toMatch(
      /\.enact-usage-segmented\[data-disabled="true"\]\s*\{[^}]*opacity:\s*var\(--disabled-opacity\);/,
    );
    expect(management).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.enact-management-row,[\s\S]*?\[data-enact-platform="desktop"\] \.enact-daemon-log-row,[\s\S]*?transition:\s*none;[\s\S]*?\.enact-daemon-status-dot\s*\{[^}]*animation:\s*none;/,
    );
    expect(management).toMatch(
      /@media \(forced-colors: active\)[\s\S]*?\.enact-management-row\[data-selected="true"\],[\s\S]*?outline:\s*var\(--border-width\) solid Highlight;/,
    );
    expect(management).toMatch(
      /@media \(forced-colors: active\)[\s\S]*?\[data-enact-platform="desktop"\]\.enact-daemon-panel,[\s\S]*?border-color:\s*CanvasText;/,
    );
    expect(management).toMatch(
      /\[data-enact-platform="desktop"\]\.enact-daemon-panel\s*\{/,
    );
    expect(management).toMatch(
      /\[data-enact-platform="desktop"\]\.enact-daemon-runtime-actions\s*\{/,
    );
    expect(management).toMatch(
      /\.enact-agent-status-dot\[data-availability="online"\],[\s\S]*?\.enact-daemon-status-dot\[data-state="running"\]/,
    );
    for (const state of ["starting", "stopping", "installing_cli"] as const) {
      expect(management).toMatch(
        new RegExp(
          `\\.enact-daemon-status-dot\\[data-state="${state}"\\][\\s\\S]*?animation:\\s*enact-daemon-pulse`,
        ),
      );
    }
    for (const state of ["cli_not_found", "auth_expired"] as const) {
      expect(management).toMatch(
        new RegExp(
          `\\.enact-daemon-status-dot\\[data-state="${state}"\\][\\s\\S]*?background-color:\\s*var\\(--destructive\\);`,
        ),
      );
    }
    expect(management).not.toContain('data-state="error"');
  });

  it("defines Task 8 settings, billing, integration, and Desktop update presentation", () => {
    const entry = readRepoFile("packages/ui/styles/application-theme.css");
    const updateNotification = readRepoFile(
      "apps/desktop/src/renderer/src/components/update-notification.tsx",
    );

    expect(entry).toMatch(
      /@import "\.\/features\/agents-runtimes\.css";\s*@import "\.\/features\/settings\.css";\s*@import "\.\/features\/integrations\.css";/,
    );

    for (const className of requiredSettingsClasses) {
      const selector = className.replace(".", "\\.");
      expect(settings, `${className} is missing`).toMatch(
        new RegExp(`${selector}(?=[\\s,:{\\[])`),
      );
    }
    for (const className of requiredIntegrationClasses) {
      const selector = className.replace(".", "\\.");
      expect(integrations, `${className} is missing`).toMatch(
        new RegExp(`${selector}(?=[\\s,:{\\[])`),
      );
    }

    expect(settings).toMatch(
      /\.enact-settings-tab-trigger\[data-active\],\s*\.enact-settings-tab-trigger\[data-active\]:hover\s*\{[^}]*background-color:\s*var\(--surface-selected\)\s*!important;[^}]*color:\s*var\(--surface-selected-foreground\)\s*!important;/,
    );
    expect(settings).toMatch(
      /\.enact-settings-save-state\[data-status="error"\],\s*\.enact-settings-field-error\s*\{[^}]*color:\s*var\(--destructive\);/,
    );
    expect(settings).toMatch(
      /\.enact-settings-danger-zone\s*\{[^}]*border-color:\s*color-mix\([^}]*var\(--destructive\)[^}]*background-color:\s*color-mix\([^}]*var\(--destructive\)/,
    );
    expect(settings).toMatch(
      /\.enact-settings-color-trigger:focus-visible,\s*\.enact-billing-interval-option:focus-visible,\s*\.enact-billing-tier:focus-visible\s*\{[^}]*outline:\s*var\(--focus-ring-width\) solid var\(--ring\);[^}]*outline-offset:\s*var\(--focus-ring-offset\);/,
    );
    expect(settings).toMatch(
      /\.enact-billing-tier:disabled\s*\{[^}]*cursor:\s*not-allowed;[^}]*opacity:\s*var\(--disabled-opacity\);/,
    );
    expect(settings).toMatch(
      /\.enact-billing-interval-option\[aria-pressed="true"\],\s*\.enact-billing-interval-option\[aria-pressed="true"\]:hover\s*\{[^}]*background-color:\s*var\(--surface-selected\);[^}]*color:\s*var\(--surface-selected-foreground\);/,
    );
    expect(settings).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\[data-enact-platform="desktop"\]\.enact-update-notification\s*\{[^}]*animation:\s*none;[\s\S]*?@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.enact-billing-interval-option\s*\{[^}]*transition:\s*none;/,
    );
    expect(settings).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.enact-settings-color-option,\s*\.enact-settings-color-trigger,[\s\S]*?\{\s*transition:\s*none;/,
    );
    expect(settings).toMatch(
      /@media \(forced-colors: active\)[\s\S]*?\[data-enact-platform="desktop"\]\.enact-update-notification,[\s\S]*?border-color:\s*CanvasText;[\s\S]*?@media \(forced-colors: active\)[\s\S]*?\.enact-settings-tab-trigger\[data-active\],[\s\S]*?outline:\s*var\(--border-width\) solid Highlight;/,
    );

    expect(integrations).toMatch(
      /\.enact-integration-status-row:focus-visible,\s*\.enact-integration-permission-trigger:focus-visible,\s*\.enact-integration-resource-id:focus-visible\s*\{[^}]*outline:\s*var\(--focus-ring-width\) solid var\(--ring\);[^}]*outline-offset:\s*var\(--focus-ring-offset\);/,
    );
    for (const [status, token] of [
      ["active", "success"],
      ["connected", "success"],
      ["expired", "warning"],
      ["pending", "warning"],
      ["error", "destructive"],
      ["revoked", "destructive"],
    ] as const) {
      expect(integrations).toMatch(
        new RegExp(
          `\\.enact-integration-status\\[data-status="${status}"\\][\\s\\S]*?color:\\s*var\\(--${token}\\);`,
        ),
      );
    }
    expect(integrations).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.enact-integration-status-row,[\s\S]*?transition:\s*none;[\s\S]*?\.enact-integration-status-icon\[data-loading="true"\]\s*\{[^}]*animation:\s*none;/,
    );
    expect(integrations).toMatch(
      /@media \(forced-colors: active\)[\s\S]*?\.enact-integration-status-dot[\s\S]*?border:\s*var\(--border-width\) solid CanvasText;[\s\S]*?\.enact-integration-status-dot\[data-status="active"\],[\s\S]*?background-color:\s*Highlight;/,
    );
    expect(settings).toMatch(
      /\[data-enact-platform="desktop"\]\.enact-update-notification\s*\{/,
    );
    expect(updateNotification).toMatch(
      /<div\s+data-enact-platform="desktop"\s+className="enact-update-notification"\s*>/,
    );
  });

  it("defines Task 9 editor, modal, auth, and onboarding presentation", () => {
    const entry = readRepoFile("packages/ui/styles/application-theme.css");

    expect(entry).toMatch(
      /@import "\.\/features\/integrations\.css";\s*@import "\.\/features\/editor\.css";\s*@import "\.\/features\/onboarding-auth\.css";/,
    );

    for (const className of requiredEditorClasses) {
      const selector = className.replace(".", "\\.");
      expect(editor, `${className} is missing`).toMatch(
        new RegExp(`${selector}(?=[\\s,:{\\[])`),
      );
    }
    for (const className of requiredOnboardingAuthClasses) {
      const selector = className.replace(".", "\\.");
      expect(onboardingAuth, `${className} is missing`).toMatch(
        new RegExp(`${selector}(?=[\\s,:{\\[])`),
      );
    }

    expect(editor).toMatch(
      /\.enact-editor-menu-item:focus-visible,[\s\S]*?\.enact-modal-icon-action:focus-visible\s*\{[^}]*outline:\s*var\(--focus-ring-width\) solid var\(--ring\);[^}]*outline-offset:\s*var\(--focus-ring-offset\);/,
    );
    expect(editor).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.enact-editor-toolbar-action,[\s\S]*?\.enact-modal-create-issue,[\s\S]*?transition:\s*none;/,
    );
    expect(editor).toMatch(
      /@media \(forced-colors: active\)[\s\S]*?\.enact-attachment-modal,[\s\S]*?border-color:\s*CanvasText;[\s\S]*?\.enact-editor-suggestion-item\[data-active="true"\][\s\S]*?outline:\s*var\(--border-width\) solid Highlight;/,
    );

    expect(onboardingAuth).toMatch(
      /\.enact-onboarding-step-button:focus-visible\s*\{[^}]*outline:\s*var\(--focus-ring-width\) solid var\(--ring\);[^}]*outline-offset:\s*var\(--focus-ring-offset\);/,
    );
    expect(onboardingAuth).toMatch(
      /\.enact-onboarding-runtime-status\s*\{[^}]*color:\s*var\(--success\);/,
    );
    expect(onboardingAuth).toMatch(
      /\.enact-onboarding-runtime-status\[data-online="false"\]\s*\{[^}]*color:\s*var\(--muted-foreground\);/,
    );
    expect(onboardingAuth).toMatch(
      /\.enact-onboarding-runtime-refresh-icon\[data-spinning="true"\],\s*\.enact-onboarding-action-icon\[data-spinning="true"\]\s*\{[^}]*animation:\s*spin var\(--motion-slow\) linear infinite;/,
    );
    expect(onboardingAuth).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.enact-onboarding-action-icon\[data-spinning="true"\],[\s\S]*?animation:\s*none;/,
    );
    expect(onboardingAuth).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.enact-workspace-welcome-emoji[\s\S]*?animation:\s*none;[\s\S]*?\.enact-onboarding-workspace-card,[\s\S]*?transition:\s*none;/,
    );
    expect(onboardingAuth).toMatch(
      /@media \(forced-colors: active\)[\s\S]*?\.enact-workspace-welcome-preview[\s\S]*?border-color:\s*CanvasText;[\s\S]*?\.enact-onboarding-workspace-card\[aria-checked="true"\],[\s\S]*?outline:\s*var\(--border-width\) solid Highlight;/,
    );
  });

  it("defines Task 10 fixed-light landing and Desktop edge presentation", () => {
    const landingCss = stripComments(readRepoFile("apps/web/app/custom.css"));
    const landingLayout = readRepoFile("apps/web/app/(landing)/layout.tsx");
    const crashBoundary = readRepoFile(
      "apps/desktop/src/renderer/src/components/app-crash-boundary.tsx",
    );
    const routeError = readRepoFile(
      "apps/desktop/src/renderer/src/components/route-error-page.tsx",
    );

    expect(tokens).toMatch(
      /\.enact-fixed-light,\s*\.enact-fixed-light \*\s*\{[^}]*color-scheme:\s*light;/,
    );
    expect(tokens).toMatch(
      /:root,\s*\.dark\s*\{[^}]*color-scheme:\s*dark;[^}]*--app-shell:\s*hsl\(228 24% 8%\);[^}]*--primary:\s*hsl\(147 87% 33%\);/,
    );
    expect(tokens).toMatch(
      /\.light,\s*\.enact-fixed-light\s*\{[^}]*color-scheme:\s*light;[^}]*--app-shell:\s*hsl\(220 20% 96%\);/,
    );
    expect(landingLayout).toContain("enact-fixed-light landing-light");
    expect(landingCss).not.toMatch(
      /--(?:app-shell|page-canvas|surface|background|foreground|card|popover|primary|secondary|muted|faint-foreground|accent|destructive|success|warning|info|border|input|ring|brand|scrollbar)[\w-]*\s*:/,
    );
    expect(landingCss).toContain("--font-serif:");

    expect(shell).toMatch(
      /\.enact-desktop-crash-shell\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/,
    );
    expect(shell).toMatch(
      /\.enact-desktop-edge-icon\[data-tone="destructive"\]\s*\{[^}]*var\(--destructive\)/,
    );
    expect(shell).toMatch(
      /@media \(forced-colors: active\)[\s\S]*?\.enact-desktop-tab-active-cap,[^{}]*\.enact-desktop-tab-added-highlight,[^{}]*\.enact-desktop-crash-card\s*\{[^}]*border-color:\s*CanvasText;/,
    );
    expect(crashBoundary).toMatch(
      /<div className="enact-desktop-crash-shell">\s*<DragStrip \/>/,
    );
    expect(routeError).toContain(
      'className="enact-desktop-edge-icon" data-tone="destructive"',
    );
  });

  it("keeps Task 7 status meaning available without color", () => {
    const agents = readRepoFile(
      "packages/views/agents/components/agent-presence-indicator.tsx",
    );
    const runtimes = readRepoFile(
      "packages/views/runtimes/components/shared.tsx",
    );
    const autopilots = readRepoFile(
      "packages/views/autopilots/components/autopilots-page.tsx",
    );
    const daemonPanel = readRepoFile(
      "apps/desktop/src/renderer/src/components/daemon-panel.tsx",
    );
    const daemonActions = readRepoFile(
      "apps/desktop/src/renderer/src/components/daemon-runtime-card.tsx",
    );

    expect(agents).toContain("data-availability={detail.availability}");
    expect(agents).toContain("availabilityLabel");
    expect(runtimes).toContain("HEALTH_ICON");
    expect(runtimes).toContain("data-health={health}");
    expect(autopilots).toMatch(
      /const statusLabel = knownStatus[\s\S]*?\$\.run_status\[knownStatus\][\s\S]*?data-status=\{knownStatus \?\? "unknown"\}[\s\S]*?aria-hidden="true"[\s\S]*?\{statusLabel && <span className="sr-only">\{statusLabel\}<\/span>\}/,
    );
    expect(daemonPanel).toContain("DAEMON_STATE_LABELS[status.state]");
    expect(daemonPanel).toContain("data-state={status.state}");
    expect(daemonActions).toContain("DAEMON_STATE_LABELS[status.state]");
    expect(daemonActions).toContain("Managed outside the app");
    expect(daemonActions).toContain("Sign-in expired");
  });

  it("defines every token consumed by shared primitives", () => {
    for (const token of requiredTokens) {
      expect(tokens, `${token} is missing`).toMatch(
        new RegExp(`${token.replaceAll("-", "\\-")}:\\s*[^;]+;`),
      );
    }

    for (const status of statusForegrounds) {
      expect(tokens).toContain(
        `--color-${status}-foreground: var(--${status}-foreground);`,
      );
    }
  });

  it("keeps selected items, tabs, and table rows identifiable while hovered", () => {
    expect(primitives).toMatch(
      /\.enact-selection-item\[data-active="true"\]:hover,[\s\S]*?\{[^}]*background-color:\s*var\(--surface-selected\);[^}]*color:\s*var\(--surface-selected-foreground\);[^}]*\}/,
    );
    expect(primitives).toMatch(
      /\.enact-tab-trigger\[data-active\],[\s\S]*?\.enact-tab-trigger\[data-active\]:hover\s*\{[^}]*background-color:\s*var\(--surface-selected\);[^}]*color:\s*var\(--surface-selected-foreground\);[^}]*\}/,
    );
    expect(primitives).toMatch(
      /\.enact-table-row\[data-state="selected"\],[\s\S]*?\.enact-table-row\[data-state="selected"\]:hover\s*\{[^}]*background-color:\s*var\(--surface-selected\);[^}]*color:\s*var\(--surface-selected-foreground\);[^}]*\}/,
    );
  });

  it("pins focus and disabled presentation to semantic tokens", () => {
    expect(primitives).toMatch(
      /\.enact-control:focus-visible\s*\{[^}]*outline:\s*var\(--focus-ring-width\) solid var\(--ring\);[^}]*outline-offset:\s*var\(--focus-ring-offset\);[^}]*\}/,
    );
    expect(primitives).toMatch(
      /:is\(:disabled, \[aria-disabled="true"\], \[data-disabled\]\)\s*\{[^}]*cursor:\s*not-allowed;[^}]*opacity:\s*var\(--disabled-opacity\);[^}]*\}/,
    );
  });

  it("removes primitive motion when reduced motion is requested", () => {
    const reducedMotionStart = primitives.indexOf(
      "@media (prefers-reduced-motion: reduce)",
    );
    const forcedColorsStart = primitives.indexOf(
      "@media (forced-colors: active)",
    );
    const reducedMotion = primitives.slice(
      reducedMotionStart,
      forcedColorsStart,
    );

    expect(reducedMotionStart).toBeGreaterThanOrEqual(0);
    expect(reducedMotion).toMatch(
      /\.enact-control,[\s\S]*?\.enact-selection-item\s*\{[^}]*transition:\s*none;/,
    );
    expect(reducedMotion).toMatch(
      /\[data-slot\]\.enact-dialog-backdrop:is\(\[data-open\], \[data-closed\]\),[\s\S]*?\[data-slot\]\.enact-overlay-surface:is\(\[data-open\], \[data-closed\]\)\s*\{[^}]*animation:\s*none;/,
    );
    expect(reducedMotion).toMatch(
      /\.enact-feedback\[aria-busy="true"\][^{]*\{[^}]*animation:\s*none;/,
    );
  });

  it("retains boundaries and selection indicators in forced colors", () => {
    const forcedColorsStart = primitives.indexOf(
      "@media (forced-colors: active)",
    );
    const forcedColors = primitives.slice(forcedColorsStart);

    expect(forcedColorsStart).toBeGreaterThanOrEqual(0);
    expect(forcedColors).toMatch(/border-color:\s*CanvasText;/);
    expect(forcedColors).toMatch(
      /\.enact-selection-item\[data-active="true"\],[\s\S]*?\.enact-table-row\[data-state="selected"\]\s*\{[^}]*border-color:\s*Highlight;[^}]*outline:\s*var\(--border-width\) solid Highlight;/,
    );
  });

  it("keeps governed styles free of local color and typography systems", () => {
    const violations: string[] = [];

    for (const path of governedStylePaths) {
      const source = stripComments(readRepoFile(path));
      const remaining = removeAllowedRawVisuals(path, source);
      const lines = remaining.split("\n");

      lines.forEach((line, index) => {
        if (/#[\da-f]{3,8}\b|\b(?:rgb|hsl|oklch)\(/i.test(line)) {
          violations.push(`${path}:${index + 1} raw color: ${line.trim()}`);
        }
        if (/font-size:(?!\s*var\()\s*[^;}]+/.test(line)) {
          violations.push(`${path}:${index + 1} raw font size: ${line.trim()}`);
        }
      });
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("governs shared primitives, shell, and issue-domain components with semantic classes", () => {
    for (const path of governedComponentPaths) {
      const source = readRepoFile(path);
      for (const className of requiredComponentClasses[path] ?? []) {
        expect(source, `${path} must use ${className}`).toContain(className);
      }
    }
  });

  it("keeps all product components free of raw visual systems", () => {
    const violations: string[] = [];

    for (const path of governedProductComponentPaths) {
      const source = stripComments(readRepoFile(path));
      const remaining = removeAllowedRawVisuals(path, source);
      const lines = remaining.split("\n");

      lines.forEach((line, index) => {
        if (/#[\da-f]{3,8}\b|\b(?:rgb|hsl|oklch)\(/i.test(line)) {
          violations.push(`${path}:${index + 1} raw color: ${line.trim()}`);
        }
        if (/\b(?:bg|text|border)-(?:black|white|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:\b|\/)/.test(line)) {
          violations.push(`${path}:${index + 1} named color: ${line.trim()}`);
        }
        if (/\btext-(?:xs|sm|base|lg|xl|[2-9]xl)\b/.test(line)) {
          violations.push(`${path}:${index + 1} raw type ramp: ${line.trim()}`);
        }
      });
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("allows only property-specific dynamic geometry styles", () => {
    const violations: string[] = [];
    const scrollFade = stripComments(
      readRepoFile("packages/ui/hooks/use-scroll-fade.ts"),
    );

    expect(scrollFade).toMatch(
      /return \{\s*maskImage: gradient,\s*WebkitMaskImage: gradient,\s*\};/,
    );

    for (const path of governedProductComponentPaths) {
      const source = stripComments(readRepoFile(path));
      const remaining = removeAllowedDynamicStyles(path, source);
      const lines = remaining.split("\n");

      lines.forEach((line, index) => {
        if (/\bstyle\s*=\s*\{|\.style(?:\.|\[)/.test(line)) {
          violations.push(
            `${path}:${index + 1} unapproved dynamic style: ${line.trim()}`,
          );
        }
      });
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("does not let the timeline playhead exception span unrelated dynamic styles", () => {
    const rule = dynamicStyleAllowlist[
      "packages/views/common/task-transcript/run-timeline.tsx"
    ]?.find(({ description }) =>
      description === "timeline selected playhead position",
    );

    expect(rule).toBeDefined();
    if (!rule) throw new Error("Missing timeline selected playhead allowlist");

    const mutatedSource = [
      '<div style={{ left: `${unrelatedOffset}%` }} />',
      '<span style={{ color: "red" }} />',
      "<div",
      "  style={{",
      "    left: `${",
      "      (Math.min(Math.max(selectedOffsetMs, 0), lanes.totalMs) / lanes.totalMs) * 100",
      "    }%`,",
      "  }}",
      "/>\n",
    ].join("\n");
    const matches =
      mutatedSource.match(new RegExp(rule.pattern.source, rule.pattern.flags)) ??
      [];
    const remaining = mutatedSource.replace(
      new RegExp(rule.pattern.source, rule.pattern.flags),
      "",
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]).not.toContain('style={{ color: "red" }}');
    expect(remaining).toContain('style={{ color: "red" }}');
  });

  it("limits data-table cell style helpers to sizing and pinned geometry", () => {
    const helper = stripComments(
      readRepoFile("packages/ui/lib/data-table.ts"),
    );
    const getCellStyle = helper.slice(
      helper.indexOf("export function getCellStyle"),
      helper.indexOf("// Mask for the scroll container"),
    );
    const pinnedStyle = getCellStyle.match(/return \{([\s\S]*?)\};/)?.[1];
    const assignedProperties = [
      ...(pinnedStyle?.matchAll(/^\s*(\w+)(?::|,)/gm) ?? []),
    ].map((match) => match[1]);

    expect(getCellStyle).toContain(
      "return width !== undefined ? { width } : {};",
    );
    expect(new Set(assignedProperties)).toEqual(
      new Set(["width", "position", "left", "right", "zIndex"]),
    );
  });

  it("preserves Task 4 shell and desktop behavior contracts", () => {
    const pageHeader = readRepoFile("packages/views/layout/page-header.tsx");
    const sidebar = readRepoFile("packages/views/layout/app-sidebar.tsx");
    const rightSidebar = readRepoFile(
      "packages/views/layout/animated-right-sidebar.tsx",
    );
    const desktopLayout = readRepoFile(
      "apps/desktop/src/renderer/src/components/desktop-layout.tsx",
    );
    const tabBar = readRepoFile(
      "apps/desktop/src/renderer/src/components/tab-bar.tsx",
    );
    const tabContent = readRepoFile(
      "apps/desktop/src/renderer/src/components/tab-content.tsx",
    );
    const windowOverlay = readRepoFile(
      "apps/desktop/src/renderer/src/components/window-overlay.tsx",
    );
    const desktopGlobals = readRepoFile(
      "apps/desktop/src/renderer/src/globals.css",
    );

    expect(pageHeader).toContain('export const PAGE_GUTTER = "px-4";');
    expect(pageHeader).toContain("export const PAGE_TOOLBAR = cn(");
    expect(pageHeader).toContain("h-12");
    expect(pageHeader).toContain("sidebar.hasExternalTrigger");

    expect(sidebar).toContain("ref={setNodeRef}");
    expect(sidebar).toContain("{...attributes}");
    expect(sidebar).toContain("{...listeners}");
    expect(sidebar).toContain("ref={sidebarScrollRef}");
    expect(sidebar).toContain("style={sidebarFadeStyle}");
    expect(sidebar).toContain("setOpenMobile(false)");
    expect(sidebar).toContain("topSlot?: React.ReactNode");
    expect(sidebar).toContain("searchSlot?: React.ReactNode");
    expect(rightSidebar).toContain('"data-right-sidebar-panel": "true"');
    expect(rightSidebar).toContain("rightSidebarPanelMotionProps");
    expect(rightSidebar).toContain('className: "enact-right-sidebar-frame"');
    expect(shell).toMatch(
      /\.enact-right-sidebar-frame\s*\{[^}]*overflow-x:\s*hidden;[^}]*\}/,
    );
    expect(shell).toMatch(
      /\.enact-right-sidebar-panel\s*\{[^}]*overflow-y:\s*auto;[^}]*border-left:\s*var\(--border-width\) solid var\(--border\);[^}]*\}/,
    );
    expect(
      shell.match(/\.enact-right-sidebar-frame\s*\{([^}]*)\}/)?.[1],
    ).not.toMatch(/overflow-y|border-left/);

    expect(desktopLayout).toContain("const WINDOW_TOOLBAR_CLEARANCE = 184");
    expect(desktopLayout).toContain("hasExternalTrigger");
    expect(desktopLayout).toContain("WebkitAppRegion");
    expect(desktopLayout.indexOf("<MainTopBar />")).toBeLessThan(
      desktopLayout.indexOf("<TabContent />"),
    );
    expect(desktopLayout.indexOf("<TabContent />")).toBeLessThan(
      desktopLayout.indexOf("<WindowOverlay />"),
    );

    expect(tabBar).toContain("data-tab-frame");
    expect(tabBar).toContain("data-tab-id={tab.id}");
    expect(tabBar).toContain("data-tab-active={isActive");
    expect(tabBar).toContain("onAuxClick");
    expect(tabBar).toContain("style={tabFadeStyle}");
    expect(tabBar).toContain("prev-tab-hover:opacity-0");
    expect(tabBar).toContain("WebkitAppRegion");
    expect(desktopGlobals).toContain("@custom-variant prev-tab-hover");
    expect(desktopGlobals).toContain(
      '.enact-desktop-shell [data-slot="sidebar-container"]',
    );

    expect(tabContent).toContain("registerActiveHostElement(hostRef.current)");
    expect(tabContent).toContain("enact-desktop-tab-content");
    expect(tabContent).not.toContain('display: "contents"');
    for (const type of [
      "new-workspace",
      "invite",
      "invitations",
      "onboarding",
    ]) {
      expect(windowOverlay).toContain(`overlay.type === "${type}"`);
    }
  });

  it("preserves Task 5 issue behavior boundaries", () => {
    const surface = readRepoFile("packages/views/issues/surface/issue-surface.tsx");
    const list = readRepoFile("packages/views/issues/components/list-view.tsx");
    const board = readRepoFile("packages/views/issues/components/board-view.tsx");
    const swimlane = readRepoFile("packages/views/issues/components/swimlane-view.tsx");
    const table = readRepoFile("packages/views/issues/components/table-view.tsx");
    const detail = readRepoFile("packages/views/issues/components/issue-detail.tsx");
    const comment = readRepoFile("packages/views/issues/components/comment-card.tsx");
    const picker = readRepoFile(
      "packages/views/issues/components/pickers/property-picker.tsx",
    );
    const issueWindow = readRepoFile(
      "apps/desktop/src/renderer/src/components/issue-window.tsx",
    );

    expect(surface).toMatch(
      /<ViewStoreProvider store=\{store\}>[\s\S]*?<ViewBaselineProvider baseline=\{viewBaseline\}>[\s\S]*?<IssueSurfaceContent\s+key=\{contentKey\}/,
    );
    expect(surface).toMatch(
      /<IssueSurfaceActionsProvider actions=\{controller\.actions\}>[\s\S]*?<IssueContextMenuProvider>[\s\S]*?<IssueSurfaceSelectionProvider selection=\{controller\.selection\}>/,
    );
    expect(surface).toMatch(
      /controller\.isStatusCatalogError\s*\?[\s\S]*?: controller\.isLoading\s*\?[\s\S]*?: controller\.isEmpty \|\| shouldShowClientEmpty\s*\?/,
    );

    expect(list).toMatch(
      /<DndContext[\s\S]*?sensors=\{sensors\}[\s\S]*?onDragStart=\{handleDragStart\}[\s\S]*?onDragOver=\{handleDragOver\}[\s\S]*?onDragEnd=\{handleDragEnd\}[\s\S]*?onDragCancel=\{handleDragCancel\}[\s\S]*?<div ref=\{attachScroller\} data-tab-scroll-root="list" className="[^"]*overflow-y-auto/,
    );
    expect(list).toMatch(
      /<Virtuoso\s+customScrollParent=\{scrollParent\}[\s\S]*?data=\{issues\}/,
    );
    expect(board).toMatch(
      /const pan = useBoardDragPan<HTMLDivElement>\(\)[\s\S]*?<DndContext[\s\S]*?sensors=\{sensors\}[\s\S]*?onDragStart=\{handleDragStart\}[\s\S]*?onDragOver=\{handleDragOver\}[\s\S]*?onDragEnd=\{handleDragEnd\}[\s\S]*?onDragCancel=\{handleDragCancel\}/,
    );
    expect(swimlane).toMatch(
      /<DndContext[\s\S]*?sensors=\{sensors\}[\s\S]*?onDragStart=\{handleDragStart\}[\s\S]*?onDragOver=\{handleDragOver\}[\s\S]*?onDragEnd=\{handleDragEnd\}[\s\S]*?onDragCancel=\{handleDragCancel\}[\s\S]*?<div ref=\{attachScroller\} data-tab-scroll-root="swimlane" className="[^"]*overflow-auto/,
    );
    expect(swimlane).toMatch(
      /<Virtuoso\s+customScrollParent=\{scrollEl\}[\s\S]*?data=\{orderedLanes\}/,
    );
    expect(table).toMatch(
      /<DndContext[\s\S]*?modifiers=\{\[restrictToHorizontalAxis\]\}[\s\S]*?<DataTable[\s\S]*?virtualizeRows[\s\S]*?onRowClick=\{\(row, event\) =>/,
    );
    expect(table).toContain("onColumnSizingChange: handleColumnSizingChange");
    expect(table).toContain("getIssueTableSelectionRange(");
    expect(table).toContain("mode === \"all\" ? exportIssues()");

    expect(detail).toMatch(
      /const attachScrollContainer = useCallback\([\s\S]*?setScrollContainerEl\(el\);[\s\S]*?restoreScrollRef\(el\);/,
    );
    expect(detail).toMatch(
      /ref=\{attachScrollContainer\}[\s\S]*?data-tab-scroll-root=\{scrollContainerKey\}[\s\S]*?className="enact-issue-detail-scroller[^"]*overflow-y-auto"/,
    );
    expect(detail).toMatch(
      /ref=\{virtuosoRef\}[\s\S]*?customScrollParent=\{scrollContainerEl\}[\s\S]*?data=\{items\}/,
    );
    expect(detail).toMatch(
      /ref=\{composerRef\}[\s\S]*?<CommentInput[\s\S]*?key=\{id\}[\s\S]*?issueId=\{id\}[\s\S]*?onAccepted=\{scrollToTimelineBottom\}/,
    );
    expect(detail).toMatch(
      /<Sheet open=\{mobileSidebarOpen\}[\s\S]*?<SheetContent side="right"[\s\S]*?\{sidebarContent\}/,
    );
    expect(detail).toMatch(
      /<AnimatedRightSidebar open=\{desktopSidebarVisualOpen\} motionEnabled=\{desktopSidebarMotionEnabled\}>[\s\S]*?\{sidebarContent\}/,
    );
    expect(comment).toContain('id={`comment-body-${entry.id}`}');
    expect(comment).toContain("overflow-clip");
    expect(picker).toContain('data-custom-hover={hoverClassName ? "true" : undefined}');

    expect(issueWindow).toMatch(
      /const router = useMemo\([\s\S]*?createMemoryRouter\([\s\S]*?\[context\.path\]/,
    );
    expect(issueWindow.indexOf("if (unavailable)")).toBeLessThan(
      issueWindow.indexOf("if (!ready)"),
    );
    expect(issueWindow).toMatch(
      /<DesktopAuthRecoveryPage[\s\S]*?isRetrying=\{isFetching\}[\s\S]*?void refetch\(\)/,
    );
    expect(issueWindow).toMatch(
      /<WorkspaceSlugProvider slug=\{workspaceSlug\}>[\s\S]*?<IssueWindowNavigationProvider>[\s\S]*?<IssueWindowFrame>[\s\S]*?<IssueDetailPage onDelete=\{\(\) => window\.desktopAPI\.closeWindow\(\)\}/,
    );
    expect(issueWindow).toMatch(
      /data-dedicated-issue-window="true"[\s\S]*?>\s*<DragStrip \/>\s*<div className="[^"]*overflow-hidden">\{children\}<\/div>/,
    );
    expect(issueWindow).toContain("onClick={() => window.location.reload()}");
    expect(issueWindow.match(/window\.desktopAPI\.closeWindow\(\)/g)).toHaveLength(3);
  });

  it("preserves Task 6 chat and inbox behavior boundaries", () => {
    const chatPage = readRepoFile("packages/views/chat/chat-page.tsx");
    const chatWindow = readRepoFile(
      "packages/views/chat/components/chat-window.tsx",
    );
    const chatInput = readRepoFile(
      "packages/views/chat/components/chat-input.tsx",
    );
    const transcript = readRepoFile(
      "packages/views/chat/components/chat-message-list.tsx",
    );
    const inboxPage = readRepoFile(
      "packages/views/inbox/components/inbox-page.tsx",
    );
    const inboxList = readRepoFile(
      "packages/views/inbox/components/inbox-list.tsx",
    );
    const inboxRow = readRepoFile(
      "packages/views/inbox/components/inbox-list-item.tsx",
    );

    expect(chatInbox).not.toContain("touch-action");
    for (const [edge, cursor] of [
      ["left", "col-resize"],
      ["top", "row-resize"],
      ["corner", "nw-resize"],
    ] as const) {
      expect(chatInbox).toMatch(
        new RegExp(
          `\\.enact-chat-resize-handle\\[data-edge="${edge}"\\]\\s*\\{[^}]*cursor:\\s*${cursor};`,
        ),
      );
    }

    expect(transcript).toMatch(
      /const renderItems: ChatRenderItem\[\] = useMemo\([\s\S]*?items\.push\(\{ key: `task:\$\{pendingTaskId\}`, kind: "live", taskId: pendingTaskId \}\);[\s\S]*?computeItemKey=\{\(_, item\) => item\.key\}/,
    );
    expect(transcript).toMatch(
      /<div\s+ref=\{setScrollContainerRef\}\s+data-tab-scroll-root\s+style=\{fadeStyle\}[\s\S]*?enact-chat-transcript[^"]*overflow-y-auto[\s\S]*?<RichContentScrollRootProvider scrollRoot=\{scrollContainerEl\}>[\s\S]*?<Virtuoso[\s\S]*?customScrollParent=\{scrollContainerEl\}/,
    );
    expect(chatInput).toMatch(
      /const draftKey = draftKeyOverride \?\? activeSessionId \?\? DRAFT_NEW_SESSION;[\s\S]*?uploadGate: gate[\s\S]*?editorDraftKeyRef\.current !== draftKey[\s\S]*?const accepted = await onSend\([\s\S]*?commitInput,[\s\S]*?if \(accepted === false\) return false;[\s\S]*?if \(!committed\) commitInput\(\);/,
    );
    expect(chatPage.indexOf("<ChatMessageList")).toBeLessThan(chatPage.indexOf("<ChatQueue"));
    expect(chatPage.indexOf("<ChatQueue")).toBeLessThan(chatPage.indexOf("<ChatInput"));
    expect(chatWindow).toMatch(
      /result = await api\.sendChatMessage\(sessionId, finalContent, attachmentIds\);[\s\S]*?const sent: ChatMessage = \{[\s\S]*?attachments: draftAttachments,[\s\S]*?upsertChatMessageToCaches\(qc, sessionId, sent, \{ seedIfMissing: true \}\);[\s\S]*?seedAcceptedPendingTask\(qc, sessionId,[\s\S]*?const stillOnSourceSession = isStillOnComposeTarget[\s\S]*?setActiveSession\(sessionId\);[\s\S]*?commitInput\?\.\(\{ extraDraftKeys: \[sessionId\], clearEditor: stillOnSourceSession \}\);/,
    );
    expect(chatWindow).toMatch(
      /<ChatInput[\s\S]*?onSend=\{handleSend\}[\s\S]*?restoreDraftRequest=\{restoreDraftRequest\}[\s\S]*?uploadEnabled=\{!!activeAgent && !isAgentAccessRevoked\}[\s\S]*?onStop=\{handleStop\}[\s\S]*?focusRequest=\{focusRequest\}/,
    );
    expect(chatWindow).not.toContain("maskImage:");
    expect(chatWindow).not.toContain("WebkitMaskImage:");

    expect(inboxPage).toMatch(
      /const setSelectedKey = useCallback\(\(key: string\) => \{\s*setSelectedKeyState\(key\);\s*replace\(buildInboxUrl\(view, key\)\);/,
    );
    expect(inboxPage).toMatch(
      /const detailKey = useDeferredValue\(selectedKey\);[\s\S]*?if \(!selectedId \|\| selectedRead\) return;\s*if \(manualUnreadIdRef\.current === selectedId\) return;\s*markReadMutate\(selectedId,[\s\S]*?const handleMarkUnread = \(id: string\) => \{[\s\S]*?if \(selected\?\.id === id\) manualUnreadIdRef\.current = id;\s*markUnreadMutation\.mutate\(id,/,
    );
    expect(inboxPage).toMatch(
      /const handleArchive = \(id: string\) => \{\s*advanceSelectionPast\(id, items\);\s*archiveMutation\.mutate\(id,[\s\S]*?const handleUnarchive = \(id: string\) => \{\s*advanceSelectionPast\(id, archivedItems\);\s*unarchiveMutation\.mutate\(id,/,
    );
    expect(inboxPage).toMatch(
      /const compactBackAction = isCompact \? \([\s\S]*?onClick=\{\(\) => setSelectedKey\(""\)\}[\s\S]*?leadingAction=\{compactBackAction\}[\s\S]*?return <div className="flex flex-1 flex-col min-h-0">\{detailContent\}<\/div>;/,
    );
    expect(inboxPage).toContain('searchParams.get("issue")');
    expect(inboxPage).toContain('searchParams.get("view") === ARCHIVED_VIEW_PARAM');
    expect(inboxList).toMatch(
      /ref=\{attachScrollEl\}[\s\S]*?data-tab-scroll-root="list"[\s\S]*?onKeyDown=\{handleKeyDown\}[\s\S]*?overflow-y-auto[\s\S]*?<Virtuoso[\s\S]*?customScrollParent=\{scrollEl\}/,
    );
    expect(inboxRow).toMatch(
      /role="button"[\s\S]*?onAuxClick=\{\(e\) => \{[\s\S]*?intentNavigate\(issueHref, "background-tab"\)/,
    );
  });

  it("preserves Task 7 management and usage behavior boundaries", () => {
    const agents = readRepoFile(
      "packages/views/agents/components/agent-list-page.tsx",
    );
    const agentActions = readRepoFile(
      "packages/views/agents/components/agent-row-actions.tsx",
    );
    const runtimes = readRepoFile(
      "packages/views/runtimes/components/runtime-list.tsx",
    );
    const runtimeUsage = readRepoFile(
      "packages/views/runtimes/components/usage-section.tsx",
    );
    const skills = readRepoFile(
      "packages/views/skills/components/skills-page.tsx",
    );
    const squads = readRepoFile(
      "packages/views/squads/components/squads-page.tsx",
    );
    const autopilots = readRepoFile(
      "packages/views/autopilots/components/autopilots-page.tsx",
    );
    const dashboard = readRepoFile(
      "packages/views/dashboard/components/dashboard-page.tsx",
    );
    const leaderboard = readRepoFile(
      "packages/views/dashboard/components/leaderboard.tsx",
    );
    const errors = readRepoFile(
      "packages/views/dashboard/components/errors-tab.tsx",
    );

    expect(agents).toMatch(
      /agentListOptions\(wsId\)[\s\S]*?runtimeListOptions\(wsId\)[\s\S]*?<ListGridRow[\s\S]*?data-selected=\{selectedIds\.has\(row\.agent\.id\) \? "true" : undefined\}[\s\S]*?\{\.\.\.rowLink\(paths\.agentDetail\(row\.agent\.id\), row\.agent\.name\)\}[\s\S]*?<CheckboxCell[\s\S]*?onToggle=\{\(\) => toggleSelected\(row\.agent\.id\)\}[\s\S]*?onClick=\{\(e\) => e\.stopPropagation\(\)\}[\s\S]*?<AgentRowActions[\s\S]*?canManage=\{row\.canManage\}[\s\S]*?<AgentBatchToolbar[\s\S]*?rows=\{selectedRows\}[\s\S]*?onClear=\{\(\) => setSelectedIds\(new Set\(\)\)\}/,
    );
    expect(agentActions).toMatch(
      /const showStop = canManage && !isArchived && hasActiveWork;[\s\S]*?const showDuplicate = !isArchived;[\s\S]*?const showArchive = canManage && !isArchived && !isSystemAgent;[\s\S]*?const showRestore = canManage && isArchived;[\s\S]*?<DropdownMenuTrigger[\s\S]*?\{showDuplicate && \([\s\S]*?<AppLink href=\{duplicateHref\}/,
    );

    expect(runtimes).toMatch(
      /canDelete: isCustomRuntime[\s\S]*?isAdmin && !!profile[\s\S]*?!isPendingCustomRuntime\(runtime\)[\s\S]*?isAdmin \|\| \(!!user && runtime\.owner_id === user\.id\)[\s\S]*?const detailHref = pending[\s\S]*?\{\.\.\.\(detailHref \? rowLink\(detailHref\) : \{\}\)\}[\s\S]*?onClick=\{\(e\) => e\.stopPropagation\(\)\}[\s\S]*?<RuntimeRowMenu[\s\S]*?canDelete=\{row\.canDelete\}[\s\S]*?detailHref=\{detailHref\}/,
    );
    expect(runtimes).toMatch(
      /if \(!canDelete\) \{\s*return <span aria-hidden \/>;[\s\S]*?\{detailHref && \([\s\S]*?onClick=\{\(\) => intentNavigate\(detailHref, "foreground-tab"\)\}/,
    );
    expect(runtimeUsage).toMatch(
      /runtimeUsageByAgentOptions\(runtimeId, days, tz\)[\s\S]*?aggregateCostByAgent\(byAgentRows\)[\s\S]*?aggregateCostByModel\(usage\)/,
    );
    expect(runtimeUsage).toMatch(
      /function computeTotals\(rows: RuntimeUsage\[\]\)[\s\S]*?return rows\.reduce/,
    );

    expect(skills).toMatch(
      /<ListGridRow[\s\S]*?data-selected=\{selectedIds\.has\(row\.skill\.id\) \? "true" : undefined\}[\s\S]*?\{\.\.\.rowLink\(paths\.skillDetail\(row\.skill\.id\), row\.skill\.name\)\}[\s\S]*?<CheckboxCell[\s\S]*?onToggle=\{\(\) => toggleSelected\(row\.skill\.id\)\}[\s\S]*?<SkillRowActions row=\{row\} ctx=\{actionsCtx\} \/>[\s\S]*?<SkillBatchToolbar[\s\S]*?rows=\{selectedRows\}[\s\S]*?onClear=\{\(\) => setSelectedIds\(new Set\(\)\)\}/,
    );
    expect(squads).toMatch(
      /\{\.\.\.rowLink\(p\.squadDetail\(squad\.id\), squad\.name\)\}[\s\S]*?isWorkspaceAdmin \|\|[\s\S]*?squad\.creator_id === currentUser\.id[\s\S]*?<SquadRowActions squad=\{squad\} \/>/,
    );
    expect(autopilots).toMatch(
      /<ListGridRow[\s\S]*?data-selected=\{selectedIds\.has\(autopilot\.id\) \? "true" : undefined\}[\s\S]*?\{\.\.\.rowLink\(wsPaths\.autopilotDetail\(autopilot\.id\), autopilot\.title\)\}[\s\S]*?<CheckboxCell[\s\S]*?onToggle=\{\(\) => toggleSelected\(autopilot\.id\)\}[\s\S]*?<AutopilotRowActions row=\{autopilot\} \/>[\s\S]*?<AutopilotBatchToolbar[\s\S]*?rows=\{selectedRows\}[\s\S]*?onClear=\{\(\) => setSelectedIds\(new Set\(\)\)\}/,
    );

    expect(dashboard).toMatch(
      /dashboardUsageDailyOptions\(wsId, chartFetchDays, viewTZ\)[\s\S]*?dashboardFailuresByAgentOptions\(wsId, days, viewTZ\)/,
    );
    expect(leaderboard).toMatch(
      /const metric = SORT_METRIC\[sortBy\];[\s\S]*?metric\(b\) - metric\(a\)/,
    );
    expect(errors).toMatch(
      /const total = rows\.reduce\([\s\S]*?style=\{\{ width: `\$\{\(row\.count \/ total\) \* 100\}%` \}\}/,
    );
    expect(errors).toMatch(
      /const value = OFFENDER_METRIC\[sortBy\]\(row\);[\s\S]*?const pct = maxValue > 0 \? Math\.min\(100, \(value \/ maxValue\) \* 100\) : 0;[\s\S]*?href=\{`\$\{wsPaths\.agentDetail\(row\.agentId\)\}\?view=overview`\}/,
    );
  });

  it("preserves Task 7 Desktop daemon context and lifecycle handlers", () => {
    const desktopRuntimes = readRepoFile(
      "apps/desktop/src/renderer/src/components/desktop-runtimes-page.tsx",
    );
    const daemonActions = readRepoFile(
      "apps/desktop/src/renderer/src/components/daemon-runtime-card.tsx",
    );
    const daemonPanel = readRepoFile(
      "apps/desktop/src/renderer/src/components/daemon-panel.tsx",
    );

    // The agents list had a matching desktop wrapper that subscribed to daemon
    // status and passed it down. `AgentsPageProps` documented those props as
    // unused, and they were: the runtime filter lists runtimes by name. Both
    // the wrapper and the props are gone now that the list is a tab of Team.
    // The runtimes page below is the one that really consumes this context.
    expect(desktopRuntimes).toMatch(
      /const context = useDesktopRuntimeContext\(\);[\s\S]*?<RuntimesPage[\s\S]*?localDaemonId=\{context\.localDaemonId\}[\s\S]*?localMachineName=\{context\.localMachineName\}[\s\S]*?hasLocalMachine[\s\S]*?bootstrapping=\{context\.bootstrapping\}/,
    );

    expect(daemonActions).toMatch(
      /const affectedTasks = useMemo\([\s\S]*?localRuntimeIds\.has\(t\.runtime_id\) &&[\s\S]*?t\.status === "running" \|\| t\.status === "dispatched"[\s\S]*?const handleStopClick = useCallback\([\s\S]*?if \(affectedTasks\.length === 0\) \{\s*void performStop\(\);\s*\} else \{\s*setConfirmStop\(true\);[\s\S]*?<StopConfirmDialog[\s\S]*?affectedCount=\{affectedTasks\.length\}[\s\S]*?onConfirm=\{\(\) => \{[\s\S]*?void performStop\(\);/,
    );
    for (const [handler, api, buttonHandler] of [
      ["handleStart", "start", "handleStart"],
      ["handleRestart", "restart", "handleRestart"],
      ["handleRetryInstall", "retryInstall", "handleRetryInstall"],
    ] as const) {
      expect(daemonActions).toMatch(
        new RegExp(
          `const ${handler} = useCallback\\([\\s\\S]*?window\\.daemonAPI\\.${api}\\(\\)[\\s\\S]*?onClick=\\{${buttonHandler}\\}`,
        ),
      );
    }
    expect(daemonActions).toMatch(
      /const handleReauth = useCallback\([\s\S]*?await reauthenticateDaemon\(\);[\s\S]*?onClick=\{handleReauth\}/,
    );
    expect(daemonActions).toMatch(
      /window\.daemonAPI\.getStatus\(\)\.then[\s\S]*?const unsub = window\.daemonAPI\.onStatusChange[\s\S]*?return unsub;/,
    );
    expect(daemonPanel).toMatch(
      /useEffect\(\(\) => \{\s*if \(!open\) return;[\s\S]*?window\.daemonAPI\.startLogStream\(\);[\s\S]*?const unsub = window\.daemonAPI\.onLogLine[\s\S]*?return \(\) => \{\s*unsub\(\);\s*window\.daemonAPI\.stopLogStream\(\);/,
    );
    expect(daemonPanel).toContain('data-enact-platform="desktop"');
  });

  it("preserves Task 8 settings, billing, integration, and bind-flow topology", () => {
    const settingsPage = readRepoFile(
      "packages/views/settings/components/settings-page.tsx",
    );
    const deleteWorkspace = readRepoFile(
      "packages/views/settings/components/delete-workspace-dialog.tsx",
    );
    const billing = readRepoFile(
      "packages/views/settings/components/billing-tab.tsx",
    );
    const composio = readRepoFile(
      "packages/views/settings/components/composio-tab.tsx",
    );
    const github = readRepoFile(
      "packages/views/settings/components/github-tab.tsx",
    );
    const lark = readRepoFile(
      "packages/views/settings/components/lark-tab.tsx",
    );
    const slack = readRepoFile(
      "packages/views/settings/components/slack-tab.tsx",
    );
    const dingtalk = readRepoFile(
      "packages/views/settings/components/dingtalk-tab.tsx",
    );
    const wecom = readRepoFile(
      "packages/views/settings/components/wecom-tab.tsx",
    );
    const telegram = readRepoFile(
      "packages/views/settings/components/telegram-tab.tsx",
    );

    expect(settingsPage).toMatch(
      /const validTabs = React\.useMemo\([\s\S]*?new Set<string>\(\[[\s\S]*?\.\.\.ACCOUNT_TAB_KEYS,[\s\S]*?\.\.\.visibleWorkspaceTabKeys\.map\(\(key\) => WORKSPACE_TAB_VALUES\[key\]\),[\s\S]*?\.\.\.\(extraAccountTabs\?\.map\(\(tab\) => tab\.value\) \?\? \[\]\),[\s\S]*?const tabFromUrl = navigation\.searchParams\.get\(TAB_QUERY_KEY\);[\s\S]*?LEGACY_WORKSPACE_TAB_REDIRECTS\[tabFromUrl\] \?\? tabFromUrl[\s\S]*?candidateTab && validTabs\.has\(candidateTab\) \? candidateTab : DEFAULT_TAB;[\s\S]*?const handleTabChange = \(next: string\) => \{[\s\S]*?params\.set\(TAB_QUERY_KEY, next\);[\s\S]*?navigation\.replace\(`\$\{navigation\.pathname\}\?\$\{params\.toString\(\)\}`\);[\s\S]*?<Tabs[\s\S]*?value=\{activeTab\}[\s\S]*?onValueChange=\{handleTabChange\}/,
    );
    expect(settingsPage).toMatch(
      /const WORKSPACE_TAB_VALUES = \{[\s\S]*?integrations: "integrations",[\s\S]*?issue_statuses: "issue-statuses",[\s\S]*?<TabsContent value="integrations"><IntegrationsTab \/><\/TabsContent>[\s\S]*?<TabsContent value="issue-statuses"><IssueStatusesTab \/><\/TabsContent>/,
    );

    expect(deleteWorkspace).toMatch(
      /const \[typed, setTyped\] = useState\(""\);\s*const matched = typed === workspaceName;[\s\S]*?const submit = \(\) => \{\s*if \(!matched \|\| loading\) return;\s*onConfirm\(\);\s*\};[\s\S]*?value=\{typed\}[\s\S]*?onChange=\{\(e\) => setTyped\(e\.target\.value\)\}[\s\S]*?if \(e\.key === "Enter"\) \{\s*e\.preventDefault\(\);\s*submit\(\);[\s\S]*?variant="destructive"\s*onClick=\{submit\}\s*disabled=\{!matched \|\| loading\}/,
    );

    expect(billing).toMatch(
      /const canManage =\s*currentMember\.role === "owner" \|\| currentMember\.role === "admin";[\s\S]*?const handleCheckout = async \(\) => \{[\s\S]*?checkoutMutation\.mutateAsync\(\{\s*interval,\s*idempotencyKey: intent\.key,[\s\S]*?openExternal\(response\.url, \{ webTarget: "same-tab" \}\);[\s\S]*?\{canManage \? \([\s\S]*?onClick=\{\(\) => setCheckoutConfirmOpen\(true\)\}[\s\S]*?<AlertDialog\s+open=\{checkoutConfirmOpen\}[\s\S]*?<AlertDialogAction[\s\S]*?disabled=\{checkoutMutation\.isPending\}[\s\S]*?onClick=\{\(\) => void handleCheckout\(\)\}/,
    );
    expect(billing).toMatch(
      /const handlePortal = async \(\) => \{[\s\S]*?portalMutation\.mutateAsync\(key\);[\s\S]*?openExternal\(response\.url, \{ webTarget: "same-tab" \}\);[\s\S]*?\{hasManagedSubscription && canManage \? \([\s\S]*?onClick=\{\(\) => void handlePortal\(\)\}/,
    );
    expect(billing).toMatch(
      /const handleSeatPurchase = async \(\) => \{\s*const confirmedPreview = seatPreview;\s*if \(!confirmedPreview\) return;[\s\S]*?purchaseSeatsMutation\.mutateAsync\(request\);[\s\S]*?const canAddSeats =\s*canManage &&[\s\S]*?\{canAddSeats \? \([\s\S]*?onClick=\{\(\) => handleSeatPurchaseOpenChange\(true\)\}[\s\S]*?<Dialog\s+open=\{seatPurchaseOpen\}[\s\S]*?disabled=\{\s*!seatPreview \|\|[\s\S]*?purchaseSeatsMutation\.isPending\s*\}[\s\S]*?onClick=\{\(\) => void handleSeatPurchase\(\)\}/,
    );

    expect(composio).toMatch(
      /const consumedCallbackKey = useRef<string \| null>\(null\);[\s\S]*?const callbackKey = connectedParam[\s\S]*?if \(consumedCallbackKey\.current === callbackKey\) return;\s*consumedCallbackKey\.current = callbackKey;[\s\S]*?qc\.invalidateQueries\(\{ queryKey: composioKeys\.connections\(\) \}\);[\s\S]*?params\.delete\("connected"\);\s*params\.delete\("error"\);[\s\S]*?navigation\.replace\(qs \? `\$\{navigation\.pathname\}\?\$\{qs\}` : navigation\.pathname\);/,
    );
    expect(composio).toMatch(
      /async function handleConnect\(tk: ComposioToolkit\)[\s\S]*?api\.beginComposioConnect\(tk\.slug\);[\s\S]*?window\.location\.href = redirect_url;[\s\S]*?async function handleDisconnect\(\)[\s\S]*?api\.deleteComposioConnection\(disconnectTarget\.connectionId\);[\s\S]*?qc\.invalidateQueries\(\{ queryKey: composioKeys\.connections\(\) \}\);[\s\S]*?onConnect=\{\(\) => handleConnect\(tk\)\}[\s\S]*?setDisconnectTarget\(\{ connectionId, name \}\)[\s\S]*?<AlertDialogAction onClick=\{handleDisconnect\} disabled=\{disconnecting\}>/,
    );

    expect(github).toMatch(
      /const canView = !!currentMember;[\s\S]*?githubInstallationsOptions\(wsId\),\s*enabled: !!wsId && canView,[\s\S]*?const canManage = installationData\?\.can_manage === true;[\s\S]*?async function persistSetting\(key: SettingsKey, next: boolean\)[\s\S]*?api\.updateWorkspace\(workspace\.id, \{ settings: merged \}\)[\s\S]*?disabled=\{!canManage \|\| savingKey === "github_enabled"\}/,
    );
    expect(github).toMatch(
      /async function handleConnect\(\)[\s\S]*?api\.getGitHubConnectURL\(wsId\);[\s\S]*?window\.open\(resp\.url, "_blank", "noopener"\);[\s\S]*?async function handleDisconnect\(\)[\s\S]*?api\.deleteGitHubInstallation\(wsId, disconnectTarget\);[\s\S]*?qc\.invalidateQueries\(\{ queryKey: \["github", wsId\] \}\);[\s\S]*?onClick=\{\(\) => setDisconnectTarget\(primaryInstallation\.id\)\}[\s\S]*?onClick=\{handleConnect\}[\s\S]*?disabled=\{connecting \|\| !configured\}[\s\S]*?<AlertDialogAction onClick=\{handleDisconnect\} disabled=\{disconnecting\}>/,
    );

    expect(slack).toMatch(
      /const canManage =\s*currentMember\?\.role === "owner" \|\| currentMember\?\.role === "admin";[\s\S]*?async function handleDisconnect\(\)[\s\S]*?api\.deleteSlackInstallation\(wsId, disconnectTarget\);[\s\S]*?qc\.invalidateQueries\(\{ queryKey: slackKeys\.installations\(wsId\) \}\);[\s\S]*?canManage=\{canManage\}[\s\S]*?onDisconnect=\{\(\) => setDisconnectTarget\(inst\.id\)\}[\s\S]*?<AlertDialogAction onClick=\{handleDisconnect\} disabled=\{disconnecting\}>/,
    );
    expect(slack).toMatch(
      /export function SlackAgentBindButton[\s\S]*?const canManage =\s*currentMember\?\.role === "owner" \|\| currentMember\?\.role === "admin";\s*if \(!canManage\) return null;[\s\S]*?async function handleSubmit\(\)[\s\S]*?api\.registerSlackBYO\(wsId, agentId, \{ bot_token, app_token \}\);[\s\S]*?qc\.invalidateQueries\(\{ queryKey: slackKeys\.installations\(wsId\) \}\);[\s\S]*?onClick=\{handleSubmit\}\s*disabled=\{!canSubmit\}/,
    );

    expect(wecom).toMatch(
      /const canManage =\s*currentMember\?\.role === "owner" \|\| currentMember\?\.role === "admin";[\s\S]*?async function handleDisconnect\(\)[\s\S]*?api\.deleteWecomInstallation\(wsId, disconnectTarget\);[\s\S]*?qc\.invalidateQueries\(\{ queryKey: wecomKeys\.installations\(wsId\) \}\);[\s\S]*?canManage=\{canManage\}[\s\S]*?onDisconnect=\{\(\) => setDisconnectTarget\(inst\.id\)\}[\s\S]*?<AlertDialogAction onClick=\{handleDisconnect\} disabled=\{disconnecting\}>/,
    );
    expect(wecom).toMatch(
      /export function WecomAgentBindButton[\s\S]*?const canManage =\s*currentMember\?\.role === "owner" \|\| currentMember\?\.role === "admin";\s*if \(!canManage\) return null;[\s\S]*?async function handleSubmit\(\)[\s\S]*?api\.registerWecomBYO\(wsId, agentId, \{[\s\S]*?bot_id,[\s\S]*?secret: secretTrimmed,[\s\S]*?bot_name: botName\.trim\(\) \|\| undefined,[\s\S]*?qc\.invalidateQueries\(\{ queryKey: wecomKeys\.installations\(wsId\) \}\);[\s\S]*?onClick=\{handleSubmit\}\s*disabled=\{!canSubmit\}/,
    );

    expect(lark).toMatch(
      /const isWorkspaceAdmin =\s*currentMember\?\.role === "owner" \|\| currentMember\?\.role === "admin";\s*const isAgentOwner =[\s\S]*?const canManage = isWorkspaceAdmin \|\| isAgentOwner;\s*if \(!canManage\) return null;[\s\S]*?if \(!installSupported\) return null;[\s\S]*?<LarkInstallDialog[\s\S]*?async function handleDisconnect\(\)[\s\S]*?api\.deleteLarkInstallation\(wsId, installation\.id\);[\s\S]*?qc\.invalidateQueries\(\{ queryKey: larkKeys\.installations\(wsId\) \}\)[\s\S]*?async function beginSession\(\)[\s\S]*?api\.beginLarkInstall\(wsId, agentId, region\);/,
    );
    expect(dingtalk).toMatch(
      /const isWorkspaceAdmin =\s*currentMember\?\.role === "owner" \|\| currentMember\?\.role === "admin";[\s\S]*?const isAgentOwner =[\s\S]*?const canManage = isWorkspaceAdmin \|\| isAgentOwner;\s*if \(!canManage\) return null;[\s\S]*?async function handleSubmit\(\)[\s\S]*?api\.registerDingTalkBYO\(wsId, agentId, \{ client_id, client_secret \}\);[\s\S]*?onClick=\{handleSubmit\}\s*disabled=\{!canSubmit\}[\s\S]*?async function handleDisconnect\(\)[\s\S]*?api\.deleteDingTalkInstallation\(wsId, installation\.id\);/,
    );
    expect(telegram).toMatch(
      /const canManage =\s*currentMember\?\.role === "owner" \|\| currentMember\?\.role === "admin";\s*if \(!canManage\) return null;[\s\S]*?async function handleSubmit\(\)[\s\S]*?api\.registerTelegramBot\(wsId, agentId, \{ bot_token \}\);[\s\S]*?onClick=\{handleSubmit\}\s*disabled=\{!canSubmit\}[\s\S]*?async function handleDisconnect\(\)[\s\S]*?api\.deleteTelegramInstallation\(wsId, installation\.id\);/,
    );

    for (const [provider, component, redeemApi] of [
      ["lark", "Lark", "redeemLarkBindingToken"],
      ["slack", "Slack", "redeemSlackBindingToken"],
      ["dingtalk", "DingTalk", "redeemDingTalkBindingToken"],
      ["wecom", "Wecom", "redeemWecomBindingToken"],
      ["telegram", "Telegram", "redeemTelegramBindingToken"],
    ] as const) {
      const bindPage = readRepoFile(`packages/views/${provider}/bind-page.tsx`);
      expect(bindPage).toMatch(
        new RegExp(
          `type RedeemState =[\\s\\S]*?kind: "idle"[\\s\\S]*?kind: "redeeming"[\\s\\S]*?kind: "done"[\\s\\S]*?kind: "needs-auth"[\\s\\S]*?kind: "error"[\\s\\S]*?export function ${component}BindPage\\(\\{ token \\}[\\s\\S]*?if \\(!token\\) \\{[\\s\\S]*?kind: "error", reason: "missing_token"[\\s\\S]*?if \\(isAuthLoading\\) return;[\\s\\S]*?if \\(!user\\) \\{[\\s\\S]*?kind: "needs-auth"[\\s\\S]*?api\\.${redeemApi}\\(token\\);[\\s\\S]*?kind: "done"[\\s\\S]*?workspaceId: resp\\.workspace_id,[\\s\\S]*?installationId: resp\\.installation_id,[\\s\\S]*?catch \\(e\\) \\{[\\s\\S]*?kind: "error"[\\s\\S]*?data-state=\\{state\\.kind\\}[\\s\\S]*?state\\.kind === "idle" \\|\\| state\\.kind === "redeeming"[\\s\\S]*?state\\.kind === "needs-auth"[\\s\\S]*?/${provider}/bind\\?token=\\$\\{encodeURIComponent\\(token \\?\\? ""\\)\\}[\\s\\S]*?state\\.kind === "done"[\\s\\S]*?switch \\(state\\.reason\\)`,
        ),
      );
    }
    const dingtalkBind = readRepoFile(
      "packages/views/dingtalk/bind-page.tsx",
    );
    expect(dingtalkBind).toMatch(
      /if \(redeemingToken\.current === token\) return;\s*redeemingToken\.current = token;/,
    );
    const telegramBind = readRepoFile(
      "packages/views/telegram/bind-page.tsx",
    );
    expect(telegramBind).toMatch(
      /api\.redeemTelegramBindingToken\(token\);\s*if \(!resp\.workspace_id \|\| !resp\.installation_id \|\| !resp\.telegram_user_id\) \{\s*throw new Error\("Telegram binding returned a malformed response"\);/,
    );
  });

  it("preserves Task 8 Desktop settings and update lifecycle topology", () => {
    const daemonSettings = readRepoFile(
      "apps/desktop/src/renderer/src/components/daemon-settings-tab.tsx",
    );
    const updatesSettings = readRepoFile(
      "apps/desktop/src/renderer/src/components/updates-settings-tab.tsx",
    );
    const updateNotification = readRepoFile(
      "apps/desktop/src/renderer/src/components/update-notification.tsx",
    );

    expect(daemonSettings).toMatch(
      /useEffect\(\(\) => \{\s*window\.daemonAPI\.getPrefs\(\)\.then\(setPrefs\);\s*window\.daemonAPI\.isCliInstalled\(\)\.then\(setCliInstalled\);\s*window\.daemonAPI\.getStatus\(\)\.then\(setStatus\);\s*return window\.daemonAPI\.onStatusChange\(setStatus\);\s*\}, \[\]\);/,
    );
    expect(daemonSettings).toMatch(
      /const handleReauth = useCallback\(async \(\) => \{[\s\S]*?await reauthenticateDaemon\(\);[\s\S]*?const updatePref = useCallback\([\s\S]*?window\.daemonAPI\.setPrefs\(\{ \[key\]: value \}\);[\s\S]*?const externallyManaged = status\.externallyManaged === true;[\s\S]*?onClick=\{handleReauth\}[\s\S]*?onCheckedChange=\{\(checked\) => updatePref\("autoStart", checked\)\}[\s\S]*?disabled=\{saving \|\| externallyManaged\}[\s\S]*?onCheckedChange=\{\(checked\) => updatePref\("autoStop", checked\)\}[\s\S]*?disabled=\{saving \|\| externallyManaged\}/,
    );

    expect(updatesSettings).toMatch(
      /useEffect\(\(\) => \{\s*let mounted = true;[\s\S]*?window\.updater\s*\.getPreferences\(\)[\s\S]*?setAutomaticUpdates\(preferences\.automaticUpdates\);[\s\S]*?return \(\) => \{\s*mounted = false;\s*\};/,
    );
    expect(updatesSettings).toMatch(
      /const handleAutomaticUpdatesChange = useCallback\([\s\S]*?window\.updater\.setAutomaticUpdates\(enabled\);[\s\S]*?const handleCheck = useCallback\(async \(\) => \{[\s\S]*?window\.updater\.checkForUpdates\(\);[\s\S]*?onCheckedChange=\{handleAutomaticUpdatesChange\}[\s\S]*?onClick=\{handleCheck\}\s*disabled=\{state\.status === "checking"\}/,
    );

    expect(updateNotification).toMatch(
      /useEffect\(\(\) => \{\s*const cleanup = window\.updater\.onUpdateDownloaded\(\(info\) => \{\s*setState\(\{ status: "ready", version: info\.version \}\);\s*setDismissed\(false\);\s*\}\);\s*return cleanup;\s*\}, \[\]\);[\s\S]*?<div\s+data-enact-platform="desktop"\s+className="enact-update-notification"[\s\S]*?window\.desktopAPI\.openExternal\(changelogUrl\(state\.version\)\)[\s\S]*?onClick=\{\(\) => window\.updater\.installUpdate\(\)\}/,
    );
  });

  it("preserves Task 9 editor, modal, auth, and onboarding behavior topology", () => {
    const contentEditor = readRepoFile(
      "packages/views/editor/content-editor.tsx",
    );
    const attachmentPreview = readRepoFile(
      "packages/views/editor/attachment-preview-modal.tsx",
    );
    const htmlPreview = readRepoFile(
      "packages/views/editor/html-preview-body.tsx",
    );
    const mermaidViewer = readRepoFile(
      "packages/views/editor/mermaid-viewer.tsx",
    );
    const createIssueDialog = readRepoFile(
      "packages/views/modals/create-issue-dialog.tsx",
    );
    const login = readRepoFile("packages/views/auth/login-page.tsx");
    const stepShell = readRepoFile(
      "packages/views/onboarding/components/step-shell.tsx",
    );
    const onboardingFlow = readRepoFile(
      "packages/views/onboarding/onboarding-flow.tsx",
    );
    const sourceBackfill = readRepoFile(
      "packages/views/onboarding/source-backfill-modal.tsx",
    );
    const workspaceWelcome = readRepoFile(
      "packages/views/workspace/welcome-after-onboarding.tsx",
    );
    const desktopLogin = readRepoFile(
      "apps/desktop/src/renderer/src/pages/login.tsx",
    );
    const desktopRecovery = readRepoFile(
      "apps/desktop/src/renderer/src/pages/auth-recovery.tsx",
    );

    expect(contentEditor).toMatch(
      /useEditor\([\s\S]*?<EditorContent className="enact-editor-content" editor=\{editor\} \/>[\s\S]*?showBubbleMenu && \([\s\S]*?<EditorBubbleMenu editor=\{editor\}/,
    );
    expect(attachmentPreview).toMatch(
      /document\.addEventListener\("keydown", handler\);\s*return \(\) => document\.removeEventListener\("keydown", handler\);[\s\S]*?return createPortal\([\s\S]*?<AnimatePresence onExitComplete=\{onExitComplete\}>/,
    );
    expect(htmlPreview).toContain("withFragmentNavShim");
    expect(htmlPreview).toContain("<CodeBlockIframe");
    expect(mermaidViewer).toMatch(
      /<DialogContent[\s\S]*?initialFocus=\{canvasRef\}[\s\S]*?finalFocus=\{finalFocusRef\}[\s\S]*?<iframe[\s\S]*?sandbox=""[\s\S]*?srcDoc=\{viewerDocument\}/,
    );
    expect(createIssueDialog).toMatch(
      /const \[mode, setMode\] = useState<CreateMode>\(initialMode\);[\s\S]*?const switchTo = \(next: CreateMode\)[\s\S]*?<DialogContent[\s\S]*?mode === "agent" \? \([\s\S]*?<AgentCreatePanel[\s\S]*?onSwitchMode=\{switchTo\("manual"\)\}[\s\S]*?<ManualCreatePanel[\s\S]*?onSwitchMode=\{switchTo\("agent"\)\}/,
    );

    expect(login).toMatch(
      /const handleEmailAuth = useCallback\([\s\S]*?mode === "register"[\s\S]*?registerWithEmail\(email, password, name\.trim\(\)\)[\s\S]*?loginWithEmail\(email, password\)[\s\S]*?qc\.setQueryData\(workspaceKeys\.list\(\), wsList\);[\s\S]*?onSuccess\(\);[\s\S]*?const handleCliAuthorize = async \(\) => \{[\s\S]*?redirectToCliCallback\(cliCallback\.url, token, cliCallback\.state\);[\s\S]*?const handleGoogleLogin = \(\) => \{[\s\S]*?onGoogleLogin\(\);/,
    );
    expect(stepShell).toMatch(
      /<div className="enact-onboarding-shell">\s*<DragStrip \/>[\s\S]*?<main\s+ref=\{mainRef\}\s+style=\{fadeStyle\}\s+className=\{`enact-onboarding-scroller \$\{STEP_GUTTER\}`\}/,
    );
    expect(onboardingFlow).toMatch(
      /await completeOnboarding\("skip_existing", workspaces\[0\]\?\.id\);[\s\S]*?const handleRuntimeNext = useCallback\([\s\S]*?await completeOnboarding\("full", workspace\.id\);[\s\S]*?await completeOnboarding\("runtime_skipped", workspace\.id\);[\s\S]*?<StepShell[\s\S]*?<StepWorkspace[\s\S]*?onCreated=\{handleWorkspaceCreated\}[\s\S]*?<StepRuntimeConnect[\s\S]*?onNext=\{handleRuntimeNext\}/,
    );
    expect(sourceBackfill).toMatch(
      /const \[dismissCount, bumpDismissCount\] =[\s\S]*?window\.setTimeout\(\(\) => \{[\s\S]*?setOpen\(true\);[\s\S]*?<Dialog[\s\S]*?onOpenChange=\{\(next\) => \{[\s\S]*?bumpDismissCount\(\);\s*setOpen\(false\);/,
    );
    expect(workspaceWelcome).toMatch(
      /workspaceSetupOptions\(workspaceId, i18n\.resolvedLanguage \?\? i18n\.language\)[\s\S]*?findSetupStep\(setup\.data, "runtime"\)[\s\S]*?const handleGotIt = async \(\) => \{\s*onDismiss\(\);[\s\S]*?resolveWorkspaceSlug\(queryClient, workspaceId\)[\s\S]*?runtimeStep\?\.issue_id[\s\S]*?issueDetail\(runtimeStep\.issue_id\)[\s\S]*?paths\.workspace\(slug\)\.issues\(\)/,
    );
    expect(desktopLogin).toMatch(
      /window\.desktopAPI\.openExternal\([\s\S]*?`\$\{webUrl\}\/login\?platform=desktop`[\s\S]*?data-enact-platform="desktop"[\s\S]*?<DragStrip \/>/,
    );
    expect(desktopRecovery).toMatch(
      /const retryAuthentication = useAuthStore\([\s\S]*?data-enact-platform="desktop"[\s\S]*?<DragStrip \/>[\s\S]*?onClick=\{onRetry \?\? retryAuthentication\}/,
    );
  });

  it("preserves popup, selection, and integration behavior contracts", () => {
    const dropdown = readRepoFile(
      "packages/ui/components/ui/dropdown-menu.tsx",
    );
    const popover = readRepoFile("packages/ui/components/ui/popover.tsx");
    const table = readRepoFile("packages/ui/components/ui/table.tsx");
    const dataTable = readRepoFile(
      "packages/ui/components/ui/data-table.tsx",
    );
    const sonner = readRepoFile("packages/ui/components/ui/sonner.tsx");

    expect(dropdown).toMatch(
      /onClick=\{\(e\) => \{\s*e\.stopPropagation\(\)\s*onClick\?\.\(e\)/,
    );
    expect(dropdown).toContain("closeOnClick = true");
    expect(popover).toContain(
      "<PopoverPrimitive.Portal keepMounted={keepMounted}>",
    );
    expect(table).toContain('className={cn(\n        "enact-table-row",');
    expect(table).not.toContain("enact-selection-item");
    expect(dataTable).toMatch(
      /className="enact-data-table-pinned-shadow[^\n]+"\s*style=\{\{ left: `\$\{pinnedEdge\}px` \}\}/,
    );
    expect(sonner).toContain('const { resolvedTheme = "system" } = useTheme()');
    expect(sonner).toContain("const Toaster = ({ className, ...props }: ToasterProps)");
    expect(sonner).toContain('className={cn("enact-sonner-theme toaster group", className)}');
    expect(sonner).not.toMatch(/\bstyle\s*=/);
    expect(sonner).toMatch(/toastOptions=\{\{[\s\S]*?\}\}\s*\{\.\.\.props\}\s*\/>/);
  });
});
