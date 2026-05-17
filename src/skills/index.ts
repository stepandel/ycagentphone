import { reservationTakingSkill } from "./reservation-taking.js";
import type { AgentSkill } from "./types.js";

export const skills: AgentSkill[] = [reservationTakingSkill];

export function buildSkillContext(transcript: string | undefined): string {
  const matchingSkills = skills.filter((skill) => skill.matches(transcript));

  if (matchingSkills.length === 0) {
    return "No call skills matched this caller turn.";
  }

  return matchingSkills.map((skill) => skill.buildContext(transcript)).join("\n\n---\n\n");
}
