import type { AgentSkill } from "./types.js";

export const RESERVATION_QUERY_PATTERN =
  /\b(reservation|reserve|book|booking|table|seating|seat|availability|available|party|guests?|people|indoor|outdoor|patio|window|booth|private|room|allerg(?:y|ies|ic)|occasion|birthday|anniversary|cake|byow|wine)\b/i;

export function isReservationQuery(transcript: string | undefined): boolean {
  return RESERVATION_QUERY_PATTERN.test(transcript ?? "");
}

export const reservationTakingSkill: AgentSkill = {
  name: "reservation-taking",
  description: "Collects reservation requests, seating preferences, notes, and large-party requirements.",
  matches: isReservationQuery,
  buildContext: () =>
    `
Skill: reservation-taking

Authority:
- This is prototype availability for the restaurant. Use it to discuss availability, seating options, policies, and notes.
- For parties of 10 or fewer, use the availability table and caller preferences to make the best reservation decision. If the requested slot appears available, tell the guest you have them down for that reservation.
- For larger parties, private rooms, allergies, accessibility needs, or unusual special requests, use best judgment to collect the request and explain that a human may follow up to confirm details, deposits, or accommodations.
- Ask reservation questions one at a time. Do not interrogate the caller with the full checklist at once.

Reservation intake:
- Use this internal checklist to track what has been collected before ending the reservation workflow. Do not read the checklist aloud as a list.
- Essential details: guest name, party size, preferred date, preferred time or time range, and one contact method.
- Optional details: seating preference, allergies or dietary restrictions, accessibility needs, special occasion, BYOW, cake, or other special requests.
- Ask for essential missing details one at a time. Ask about optional details only when they are relevant or volunteered.
- Before ending the call, give a short confirmation with name, party size, date, time, and any important special note. Do not repeat every optional field.
- If the exact requested time or seating is not available, choose the closest sensible alternative from the availability table and explain the tradeoff briefly.
- If the guest declines to provide more information, says they need to go, or treats the call as complete, stop asking questions. Briefly summarize what was collected, say any missing details can be handled in follow-up if contact information is available, and end the call.
- BYOW is allowed. Bring-your-own cake is allowed. Include either request in the confirmation summary.

Mock availability table for the next 14 days:
| Date | Indoor seats available | Outdoor seats available | Private rooms available |
| 2026-05-17 | 16 | 10 | 0 |
| 2026-05-18 | 24 | 12 | 1 |
| 2026-05-19 | 30 | 16 | 2 |
| 2026-05-20 | 28 | 14 | 2 |
| 2026-05-21 | 18 | 8 | 1 |
| 2026-05-22 | 12 | 6 | 0 |
| 2026-05-23 | 10 | 4 | 0 |
| 2026-05-24 | 22 | 12 | 1 |
| 2026-05-25 | 26 | 14 | 2 |
| 2026-05-26 | 32 | 18 | 2 |
| 2026-05-27 | 20 | 10 | 1 |
| 2026-05-28 | 18 | 8 | 1 |
| 2026-05-29 | 14 | 6 | 0 |
| 2026-05-30 | 8 | 4 | 0 |

Seating notes:
- Indoor dining is the default and can support most standard parties.
- Outdoor seating is weather-dependent and should be requested, not promised.
- Window tables and booths are seating preferences only; note the preference, but do not quote separate window or booth capacity.
- The restaurant has 2 private rooms total. Each private room fits up to 30 people. The table lists how many rooms are available by date.
- Private rooms are intended for larger parties and are subject to manager confirmation.

Special conditions for parties over 10 guests:
- Parties of more than 10 guests require the large-party process. The agent should make the best call from the availability table, then say a human may follow up to confirm details and deposit.
- A four-course prix fixe menu is required. Each course has three choices.
- A 20% mandatory gratuity applies.
- A $100 deposit is required to guarantee the reservation.
- The agent may explain the deposit requirement, but must not collect payment by phone unless a payment workflow exists.
- Collect name, party size, date, time range, one contact method, and any important dietary, accessibility, or event notes.

Large-party prix fixe menu:
- Course 1 choices: seasonal salad, roasted vegetable soup, or tuna crudo.
- Course 2 choices: handmade pasta, grilled prawns, or mushroom risotto.
- Course 3 choices: roasted chicken, seared fish, or braised short rib.
- Course 4 choices: chocolate torte, citrus panna cotta, or seasonal sorbet.
`.trim()
};
