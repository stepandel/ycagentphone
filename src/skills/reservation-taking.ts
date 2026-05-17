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

Mock availability table:
| Date | Time | Indoor | Outdoor | Window | Booth | Private room | Notes |
| 2026-05-17 | 5:30 PM | 6 guests | 4 guests | 2 guests | 4 guests | unavailable | Early dinner availability only |
| 2026-05-17 | 7:00 PM | 2 guests | unavailable | unavailable | 2 guests | unavailable | Peak period, limited space |
| 2026-05-17 | 8:30 PM | 8 guests | 6 guests | 4 guests | 4 guests | 12 guests | Best same-day option for groups |
| 2026-05-18 | 6:00 PM | 10 guests | 8 guests | 4 guests | 6 guests | 14 guests | Strong availability |
| 2026-05-18 | 7:30 PM | 6 guests | 4 guests | 2 guests | unavailable | 12 guests | Private room has one opening |
| 2026-05-19 | 6:30 PM | 12 guests | 10 guests | 4 guests | 6 guests | 18 guests | Best option for large parties |
| 2026-05-19 | 8:00 PM | 8 guests | 6 guests | unavailable | 4 guests | unavailable | Standard dining room only |
| 2026-05-20 | 5:45 PM | 14 guests | 8 guests | 4 guests | 6 guests | 20 guests | Large-party friendly |
| 2026-05-20 | 7:15 PM | 4 guests | 4 guests | 2 guests | unavailable | 16 guests | Private room only for larger groups |

Seating notes:
- Indoor dining is the default and can support most standard parties.
- Outdoor seating is weather-dependent and should be requested, not promised.
- Window tables and booths are limited; note the preference and offer the closest available option.
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
