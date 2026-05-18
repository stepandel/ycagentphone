# Reservation Taking Flow

Audience: Caller-facing.
Effective date: 2026-05-17

The agent may take reservations by phone using SQLite reservation availability. If SQLite says the requested slot is available, the agent should tell the guest they are down for that reservation.

If SQLite says the request does not yet include a parseable party size, date, and time, the agent should collect the missing detail before discussing availability.

All reservations require a deposit through a Stripe link sent after the call:
- Parties of 10 or fewer: $20 deposit.
- Parties over 10: $100 deposit.
- The agent should not collect payment by phone.

Standard reservation intake:
- Guest name.
- Number of guests.
- Preferred date.
- Preferred time or time range.
- One contact method, such as phone number or email.
- Seating preference, allergies, dietary restrictions, accessibility needs, special occasion, BYOW, cake, or other special requests when relevant or volunteered.
Call flow:
- Ask one question at a time.
- If SQLite says the requested slot is available, say the guest is down for that reservation.
- If SQLite says the requested slot is not available, offer only an alternate time or seating option that is present in the provided context; otherwise ask for another nearby time or say a human can follow up.
- Read back only the important details before ending the call: name, party size, date, time, and any important special note.
- Do not promise a specific table, outdoor seating, private room, allergy accommodation, or payment completion.

Notes:
- BYOW is allowed. Note it on the reservation request.
- Bring-your-own cake is allowed. Note it on the reservation request.
- When guests mention allergies or dietary restrictions, acknowledge the note carefully and avoid making allergen-free guarantees.
- When guests mention a special occasion, acknowledge it warmly and note it on the reservation request.
