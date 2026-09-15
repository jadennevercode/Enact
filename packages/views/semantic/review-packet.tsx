"use client";

import { AppLink } from "../navigation";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  CircleDashed,
  MessageSquare,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import {
  authoringOptions,
  type OntologyAuthoring,
  reviewPacketApi,
  reviewPacketOptions,
  useSemanticMutation,
  type ReviewPacket,
  type ReviewPacketDecision,
} from "@enact/core/semantic";
import { useWorkspaceId } from "@enact/core/hooks";
import { Badge } from "@enact/ui/components/ui/badge";
import { Button } from "@enact/ui/components/ui/button";
import { Failure, TextArea, useSemanticText } from "./shared";
import { TechnicalDetails } from "./ontology-model";
import { CoordinatorResumeNotice } from "./coordinator-resume-notice";

const gates = ["scope", "model", "operations", "release"];
const gateKeys = [
  "reviewScope",
  "reviewModel",
  "reviewOperations",
  "reviewRelease",
] as const;
export function ReviewPacketCard({
  packet,
  onDecision,
  canReview = true,
  pending = false,
  error,
}: {
  packet: ReviewPacket;
  onDecision: (input: ReviewPacketDecision) => Promise<unknown>;
  canReview?: boolean;
  pending?: boolean;
  error?: unknown;
}) {
  const t = useSemanticText(),
    [rationale, setRationale] = useState(""),
    [localError, setLocalError] = useState<unknown>(),
    [submitting, setSubmitting] = useState(false);
  const open = packet.status === "pending",
    gateIndex = gates.indexOf(packet.gate);
  async function decide(decision: ReviewPacketDecision["decision"]) {
    if (decision === "request_changes" && !rationale.trim()) {
      setLocalError(new Error(t("reviewReasonRequired")));
      return;
    }
    setLocalError(undefined);
    setSubmitting(true);
    try {
      await onDecision({
        decision,
        rationale: rationale.trim(),
        expectedArtifactDigest: packet.artifactDigest,
        expectedReviewSubjectDigest: packet.reviewSubjectDigest,
      });
    } catch (e) {
      setLocalError(e);
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <section
      className="space-y-5 rounded-2xl border border-primary/25 bg-surface p-5"
      aria-label={packet.packet.title || t("reviewTitle")}
    >
      <ol
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        aria-label={t("reviewSequence")}
      >
        {gateKeys.map((key, index) => (
          <li
            key={key}
            className={`border-t-2 pt-2 text-caption ${index === gateIndex ? "border-primary font-semibold text-primary" : "border-border-soft text-muted-foreground"}`}
            aria-current={index === gateIndex ? "step" : undefined}
          >
            {index + 1}. {t(key)}
          </li>
        ))}
      </ol>
      <header>
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-title font-semibold">{packet.packet.title}</h3>
          <ShieldCheck
            className="size-5 shrink-0 text-primary"
            aria-hidden="true"
          />
        </div>
        <p className="mt-3 text-body leading-relaxed text-muted-foreground">
          {packet.packet.summary}
        </p>
        <Badge variant="outline" className="mt-3">
          {t(
            packet.status === "approved"
              ? "reviewApproved"
              : packet.status === "changes_requested"
                ? "reviewChangesRequested"
                : packet.status === "stale"
                  ? "reviewStale"
                  : "reviewPending",
          )}
        </Badge>
      </header>
      {packet.packet.groups.map((group, index) => (
        <section key={index} className="space-y-3">
          <h4 className="text-body font-semibold">{group.title}</h4>
          <div className="space-y-2">
            {group.items.map((item, i) => (
              <article
                key={i}
                className="min-w-0 [overflow-wrap:anywhere] rounded-xl bg-muted/30 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h5 className="text-body font-medium">{item.label}</h5>
                  <span className="text-caption text-muted-foreground">
                    {t(
                      item.classification === "fact"
                        ? "reviewFact"
                        : item.classification === "human_confirmation" &&
                            item.decisionId
                          ? "reviewHumanConfirmation"
                          : item.classification === "recommendation"
                            ? "reviewRecommendation"
                            : "reviewUnknown",
                    )}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-body leading-relaxed">
                  {item.value}
                </p>
                {item.sourceRefs.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-caption text-muted-foreground">
                      {t("modelEvidence")}
                    </summary>
                    <ul className="mt-2 space-y-1 text-caption text-muted-foreground">
                      {item.sourceRefs.map((ref) => (
                        <li className="break-words" key={ref}>
                          {ref}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}
      {packet.packet.checks.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-body font-semibold">{t("reviewChecks")}</h4>
          {packet.packet.checks.map((check, i) => {
            const Icon =
              check.status === "pass"
                ? CheckCircle2
                : check.status === "fail"
                  ? TriangleAlert
                  : CircleDashed;
            return (
              <div
                key={i}
                className="flex items-start gap-3 rounded-lg border border-border-soft p-3"
              >
                <Icon
                  className={`mt-0.5 size-4 shrink-0 ${check.status === "pass" ? "text-success" : check.status === "fail" ? "text-destructive" : "text-muted-foreground"}`}
                  aria-hidden="true"
                />
                <div>
                  <p className="text-body font-medium">{check.label}</p>
                  {check.detail && (
                    <p className="mt-1 text-caption leading-relaxed text-muted-foreground">
                      {check.detail}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}
      {packet.packet.unresolved.length > 0 && (
        <section className="rounded-xl border border-warning/30 bg-warning/5 p-4">
          <h4 className="text-body font-semibold">{t("reviewUnresolved")}</h4>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-body leading-relaxed">
            {packet.packet.unresolved.map((question, i) => (
              <li key={i}>{question}</li>
            ))}
          </ul>
        </section>
      )}
      {packet.decision && (
        <div className="rounded-xl bg-muted/30 p-4">
          <p className="text-body leading-relaxed">
            {packet.decision.rationale}
          </p>
          <p className="mt-2 text-caption text-muted-foreground">
            {new Date(packet.decision.createdAt).toLocaleString()}
          </p>
        </div>
      )}
      {open && canReview && (
        <div className="space-y-4 border-t border-border-soft pt-5">
          <TextArea
            label={t("reviewReason")}
            value={rationale}
            onChange={setRationale}
            rows={3}
          />
          <p className="text-caption leading-relaxed text-muted-foreground">
            {t("reviewHumanOnly")}
          </p>
          <Failure error={error || localError} />
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={pending || submitting}
              onClick={() => void decide("approve")}
            >
              <CheckCircle2 className="size-4" aria-hidden="true" />
              {t("reviewApprove")}
            </Button>
            <Button
              variant="outline"
              disabled={pending || submitting}
              onClick={() => void decide("request_changes")}
            >
              <MessageSquare className="size-4" aria-hidden="true" />
              {t("reviewRevise")}
            </Button>
          </div>
        </div>
      )}
      <TechnicalDetails
        value={{
          packetId: packet.id,
          artifactDigest: packet.artifactDigest,
          reviewSubjectDigest: packet.reviewSubjectDigest,
          status: packet.status,
        }}
      />
    </section>
  );
}

export function ReviewPacketSummary({ packet, link }: {
  packet: ReviewPacket;
  link?: { href: string; label: string };
}) {
  const t = useSemanticText();
  return (
    <article className="min-w-0 space-y-2 rounded-xl border border-border-soft p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-body font-semibold">{t(gateKeys[gates.indexOf(packet.gate)] ?? "reviewSequence")}</h3>
        <Badge variant="outline">{t(packet.status === "approved" ? "reviewApproved" : packet.status === "changes_requested" ? "reviewChangesRequested" : packet.status === "stale" ? "reviewStale" : "reviewPending")}</Badge>
      </div>
      <p className="line-clamp-1 text-caption text-muted-foreground" title={packet.packet.title}>{packet.packet.title}</p>
      {link && <AppLink href={link.href} className="inline-flex min-h-8 items-center text-caption font-medium text-primary underline-offset-4 hover:underline">{t("reviewOpenSubIssue")} · {link.label}</AppLink>}
    </article>
  );
}

export function ConstructionReviewPackets({
  constructionId,
  canReview = true,
  showResumeNotice = true,
  packetIds,
  compact = false,
  packetLinks = {},
}: {
  constructionId: string;
  canReview?: boolean;
  showResumeNotice?: boolean;
  packetIds?: string[];
  compact?: boolean;
  packetLinks?: Record<string, { href: string; label: string }>;
}) {
  const t = useSemanticText(),
    wsId = useWorkspaceId(),
    queryClient = useQueryClient(),
    packets = useQuery(reviewPacketOptions(wsId, constructionId));
  const decide = useSemanticMutation(
    wsId,
    async ({
      packetId,
      input,
    }: {
      packetId: string;
      input: ReviewPacketDecision;
    }) => {
      const result = await reviewPacketApi.decide(packetId, input);
      queryClient.setQueryData<OntologyAuthoring>(
        authoringOptions(wsId, constructionId).queryKey,
        (previous) =>
          previous
            ? { ...previous, coordinatorResume: result.coordinatorResume }
            : previous,
      );
      return result;
    },
  );
  const latest = new Map<string, ReviewPacket>();
  for (const packet of packets.data || [])
    if (
      !latest.has(packet.gate) ||
      latest.get(packet.gate)!.sequence < packet.sequence
    )
      latest.set(packet.gate, packet);
  const visiblePackets = packetIds
    ? (packets.data || []).filter((packet) => packetIds.includes(packet.id))
    : gates.flatMap((gate) => latest.get(gate) ? [latest.get(gate)!] : []);
  const earlierPackets = (packets.data || []).filter(
    (packet) => latest.get(packet.gate)?.id !== packet.id && packet.status !== "stale",
  );
  return (
    <div className={compact ? "grid gap-3 sm:grid-cols-2" : "space-y-5"}>
      <Failure error={packets.error} retry={() => void packets.refetch()} />
      {showResumeNotice && (
        <CoordinatorResumeNotice
          constructionId={constructionId}
          resume={decide.data?.coordinatorResume}
        />
      )}
      {visiblePackets.map((packet) => {
        const earlierApproved = gates.slice(0, gates.indexOf(packet.gate)).every((prior) => latest.get(prior)?.status === "approved");
        const card = <ReviewPacketCard
          packet={packet}
          canReview={canReview && earlierApproved && latest.get(packet.gate)?.id === packet.id}
          pending={decide.isPending}
          error={decide.error}
          onDecision={(input) => decide.mutateAsync({ packetId: packet.id, input })}
        />;
        if (!compact) return <div key={packet.id} id={`review-packet-${packet.id}`} className="scroll-mt-20">{card}</div>;
        return <div key={packet.id} className="space-y-2">
          <ReviewPacketSummary packet={packet} link={packetLinks[packet.id]} />
          {!packetLinks[packet.id] && <details className="text-body">
            <summary className="cursor-pointer text-caption text-primary">{t("reviewOpenReport")}</summary>
            <div className="mt-3">{card}</div>
          </details>}
        </div>;
      })}
      {compact && earlierPackets.length > 0 && (
        <details className="sm:col-span-2">
          <summary className="cursor-pointer text-caption text-muted-foreground">{t("reviewEarlierReports")}</summary>
          <div className="mt-3 space-y-2">
            {earlierPackets.map((packet) => (
              <div key={packet.id}>
                <ReviewPacketSummary packet={packet} link={packetLinks[packet.id]} />
                {!packetLinks[packet.id] && <details>
                  <summary className="cursor-pointer text-caption text-primary">{t("reviewOpenReport")}</summary>
                  <ReviewPacketCard packet={packet} canReview={false} onDecision={async () => {}} />
                </details>}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
