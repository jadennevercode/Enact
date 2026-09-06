import { DingTalkMark } from "./dingtalk-mark";
import { LarkMark } from "./lark-mark";
import { SlackMark } from "./slack-mark";
import { TelegramMark } from "./telegram-mark";
import { WecomMark } from "./wecom-mark";

type IntegrationChannel = "lark" | "slack" | "dingtalk" | "wecom" | "telegram";

// Every channel gets its own brand mark, never a generic lucide glyph: the icon
// is what tells a reader which platform the section belongs to, and a stand-in
// speech bubble or plug says nothing (see WecomMark, #6585). lucide-react ships
// no brand icons, so a new channel needs its own `*-mark.tsx` before it can be
// listed here.
export function IntegrationChannelIcon({ channel }: { channel: IntegrationChannel }) {
  const icon = {
    lark: <LarkMark className="enact-integration-provider-mark" />,
    slack: <SlackMark className="enact-integration-provider-mark" />,
    dingtalk: <DingTalkMark className="enact-integration-provider-mark enact-integration-provider-mark-section" />,
    wecom: <WecomMark className="enact-integration-provider-mark" />,
    telegram: <TelegramMark className="enact-integration-provider-mark" />,
  }[channel];

  return (
    <span
      aria-hidden="true"
      data-testid={`integration-channel-icon-${channel}`}
      className="enact-integration-channel-icon"
    >
      {icon}
    </span>
  );
}
