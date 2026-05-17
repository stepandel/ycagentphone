import { mkdir, readFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import type { ReservationDeposit, ReservationDetails } from "./post-call.js";
import {
  createReservation,
  findLatestReservationByPhone,
  openReservationDatabase,
  parseReservationDateTime,
  type Reservation,
  seedDiningTables
} from "./reservation-store.js";

const RESERVATION_MARKER = "<!-- reservation-log-entry ";
const FOLLOW_UP_MARKER = "<!-- reservation-log-follow-up ";
const MARKER_END = " -->";

export type ReservationLogEntry = {
  id: string;
  callId?: string;
  caller: string;
  createdAt: string;
  conversationContext?: string;
  reservation: ReservationDetails;
  deposit?: ReservationDeposit;
};

export type ReservationLogFollowUp = {
  reservationId: string;
  caller: string;
  createdAt: string;
  transcript: string;
  reservationUpdates?: Partial<ReservationDetails>;
};

export type ReservationLogRecord =
  | { type: "reservation"; entry: ReservationLogEntry }
  | { type: "follow-up"; followUp: ReservationLogFollowUp };

function normalizePhone(value: string): string {
  return value.replace(/[^\d+]/g, "");
}

function parsePartySize(value: string | undefined): number | undefined {
  const match = value?.match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

function reservationId(callId: string | undefined, caller: string, createdAt: string): string {
  if (callId) return callId;
  const normalizedCaller = normalizePhone(caller).replace(/^\+/, "") || "unknown";
  return `reservation_${normalizedCaller}_${createdAt.replace(/[^0-9]/g, "")}`;
}

function escapeHtmlComment(value: string): string {
  return value.replaceAll("--", "- -");
}

function detailLine(label: string, value: string | undefined): string {
  return `- ${label}: ${value?.trim() || "Not provided"}`;
}

function formatReservationEntry(entry: ReservationLogEntry): string {
  const metadata = escapeHtmlComment(JSON.stringify(entry));
  return [
    `## Reservation ${entry.id}`,
    `${RESERVATION_MARKER}${metadata}${MARKER_END}`,
    "",
    detailLine("Caller", entry.caller),
    detailLine("Guest name", entry.reservation.guestName),
    detailLine("Party size", entry.reservation.partySize),
    detailLine("Date", entry.reservation.day),
    detailLine("Time", entry.reservation.time),
    detailLine("Special notes", entry.reservation.specialNotes),
    entry.conversationContext ? detailLine("Context", entry.conversationContext) : undefined,
    ""
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function formatFollowUp(followUp: ReservationLogFollowUp): string {
  const metadata = escapeHtmlComment(JSON.stringify(followUp));
  const updates = formatReservationUpdates(followUp.reservationUpdates);
  return [
    `### Text follow-up for ${followUp.reservationId}`,
    `${FOLLOW_UP_MARKER}${metadata}${MARKER_END}`,
    "",
    `- Caller: ${followUp.caller}`,
    `- Received: ${followUp.createdAt}`,
    updates ? `- Reservation updates: ${updates}` : undefined,
    "",
    "> " + followUp.transcript.replace(/\n/g, "\n> "),
    ""
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

async function appendMarkdown(section: string, logPath = config.RESERVATION_LOG_PATH): Promise<void> {
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, `${section.trimEnd()}\n\n`, "utf8");
}

function parseMarkers(content: string, marker: string): unknown[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(marker) && line.endsWith(MARKER_END))
    .map((line) => line.slice(marker.length, -MARKER_END.length).trim())
    .map((json) => {
      try {
        return JSON.parse(json);
      } catch {
        return undefined;
      }
    })
    .filter((value) => value !== undefined);
}

function isReservationLogEntry(value: unknown): value is ReservationLogEntry {
  const item = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return typeof item.id === "string" && typeof item.caller === "string" && typeof item.createdAt === "string";
}

function isReservationLogFollowUp(value: unknown): value is ReservationLogFollowUp {
  const item = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return (
    typeof item.reservationId === "string" &&
    typeof item.caller === "string" &&
    typeof item.createdAt === "string" &&
    typeof item.transcript === "string"
  );
}

function formatReservationUpdates(updates: Partial<ReservationDetails> | undefined): string | undefined {
  if (!updates) return undefined;
  const parts = [
    updates.guestName ? `guest name -> ${updates.guestName}` : undefined,
    updates.partySize ? `party size -> ${updates.partySize}` : undefined,
    updates.day ? `date -> ${updates.day}` : undefined,
    updates.time ? `time -> ${updates.time}` : undefined,
    updates.specialNotes ? `special notes -> ${updates.specialNotes}` : undefined
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("; ") : undefined;
}

function formatDepositContext(deposit: ReservationDeposit | undefined): string {
  if (!deposit) return "not tracked";
  const amount = deposit.amountLabel || (deposit.amountCents && deposit.currency ? `${deposit.amountCents} ${deposit.currency}` : "deposit");
  const link = deposit.paymentLinkUrl ? `; link sent: ${deposit.paymentLinkUrl}` : "";
  return `pending ${amount}${link}`;
}

function formatSqliteDepositContext(reservation: Reservation | undefined, fallback: ReservationDeposit | undefined): string {
  if (!reservation) return formatDepositContext(fallback);
  const amount =
    reservation.depositAmountCents && reservation.depositCurrency
      ? new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: reservation.depositCurrency.toUpperCase(),
          maximumFractionDigits: reservation.depositAmountCents % 100 === 0 ? 0 : 2
        }).format(reservation.depositAmountCents / 100)
      : "not specified";
  const paidAt = reservation.depositPaidAt ? `; paid at ${reservation.depositPaidAt}` : "";
  const link = reservation.depositPaymentLinkUrl ? `; link: ${reservation.depositPaymentLinkUrl}` : "";
  return `${reservation.depositStatus.replaceAll("_", " ")}; amount: ${amount}${paidAt}${link}`;
}

function mergeReservationUpdates(
  reservation: ReservationDetails,
  updates: Partial<ReservationDetails> | undefined
): ReservationDetails {
  if (!updates) return reservation;
  const specialNotes =
    updates.specialNotes && reservation.specialNotes
      ? `${reservation.specialNotes}; ${updates.specialNotes}`
      : updates.specialNotes ?? reservation.specialNotes;
  return {
    ...reservation,
    ...Object.fromEntries(
      Object.entries(updates).filter(([key, value]) => key !== "specialNotes" && typeof value === "string" && value.trim().length > 0)
    ),
    specialNotes
  };
}

export function createReservationLogEntry(input: {
  callId?: string;
  caller: string;
  conversationContext?: string;
  reservation: ReservationDetails;
  deposit?: ReservationDeposit;
  createdAt?: string;
}): ReservationLogEntry {
  const createdAt = input.createdAt ?? new Date().toISOString();
  return {
    id: reservationId(input.callId, input.caller, createdAt),
    callId: input.callId,
    caller: input.caller,
    createdAt,
    conversationContext: input.conversationContext,
    reservation: input.reservation,
    deposit: input.deposit
  };
}

export async function appendReservationLogEntry(entry: ReservationLogEntry, logPath?: string): Promise<void> {
  await appendMarkdown(formatReservationEntry(entry), logPath);
  if (!logPath || logPath === config.RESERVATION_LOG_PATH) {
    await appendReservationLogEntryToSqlite(entry);
  }
}

export async function appendReservationLogFollowUp(followUp: ReservationLogFollowUp, logPath?: string): Promise<void> {
  await appendMarkdown(formatFollowUp(followUp), logPath);
}

export async function appendReservationLogEntryToSqlite(entry: ReservationLogEntry): Promise<void> {
  const startsAt = parseReservationDateTime(entry.reservation.day, entry.reservation.time, new Date(entry.createdAt));
  const partySize = parsePartySize(entry.reservation.partySize);
  if (!startsAt || !partySize) return;

  const db = openReservationDatabase();
  try {
    seedDiningTables(db);
    createReservation(db, {
      id: entry.id,
      sourceCallId: entry.callId,
      guestName: entry.reservation.guestName ?? "Unknown guest",
      phone: entry.caller,
      partySize,
      startsAt,
      notes: [entry.reservation.specialNotes, entry.conversationContext].filter(Boolean).join("; ") || undefined,
      depositAmountCents: entry.deposit?.amountCents,
      depositCurrency: entry.deposit?.currency,
      depositPaymentLinkUrl: entry.deposit?.paymentLinkUrl,
      depositStatus: entry.deposit ? "pending" : "not_required",
      createdAt: entry.createdAt
    });
  } finally {
    db.close();
  }
}

export async function loadReservationLogRecords(logPath = config.RESERVATION_LOG_PATH): Promise<ReservationLogRecord[]> {
  let content = "";
  try {
    content = await readFile(logPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const reservations = parseMarkers(content, RESERVATION_MARKER)
    .filter(isReservationLogEntry)
    .map((entry): ReservationLogRecord => ({ type: "reservation", entry }));
  const followUps = parseMarkers(content, FOLLOW_UP_MARKER)
    .filter(isReservationLogFollowUp)
    .map((followUp): ReservationLogRecord => ({ type: "follow-up", followUp }));

  return [...reservations, ...followUps].sort((a, b) => {
    const left = a.type === "reservation" ? a.entry.createdAt : a.followUp.createdAt;
    const right = b.type === "reservation" ? b.entry.createdAt : b.followUp.createdAt;
    return left.localeCompare(right);
  });
}

export async function findLatestReservationForCaller(
  caller: string | undefined,
  logPath = config.RESERVATION_LOG_PATH
): Promise<ReservationLogEntry | undefined> {
  if (!caller) return undefined;
  const normalizedCaller = normalizePhone(caller);
  const records = await loadReservationLogRecords(logPath);
  return records
    .filter((record): record is { type: "reservation"; entry: ReservationLogEntry } => record.type === "reservation")
    .map((record) => record.entry)
    .filter((entry) => normalizePhone(entry.caller) === normalizedCaller)
    .at(-1);
}

export async function recordReservationTextFollowUp(input: {
  caller?: string;
  transcript?: string;
  reservationUpdates?: Partial<ReservationDetails>;
  createdAt?: string;
  logPath?: string;
}): Promise<ReservationLogFollowUp | undefined> {
  if (!input.caller || !input.transcript?.trim()) return undefined;
  const latest = await findLatestReservationForCaller(input.caller, input.logPath);
  if (!latest) return undefined;

  const followUp: ReservationLogFollowUp = {
    reservationId: latest.id,
    caller: input.caller,
    createdAt: input.createdAt ?? new Date().toISOString(),
    transcript: input.transcript.trim(),
    reservationUpdates: input.reservationUpdates
  };
  await appendReservationLogFollowUp(followUp, input.logPath);
  return followUp;
}

export async function formatReservationLogContextForCaller(
  caller: string | undefined,
  logPath = config.RESERVATION_LOG_PATH
): Promise<string> {
  if (!caller) return "No caller phone number was provided for reservation log lookup.";
  const latest = await findLatestReservationForCaller(caller, logPath);
  if (!latest) return "No reservation log entry was found for this caller.";

  const records = await loadReservationLogRecords(logPath);
  const followUps = records
    .filter((record): record is { type: "follow-up"; followUp: ReservationLogFollowUp } => record.type === "follow-up")
    .map((record) => record.followUp)
    .filter((followUp) => followUp.reservationId === latest.id);
  const currentReservation = followUps.reduce(
    (reservation, followUp) => mergeReservationUpdates(reservation, followUp.reservationUpdates),
    latest.reservation
  );
  const recentFollowUps = followUps.slice(-3);
  let sqliteReservation: Reservation | undefined;
  try {
    const db = openReservationDatabase();
    try {
      sqliteReservation = findLatestReservationByPhone(db, caller);
    } finally {
      db.close();
    }
  } catch {
    sqliteReservation = undefined;
  }

  return [
    "Reservation log context for this caller:",
    `Reservation ID: ${latest.id}`,
    `Guest name: ${currentReservation.guestName ?? "not provided"}`,
    `Party size: ${currentReservation.partySize ?? "not provided"}`,
    `Date/time: ${[currentReservation.day, currentReservation.time].filter(Boolean).join(" at ") || "not provided"}`,
    `Special notes: ${currentReservation.specialNotes ?? "none"}`,
    `Deposit: ${formatSqliteDepositContext(sqliteReservation, latest.deposit)}`,
    latest.conversationContext ? `Original context: ${latest.conversationContext}` : undefined,
    recentFollowUps.length > 0
      ? [
          "Recent text follow-ups:",
          ...recentFollowUps.map((followUp) => {
            const updates = formatReservationUpdates(followUp.reservationUpdates);
            return `- ${followUp.createdAt}: ${followUp.transcript}${updates ? ` (${updates})` : ""}`;
          })
        ].join("\n")
      : "Recent text follow-ups: none"
  ]
    .filter(Boolean)
    .join("\n");
}
