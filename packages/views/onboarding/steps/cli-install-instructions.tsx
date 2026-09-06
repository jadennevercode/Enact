"use client";

import { useState } from "react";
import { Check, Copy, Terminal } from "lucide-react";
import { Card, CardContent } from "@enact/ui/components/ui/card";
import { CODE_LIGATURE_CLASS } from "@enact/ui/lib/code-style";
import { cn } from "@enact/ui/lib/utils";
import { copyText } from "@enact/ui/lib/clipboard";
import { useT } from "../../i18n";

const INSTALL_CMD =
  "curl -fsSL https://raw.githubusercontent.com/enact-ai/enact/main/scripts/install.sh | bash";
const SETUP_CMD = "enact setup";

function CopyButton({ text }: { text: string }) {
  const { t } = useT("onboarding");
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void copyText(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="enact-onboarding-copy-button"
      aria-label={t(($) => $.cli_install.copy_aria)}
    >
      {copied ? (
        <Check className="enact-onboarding-copy-icon" data-copied="true" />
      ) : (
        <Copy className="enact-onboarding-copy-icon" />
      )}
    </button>
  );
}

function Step({ n, label, cmd }: { n: number; label: string; cmd: string }) {
  return (
    <div>
      <p className="enact-onboarding-cli-step-label">
        {n}. {label}
      </p>
      <div className="enact-onboarding-cli-command">
        <Terminal className="enact-onboarding-cli-command-icon" />
        <code
          className={cn(
            "enact-onboarding-cli-command-code",
            CODE_LIGATURE_CLASS,
          )}
        >
          {cmd}
        </code>
        <CopyButton text={cmd} />
      </div>
    </div>
  );
}

export function CliInstallInstructions() {
  const { t } = useT("onboarding");
  return (
    <Card className="enact-onboarding-cli-card">
      <CardContent className="enact-onboarding-cli-card-content">
        <p className="enact-onboarding-cli-intro">
          {t(($) => $.cli_install.intro)}
        </p>
        <Step n={1} label={t(($) => $.cli_install.step1_label)} cmd={INSTALL_CMD} />
        <Step n={2} label={t(($) => $.cli_install.step2_label)} cmd={SETUP_CMD} />
      </CardContent>
    </Card>
  );
}
