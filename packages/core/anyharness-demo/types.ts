export type Framework = "Deep Agents" | "LangGraph" | "Pi";
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
