"use client";

import { useState } from "react";
import {
  ChevronRight,
  FileText,
  MessageSquare,
  Store,
  Telescope,
  type LucideIcon,
} from "lucide-react";
import { useWorkspacePaths } from "@enact/core/paths";
import { cn } from "@enact/ui/lib/utils";
import { AppLink, useBackOrReplace, useNavigation } from "../../navigation";
import { useT } from "../../i18n";
import { AgentCreateShell } from "./create-shell";
import { RetrospectAgentDialog } from "./retrospect-agent-dialog";
import { withSquadParam } from "./squad-param";

/**
 * Entry route of agent creation: pick a method, then hand off to that method's
 * own route. Holds no draft — nothing typed here survives to the next screen
 * because nothing is typed here.
 */
export function ChooseCreateMethodPage() {
  const { t } = useT("agents");
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const backOrReplace = useBackOrReplace();
  const squadId = navigation.searchParams.get("squad");
  const [retrospectOpen, setRetrospectOpen] = useState(false);

  return (
    <AgentCreateShell
      title={
        squadId
          ? t(($) => $.creation_studio.squad_title)
          : t(($) => $.creation_studio.title)
      }
      step={t(($) => $.creation_studio.step_choose)}
      onBack={() => backOrReplace(paths.teamTab("agents"))}
    >
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-10">
        <CreateMethodChooser
          blankHref={withSquadParam(paths.newAgentManual(), squadId)}
          aiHref={withSquadParam(paths.newAgentAi(), squadId)}
          templateHref={paths.marketplace()}
          onRetrospect={() => setRetrospectOpen(true)}
        />
      </main>
      <RetrospectAgentDialog
        open={retrospectOpen}
        onOpenChange={setRetrospectOpen}
      />
    </AgentCreateShell>
  );
}

interface CreateMethod {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Methods that hand off to a route. Mutually exclusive with `onSelect`. */
  href?: string;
  /** Methods that stay on this screen and open a dialog. */
  onSelect?: () => void;
  recommended?: boolean;
}

export function CreateMethodChooser({
  blankHref,
  aiHref,
  templateHref,
  onRetrospect,
}: {
  blankHref: string;
  aiHref: string;
  /**
   * The marketplace, filtered to agent templates. Optional so a caller that
   * has no workspace paths — the onboarding chooser — keeps two cards.
   */
  templateHref?: string;
  /**
   * Opens the Retrospect Agent's setup. Optional for the same reason as
   * `templateHref`: a caller outside a workspace has no runtime to bind and
   * nothing to review yet.
   */
  onRetrospect?: () => void;
}) {
  const { t } = useT("agents");
  const modes: CreateMethod[] = [
    {
      icon: FileText,
      title: t(($) => $.creation_studio.modes.blank.title),
      description: t(($) => $.creation_studio.modes.blank.description),
      href: blankHref,
    },
    {
      icon: MessageSquare,
      title: t(($) => $.creation_studio.modes.ai.title),
      description: t(($) => $.creation_studio.modes.ai.description),
      href: aiHref,
      recommended: true,
    },
    ...(templateHref
      ? [
          {
            icon: Store,
            title: t(($) => $.creation_studio.modes.template.title),
            description: t(($) => $.creation_studio.modes.template.description),
            href: templateHref,
            recommended: false,
          },
        ]
      : []),
    ...(onRetrospect
      ? [
          {
            icon: Telescope,
            title: t(($) => $.creation_studio.modes.retrospect.title),
            description: t(
              ($) => $.creation_studio.modes.retrospect.description,
            ),
            onSelect: onRetrospect,
            recommended: false,
          },
        ]
      : []),
  ];
  return (
    <div className="m-auto w-full max-w-5xl">
      <div className="mx-auto max-w-2xl text-center">
        <div className="text-caption font-medium uppercase tracking-wider text-muted-foreground">
          {t(($) => $.creation_studio.eyebrow)}
        </div>
        <h2 className="mt-2 text-balance text-display-sm font-semibold tracking-tight sm:text-display">
          {t(($) => $.creation_studio.choose_title)}
        </h2>
        <p className="mt-3 text-pretty text-body text-muted-foreground">
          {t(($) => $.creation_studio.choose_description)}
        </p>
      </div>
      <div
        className={cn(
          "mx-auto mt-9 grid gap-4 md:grid-cols-2",
          modes.length > 2 ? "max-w-5xl lg:grid-cols-3" : "max-w-3xl",
        )}
      >
        {modes.map((mode) => (
          <CreateMethodCard key={mode.title} mode={mode} />
        ))}
      </div>
    </div>
  );
}

/**
 * One card. A method that navigates stays an anchor so it keeps middle-click,
 * copy-link and prefetch; a method that opens a dialog is a real button, so it
 * is not a link that goes nowhere.
 */
function CreateMethodCard({ mode }: { mode: CreateMethod }) {
  const { t } = useT("agents");
  const { icon: Icon, title, description, href, onSelect, recommended } = mode;

  const className = cn(
    "group relative flex min-h-56 w-full flex-col items-start rounded-xl border bg-card p-5 text-left",
    "transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-primary/40 hover:bg-accent/30",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    recommended && "border-primary/30 bg-primary/[0.025]",
  );

  const body = (
    <>
      {recommended && (
        <span className="absolute right-4 top-4 rounded-full bg-primary/10 px-2 py-1 text-micro font-medium text-primary">
          {t(($) => $.creation_studio.recommended)}
        </span>
      )}
      <span className="flex size-11 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:text-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="mt-7 text-title-sm font-semibold">{title}</span>
      <span className="mt-2 text-body leading-6 text-muted-foreground">
        {description}
      </span>
      <span className="mt-auto flex items-center gap-1 pt-5 text-caption font-medium text-foreground">
        {t(($) => $.creation_studio.continue)}
        <ChevronRight
          className="size-3.5 transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </span>
    </>
  );

  if (href) {
    return (
      <AppLink href={href} className={className}>
        {body}
      </AppLink>
    );
  }
  return (
    <button type="button" onClick={onSelect} className={className}>
      {body}
    </button>
  );
}
