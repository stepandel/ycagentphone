import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import { config } from "./config.js";

export const DEFAULT_RESERVATION_DURATION_MINUTES = 75;

export type ReservationStatus = "booked" | "seated" | "completed" | "cancelled" | "no_show";

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
  tableIds: number[];
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
};

type ReservationLogRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  guest_name: string;
  phone: string | null;
  party_size: number;
  status: ReservationStatus;
  tables: string | null;
  notes: string | null;
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

    CREATE INDEX IF NOT EXISTS reservations_time_idx ON reservations(starts_at, ends_at, status);
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
    requestedStart,
    requestedEnd,
    partySize,
    availableTables,
    suggestedTableIds: suggestion.map((table) => table.id),
    suggestedCapacity,
    isAvailable: suggestedCapacity >= partySize
  };
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
        duration_minutes, status, notes, created_at, updated_at
      )
      VALUES ($id, $sourceCallId, $guestName, $phone, $partySize, $startsAt, $endsAt,
        $durationMinutes, $status, $notes, $createdAt, $createdAt)
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
    tableIds: tableRows.map((table) => table.table_id)
  };
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

  return [
    `SQLite reservation availability for ${date} ${startTime}-${endTime}:`,
    `Party size: ${availability.partySize}`,
    `Default dining time: ${request.durationMinutes ?? DEFAULT_RESERVATION_DURATION_MINUTES} minutes`,
    `Available: ${availability.isAvailable ? "yes" : "no"}`,
    `Suggested table assignment: ${suggestedTables}`,
    formatReservationDayLog(db, date)
  ].join("\n");
}
