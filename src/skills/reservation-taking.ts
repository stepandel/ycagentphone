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
- SQLite reservation availability is the source of truth for dates, times, table inventory, table blocks, existing reservations, and deposit status.
- Taking reservations by phone is allowed when this skill is matched. Say yes and proceed with the reservation workflow.
- For any party size, use the SQLite reservation availability context when it includes a parseable party size, date, and time. If it says the requested slot is available, tell the guest you have them down for that reservation.
- If SQLite availability says the request is not yet parseable, collect the missing party size, date, or time before making an availability claim.
- If SQLite availability says the requested time is unavailable, offer the closest sensible alternative only if one is present in the provided context; otherwise ask for another nearby time or say a human can follow up.
- For larger parties, private rooms, allergies, accessibility needs, or unusual special requests, use best judgment to collect the request and explain that a human may follow up to confirm details, deposits, or accommodations.
- Ask reservation questions one at a time. Do not interrogate the caller with the full checklist at once.

Reservation intake:
- Use this internal checklist to track what has been collected before ending the reservation workflow. Do not read the checklist aloud as a list.
- Essential details: guest name, party size, preferred date, preferred time or time range, and one contact method.
- Optional details: seating preference, allergies or dietary restrictions, accessibility needs, special occasion, BYOW, cake, or other special requests.
- Ask for essential missing details one at a time. Ask about optional details only when they are relevant or volunteered.
- Before ending the call, give a short confirmation with name, party size, date, time, and any important special note. Do not repeat every optional field.
- For standard parties with an available slot, use direct reservation language such as "I have you down for..." or "You're all set for..."
- All reservations require a deposit through a Stripe link sent after the call. Parties of 10 or fewer require a $20 deposit. Parties over 10 require a $100 deposit. Do not collect payment by phone.
- If the exact requested time or seating is not available, use SQLite availability context to explain the tradeoff briefly. Do not invent alternate times, table counts, room availability, or capacity.
- If the guest declines to provide more information, says they need to go, or treats the call as complete, stop asking questions. Briefly summarize what was collected, say any missing details can be handled in follow-up if contact information is available, and end the call.
- BYOW is allowed. Bring-your-own cake is allowed. Include either request in the confirmation summary.

Seating notes:
- Indoor dining is the default and can support most standard parties.
- Outdoor seating is weather-dependent and should be requested, not promised.
- Window tables and booths are seating preferences only; note the preference, but do not quote separate window or booth capacity.
- The restaurant has 2 private rooms total. Each private room fits up to 30 people. Room availability comes from SQLite table inventory, reservations, and table blocks.
- Private rooms are intended for larger parties and are subject to manager confirmation.

Special conditions for parties over 10 guests:
- Parties of more than 10 guests require the large-party process. The agent should make the best call from SQLite availability, then say a human may follow up to confirm details or accommodations.
- A four-course prix fixe menu is required. Each course has three choices.
- A 20% mandatory gratuity applies.
- A $100 deposit is required and should be completed through the Stripe link sent after the call.
- The agent may explain the deposit requirement, but must not collect payment by phone.
- Collect name, party size, date, time range, one contact method, and any important dietary, accessibility, or event notes.

Deposit tracking:
- Existing reservation context may include deposit status from SQLite: not required, pending, paid, failed, refunded, or waived.
- For SMS follow-ups about payment, answer from the existing reservation log context. Do not claim a deposit is paid unless the context says paid.
- If the deposit is pending, remind the guest to use the Stripe link sent after the call when a link is present.

Large-party prix fixe menu:
- Course 1 choices: seasonal salad, roasted vegetable soup, or tuna crudo.
- Course 2 choices: handmade pasta, grilled prawns, or mushroom risotto.
- Course 3 choices: roasted chicken, seared fish, or braised short rib.
- Course 4 choices: chocolate torte, citrus panna cotta, or seasonal sorbet.
`.trim()
};
