import { describe, expect, it } from "bun:test";
import { buildSkillContext } from "../src/skills/index.js";
import { isReservationQuery, reservationTakingSkill } from "../src/skills/reservation-taking.js";

describe("reservation-taking skill", () => {
  it("detects reservation-like caller turns", () => {
    expect(isReservationQuery("Can I book a booth for six tomorrow?")).toBe(true);
    expect(isReservationQuery("Do you allow BYOW for an anniversary dinner?")).toBe(true);
    expect(isReservationQuery("Who is the chef?")).toBe(false);
  });

  it("injects availability, seating, and large-party conditions", () => {
    const context = buildSkillContext("I need a private room for 12 people");

    expect(context).toContain("Skill: reservation-taking");
    expect(context).toContain("Mock availability table for the next 14 days");
    expect(context).toContain("2026-05-30 | 8 | 4 | 0");
    expect(context).toContain("Indoor seats available");
    expect(context).toContain("Outdoor seats available");
    expect(context).toContain("Private rooms available");
    expect(context).toContain("The restaurant has 2 private rooms total");
    expect(context).toContain("Each private room fits up to 30 people");
    expect(context).toContain("four-course prix fixe menu");
    expect(context).toContain("20% mandatory gratuity");
    expect(context).toContain("$100 deposit");
    expect(context).toContain("BYOW is allowed");
    expect(context).toContain("Bring-your-own cake is allowed");
    expect(context).toContain("use the availability table and caller preferences to make the best reservation decision");
    expect(context).toContain("Taking reservations by phone is allowed");
    expect(context).toContain("Say yes and proceed with the reservation workflow");
    expect(context).toContain("Essential details: guest name, party size, preferred date");
    expect(context).toContain("I have you down for");
    expect(context).toContain("give a short confirmation with name, party size, date, time");
    expect(context).toContain("choose the closest sensible alternative");
  });

  it("keeps non-reservation turns concise", () => {
    expect(buildSkillContext("What desserts do you have?")).toBe("No call skills matched this caller turn.");
  });

  it("exposes reservation taking as an explicit skill", () => {
    expect(reservationTakingSkill).toMatchObject({
      name: "reservation-taking",
      description: expect.stringContaining("reservation requests")
    });
  });
});
