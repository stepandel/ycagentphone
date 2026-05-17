import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "bun:test";
import { appendReservationNote, formatReservationNote } from "../src/reservation-notes.js";

describe("reservation notes", () => {
  it("formats reservation turns as markdown", () => {
    const note = formatReservationNote({
      callId: "call_123",
      caller: "+15551234567",
      transcript: "Can I book a birthday dinner for 6 tomorrow?",
      answer: "My pleasure, I can help with that.",
      now: new Date("2026-05-17T12:00:00.000Z")
    });

    expect(note).toContain("## Reservation note - 2026-05-17T12:00:00.000Z");
    expect(note).toContain("- Call ID: call_123");
    expect(note).toContain("Can I book a birthday dinner for 6 tomorrow?");
    expect(note).toContain("My pleasure, I can help with that.");
  });

  it("appends reservation-like turns to the configured markdown file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ycagentphone-notes-"));
    const notesPath = join(dir, "reservations.md");

    const wrote = await appendReservationNote({
      notesPath,
      callId: "call_456",
      caller: "+15557654321",
      transcript: "I need a table for 4 on the patio.",
      answer: "Happy to help.",
      isCallStart: false,
      now: new Date("2026-05-17T12:01:00.000Z")
    });

    expect(wrote).toBe(true);
    const contents = await readFile(notesPath, "utf8");
    expect(contents).toContain("call_456");
    expect(contents).toContain("I need a table for 4 on the patio.");
  });

  it("skips non-reservation turns", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ycagentphone-notes-"));
    const notesPath = join(dir, "reservations.md");

    const wrote = await appendReservationNote({
      notesPath,
      transcript: "What soups do you have?",
      answer: "Let me check.",
      isCallStart: false
    });

    expect(wrote).toBe(false);
  });
});
