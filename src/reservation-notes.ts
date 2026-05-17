import { mkdir, appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { CallTurn } from "./agentphone.js";
import { config } from "./config.js";
import { isReservationQuery } from "./skills/reservation-taking.js";

export type ReservationNoteOptions = Pick<CallTurn, "callId" | "caller" | "transcript"> & {
  answer: string;
  isCallStart?: boolean;
  now?: Date;
  notesPath?: string;
};

function markdownValue(value: string | undefined): string {
  return value?.trim() ? value.trim() : "Not provided";
}

function fenced(value: string): string {
  return value.replaceAll("```", "'''").trim();
}

export function formatReservationNote({ callId, caller, transcript, answer, now = new Date() }: ReservationNoteOptions): string {
  return [
    `## Reservation note - ${now.toISOString()}`,
    "",
    `- Call ID: ${markdownValue(callId)}`,
    `- Caller: ${markdownValue(caller)}`,
    "",
    "### Transcript",
    "",
    "```text",
    fenced(transcript ?? ""),
    "```",
    "",
    "### Agent response",
    "",
    "```text",
    fenced(answer),
    "```",
    ""
  ].join("\n");
}

export async function appendReservationNote(options: ReservationNoteOptions): Promise<boolean> {
  const notesPath = options.notesPath ?? config.RESERVATION_NOTES_PATH;
  if (!notesPath || options.isCallStart || !isReservationQuery(options.transcript)) {
    return false;
  }

  const absolutePath = resolve(notesPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await appendFile(absolutePath, `${formatReservationNote(options)}\n`, "utf8");
  return true;
}
