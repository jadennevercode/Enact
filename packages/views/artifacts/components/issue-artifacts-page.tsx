"use client";

/**
 * IssueArtifactsPage — the files one issue produced, reached from the issue's
 * own header.
 *
 * Artifacts hang off the issue that produced them rather than off a
 * workspace-wide section, so this page is addressed under the issue and its
 * breadcrumb walks back to it. Sub-issue files are listed too, in their own
 * folders: a sub-issue is where delegated work lands, and a parent whose
 * children did the producing would otherwise look empty.
 */

import { useQuery } from "@tanstack/react-query";
import { issueArtifactsOptions } from "@enact/core/artifacts";
import { useWorkspaceId } from "@enact/core/hooks";
import { issueDetailOptions } from "@enact/core/issues/queries";
import { useWorkspacePaths } from "@enact/core/paths";
import { BreadcrumbHeader } from "../../layout/breadcrumb-header";
import { useT } from "../../i18n";
import { ArtifactBrowser } from "./artifact-browser";

export function IssueArtifactsPage({ issueId }: { issueId: string }) {
  const { t } = useT("artifacts");
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const issue = useQuery(issueDetailOptions(wsId, issueId));
  const query = useQuery(issueArtifactsOptions(wsId, issueId));

  // The crumb is omitted rather than rendered as a skeleton while the issue
  // loads: a breadcrumb segment must always navigate somewhere.
  const segments = issue.data
    ? [
        {
          href: paths.issues(),
          label: t(($) => $.breadcrumb_issues),
        },
        {
          href: paths.issueDetail(issue.data.id),
          label: `${issue.data.identifier ?? ""} ${issue.data.title ?? ""}`.trim(),
          className: "flex items-center gap-1 min-w-0 max-w-72 truncate",
        },
      ]
    : [];

  return (
    <ArtifactBrowser
      scope={{ kind: "issue", issueId }}
      query={query}
      ownLabel={t(($) => $.own_issue_group)}
      emptyHint={t(($) => $.empty_hint_issue)}
      header={
        <BreadcrumbHeader
          segments={segments}
          leaf={<span className="font-medium">{t(($) => $.title)}</span>}
        />
      }
    />
  );
}
