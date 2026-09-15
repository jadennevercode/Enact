"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CircleHelp,
  MessageSquare,
  Pencil,
  Sparkles,
  X,
} from "lucide-react";
import {
  constructionDetailOptions,
  reviewPacketOptions,
  reviewPacketsForIssue,
  authoringApi,
  authoringOptions,
  issueConstructionOptions,
  useSemanticMutation,
  type AuthoringCard,
  type AuthoringResponse,
  type OntologyAuthoring,
} from "@enact/core/semantic";
import { useWorkspaceId } from "@enact/core/hooks";
import { useWorkspacePaths } from "@enact/core/paths";
import { Badge } from "@enact/ui/components/ui/badge";
import { Button } from "@enact/ui/components/ui/button";
import { Failure, TextArea, TextField, useSemanticText } from "./shared";
import { ConstructionReviewPackets } from "./review-packet";
import { CoordinatorResumeNotice } from "./coordinator-resume-notice";

const kindKeys = {
  entity: "authoringEntity",
  attribute: "authoringAttribute",
  relationship: "authoringRelationship",
  action: "authoringAction",
  policy: "authoringPolicy",
  data_binding: "authoringDataBinding",
  action_binding: "authoringActionBinding",
} as const;

export function AuthoringProposalCard({
  card,
  onDecision,
  pending,
}: {
  card: AuthoringCard;
  onDecision: (
    decision: NonNullable<AuthoringResponse["cardDecisions"]>[number],
  ) => Promise<unknown>;
  pending: boolean;
}) {
  const t = useSemanticText();
  const [editing, setEditing] = useState(false),
    [label, setLabel] = useState(card.label),
    [description, setDescription] = useState(card.description),
    [rationale, setRationale] = useState(""),
    [error, setError] = useState<unknown>(),
    [submitting, setSubmitting] = useState(false);
  async function decide(
    decision: NonNullable<
      AuthoringResponse["cardDecisions"]
    >[number]["decision"],
  ) {
    if (decision === "correct" && (!label.trim() || !description.trim()))
      return;
    setError(undefined);
    setSubmitting(true);
    try {
      await onDecision({
        cardKey: card.key,
        decision,
        rationale: rationale.trim(),
        ...(decision === "correct"
          ? {
              correction: {
                label: label.trim(),
                description: description.trim(),
              },
            }
          : {}),
      });
      setEditing(false);
    } catch (e) {
      setError(e);
    } finally {
      setSubmitting(false);
    }
  }
  const decided = !!card.decisionId && card.status !== "proposed";
  return (
    <article className="min-w-0 [overflow-wrap:anywhere] space-y-3 rounded-xl border border-border-soft bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge variant="outline">{t(kindKeys[card.kind])}</Badge>
        <span className="text-caption text-muted-foreground">
          {t(
            card.classification === "fact"
              ? "reviewFact"
              : card.classification === "human_confirmation" && card.decisionId
                ? "reviewHumanConfirmation"
                : card.classification === "recommendation"
                  ? "reviewRecommendation"
                  : "reviewUnknown",
          )}
        </span>
      </div>
      <h4 className="text-body font-semibold">{card.label}</h4>
      <p className="whitespace-pre-wrap text-body leading-relaxed text-muted-foreground">
        {card.description}
      </p>
      {!!card.sourceRefs.length && (
        <details>
          <summary className="cursor-pointer text-caption text-muted-foreground">
            {t("modelEvidence")}
          </summary>
          <ul className="mt-2 space-y-1 text-caption text-muted-foreground">
            {card.sourceRefs.map((ref) => (
              <li className="break-words" key={ref}>
                {ref}
              </li>
            ))}
          </ul>
        </details>
      )}
      {decided && (
        <p className="flex items-center gap-2 text-caption">
          <Check className="size-4 text-primary" aria-hidden="true" />
          {t(
            card.status === "confirmed"
              ? "authoringConfirmed"
              : card.status === "corrected"
                ? "authoringCorrected"
                : card.status === "rejected"
                  ? "authoringRejected"
                  : "reviewUnknown",
          )}
          {card.rationale ? ` · ${card.rationale}` : ""}
        </p>
      )}
      {editing ? (
        <div className="space-y-3 border-t border-border-soft pt-3">
          <TextField
            label={t("authoringCorrectLabel")}
            value={label}
            onChange={setLabel}
          />
          <TextArea
            label={t("authoringCorrectDescription")}
            value={description}
            onChange={setDescription}
            rows={3}
          />
          <TextArea
            label={t("authoringRationale")}
            value={rationale}
            onChange={setRationale}
            rows={2}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={
                pending || submitting || !label.trim() || !description.trim()
              }
              onClick={() => void decide("correct")}
            >
              {t("authoringSaveCorrection")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 border-t border-border-soft pt-3">
          <Button
            size="sm"
            variant="outline"
            disabled={pending || submitting}
            onClick={() => void decide("confirm")}
          >
            <Check className="size-4" />
            {t("authoringConfirm")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || submitting}
            onClick={() => {
              setLabel(card.label);
              setDescription(card.description);
              setEditing(true);
            }}
          >
            <Pencil className="size-4" />
            {t("authoringCorrect")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending || submitting}
            onClick={() => void decide("unknown")}
          >
            <CircleHelp className="size-4" />
            {t("authoringUnknown")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending || submitting}
            onClick={() => void decide("reject")}
          >
            <X className="size-4" />
            {t("authoringReject")}
          </Button>
        </div>
      )}
      <Failure error={error} />
    </article>
  );
}

export function OntologyInterview({
  authoring,
  onRespond,
  pending,
}: {
  authoring: OntologyAuthoring;
  onRespond: (input: AuthoringResponse) => Promise<unknown>;
  pending: boolean;
}) {
  const t = useSemanticText(),
    [answers, setAnswers] = useState<
      Record<string, { answer: string; unknown: boolean }>
    >({}),
    [error, setError] = useState<unknown>(),
    [submitting, setSubmitting] = useState(false);
  const questions = authoring.interview.questions
    .filter((q) => q.status === "unanswered")
    .slice(0, 3);
  const answered = authoring.interview.questions.filter(
    (q) => q.status !== "unanswered",
  );
  async function submit() {
    setError(undefined);
    setSubmitting(true);
    try {
      await onRespond({
        expectedRevision: authoring.revision,
        answers: questions.map((q) => ({
          questionKey: q.key,
          answer: answers[q.key]?.answer.trim() || "",
          answerKind: answers[q.key]?.unknown ? "unknown" : "answer",
        })),
      });
      setAnswers({});
    } catch (e) {
      setError(e);
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <section className="space-y-4" aria-label={t("authoringInterview")}>
      <header>
        <h3 className="flex items-center gap-2 text-title font-semibold">
          <MessageSquare className="size-5 text-primary" aria-hidden="true" />
          {t("authoringInterview")}
        </h3>
        <p className="mt-2 text-body leading-relaxed text-muted-foreground">
          {t("authoringInterviewHelp")}
        </p>
      </header>
      {answered.length > 0 && (
        <details className="rounded-xl border border-border-soft p-4">
          <summary className="cursor-pointer text-body font-medium">
            {t("authoringPreviousAnswers")} · {answered.length}
          </summary>
          <dl className="mt-4 space-y-4">
            {answered.map((q) => (
              <div key={q.key}>
                <dt className="text-body font-medium">{q.prompt}</dt>
                <dd className="mt-1 whitespace-pre-wrap text-body text-muted-foreground">
                  {q.answerKind === "unknown" || q.status === "skipped"
                    ? t("reviewUnknown")
                    : q.answer}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {questions.map((q) => (
        <div key={q.key} className="space-y-3 rounded-xl bg-muted/30 p-4">
          <TextArea
            label={q.prompt}
            value={answers[q.key]?.answer || ""}
            onChange={(answer) =>
              setAnswers((previous) => ({
                ...previous,
                [q.key]: { answer, unknown: false },
              }))
            }
            rows={3}
          />
          <p className="text-caption leading-relaxed text-muted-foreground">
            {q.why}
          </p>
          <label className="flex cursor-pointer items-center gap-2 text-caption">
            <input
              type="checkbox"
              checked={answers[q.key]?.unknown || false}
              onChange={(e) =>
                setAnswers((previous) => ({
                  ...previous,
                  [q.key]: {
                    answer: previous[q.key]?.answer || "",
                    unknown: e.target.checked,
                  },
                }))
              }
              className="size-4 accent-primary"
            />
            {t("authoringUnknownAnswer")}
          </label>
        </div>
      ))}
      {questions.length > 0 ? (
        <Button
          onClick={() => void submit()}
          disabled={
            pending ||
            submitting ||
            questions.some(
              (q) => !answers[q.key]?.unknown && !answers[q.key]?.answer.trim(),
            )
          }
        >
          {t("authoringSubmitAnswers")}
        </Button>
      ) : (
        <p className="rounded-xl bg-primary/5 p-4 text-body leading-relaxed text-muted-foreground">
          {t(
            authoring.interview.status === "ready"
              ? "authoringScopeReady"
              : "authoringWaiting",
          )}
        </p>
      )}
      <Failure error={error} />
    </section>
  );
}

function ConstructionAuthoring({ constructionId }: { constructionId: string }) {
  const t = useSemanticText(),
    wsId = useWorkspaceId(),
    query = useQuery(authoringOptions(wsId, constructionId)),
    queryClient = useQueryClient();
  const respond = useSemanticMutation(
    wsId,
    async (input: AuthoringResponse) => {
      const result = await authoringApi.respond(constructionId, input);
      queryClient.setQueryData(
        authoringOptions(wsId, constructionId).queryKey,
        result,
      );
      return result;
    },
  );
  return (
    <div className="space-y-6">
      <Failure error={query.error} retry={() => void query.refetch()} />
      <CoordinatorResumeNotice
        constructionId={constructionId}
        resume={
          query.data?.coordinatorResume ?? respond.data?.coordinatorResume
        }
      />
      {query.data && (
        <>
          <OntologyInterview
            authoring={query.data}
            pending={respond.isPending}
            onRespond={(input) => respond.mutateAsync(input)}
          />
          {query.data.cards.length > 0 && (
            <section className="space-y-4">
              <header>
                <h3 className="text-title font-semibold">
                  {t("authoringCards")}
                </h3>
                <p className="mt-2 text-body leading-relaxed text-muted-foreground">
                  {t("authoringCardsHelp")}
                </p>
              </header>
              <div className="grid items-start gap-3 xl:grid-cols-2">
                {query.data.cards.map((card) => (
                  <AuthoringProposalCard
                    key={card.key}
                    card={card}
                    pending={respond.isPending}
                    onDecision={(decision) =>
                      respond.mutateAsync({
                        expectedRevision: query.data!.revision,
                        cardDecisions: [decision],
                      })
                    }
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

export function IssueOntologyConstruction({ issueId, childIssues = [] }: {
  issueId: string;
  childIssues?: { id: string; identifier?: string; title?: string }[];
}) {
  const wsId = useWorkspaceId(),
    t = useSemanticText(),
    paths = useWorkspacePaths(),
    construction = useQuery(issueConstructionOptions(wsId, issueId)),
    constructionId = construction.data?.constructionId ?? "",
    detail = useQuery(constructionDetailOptions(wsId, constructionId)),
    packets = useQuery(reviewPacketOptions(wsId, constructionId));
  const isRoot = detail.data?.construction.issueId === issueId;
  const ownPackets = reviewPacketsForIssue(packets.data || [], detail.data?.tasks || [], issueId);
  if (detail.data && !isRoot && !ownPackets.length && !packets.error) return null;
  const links: Record<string, { href: string; label: string }> = {};
  for (const packet of packets.data || []) {
    const task = detail.data?.tasks.find((task) => task.id === packet.createdByTaskId);
    if (!task || task.issueId === detail.data?.construction.issueId) continue;
    const child = childIssues.find((child) => child.id === task.issueId);
    links[packet.id] = {
      href: `${paths.issueDetail(child?.identifier || task.issueId)}#review-packet-${packet.id}`,
      label: child?.identifier || child?.title || packet.packet.title,
    };
  }
  if (!construction.data && !construction.error) return null;
  return (
    <section
      className="mt-8 space-y-6 rounded-2xl border border-primary/20 bg-surface p-5 sm:p-6"
      aria-label={t(isRoot ? "reviewProgressTitle" : "reviewIssueReports")}
    >
      <header>
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-title font-semibold">{t(isRoot ? "reviewProgressTitle" : "reviewIssueReports")}</h2>
            <p className="mt-1 text-caption text-muted-foreground">
              {t(isRoot ? "reviewProgressHelp" : "reviewIssueReportsHelp")}
            </p>
          </div>
        </div>
      </header>
      <Failure
        error={construction.error}
        retry={() => void construction.refetch()}
      />
      <Failure error={detail.error} retry={() => void detail.refetch()} />
      {detail.data && <>
        <ConstructionReviewPackets
          constructionId={constructionId}
          compact={isRoot}
          packetIds={isRoot ? undefined : ownPackets.map((packet) => packet.id)}
          packetLinks={links}
          showResumeNotice={false}
        />
        {isRoot && <details open={detail.data.construction.stage === "scope" && detail.data.construction.status !== "completed"}>
          <summary className="cursor-pointer text-caption text-muted-foreground">{t("reviewScopeInputs")}</summary>
          <div className="mt-4"><ConstructionAuthoring constructionId={constructionId} /></div>
        </details>}
      </>}
    </section>
  );
}
