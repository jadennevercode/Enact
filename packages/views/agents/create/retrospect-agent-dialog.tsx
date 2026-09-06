"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useCreateRetrospectAgent } from "@enact/core/agents";
import { useAuthStore } from "@enact/core/auth";
import { useWorkspaceId } from "@enact/core/hooks";
import {
  useRequiredWorkspaceSlug,
  useWorkspacePaths,
} from "@enact/core/paths";
import { runtimeListOptions } from "@enact/core/runtimes/queries";
import { memberListOptions } from "@enact/core/workspace/queries";
import { Button } from "@enact/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@enact/ui/components/ui/dialog";
import { RuntimePicker } from "../components/runtime-picker";
import { useNavigation } from "../../navigation";
import { useT } from "../../i18n";
import { pickContentLang } from "../../onboarding/templates";

/**
 * The one question the Retrospect Agent's setup asks: which runtime it reviews
 * on. Everything else about it — name, avatar, permissions, instructions — is
 * a server constant, so there is nothing else here to get wrong.
 *
 * Model is deliberately not asked. Mika's dialog offers one because a Chief of
 * Staff talks to the member all day and the choice is felt immediately; a
 * retrospect runs unattended after work finishes, and the runtime's own
 * default is the right answer until someone changes it on the agent itself.
 *
 * Configuring the agent is also the opt-in for the whole retrospect loop, which
 * is why the copy explains what starts happening rather than just naming a
 * runtime.
 */
export function RetrospectAgentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useT("agents");
  const wsId = useWorkspaceId();
  const wsSlug = useRequiredWorkspaceSlug();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const currentUserId = useAuthStore((state) => state.user?.id) ?? null;

  const { data: runtimes = [], isLoading: runtimesLoading } = useQuery(
    runtimeListOptions(wsId),
  );
  const { data: members = [] } = useQuery(memberListOptions(wsId));

  // Left empty on purpose: RuntimePicker owns seeding, so the first usable
  // runtime is selected once the list arrives — including when it arrives
  // late over the websocket — instead of this component racing it.
  const [runtimeId, setRuntimeId] = useState("");
  const createAgent = useCreateRetrospectAgent(wsId);

  const handleConfirm = async () => {
    if (!runtimeId || createAgent.isPending) return;
    try {
      const agent = await createAgent.mutateAsync({
        workspaceSlug: wsSlug,
        runtimeId,
        language: pickContentLang(i18n.language),
      });
      onOpenChange(false);
      // A workspace that already had one gets it back with 200 instead of an
      // error, so there is nothing to branch on: open whatever came back.
      navigation.push(paths.agentDetail(agent.id));
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t(($) => $.creation_studio.retrospect.failed),
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {t(($) => $.creation_studio.retrospect.dialog_title)}
          </DialogTitle>
          <DialogDescription>
            {t(($) => $.creation_studio.retrospect.dialog_description)}
          </DialogDescription>
        </DialogHeader>

        <RuntimePicker
          runtimes={runtimes}
          runtimesLoading={runtimesLoading}
          members={members}
          currentUserId={currentUserId}
          selectedRuntimeId={runtimeId}
          onSelect={setRuntimeId}
          disabled={createAgent.isPending}
        />

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={createAgent.isPending}
          >
            {t(($) => $.creation_studio.retrospect.cancel)}
          </Button>
          <Button
            onClick={() => void handleConfirm()}
            disabled={!runtimeId || createAgent.isPending}
          >
            {createAgent.isPending && (
              <Loader2 aria-hidden className="size-4 animate-spin" />
            )}
            {t(($) => $.creation_studio.retrospect.confirm)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
