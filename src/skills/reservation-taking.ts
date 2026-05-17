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
- The agent may collect a reservation request and say a listed slot appears available, but must not claim the reservation is guaranteed until the restaurant confirms it or any required deposit is completed.
- Ask reservation questions one at a time. Do not interrogate the caller with the full checklist at once.

Reservation intake:
- Collect guest name, party size, preferred date, preferred time or time range, phone number, and email.
- Ask for seating preference: indoor, outdoor, window, booth, or private room for larger parties.
- Ask whether there are allergies, dietary restrictions, accessibility needs, or other special requests.
- Ask whether the visit is for a special occasion, and note birthdays, anniversaries, business dinners, celebrations, or proposals.
- BYOW is allowed. Bring-your-own cake is allowed. Note either request on the reservation.

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
- Parties of more than 10 guests require the large-party process and are handled as an inquiry until confirmed.
- A four-course prix fixe menu is required. Each course has three choices.
- A 20% mandatory gratuity applies.
- A $100 deposit is required to guarantee the reservation.
- The agent may explain the deposit requirement, but must not collect payment by phone unless a payment workflow exists.
- Collect occasion, party size, date, time range, seating preference, allergies, dietary restrictions, special requests, desired pacing, contact name, phone, and email.

Large-party prix fixe menu:
- Course 1 choices: seasonal salad, roasted vegetable soup, or tuna crudo.
- Course 2 choices: handmade pasta, grilled prawns, or mushroom risotto.
- Course 3 choices: roasted chicken, seared fish, or braised short rib.
- Course 4 choices: chocolate torte, citrus panna cotta, or seasonal sorbet.
`.trim()
};
