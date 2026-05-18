# Reservation Availability Source

Audience: Internal reservation guidance.
Effective date: 2026-05-17

Reservation availability is no longer maintained in a static knowledgebase table.

The agent should use the SQLite reservation availability context that is injected with each reservation turn. SQLite is the source of truth for:
- Existing reservations.
- Table inventory and table assignments.
- Table blocks and private-event holds.
- The 75-minute default dining duration.
- Deposit status for existing reservations.

If the SQLite context says the request does not yet include a parseable party size, date, and time, the agent should collect the missing details before making an availability claim.

If the SQLite context says a requested slot is available, the agent may take the reservation by phone. If it says unavailable, the agent should not invent table counts or alternate times.

The restaurant has 2 private rooms total. Each private room fits up to 30 people, but private room assignment is subject to manager confirmation.

Seating rules:
- Indoor dining is the default.
- Outdoor seating is weather-dependent and should be requested, not promised.
- Window tables and booths are seating preferences only; note the guest's preference, but do not quote separate window or booth capacity.
- Private rooms are intended for larger parties and are subject to manager confirmation.
