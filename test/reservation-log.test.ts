import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import {
  appendReservationLogEntry,
  createReservationLogEntry,
  findLatestReservationForCaller,
  formatReservationLogContextForCaller,
  loadReservationLogRecords,
  recordReservationTextFollowUp
} from "../src/reservation-log.js";

async function tempLogPath(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "reservation-log-test-"));
  return path.join(dir, "reservation-log.md");
}

describe("reservation log", () => {
  it("writes reservation details to a markdown log that can be read back by caller", async () => {
    const logPath = await tempLogPath();
    const entry = createReservationLogEntry({
      callId: "call_123",
      caller: "+15551234567",
      createdAt: "2026-05-17T20:00:00.000Z",
      conversationContext: "Caller requested a birthday dinner reservation.",
      reservation: {
        guestName: "Taylor",
        partySize: "4",
        day: "Friday",
        time: "7 PM",
        specialNotes: "birthday; window table"
      }
    });

    await appendReservationLogEntry(entry, logPath);

    const markdown = await readFile(logPath, "utf8");
    expect(markdown).toContain("## Reservation call_123");
    expect(markdown).toContain("- Guest name: Taylor");
    expect(markdown).toContain("reservation-log-entry");

    const latest = await findLatestReservationForCaller("+1 (555) 123-4567", logPath);
    expect(latest).toMatchObject({
      id: "call_123",
      reservation: {
        guestName: "Taylor",
        partySize: "4",
        day: "Friday",
        time: "7 PM",
        specialNotes: "birthday; window table"
      }
    });
  });

  it("records text follow-ups against the latest reservation and includes them in context", async () => {
    const logPath = await tempLogPath();
    await appendReservationLogEntry(
      createReservationLogEntry({
        callId: "call_older",
        caller: "+15551234567",
        createdAt: "2026-05-17T19:00:00.000Z",
        reservation: { partySize: "2", day: "Thursday", time: "6 PM" }
      }),
      logPath
    );
    await appendReservationLogEntry(
      createReservationLogEntry({
        callId: "call_latest",
        caller: "+15551234567",
        createdAt: "2026-05-17T20:00:00.000Z",
        reservation: { partySize: "4", day: "Friday", time: "7 PM" }
      }),
      logPath
    );

    const followUp = await recordReservationTextFollowUp({
      caller: "+15551234567",
      transcript: "Actually can we make it 7:30 and add a high chair?",
      createdAt: "2026-05-17T20:05:00.000Z",
      logPath
    });

    expect(followUp).toMatchObject({
      reservationId: "call_latest",
      transcript: "Actually can we make it 7:30 and add a high chair?"
    });
    expect(await loadReservationLogRecords(logPath)).toHaveLength(3);
    await expect(formatReservationLogContextForCaller("+15551234567", logPath)).resolves.toContain(
      "Actually can we make it 7:30 and add a high chair?"
    );
  });
});
