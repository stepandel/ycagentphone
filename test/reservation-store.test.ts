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
    expect(context).toContain("Taylor; party of 4");
    expect(context).toContain("deposit: not required");
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

    expect(parseReservationDateTime("May 22", "7:30 PM", now)?.toISOString()).toBe("2026-05-23T02:30:00.000Z");
  });
});
