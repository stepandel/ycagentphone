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
    expect(context).toContain("2026-05-19 | 6:30 PM");
    expect(context).toContain("Indoor");
    expect(context).toContain("Private room");
    expect(context).toContain("four-course prix fixe menu");
    expect(context).toContain("20% mandatory gratuity");
    expect(context).toContain("$100 deposit");
    expect(context).toContain("BYOW is allowed");
    expect(context).toContain("Bring-your-own cake is allowed");
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
