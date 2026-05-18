import { config } from "../src/config.js";
import {
  blockTable,
  createReservation,
  formatReservationDayLog,
  openReservationDatabase,
  seedDiningTables
} from "../src/reservation-store.js";

type SeedReservation = {
  id: string;
  guestName: string;
  phone: string;
  partySize: number;
  startsAt: string;
  notes?: string;
  status?: "booked" | "seated" | "completed" | "cancelled" | "no_show";
  depositStatus?: "pending" | "paid" | "waived";
};

const dateRange = [
  "2026-05-17",
  "2026-05-18",
  "2026-05-19",
  "2026-05-20",
  "2026-05-21",
  "2026-05-22",
  "2026-05-23",
  "2026-05-24",
  "2026-05-25",
  "2026-05-26",
  "2026-05-27",
  "2026-05-28",
  "2026-05-29",
  "2026-05-30"
];

const names = [
  "Avery Chen",
  "Maya Patel",
  "Jordan Lee",
  "Sofia Martinez",
  "Elliot Brooks",
  "Priya Shah",
  "Noah Kim",
  "Grace Nguyen",
  "Lucas Rivera",
  "Amelia Stone",
  "Sam Wilson",
  "Nina Roberts",
  "Theo Garcia",
  "Harper Brown",
  "Mina Okafor",
  "Daniel Cohen",
  "Iris Walker",
  "Owen Bennett",
  "Leah Singh",
  "Marcus Johnson",
  "Elena Rossi",
  "Victor Huang",
  "Camila Torres",
  "Ben Adler",
  "Zoe Morgan",
  "Isabel Flores",
  "Julian Park",
  "Renee Carter"
];

const notes = [
  "birthday; prefers a booth",
  "anniversary; window table if possible",
  "nut allergy noted",
  "patio requested",
  "high chair requested",
  "BYOW",
  "bringing a cake",
  "gluten-free guest",
  "wheelchair access requested",
  "quiet table preferred",
  "regular guest",
  undefined
];

const primeTimes = ["17:30", "18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:00"];
const shoulderTimes = ["21:15"];
const partySizes = [2, 2, 2, 3, 4, 4, 4, 5, 6, 6, 8, 10, 12, 14];
const dailyCapacityHoldStart = "17:45";
const dailyCapacityHoldEnd = "19:15";

function startsAt(date: string, time: string): string {
  return `${date}T${time}:00-07:00`;
}

function phoneFor(index: number): string {
  return `+155501${String(index).padStart(4, "0")}`;
}

function buildSeedReservations(): SeedReservation[] {
  let index = 0;
  const reservations: SeedReservation[] = [];

  for (const [dayIndex, date] of dateRange.entries()) {
    const isWeekend = dayIndex === 0 || dayIndex === 6 || dayIndex === 7 || dayIndex === 13;
    const isFriday = dayIndex === 5 || dayIndex === 12;
    const targetCount = isWeekend ? 12 : isFriday ? 11 : 8;
    const times = [...primeTimes, ...(isWeekend || isFriday ? shoulderTimes : [])];

    for (const time of times.slice(0, targetCount)) {
      const partySize = partySizes[(index + dayIndex) % partySizes.length];
      reservations.push({
        id: `seed_${date}_${time.replace(":", "")}_${index}`,
        guestName: names[index % names.length],
        phone: phoneFor(index),
        partySize,
        startsAt: startsAt(date, time),
        notes: notes[(index + dayIndex) % notes.length],
        status: dayIndex === 0 && time < "19:00" ? "completed" : "booked",
        depositStatus: (index + dayIndex) % 9 === 0 ? "waived" : (index + dayIndex) % 3 === 0 ? "paid" : "pending"
      });
      index += 1;
    }
  }

  return reservations;
}

const db = openReservationDatabase(config.RESERVATION_DB_PATH);

db.transaction(() => {
  db.prepare("DELETE FROM reservations WHERE source_call_id = 'seed'").run();
  db.prepare("DELETE FROM table_blocks WHERE reason LIKE 'seed:%'").run();
  db.prepare("DELETE FROM service_hours").run();

  const insertHours = db.prepare(`
    INSERT INTO service_hours (day_of_week, opens_at, closes_at, is_closed)
    VALUES (?, ?, ?, ?)
  `);
  for (const day of [0, 1, 2, 3, 4, 5, 6]) {
    insertHours.run(day, day === 0 ? "17:00" : "17:30", day === 5 || day === 6 ? "23:00" : "22:00", 0);
  }
})();

seedDiningTables(db);

const privateRoomOne = db.query<{ id: number }, []>("SELECT id FROM dining_tables WHERE name = 'Private Room 1'").get();
const patioThree = db.query<{ id: number }, []>("SELECT id FROM dining_tables WHERE name = 'Patio 3'").get();

blockTable(db, {
  tableId: privateRoomOne?.id,
  startsAt: startsAt("2026-05-22", "18:00"),
  endsAt: startsAt("2026-05-22", "22:00"),
  reason: "seed: rehearsal dinner hold"
});
blockTable(db, {
  tableId: patioThree?.id,
  startsAt: startsAt("2026-05-23", "17:30"),
  endsAt: startsAt("2026-05-23", "20:30"),
  reason: "seed: weather cover hold"
});

let inserted = 0;
let skipped = 0;

for (const reservation of buildSeedReservations()) {
  try {
    createReservation(db, {
      ...reservation,
      sourceCallId: "seed",
      depositAmountCents: reservation.partySize > 10 ? 10000 : 2000,
      depositCurrency: "usd",
      depositPaymentLinkUrl: reservation.partySize > 10
        ? config.STRIPE_LARGE_PARTY_RESERVATION_PAYMENT_LINK_URL ?? config.STRIPE_RESERVATION_PAYMENT_LINK_URL
        : config.STRIPE_STANDARD_RESERVATION_PAYMENT_LINK_URL ?? config.STRIPE_RESERVATION_PAYMENT_LINK_URL,
      createdAt: "2026-05-17T16:00:00-07:00"
    });
    inserted += 1;
  } catch (error) {
    skipped += 1;
    const message = error instanceof Error ? error.message : "unknown error";
    console.warn(`Skipped ${reservation.id}: ${message}`);
  }
}

for (const date of dateRange) {
  blockTable(db, {
    startsAt: startsAt(date, dailyCapacityHoldStart),
    endsAt: startsAt(date, dailyCapacityHoldEnd),
    reason: "seed: daily manager capacity hold for availability testing"
  });
}

console.log(`Seeded ${inserted} realistic reservations into ${config.RESERVATION_DB_PATH}.`);
if (skipped > 0) console.log(`Skipped ${skipped} reservations that could not fit the book.`);
console.log(`Added daily capacity holds from ${dailyCapacityHoldStart} to ${dailyCapacityHoldEnd}.`);
console.log(formatReservationDayLog(db, "2026-05-21"));

db.close();
