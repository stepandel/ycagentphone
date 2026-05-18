import { describe, expect, it } from "bun:test";
import {
  createPostCallService,
  formatReservationConfirmationMessage,
  paymentLinkWithReservationReference,
  reservationDepositForPartySize
} from "../src/post-call.js";
import type { ReservationLogEntry } from "../src/post-call.js";

describe("formatReservationConfirmationMessage", () => {
  it("formats brief reservation details for the caller", () => {
    expect(
      formatReservationConfirmationMessage({
        shouldSend: true,
        conversationContext: "Caller requested a birthday dinner reservation.",
        reservation: {
          partySize: "4",
          day: "Friday, May 22",
          time: "7:00 PM",
          specialNotes: "birthday; window table"
        }
      })
    ).toContain("Party size: 4; Day/time: Friday, May 22 at 7:00 PM; Special notes: birthday; window table");
  });

  it("includes the Stripe payment link when configured", () => {
    expect(
      formatReservationConfirmationMessage(
        {
          shouldSend: true,
          conversationContext: "Caller requested a large-party reservation.",
          reservation: {
            partySize: "12",
            day: "Saturday",
            time: "8 PM",
            specialNotes: "large party deposit required"
          }
        },
        { amountLabel: "$100", paymentLinkUrl: "https://buy.stripe.com/test_123" }
      )
    ).toContain("please use this $100 Stripe link: https://buy.stripe.com/test_123.");
  });

  it("uses a $20 deposit for standard reservations", () => {
    expect(
      formatReservationConfirmationMessage(
        {
          shouldSend: true,
          conversationContext: "Caller requested a standard reservation.",
          reservation: {
            partySize: "4",
            day: "Friday",
            time: "7 PM"
          }
        },
        { amountLabel: "$20", paymentLinkUrl: "https://buy.stripe.com/standard" }
      )
    ).toContain("please use this $20 Stripe link: https://buy.stripe.com/standard.");
  });

  it("keeps payment-link language out of special notes", () => {
    const message = formatReservationConfirmationMessage(
      {
        shouldSend: true,
        conversationContext: "Caller requested a standard reservation.",
        reservation: {
          partySize: "8",
          day: "Thursday, May 21st",
          time: "6:00",
          specialNotes: "Party of 8; $20 deposit link to be sent."
        }
      },
      { amountLabel: "$20", paymentLinkUrl: "https://buy.stripe.com/standard" }
    );

    expect(message).toContain("Special notes: Party of 8.");
    expect(message).toContain("please use this $20 Stripe link: https://buy.stripe.com/standard.");
    expect(message).not.toContain("link to be sent");
    expect(message).not.toContain("..");
  });

  it("chooses deposit amount from party size", () => {
    expect(reservationDepositForPartySize("10 guests").amountLabel).toBe("$20");
    expect(reservationDepositForPartySize("11 guests").amountLabel).toBe("$100");
  });

  it("adds the reservation reference to Stripe Payment Links", () => {
    expect(paymentLinkWithReservationReference("https://buy.stripe.com/test_123", "call_123")).toBe(
      "https://buy.stripe.com/test_123?client_reference_id=call_123"
    );
    expect(paymentLinkWithReservationReference("https://buy.stripe.com/test_123?prefilled_email=a%40b.com", "call:123")).toBe(
      "https://buy.stripe.com/test_123?prefilled_email=a%40b.com&client_reference_id=call_123"
    );
  });
});

describe("createPostCallService", () => {
  it("extracts reservation details and sends a post-call message", async () => {
    const sent: unknown[] = [];
    const logged: ReservationLogEntry[] = [];
    const service = createPostCallService(
      async () => ({
        shouldSend: true,
        conversationContext: "Caller requested a reservation.",
        reservation: {
          partySize: "6",
          day: "Saturday",
          time: "8 PM",
          specialNotes: "nut allergy"
        }
      }),
      async (message) => {
        sent.push(message);
        return {};
      },
      async (entry) => {
        logged.push(entry);
      }
    );

    const result = await service({
      callId: "call_123",
      caller: "+15551234567",
      numberId: "num_123",
      transcript: "caller: I need a table for six Saturday at 8 PM. One nut allergy.",
      turns: [],
      raw: {}
    });

    expect(result.sent).toBe(true);
    expect(sent).toEqual([
      {
        toNumber: "+15551234567",
        numberId: "num_123",
        body: result.message
      }
    ]);
    expect(logged).toEqual([
      expect.objectContaining({
        id: "call_123",
        callId: "call_123",
        caller: "+15551234567",
        reservation: expect.objectContaining({
          partySize: "6",
          day: "Saturday",
          time: "8 PM",
          specialNotes: "nut allergy"
        })
      })
    ]);
    if (logged[0]?.deposit?.paymentLinkUrl) {
      expect(logged[0].deposit.paymentLinkUrl).toContain("client_reference_id=call_123");
    }
  });

  it("does not send when the call was not a reservation request", async () => {
    const service = createPostCallService(
      async () => ({
        shouldSend: false,
        conversationContext: "Caller asked about hours.",
        reservation: {}
      }),
      async () => {
        throw new Error("should not send");
      },
      async () => {
        throw new Error("should not log");
      }
    );

    const result = await service({
      caller: "+15551234567",
      transcript: "caller: What time do you close?",
      turns: [],
      raw: {}
    });

    expect(result).toMatchObject({
      sent: false,
      reason: "Call did not include a reservation request."
    });
  });
});
