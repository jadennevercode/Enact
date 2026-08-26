type SkillLike = {
  kind?: string;
  config?: Record<string, unknown>;
};

export function isOntologySkill(skill: SkillLike): boolean {
  return skill.kind === "ontology" || skill.config?.kind === "ontology";
}
