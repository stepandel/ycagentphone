import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import {
  blockTable,
  createReservation,
  findAvailableTables,
  formatAvailabilityContext,
  formatReservationDayLog,
  initializeReservationSchema,
  parseReservationDateTime,
  parseReservationRequestText,
  seedDiningTables,
  updateReservationDepositStatus,
  updateReservationDepositStatusForStripeReference
} from "../src/reservation-store.js";

function testDatabase(): Database {
  const db = new Database(":memory:");
  initializeReservationSchema(db);
  db.prepare("INSERT INTO service_hours (day_of_week, opens_at, closes_at, is_closed) VALUES (?, ?, ?, ?)").run(5, "17:00", "22:00", 0);
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
      depositAmountCents: 2000,
      depositCurrency: "usd",
      depositPaymentLinkUrl: "https://buy.stripe.com/test_standard",
      notes: "birthday"
    });

    expect(reservation.durationMinutes).toBe(75);
    expect(reservation.depositStatus).toBe("pending");
    expect(reservation.depositAmountCents).toBe(2000);

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
    expect(context).toContain("Nearby available times: none found within 2 hours");
    expect(context).toContain("Taylor; party of 4");
    expect(context).toContain("deposit: not required");
  });

  it("shows nearby alternatives when a requested slot is capacity blocked", () => {
    const db = testDatabase();
    db.prepare("INSERT INTO service_hours (day_of_week, opens_at, closes_at, is_closed) VALUES (?, ?, ?, ?)").run(4, "17:30", "22:00", 0);
    blockTable(db, {
      startsAt: "2026-05-21T17:45:00-07:00",
      endsAt: "2026-05-21T19:15:00-07:00",
      reason: "manager capacity hold"
    });

    const context = formatAvailabilityContext(db, {
      partySize: 8,
      startsAt: "2026-05-21T18:00:00-07:00"
    });

    expect(context).toContain("SQLite reservation availability for 2026-05-21 18:00-19:15");
    expect(context).toContain("Available: no");
    expect(context).toContain("Suggested table assignment: none");
    expect(context).toContain("Nearby available times:");
    expect(context).toContain("19:15-20:30");
    expect(context).not.toContain("16:15-17:30");
  });

  it("does not show slots outside service hours as available", () => {
    const db = testDatabase();
    db.prepare("INSERT INTO service_hours (day_of_week, opens_at, closes_at, is_closed) VALUES (?, ?, ?, ?)").run(4, "17:30", "22:00", 0);

    const availability = findAvailableTables(db, {
      partySize: 2,
      startsAt: "2026-05-21T16:15:00-07:00"
    });

    expect(availability.isAvailable).toBe(false);
    expect(availability.availableTables).toHaveLength(0);
  });

  it("tracks Stripe deposit status and references", () => {
    const db = testDatabase();
    createReservation(db, {
      id: "res_paid",
      guestName: "Morgan",
      phone: "+15551230000",
      partySize: 6,
      startsAt: "2026-05-22T17:00:00-07:00",
      depositAmountCents: 2000,
      depositCurrency: "usd",
      depositPaymentLinkUrl: "https://buy.stripe.com/test_standard",
      stripeCheckoutSessionId: "cs_test_123"
    });

    const paid = updateReservationDepositStatus(db, {
      reservationId: "res_paid",
      depositStatus: "paid",
      paidAt: "2026-05-17T20:00:00-07:00",
      stripePaymentIntentId: "pi_test_123"
    });

    expect(paid.depositStatus).toBe("paid");
    expect(paid.depositPaidAt).toBe("2026-05-18T03:00:00.000Z");
    expect(paid.stripeCheckoutSessionId).toBe("cs_test_123");
    expect(paid.stripePaymentIntentId).toBe("pi_test_123");

    const refunded = updateReservationDepositStatusForStripeReference(db, {
      stripePaymentIntentId: "pi_test_123",
      depositStatus: "refunded"
    });
    expect(refunded?.depositStatus).toBe("refunded");
  });

  it("parses common caller reservation language into restaurant-local datetimes", () => {
    const now = new Date("2026-05-17T19:00:00-07:00");

    const request = parseReservationRequestText("Can I book a table for four Friday at 7?", now);
    expect(request.partySize).toBe(4);
    expect(request.startsAt?.toISOString()).toBe("2026-05-23T02:00:00.000Z");

    const partySizeBeforeTime = parseReservationRequestText("Can I make a reservation for 8 this Thursday at 6 PM?", now);
    expect(partySizeBeforeTime.partySize).toBe(8);
    expect(partySizeBeforeTime.startsAt?.toISOString()).toBe("2026-05-22T01:00:00.000Z");

    const spokenTurnTranscript = parseReservationRequestText(
      [
        "caller: Can I make a reservation, please?",
        "agent: What date would you like to come in?",
        "caller: Thursday.",
        "agent: How many guests will be joining you?",
        "caller: There'll be eight people.",
        "agent: What time would you prefer for the eight of you this Thursday?",
        "caller: Six o'clock."
      ].join("\n"),
      now
    );
    expect(spokenTurnTranscript.partySize).toBe(8);
    expect(spokenTurnTranscript.startsAt?.toISOString()).toBe("2026-05-22T01:00:00.000Z");

    expect(parseReservationDateTime("May 22", "7:30 PM", now)?.toISOString()).toBe("2026-05-23T02:30:00.000Z");
  });
});
