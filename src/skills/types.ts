export type AgentSkill = {
  name: string;
  description: string;
  matches: (transcript: string | undefined) => boolean;
  buildContext: (transcript: string | undefined) => string;
};
