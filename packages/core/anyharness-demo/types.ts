export type Framework = "Deep Agents" | "LangGraph" | "Pi";
export type Stage =
  | "empty"
  | "draft"
  | "team"
  | "clarify"
  | "design"
  | "failed"
  | "ready"
  | "published";
export type TrialStage =
  | "none"
  | "write-approval"
  | "approval"
  | "delivered"
  | "complete";
export interface DemoRuntime {
  id: string;
  name: string;
  goal: string;
  language: string;
  framework: Framework;
  version: string;
}
export interface DemoSkill {
  id: string;
  name: string;
  purpose: string;
  trigger: string;
  input: string;
  output: string;
  domains: number[];
}
export interface DemoAgent {
  id: string;
  name: string;
  responsibility: string;
  skills: string[];
  input: string;
  output: string;
  boundary: string;
}
export interface DemoFamily {
  id: string;
  name: string;
  agentIds: string[];
}
export interface DemoIssue {
  id: string;
  title: string;
  owner: string;
  status: "待开始" | "进行中" | "已完成" | "待修复";
  artifactIds: string[];
}
export interface DemoMessage {
  id: string;
  issue: "build" | "trial";
  role: string;
  text: string;
  kind: "comment" | "handoff" | "artifact" | "validation" | "build";
  artifactIds: string[];
  time: string;
}
export interface DemoMechanism {
  id: string;
  domain: string;
  choice: string;
  implementation: string;
  check: string;
}
export interface DemoArtifact {
  id: string;
  title: string;
  version: string;
  body: string;
}
export interface DemoRevision {
  version: string;
  reason: string;
  protectedContext: string[];
  memory: string;
  tools: string;
}
export interface DemoEvent {
  id: string;
  command: string;
  time: string;
}
export interface DemoState {
  schema: 1;
  stage: Stage;
  runtime: DemoRuntime | null;
  familyAdded: boolean;
  designRejected: boolean;
  protectedContext: string[];
  memory: "verified" | "direct";
  tools: "confirm" | "writes";
  messages: DemoMessage[];
  revisions: DemoRevision[];
  events: DemoEvent[];
  visible: number;
  trial: TrialStage;
  coderBound: boolean;
  memoryAccepted: boolean | null;
  validation: {
    attempt: number;
    passed: boolean;
    reason: string;
    blueprint: string;
  }[];
}
export type DemoCommand =
  | { type: "create"; name: string; goal: string; framework: Framework }
  | { type: "team" | "issue" | "bind" | "trial" | "reveal" | "tick" }
  | { type: "comment"; text: string; issue: "build" | "trial" }
  | {
      type: "configure";
      name: string;
      goal: string;
      language: string;
      protectedContext: string[];
      memory: DemoState["memory"];
      tools: DemoState["tools"];
    }
  | { type: "checkpoint"; checkpoint: "design" | "failed" | "published" }
  | { type: "reset" };
