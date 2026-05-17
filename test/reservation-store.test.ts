import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import {
  blockTable,
  createReservation,
  findAvailableTables,
  formatAvailabilityContext,
  formatReservationDayLog,
  initializeReservationSchema,
  seedDiningTables
} from "../src/reservation-store.js";

function testDatabase(): Database {
  const db = new Database(":memory:");
  initializeReservationSchema(db);
  seedDiningTables(db, [
    { name: "Two Top", capacity: 2, area: "dining room" },
    { name: "Four Top", capacity: 4, area: "dining room" },
    { name: "Six Top", capacity: 6, area: "dining room" }
  ]);
  return db;
}

describe("reservation store", () => {
  it("blocks overlapping reservations for the default 75 minute table turn", () => {
    const db = testDatabase();

    const reservation = createReservation(db, {
      id: "res_taylor",
      guestName: "Taylor",
      phone: "+15551234567",
      partySize: 4,
      startsAt: "2026-05-22T19:00:00-07:00",
      notes: "birthday"
    });

    expect(reservation.durationMinutes).toBe(75);

    const overlapping = findAvailableTables(db, {
      partySize: 4,
      startsAt: "2026-05-22T19:30:00-07:00"
    });
    expect(overlapping.availableTables.map((table) => table.name)).not.toContain("Four Top");

    const adjacent = findAvailableTables(db, {
      partySize: 4,
      startsAt: "2026-05-22T20:15:00-07:00"
    });
    expect(adjacent.availableTables.map((table) => table.name)).toContain("Four Top");
  });

  it("suggests a combined table assignment when one table is not large enough", () => {
    const db = testDatabase();

    const availability = findAvailableTables(db, {
      partySize: 10,
      startsAt: "2026-05-22T18:00:00-07:00"
    });

    expect(availability.isAvailable).toBe(true);
    expect(availability.suggestedCapacity).toBeGreaterThanOrEqual(10);
    expect(availability.suggestedTableIds).toHaveLength(2);
  });

  it("honors whole-restaurant and table-specific blocks", () => {
    const db = testDatabase();
    blockTable(db, {
      startsAt: "2026-05-22T18:00:00-07:00",
      endsAt: "2026-05-22T21:00:00-07:00",
      reason: "private event"
    });

    const availability = findAvailableTables(db, {
      partySize: 2,
      startsAt: "2026-05-22T19:00:00-07:00"
    });

    expect(availability.isAvailable).toBe(false);
    expect(availability.availableTables).toHaveLength(0);
  });

  it("formats an agent-readable reservation log and availability context", () => {
    const db = testDatabase();
    createReservation(db, {
      id: "res_taylor",
      guestName: "Taylor",
      phone: "+15551234567",
      partySize: 4,
      startsAt: "2026-05-22T19:00:00-07:00",
      notes: "birthday"
    });

    expect(formatReservationDayLog(db, "2026-05-23")).toBe("Reservation log for 2026-05-23: no reservations.");

    const context = formatAvailabilityContext(db, {
      partySize: 4,
      startsAt: "2026-05-22T20:15:00-07:00"
    });
    expect(context).toContain("Default dining time: 75 minutes");
    expect(context).toContain("Available: yes");
    expect(context).toContain("Taylor; party of 4");
  });
});
