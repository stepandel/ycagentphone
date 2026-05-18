import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import { config } from "./config.js";

export const DEFAULT_RESERVATION_DURATION_MINUTES = 75;

export type ReservationStatus = "booked" | "seated" | "completed" | "cancelled" | "no_show";
export type ReservationDepositStatus = "not_required" | "pending" | "paid" | "failed" | "refunded" | "waived";

export type DiningTableInput = {
  name: string;
  capacity: number;
  area?: string;
};

export type DiningTable = DiningTableInput & {
  id: number;
  isActive: boolean;
};

export type ReservationInput = {
  id?: string;
  sourceCallId?: string;
  guestName: string;
  phone?: string;
  partySize: number;
  startsAt: string | Date;
  durationMinutes?: number;
  status?: ReservationStatus;
  notes?: string;
  depositAmountCents?: number;
  depositCurrency?: string;
  depositPaymentLinkUrl?: string;
  depositStatus?: ReservationDepositStatus;
  stripeCheckoutSessionId?: string;
  stripePaymentIntentId?: string;
  stripePaymentLinkId?: string;
  tableIds?: number[];
  createdAt?: string | Date;
};

export type Reservation = {
  id: string;
  sourceCallId?: string;
  guestName: string;
  phone?: string;
  partySize: number;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  status: ReservationStatus;
  notes?: string;
  depositAmountCents?: number;
  depositCurrency?: string;
  depositPaymentLinkUrl?: string;
  depositStatus: ReservationDepositStatus;
  depositPaidAt?: string;
  stripeCheckoutSessionId?: string;
  stripePaymentIntentId?: string;
  stripePaymentLinkId?: string;
  tableIds: number[];
  createdAt: string;
};

export type AvailabilityRequest = {
  partySize: number;
  startsAt: string | Date;
  durationMinutes?: number;
};

export type AvailabilityResult = {
  requestedStart: string;
  requestedEnd: string;
  partySize: number;
  availableTables: DiningTable[];
  suggestedTableIds: number[];
  suggestedCapacity: number;
  isAvailable: boolean;
  nearbyAvailableTimes: AvailabilityTimeSuggestion[];
};

export type AvailabilityTimeSuggestion = {
  startsAt: string;
  endsAt: string;
  suggestedTableIds: number[];
  suggestedCapacity: number;
};

type DiningTableRow = {
  id: number;
  name: string;
  capacity: number;
  area: string | null;
  is_active: number;
};

type ReservationRow = {
  id: string;
  source_call_id: string | null;
  guest_name: string;
  phone: string | null;
  party_size: number;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  status: ReservationStatus;
  notes: string | null;
  deposit_amount_cents: number | null;
  deposit_currency: string | null;
  deposit_payment_link_url: string | null;
  deposit_status: ReservationDepositStatus;
  deposit_paid_at: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_payment_link_id: string | null;
  created_at: string;
};

type ReservationLogRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  guest_name: string;
  phone: string | null;
  party_size: number;
  status: ReservationStatus;
  deposit_status: ReservationDepositStatus;
  tables: string | null;
  notes: string | null;
};

type ServiceHoursRow = {
  opens_at: string;
  closes_at: string;
  is_closed: number;
};

export type ParsedReservationRequest = {
  partySize?: number;
  startsAt?: Date;
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20
};

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
};

const MONTH_INDEX: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11
};

export const DEFAULT_DINING_TABLES: DiningTableInput[] = [
  { name: "Bar 1", capacity: 2, area: "bar" },
  { name: "Bar 2", capacity: 2, area: "bar" },
  { name: "Table 1", capacity: 2, area: "dining room" },
  { name: "Table 2", capacity: 2, area: "dining room" },
  { name: "Table 3", capacity: 4, area: "dining room" },
  { name: "Table 4", capacity: 4, area: "dining room" },
  { name: "Table 5", capacity: 6, area: "dining room" },
  { name: "Patio 1", capacity: 2, area: "patio" },
  { name: "Patio 2", capacity: 4, area: "patio" },
  { name: "Patio 3", capacity: 6, area: "patio" },
  { name: "Private Room 1", capacity: 30, area: "private room" },
  { name: "Private Room 2", capacity: 30, area: "private room" }
];

function isoDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid reservation datetime: ${String(value)}`);
  }
  return date.toISOString();
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

function localDate(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: config.RESTAURANT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .formatToParts(new Date(iso))
    .reduce<Record<string, string>>((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: config.RESTAURANT_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(iso));
}

function localDateParts(date: Date): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: config.RESTAURANT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long"
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: WEEKDAY_INDEX[parts.weekday.toLowerCase()]
  };
}

function timeZoneOffsetMinutes(date: Date): number {
  const value = new Intl.DateTimeFormat("en-US", {
    timeZone: config.RESTAURANT_TIME_ZONE,
    timeZoneName: "shortOffset"
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;
  const match = value?.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return -date.getTimezoneOffset();
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? "0"));
}

function restaurantDateTime(year: number, monthIndex: number, day: number, hour: number, minute: number): Date {
  const utcGuess = new Date(Date.UTC(year, monthIndex, day, hour, minute));
  const offset = timeZoneOffsetMinutes(utcGuess);
  return new Date(Date.UTC(year, monthIndex, day, hour, minute) - offset * 60_000);
}

function parsePartySizeText(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const normalized = text.toLowerCase();
  const match = normalized.match(
    /\b(?:party|table|reservation|booking)\s+(?:of|for)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/
  );
  if (!match) return undefined;
  return /^\d+$/.test(match[1]) ? Number(match[1]) : NUMBER_WORDS[match[1]];
}

function parseRequestedTime(text: string): { hour: number; minute: number } | undefined {
  const matches = text.matchAll(/\b(?:(at|around|for|by)\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/gi);
  for (const match of matches) {
    if (!match[1] && !match[4]) continue;
    let hour = Number(match[2]);
    const minute = Number(match[3] ?? "0");
    const meridiem = match[4]?.toLowerCase();
    if (hour > 23 || minute > 59) continue;
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    if (!meridiem && hour >= 1 && hour <= 11) hour += 12;
    return { hour, minute };
  }
  return undefined;
}

function parseRequestedDate(text: string, now: Date): { year: number; monthIndex: number; day: number } | undefined {
  const lowered = text.toLowerCase();
  const today = localDateParts(now);

  const isoMatch = lowered.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    return { year: Number(isoMatch[1]), monthIndex: Number(isoMatch[2]) - 1, day: Number(isoMatch[3]) };
  }

  const monthDayMatch = lowered.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(20\d{2}))?\b/
  );
  if (monthDayMatch) {
    const monthIndex = MONTH_INDEX[monthDayMatch[1].replace(".", "")];
    let year = monthDayMatch[3] ? Number(monthDayMatch[3]) : today.year;
    if (!monthDayMatch[3] && monthIndex < today.month - 1) year += 1;
    return { year, monthIndex, day: Number(monthDayMatch[2]) };
  }

  if (/\btomorrow\b/.test(lowered)) {
    const date = restaurantDateTime(today.year, today.month - 1, today.day + 1, 12, 0);
    const parts = localDateParts(date);
    return { year: parts.year, monthIndex: parts.month - 1, day: parts.day };
  }

  if (/\btoday\b/.test(lowered)) {
    return { year: today.year, monthIndex: today.month - 1, day: today.day };
  }

  const weekdayMatch = lowered.match(/\b(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (weekdayMatch) {
    const target = WEEKDAY_INDEX[weekdayMatch[1]];
    const explicitlyNext = weekdayMatch[0].startsWith("next ");
    let daysAhead = (target - today.weekday + 7) % 7;
    if (daysAhead === 0 || explicitlyNext) daysAhead += 7;
    const date = restaurantDateTime(today.year, today.month - 1, today.day + daysAhead, 12, 0);
    const parts = localDateParts(date);
    return { year: parts.year, monthIndex: parts.month - 1, day: parts.day };
  }

  return undefined;
}

export function parseReservationRequestText(text: string | undefined, now = new Date()): ParsedReservationRequest {
  if (!text?.trim()) return {};
  const date = parseRequestedDate(text, now);
  const time = parseRequestedTime(text);
  return {
    partySize: parsePartySizeText(text),
    startsAt: date && time ? restaurantDateTime(date.year, date.monthIndex, date.day, time.hour, time.minute) : undefined
  };
}

export function parseReservationDateTime(day: string | undefined, time: string | undefined, now = new Date()): Date | undefined {
  if (!day || !time) return undefined;
  const date = parseRequestedDate(day, now);
  const parsedTime = parseRequestedTime(time);
  return date && parsedTime ? restaurantDateTime(date.year, date.monthIndex, date.day, parsedTime.hour, parsedTime.minute) : undefined;
}

function reservationId(createdAt: string): string {
  return `reservation_${createdAt.replace(/[^0-9]/g, "")}_${Math.random().toString(36).slice(2, 8)}`;
}

function toDiningTable(row: DiningTableRow): DiningTable {
  return {
    id: row.id,
    name: row.name,
    capacity: row.capacity,
    area: row.area ?? undefined,
    isActive: row.is_active === 1
  };
}

function parsePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function timeToMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function localMinutesSinceMidnight(iso: string): number {
  return timeToMinutes(localTime(iso));
}

function isWithinServiceHours(db: Database, startsAt: string, endsAt: string): boolean {
  const parts = localDateParts(new Date(startsAt));
  const hours = db
    .query<ServiceHoursRow, [number]>("SELECT opens_at, closes_at, is_closed FROM service_hours WHERE day_of_week = ?")
    .get(parts.weekday);

  if (!hours) return true;
  if (hours.is_closed === 1) return false;
  if (localDate(startsAt) !== localDate(endsAt)) return false;

  const startMinutes = localMinutesSinceMidnight(startsAt);
  return startMinutes >= timeToMinutes(hours.opens_at) && startMinutes <= timeToMinutes(hours.closes_at);
}

function optionalPositiveInteger(value: number | undefined, label: string): number | undefined {
  return value === undefined ? undefined : parsePositiveInteger(value, label);
}

function addColumnIfMissing(db: Database, table: string, column: string, definition: string): void {
  const columns = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
  if (columns.some((item) => item.name === column)) return;
  db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function openReservationDatabase(dbPath = config.RESERVATION_DB_PATH): Database {
  if (dbPath !== ":memory:") {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  initializeReservationSchema(db);
  return db;
}

export function initializeReservationSchema(db: Database): void {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS dining_tables (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      capacity INTEGER NOT NULL CHECK (capacity > 0),
      area TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY,
      source_call_id TEXT,
      guest_name TEXT NOT NULL,
      phone TEXT,
      party_size INTEGER NOT NULL CHECK (party_size > 0),
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 75 CHECK (duration_minutes > 0),
      status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'seated', 'completed', 'cancelled', 'no_show')),
      notes TEXT,
      deposit_amount_cents INTEGER CHECK (deposit_amount_cents IS NULL OR deposit_amount_cents > 0),
      deposit_currency TEXT,
      deposit_payment_link_url TEXT,
      deposit_status TEXT NOT NULL DEFAULT 'not_required' CHECK (deposit_status IN ('not_required', 'pending', 'paid', 'failed', 'refunded', 'waived')),
      deposit_paid_at TEXT,
      stripe_checkout_session_id TEXT,
      stripe_payment_intent_id TEXT,
      stripe_payment_link_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reservation_tables (
      reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
      table_id INTEGER NOT NULL REFERENCES dining_tables(id),
      PRIMARY KEY (reservation_id, table_id)
    );

    CREATE TABLE IF NOT EXISTS service_hours (
      id INTEGER PRIMARY KEY,
      day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
      opens_at TEXT NOT NULL,
      closes_at TEXT NOT NULL,
      is_closed INTEGER NOT NULL DEFAULT 0 CHECK (is_closed IN (0, 1)),
      UNIQUE (day_of_week)
    );

    CREATE TABLE IF NOT EXISTS table_blocks (
      id INTEGER PRIMARY KEY,
      table_id INTEGER REFERENCES dining_tables(id) ON DELETE CASCADE,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      reason TEXT
    );

  `);

  addColumnIfMissing(db, "reservations", "deposit_amount_cents", "INTEGER CHECK (deposit_amount_cents IS NULL OR deposit_amount_cents > 0)");
  addColumnIfMissing(db, "reservations", "deposit_currency", "TEXT");
  addColumnIfMissing(db, "reservations", "deposit_payment_link_url", "TEXT");
  addColumnIfMissing(
    db,
    "reservations",
    "deposit_status",
    "TEXT NOT NULL DEFAULT 'not_required' CHECK (deposit_status IN ('not_required', 'pending', 'paid', 'failed', 'refunded', 'waived'))"
  );
  addColumnIfMissing(db, "reservations", "deposit_paid_at", "TEXT");
  addColumnIfMissing(db, "reservations", "stripe_checkout_session_id", "TEXT");
  addColumnIfMissing(db, "reservations", "stripe_payment_intent_id", "TEXT");
  addColumnIfMissing(db, "reservations", "stripe_payment_link_id", "TEXT");

  db.exec(`
    CREATE INDEX IF NOT EXISTS reservations_time_idx ON reservations(starts_at, ends_at, status);
    CREATE INDEX IF NOT EXISTS reservations_deposit_status_idx ON reservations(deposit_status, deposit_paid_at);
    CREATE INDEX IF NOT EXISTS reservations_stripe_checkout_session_idx ON reservations(stripe_checkout_session_id);
    CREATE INDEX IF NOT EXISTS reservations_stripe_payment_intent_idx ON reservations(stripe_payment_intent_id);
    CREATE INDEX IF NOT EXISTS reservation_tables_table_idx ON reservation_tables(table_id);
    CREATE INDEX IF NOT EXISTS table_blocks_time_idx ON table_blocks(starts_at, ends_at);

    DROP VIEW IF EXISTS reservation_log;
    CREATE VIEW reservation_log AS
      SELECT
        r.id,
        date(r.starts_at, 'localtime') AS reservation_date,
        strftime('%H:%M', r.starts_at, 'localtime') AS start_time,
        strftime('%H:%M', r.ends_at, 'localtime') AS end_time,
        r.guest_name,
        r.phone,
        r.party_size,
        r.status,
        r.deposit_status,
        group_concat(t.name, ', ') AS tables,
        r.notes
      FROM reservations r
      LEFT JOIN reservation_tables rt ON rt.reservation_id = r.id
      LEFT JOIN dining_tables t ON t.id = rt.table_id
      GROUP BY r.id;
  `);
}

export function seedDiningTables(db: Database, tables: DiningTableInput[] = DEFAULT_DINING_TABLES): DiningTable[] {
  const insert = db.prepare(`
    INSERT INTO dining_tables (name, capacity, area, is_active)
    VALUES ($name, $capacity, $area, 1)
    ON CONFLICT(name) DO UPDATE SET
      capacity = excluded.capacity,
      area = excluded.area,
      is_active = 1
  `);

  db.transaction(() => {
    for (const table of tables) {
      insert.run({
        $name: table.name,
        $capacity: parsePositiveInteger(table.capacity, "Table capacity"),
        $area: table.area ?? null
      });
    }
  })();

  return listDiningTables(db);
}

export function listDiningTables(db: Database): DiningTable[] {
  return db
    .query<DiningTableRow, []>("SELECT id, name, capacity, area, is_active FROM dining_tables WHERE is_active = 1 ORDER BY capacity, name")
    .all()
    .map(toDiningTable);
}

export function findAvailableTables(db: Database, request: AvailabilityRequest): AvailabilityResult {
  const partySize = parsePositiveInteger(request.partySize, "Party size");
  const durationMinutes = parsePositiveInteger(request.durationMinutes ?? DEFAULT_RESERVATION_DURATION_MINUTES, "Duration");
  const requestedStart = isoDateTime(request.startsAt);
  const requestedEnd = addMinutes(requestedStart, durationMinutes);
  const availability = findAvailableTablesForRange(db, partySize, requestedStart, requestedEnd);

  return {
    ...availability,
    requestedStart,
    requestedEnd,
    partySize,
    nearbyAvailableTimes: availability.isAvailable
      ? []
      : findNearbyAvailableTimes(db, {
          partySize,
          startsAt: requestedStart,
          durationMinutes
        })
  };
}

function findAvailableTablesForRange(
  db: Database,
  partySize: number,
  requestedStart: string,
  requestedEnd: string
): Pick<AvailabilityResult, "availableTables" | "suggestedTableIds" | "suggestedCapacity" | "isAvailable"> {
  if (!isWithinServiceHours(db, requestedStart, requestedEnd)) {
    return {
      availableTables: [],
      suggestedTableIds: [],
      suggestedCapacity: 0,
      isAvailable: false
    };
  }

  const availableTables = db
    .query<DiningTableRow, [string, string, string, string]>(
      `
        SELECT t.id, t.name, t.capacity, t.area, t.is_active
        FROM dining_tables t
        WHERE t.is_active = 1
          AND NOT EXISTS (
            SELECT 1
            FROM reservation_tables rt
            JOIN reservations r ON r.id = rt.reservation_id
            WHERE rt.table_id = t.id
              AND r.status IN ('booked', 'seated')
              AND r.starts_at < ?
              AND r.ends_at > ?
          )
          AND NOT EXISTS (
            SELECT 1
            FROM table_blocks b
            WHERE (b.table_id = t.id OR b.table_id IS NULL)
              AND b.starts_at < ?
              AND b.ends_at > ?
          )
        ORDER BY t.capacity, t.name
      `
    )
    .all(requestedEnd, requestedStart, requestedEnd, requestedStart)
    .map(toDiningTable);

  const suggestion = chooseTableCombination(availableTables, partySize);
  const suggestedCapacity = suggestion.reduce((sum, table) => sum + table.capacity, 0);

  return {
    availableTables,
    suggestedTableIds: suggestion.map((table) => table.id),
    suggestedCapacity,
    isAvailable: suggestedCapacity >= partySize
  };
}

export function findNearbyAvailableTimes(
  db: Database,
  request: AvailabilityRequest & { searchWindowMinutes?: number; intervalMinutes?: number; limit?: number }
): AvailabilityTimeSuggestion[] {
  const partySize = parsePositiveInteger(request.partySize, "Party size");
  const durationMinutes = parsePositiveInteger(request.durationMinutes ?? DEFAULT_RESERVATION_DURATION_MINUTES, "Duration");
  const searchWindowMinutes = parsePositiveInteger(request.searchWindowMinutes ?? 120, "Search window");
  const intervalMinutes = parsePositiveInteger(request.intervalMinutes ?? 15, "Search interval");
  const limit = parsePositiveInteger(request.limit ?? 4, "Suggestion limit");
  const requestedStart = isoDateTime(request.startsAt);
  const requestedDate = localDate(requestedStart);
  const suggestions: AvailabilityTimeSuggestion[] = [];

  for (let offset = intervalMinutes; offset <= searchWindowMinutes && suggestions.length < limit; offset += intervalMinutes) {
    for (const direction of [-1, 1]) {
      const startsAt = addMinutes(requestedStart, offset * direction);
      if (localDate(startsAt) !== requestedDate || startsAt === requestedStart) continue;
      const endsAt = addMinutes(startsAt, durationMinutes);
      const availability = findAvailableTablesForRange(db, partySize, startsAt, endsAt);
      if (!availability.isAvailable) continue;
      suggestions.push({
        startsAt,
        endsAt,
        suggestedTableIds: availability.suggestedTableIds,
        suggestedCapacity: availability.suggestedCapacity
      });
      if (suggestions.length >= limit) break;
    }
  }

  return suggestions.sort((left, right) => left.startsAt.localeCompare(right.startsAt));
}

function chooseTableCombination(tables: DiningTable[], partySize: number): DiningTable[] {
  const singleTable = tables.find((table) => table.capacity >= partySize);
  if (singleTable) return [singleTable];

  const selected: DiningTable[] = [];
  let selectedCapacity = 0;
  for (const table of [...tables].sort((left, right) => right.capacity - left.capacity || left.name.localeCompare(right.name))) {
    selected.push(table);
    selectedCapacity += table.capacity;
    if (selectedCapacity >= partySize) return selected;
  }

  return [];
}

export function createReservation(db: Database, input: ReservationInput): Reservation {
  const partySize = parsePositiveInteger(input.partySize, "Party size");
  const durationMinutes = parsePositiveInteger(input.durationMinutes ?? DEFAULT_RESERVATION_DURATION_MINUTES, "Duration");
  const startsAt = isoDateTime(input.startsAt);
  const endsAt = addMinutes(startsAt, durationMinutes);
  const createdAt = isoDateTime(input.createdAt ?? new Date());
  const id = input.id ?? reservationId(createdAt);
  const status = input.status ?? "booked";
  const depositAmountCents = optionalPositiveInteger(input.depositAmountCents, "Deposit amount");
  const depositStatus = input.depositStatus ?? (depositAmountCents ? "pending" : "not_required");
  const tableIds =
    input.tableIds ??
    findAvailableTables(db, { partySize, startsAt, durationMinutes }).suggestedTableIds;

  if (tableIds.length === 0) {
    throw new Error("No available table combination can hold this reservation.");
  }

  const available = findAvailableTables(db, { partySize, startsAt, durationMinutes });
  const unavailableTableIds = tableIds.filter((tableId) => !available.availableTables.some((table) => table.id === tableId));
  if (unavailableTableIds.length > 0) {
    throw new Error(`Requested table(s) are unavailable: ${unavailableTableIds.join(", ")}.`);
  }

  db.transaction(() => {
    db.prepare(`
      INSERT INTO reservations (
        id, source_call_id, guest_name, phone, party_size, starts_at, ends_at,
        duration_minutes, status, notes, deposit_amount_cents, deposit_currency,
        deposit_payment_link_url, deposit_status, stripe_checkout_session_id,
        stripe_payment_intent_id, stripe_payment_link_id, created_at, updated_at
      )
      VALUES ($id, $sourceCallId, $guestName, $phone, $partySize, $startsAt, $endsAt,
        $durationMinutes, $status, $notes, $depositAmountCents, $depositCurrency,
        $depositPaymentLinkUrl, $depositStatus, $stripeCheckoutSessionId,
        $stripePaymentIntentId, $stripePaymentLinkId, $createdAt, $createdAt)
    `).run({
      $id: id,
      $sourceCallId: input.sourceCallId ?? null,
      $guestName: input.guestName,
      $phone: input.phone ?? null,
      $partySize: partySize,
      $startsAt: startsAt,
      $endsAt: endsAt,
      $durationMinutes: durationMinutes,
      $status: status,
      $notes: input.notes ?? null,
      $depositAmountCents: depositAmountCents ?? null,
      $depositCurrency: input.depositCurrency?.toLowerCase() ?? null,
      $depositPaymentLinkUrl: input.depositPaymentLinkUrl ?? null,
      $depositStatus: depositStatus,
      $stripeCheckoutSessionId: input.stripeCheckoutSessionId ?? null,
      $stripePaymentIntentId: input.stripePaymentIntentId ?? null,
      $stripePaymentLinkId: input.stripePaymentLinkId ?? null,
      $createdAt: createdAt
    });

    const insertTable = db.prepare("INSERT INTO reservation_tables (reservation_id, table_id) VALUES (?, ?)");
    for (const tableId of tableIds) {
      insertTable.run(id, tableId);
    }
  })();

  return getReservation(db, id);
}

export function getReservation(db: Database, id: string): Reservation {
  const row = db.query<ReservationRow, [string]>("SELECT * FROM reservations WHERE id = ?").get(id);
  if (!row) throw new Error(`Reservation not found: ${id}`);
  const tableRows = db
    .query<{ table_id: number }, [string]>("SELECT table_id FROM reservation_tables WHERE reservation_id = ? ORDER BY table_id")
    .all(id);
  return {
    id: row.id,
    sourceCallId: row.source_call_id ?? undefined,
    guestName: row.guest_name,
    phone: row.phone ?? undefined,
    partySize: row.party_size,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    durationMinutes: row.duration_minutes,
    status: row.status,
    notes: row.notes ?? undefined,
    depositAmountCents: row.deposit_amount_cents ?? undefined,
    depositCurrency: row.deposit_currency ?? undefined,
    depositPaymentLinkUrl: row.deposit_payment_link_url ?? undefined,
    depositStatus: row.deposit_status,
    depositPaidAt: row.deposit_paid_at ?? undefined,
    stripeCheckoutSessionId: row.stripe_checkout_session_id ?? undefined,
    stripePaymentIntentId: row.stripe_payment_intent_id ?? undefined,
    stripePaymentLinkId: row.stripe_payment_link_id ?? undefined,
    tableIds: tableRows.map((table) => table.table_id),
    createdAt: row.created_at
  };
}

export function deleteReservation(db: Database, id: string): boolean {
  const result = db.prepare("DELETE FROM reservations WHERE id = ?").run(id);
  return result.changes > 0;
}

export type ListReservationsOptions = {
  from?: string | Date;
  to?: string | Date;
  status?: ReservationStatus[];
  limit?: number;
};

export function listReservations(db: Database, options: ListReservationsOptions = {}): Reservation[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (options.from) {
    conditions.push("r.ends_at >= ?");
    params.push(isoDateTime(options.from));
  }
  if (options.to) {
    conditions.push("r.starts_at < ?");
    params.push(isoDateTime(options.to));
  }
  if (options.status && options.status.length > 0) {
    conditions.push(`r.status IN (${options.status.map(() => "?").join(", ")})`);
    params.push(...options.status);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = options.limit ? "LIMIT ?" : "";
  if (options.limit) params.push(parsePositiveInteger(options.limit, "Limit"));

  const rows = db
    .query<ReservationRow, (string | number)[]>(`SELECT r.* FROM reservations r ${where} ORDER BY r.starts_at ASC, r.guest_name ASC ${limit}`)
    .all(...params);

  if (rows.length === 0) return [];

  const tableMap = new Map<string, number[]>();
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(", ");
  const tableRows = db
    .query<{ reservation_id: string; table_id: number }, string[]>(
      `SELECT reservation_id, table_id FROM reservation_tables WHERE reservation_id IN (${placeholders}) ORDER BY table_id`
    )
    .all(...ids);
  for (const item of tableRows) {
    const existing = tableMap.get(item.reservation_id) ?? [];
    existing.push(item.table_id);
    tableMap.set(item.reservation_id, existing);
  }

  return rows.map((row) => ({
    id: row.id,
    sourceCallId: row.source_call_id ?? undefined,
    guestName: row.guest_name,
    phone: row.phone ?? undefined,
    partySize: row.party_size,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    durationMinutes: row.duration_minutes,
    status: row.status,
    notes: row.notes ?? undefined,
    depositAmountCents: row.deposit_amount_cents ?? undefined,
    depositCurrency: row.deposit_currency ?? undefined,
    depositPaymentLinkUrl: row.deposit_payment_link_url ?? undefined,
    depositStatus: row.deposit_status,
    depositPaidAt: row.deposit_paid_at ?? undefined,
    stripeCheckoutSessionId: row.stripe_checkout_session_id ?? undefined,
    stripePaymentIntentId: row.stripe_payment_intent_id ?? undefined,
    stripePaymentLinkId: row.stripe_payment_link_id ?? undefined,
    tableIds: tableMap.get(row.id) ?? [],
    createdAt: row.created_at
  }));
}

function normalizePhone(value: string): string {
  return value.replace(/[^\d+]/g, "");
}

function parsePartySizeFromExtraction(value: string | undefined): number | undefined {
  const match = value?.match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

export function callReservationId(callId: string | undefined, caller: string, createdAt: string): string {
  if (callId) return callId;
  const normalizedCaller = normalizePhone(caller).replace(/^\+/, "") || "unknown";
  return `reservation_${normalizedCaller}_${createdAt.replace(/[^0-9]/g, "")}`;
}

export type CallReservationExtraction = {
  guestName?: string;
  partySize?: string;
  day?: string;
  time?: string;
  specialNotes?: string;
};

export type CallReservationDeposit = {
  amountCents?: number;
  currency?: string;
  paymentLinkUrl?: string;
};

export type RecordReservationCallInput = {
  id?: string;
  callId?: string;
  caller: string;
  conversationContext?: string;
  reservation: CallReservationExtraction;
  deposit?: CallReservationDeposit;
  createdAt?: string;
};

export type RecordReservationCallResult =
  | { recorded: true; reservation: Reservation }
  | { recorded: false; reason: "missing-date-or-party" | "duplicate" };

export function recordReservationCall(input: RecordReservationCallInput): RecordReservationCallResult {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const partySize = parsePartySizeFromExtraction(input.reservation.partySize);
  const startsAt = parseReservationDateTime(input.reservation.day, input.reservation.time, new Date(createdAt));
  if (!startsAt || !partySize) return { recorded: false, reason: "missing-date-or-party" };

  const id = input.id ?? callReservationId(input.callId, input.caller, createdAt);
  const db = openReservationDatabase();
  try {
    seedDiningTables(db);
    if (db.query<{ id: string }, [string]>("SELECT id FROM reservations WHERE id = ?").get(id)) {
      return { recorded: false, reason: "duplicate" };
    }
    const reservation = createReservation(db, {
      id,
      sourceCallId: input.callId,
      guestName: input.reservation.guestName ?? "Unknown guest",
      phone: input.caller,
      partySize,
      startsAt,
      notes: [input.reservation.specialNotes, input.conversationContext].filter(Boolean).join("; ") || undefined,
      depositAmountCents: input.deposit?.amountCents,
      depositCurrency: input.deposit?.currency,
      depositPaymentLinkUrl: input.deposit?.paymentLinkUrl,
      depositStatus: input.deposit ? "pending" : "not_required",
      createdAt
    });
    return { recorded: true, reservation };
  } finally {
    db.close();
  }
}

export function appendReservationNoteByCaller(caller: string | undefined, note: string): Reservation | undefined {
  if (!caller || !note.trim()) return undefined;
  const db = openReservationDatabase();
  try {
    const latest = findLatestReservationByPhone(db, caller);
    if (!latest) return undefined;
    const trimmed = note.trim();
    const combined = latest.notes ? `${latest.notes}; ${trimmed}` : trimmed;
    db.prepare("UPDATE reservations SET notes = ?, updated_at = ? WHERE id = ?").run(combined, new Date().toISOString(), latest.id);
    return getReservation(db, latest.id);
  } finally {
    db.close();
  }
}

export function formatReservationContextForCaller(caller: string | undefined): string {
  if (!caller) return "No caller phone number was provided for reservation lookup.";
  const db = openReservationDatabase();
  try {
    const reservation = findLatestReservationByPhone(db, caller);
    if (!reservation) return "No reservation was found for this caller.";

    const tables = db
      .query<{ name: string }, [string]>(
        `
          SELECT t.name
          FROM reservation_tables rt
          JOIN dining_tables t ON t.id = rt.table_id
          WHERE rt.reservation_id = ?
          ORDER BY t.name
        `
      )
      .all(reservation.id)
      .map((row) => row.name);

    const startDate = localDate(reservation.startsAt);
    const startTime = localTime(reservation.startsAt);
    const endTime = localTime(reservation.endsAt);
    const depositAmount =
      reservation.depositAmountCents && reservation.depositCurrency
        ? new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: reservation.depositCurrency.toUpperCase(),
            maximumFractionDigits: reservation.depositAmountCents % 100 === 0 ? 0 : 2
          }).format(reservation.depositAmountCents / 100)
        : undefined;
    const depositParts = [
      reservation.depositStatus.replaceAll("_", " "),
      depositAmount ? `amount: ${depositAmount}` : undefined,
      reservation.depositPaidAt ? `paid at ${reservation.depositPaidAt}` : undefined,
      reservation.depositPaymentLinkUrl ? `link: ${reservation.depositPaymentLinkUrl}` : undefined
    ].filter(Boolean);

    return [
      `Reservation ID: ${reservation.id}`,
      `Guest name: ${reservation.guestName}`,
      `Party size: ${reservation.partySize}`,
      `Date: ${startDate} (${config.RESTAURANT_TIME_ZONE})`,
      `Time: ${startTime}-${endTime}`,
      `Status: ${reservation.status.replaceAll("_", " ")}`,
      `Deposit: ${depositParts.join("; ")}`,
      tables.length ? `Tables: ${tables.join(", ")}` : "Tables: unassigned",
      reservation.notes ? `Notes: ${reservation.notes}` : undefined
    ]
      .filter(Boolean)
      .join("\n");
  } finally {
    db.close();
  }
}

export function findLatestReservationByPhone(db: Database, phone: string): Reservation | undefined {
  const row = db
    .query<{ id: string }, [string]>(
      `
        SELECT id
        FROM reservations
        WHERE replace(replace(replace(replace(phone, ' ', ''), '(', ''), ')', ''), '-', '') = ?
        ORDER BY starts_at DESC
        LIMIT 1
      `
    )
    .get(phone.replace(/[^\d+]/g, ""));
  return row ? getReservation(db, row.id) : undefined;
}

export function updateReservationDepositStatus(
  db: Database,
  input: {
    reservationId: string;
    depositStatus: ReservationDepositStatus;
    paidAt?: string | Date;
    stripeCheckoutSessionId?: string;
    stripePaymentIntentId?: string;
    stripePaymentLinkId?: string;
  }
): Reservation {
  const paidAt =
    input.depositStatus === "paid"
      ? isoDateTime(input.paidAt ?? new Date())
      : input.paidAt
        ? isoDateTime(input.paidAt)
        : null;

  const result = db.prepare(`
    UPDATE reservations
    SET
      deposit_status = $depositStatus,
      deposit_paid_at = $depositPaidAt,
      stripe_checkout_session_id = COALESCE($stripeCheckoutSessionId, stripe_checkout_session_id),
      stripe_payment_intent_id = COALESCE($stripePaymentIntentId, stripe_payment_intent_id),
      stripe_payment_link_id = COALESCE($stripePaymentLinkId, stripe_payment_link_id),
      updated_at = $updatedAt
    WHERE id = $reservationId
  `).run({
    $reservationId: input.reservationId,
    $depositStatus: input.depositStatus,
    $depositPaidAt: paidAt,
    $stripeCheckoutSessionId: input.stripeCheckoutSessionId ?? null,
    $stripePaymentIntentId: input.stripePaymentIntentId ?? null,
    $stripePaymentLinkId: input.stripePaymentLinkId ?? null,
    $updatedAt: new Date().toISOString()
  });

  if (result.changes === 0) throw new Error(`Reservation not found: ${input.reservationId}`);
  return getReservation(db, input.reservationId);
}

export function updateReservationDepositStatusForStripeReference(
  db: Database,
  input: {
    stripeCheckoutSessionId?: string;
    stripePaymentIntentId?: string;
    depositStatus: ReservationDepositStatus;
    paidAt?: string | Date;
  }
): Reservation | undefined {
  const row = db
    .query<{ id: string }, [string | null, string | null, string | null, string | null]>(
      `
        SELECT id
        FROM reservations
        WHERE (? IS NOT NULL AND stripe_checkout_session_id = ?)
           OR (? IS NOT NULL AND stripe_payment_intent_id = ?)
        ORDER BY starts_at DESC
        LIMIT 1
      `
    )
    .get(
      input.stripeCheckoutSessionId ?? null,
      input.stripeCheckoutSessionId ?? null,
      input.stripePaymentIntentId ?? null,
      input.stripePaymentIntentId ?? null
    );

  if (!row) return undefined;
  return updateReservationDepositStatus(db, {
    reservationId: row.id,
    depositStatus: input.depositStatus,
    paidAt: input.paidAt,
    stripeCheckoutSessionId: input.stripeCheckoutSessionId,
    stripePaymentIntentId: input.stripePaymentIntentId
  });
}

export function blockTable(db: Database, input: { tableId?: number; startsAt: string | Date; endsAt: string | Date; reason?: string }): number {
  const startsAt = isoDateTime(input.startsAt);
  const endsAt = isoDateTime(input.endsAt);
  const result = db.prepare("INSERT INTO table_blocks (table_id, starts_at, ends_at, reason) VALUES (?, ?, ?, ?)").run(
    input.tableId ?? null,
    startsAt,
    endsAt,
    input.reason ?? null
  );
  return Number(result.lastInsertRowid);
}

export function formatReservationDayLog(db: Database, date: string): string {
  const rows = db
    .query<ReservationLogRow, []>(
      `
        SELECT
          r.id,
          r.starts_at,
          r.ends_at,
          r.guest_name,
          r.phone,
          r.party_size,
          r.status,
          r.deposit_status,
          group_concat(t.name, ', ') AS tables,
          r.notes
        FROM reservations r
        LEFT JOIN reservation_tables rt ON rt.reservation_id = r.id
        LEFT JOIN dining_tables t ON t.id = rt.table_id
        GROUP BY r.id
        ORDER BY r.starts_at, r.guest_name
      `
    )
    .all()
    .filter((row) => localDate(row.starts_at) === date);

  if (rows.length === 0) return `Reservation log for ${date}: no reservations.`;

  return [
    `Reservation log for ${date}:`,
    ...rows.map((row) =>
      [
        `- ${localTime(row.starts_at)}-${localTime(row.ends_at)}`,
        row.guest_name,
        `party of ${row.party_size}`,
        row.tables ? `tables: ${row.tables}` : "tables: unassigned",
        `status: ${row.status}`,
        `deposit: ${row.deposit_status.replaceAll("_", " ")}`,
        row.notes ? `notes: ${row.notes}` : undefined
      ]
        .filter(Boolean)
        .join("; ")
    )
  ].join("\n");
}

export function formatAvailabilityContext(db: Database, request: AvailabilityRequest): string {
  const availability = findAvailableTables(db, request);
  const date = localDate(availability.requestedStart);
  const startTime = localTime(availability.requestedStart);
  const endTime = localTime(availability.requestedEnd);
  const suggestedTables = availability.suggestedTableIds.length
    ? availability.availableTables
        .filter((table) => availability.suggestedTableIds.includes(table.id))
        .map((table) => `${table.name} (${table.capacity})`)
        .join(", ")
    : "none";
  const nearbyTimes = availability.nearbyAvailableTimes.length
    ? availability.nearbyAvailableTimes
        .map((time) => `${localTime(time.startsAt)}-${localTime(time.endsAt)} (capacity ${time.suggestedCapacity})`)
        .join(", ")
    : "none found within 2 hours";

  return [
    `SQLite reservation availability for ${date} ${startTime}-${endTime}:`,
    `Party size: ${availability.partySize}`,
    `Default dining time: ${request.durationMinutes ?? DEFAULT_RESERVATION_DURATION_MINUTES} minutes`,
    `Available: ${availability.isAvailable ? "yes" : "no"}`,
    `Suggested table assignment: ${suggestedTables}`,
    `Nearby available times: ${nearbyTimes}`,
    formatReservationDayLog(db, date)
  ].join("\n");
}

export function formatAvailabilityContextForTranscript(transcript: string | undefined): string {
  const parsed = parseReservationRequestText(transcript);
  if (!parsed.partySize || !parsed.startsAt) {
    return "SQLite reservation availability: request does not yet include a parseable party size, date, and time.";
  }

  const db = openReservationDatabase();
  try {
    seedDiningTables(db);
    return formatAvailabilityContext(db, {
      partySize: parsed.partySize,
      startsAt: parsed.startsAt
    });
  } finally {
    db.close();
  }
}
