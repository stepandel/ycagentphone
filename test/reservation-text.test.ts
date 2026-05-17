import { describe, expect, it } from "bun:test";
import { extractReservationUpdatesFromText } from "../src/reservation-text.js";

describe("reservation text updates", () => {
  it("extracts common SMS reservation change requests", () => {
    expect(extractReservationUpdatesFromText("Can we move the reservation to 7:30?")).toMatchObject({
      time: "7:30"
    });
    expect(extractReservationUpdatesFromText("Please change the reservation to Saturday at 8pm for a party of six.")).toMatchObject({
      day: "Saturday",
      time: "8pm",
      partySize: "6"
    });
  });

  it("captures special notes without inventing reservation fields", () => {
    expect(extractReservationUpdatesFromText("Also can we add a high chair?")).toMatchObject({
      specialNotes: "Also can we add a high chair?"
    });
    expect(extractReservationUpdatesFromText("What is the address?")).toBeUndefined();
  });
});
