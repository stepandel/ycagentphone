export function renderAdminPage(options: { restaurantName: string; timeZone: string }): string {
  const restaurantName = escapeHtml(options.restaurantName);
  const timeZone = escapeHtml(options.timeZone);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Reservations · ${restaurantName}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f6f5f1;
    --surface: #ffffff;
    --surface-muted: #f0ece2;
    --border: #e2dccb;
    --ink: #1f1d18;
    --ink-soft: #5a5650;
    --ink-faint: #8a857c;
    --accent: #6b3f1d;
    --good: #2f7d4d;
    --warn: #b8830f;
    --bad: #b03a3a;
    --info: #2c5985;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14130f;
      --surface: #1d1c18;
      --surface-muted: #25231d;
      --border: #34322c;
      --ink: #f3efe6;
      --ink-soft: #c9c4b8;
      --ink-faint: #8e8a80;
      --accent: #e7b58a;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-size: 14px;
    line-height: 1.45;
  }
  header.page {
    padding: 28px 32px 12px;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: flex-end;
    gap: 16px;
  }
  header.page h1 {
    margin: 0;
    font-size: 22px;
    letter-spacing: -0.01em;
  }
  header.page .meta {
    color: var(--ink-faint);
    font-size: 12px;
  }
  .toolbar {
    padding: 14px 32px;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .toolbar .group {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 999px;
    overflow: hidden;
  }
  .toolbar button {
    background: transparent;
    border: none;
    padding: 6px 14px;
    font: inherit;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .toolbar button.active {
    background: var(--ink);
    color: var(--bg);
  }
  .toolbar .search {
    margin-left: auto;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .toolbar input[type="search"] {
    background: var(--surface-muted);
    border: 1px solid var(--border);
    color: var(--ink);
    padding: 6px 10px;
    border-radius: 6px;
    font: inherit;
    min-width: 220px;
  }
  .toolbar .stats {
    color: var(--ink-faint);
    font-size: 12px;
  }
  main { padding: 24px 32px 64px; }
  .day {
    margin-bottom: 32px;
  }
  .day h2 {
    margin: 0 0 12px;
    font-size: 14px;
    font-weight: 600;
    color: var(--ink-soft);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
  .day h2 .count {
    font-weight: 400;
    color: var(--ink-faint);
    text-transform: none;
    letter-spacing: 0;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    position: relative;
  }
  .card .time {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    font-size: 15px;
  }
  .card .time .duration {
    color: var(--ink-faint);
    font-weight: 400;
    font-size: 12px;
    margin-left: 6px;
  }
  .card .guest {
    font-size: 15px;
  }
  .card .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    color: var(--ink-soft);
    font-size: 12px;
  }
  .card .row .label { color: var(--ink-faint); }
  .card .tables {
    color: var(--ink-soft);
    font-size: 12px;
  }
  .card .notes {
    color: var(--ink-soft);
    font-size: 12px;
    border-top: 1px dashed var(--border);
    padding-top: 8px;
    font-style: italic;
  }
  .badges { display: flex; gap: 6px; flex-wrap: wrap; }
  .badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 500;
    background: var(--surface-muted);
    color: var(--ink-soft);
    border: 1px solid var(--border);
    white-space: nowrap;
  }
  .badge.s-booked { color: var(--info); border-color: color-mix(in srgb, var(--info) 30%, var(--border)); }
  .badge.s-seated { color: var(--good); border-color: color-mix(in srgb, var(--good) 30%, var(--border)); }
  .badge.s-completed { color: var(--ink-faint); }
  .badge.s-cancelled { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 30%, var(--border)); text-decoration: line-through; }
  .badge.s-no_show { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 30%, var(--border)); }
  .badge.d-paid { color: var(--good); border-color: color-mix(in srgb, var(--good) 30%, var(--border)); }
  .badge.d-pending { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 30%, var(--border)); }
  .badge.d-failed, .badge.d-refunded { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 30%, var(--border)); }
  .empty, .loading, .error {
    text-align: center;
    color: var(--ink-faint);
    padding: 60px 0;
  }
  .error { color: var(--bad); }
</style>
</head>
<body>
<header class="page">
  <div>
    <h1>${restaurantName} · Reservations</h1>
    <div class="meta">Times shown in ${timeZone}</div>
  </div>
  <div class="meta" id="last-updated"></div>
</header>
<div class="toolbar">
  <div class="group" id="range-filter">
    <button data-range="today">Today</button>
    <button data-range="upcoming" class="active">Upcoming</button>
    <button data-range="past">Past</button>
    <button data-range="all">All</button>
  </div>
  <div class="search">
    <input type="search" id="search" placeholder="Search guest, phone, or notes" autocomplete="off" />
  </div>
  <div class="stats" id="stats"></div>
</div>
<main id="content">
  <div class="loading">Loading reservations…</div>
</main>
<script>
  const timeZone = ${JSON.stringify(options.timeZone)};
  const state = { range: "upcoming", search: "", reservations: [], tables: new Map() };

  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  });
  const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit"
  });

  function dayKey(iso) {
    return dayKeyFormatter.format(new Date(iso));
  }

  function formatTime(iso) {
    return timeFormatter.format(new Date(iso));
  }

  function formatDate(iso) {
    return dateFormatter.format(new Date(iso));
  }

  function formatDuration(minutes) {
    if (!minutes) return "";
    if (minutes < 60) return minutes + "m";
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? h + "h " + m + "m" : h + "h";
  }

  function formatDeposit(reservation) {
    if (reservation.depositStatus === "not_required") return null;
    const labels = { pending: "Deposit pending", paid: "Deposit paid", failed: "Deposit failed", refunded: "Refunded", waived: "Waived" };
    let label = labels[reservation.depositStatus] ?? reservation.depositStatus;
    if (reservation.depositAmountCents && reservation.depositCurrency) {
      const amount = (reservation.depositAmountCents / 100).toLocaleString("en-US", {
        style: "currency",
        currency: reservation.depositCurrency.toUpperCase()
      });
      label = label + " · " + amount;
    }
    return label;
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[ch]);
  }

  function matchesSearch(reservation, term) {
    if (!term) return true;
    const haystack = [reservation.guestName, reservation.phone, reservation.notes].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(term);
  }

  function inRange(reservation, range, todayKey, nowMs) {
    if (range === "all") return true;
    const startMs = new Date(reservation.startsAt).getTime();
    const endMs = new Date(reservation.endsAt).getTime();
    const key = dayKey(reservation.startsAt);
    if (range === "today") return key === todayKey;
    if (range === "upcoming") return endMs >= nowMs;
    if (range === "past") return endMs < nowMs;
    return true;
  }

  function tableLabel(id) {
    const table = state.tables.get(id);
    if (!table) return "Table " + id;
    return table.area ? table.name + " (" + table.area + ")" : table.name;
  }

  function renderCard(reservation) {
    const tables = reservation.tableIds.map(tableLabel).join(", ");
    const depositLine = formatDeposit(reservation);
    const phone = reservation.phone ? '<span><span class="label">Phone</span> ' + esc(reservation.phone) + '</span>' : "";
    const notes = reservation.notes ? '<div class="notes">' + esc(reservation.notes) + '</div>' : "";
    return [
      '<div class="card">',
      '  <div class="time">' + esc(formatTime(reservation.startsAt)) + ' – ' + esc(formatTime(reservation.endsAt)),
      '    <span class="duration">' + esc(formatDuration(reservation.durationMinutes)) + '</span>',
      '  </div>',
      '  <div class="guest">' + esc(reservation.guestName) + '</div>',
      '  <div class="row">',
      '    <span><span class="label">Party</span> ' + reservation.partySize + '</span>',
      phone,
      '  </div>',
      tables ? '  <div class="tables"><span class="label">Tables · </span>' + esc(tables) + '</div>' : '  <div class="tables"><span class="label">Tables · </span>unassigned</div>',
      '  <div class="badges">',
      '    <span class="badge s-' + esc(reservation.status) + '">' + esc(reservation.status.replace(/_/g, " ")) + '</span>',
      depositLine ? '    <span class="badge d-' + esc(reservation.depositStatus) + '">' + esc(depositLine) + '</span>' : '',
      '  </div>',
      notes,
      '</div>'
    ].join("\\n");
  }

  function renderDay(key, reservations) {
    const sample = reservations[0];
    const heading = formatDate(sample.startsAt);
    const cards = reservations.map(renderCard).join("");
    return '<section class="day"><h2>' + esc(heading) + ' <span class="count">' + reservations.length + ' reservation' + (reservations.length === 1 ? '' : 's') + '</span></h2><div class="grid">' + cards + '</div></section>';
  }

  function render() {
    const content = document.getElementById("content");
    const stats = document.getElementById("stats");
    const term = state.search.trim().toLowerCase();
    const todayKey = dayKeyFormatter.format(new Date());
    const nowMs = Date.now();

    const filtered = state.reservations
      .filter((r) => inRange(r, state.range, todayKey, nowMs))
      .filter((r) => matchesSearch(r, term));

    stats.textContent = filtered.length + ' of ' + state.reservations.length + ' shown';

    if (filtered.length === 0) {
      content.innerHTML = '<div class="empty">No reservations match this view.</div>';
      return;
    }

    const grouped = new Map();
    for (const reservation of filtered) {
      const key = dayKey(reservation.startsAt);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(reservation);
    }

    const sortedKeys = [...grouped.keys()].sort();
    const ordered = state.range === "past" ? sortedKeys.reverse() : sortedKeys;
    content.innerHTML = ordered.map((key) => renderDay(key, grouped.get(key))).join("");
  }

  async function load() {
    try {
      const response = await fetch("/admin/api/reservations");
      if (!response.ok) throw new Error("Request failed: " + response.status);
      const data = await response.json();
      state.reservations = data.reservations;
      state.tables = new Map(data.tables.map((t) => [t.id, t]));
      document.getElementById("last-updated").textContent = "Updated " + new Date().toLocaleTimeString();
      render();
    } catch (error) {
      document.getElementById("content").innerHTML = '<div class="error">' + esc(error.message) + '</div>';
    }
  }

  document.getElementById("range-filter").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-range]");
    if (!button) return;
    state.range = button.dataset.range;
    for (const item of document.querySelectorAll("#range-filter button")) {
      item.classList.toggle("active", item === button);
    }
    render();
  });

  document.getElementById("search").addEventListener("input", (event) => {
    state.search = event.target.value;
    render();
  });

  load();
  setInterval(load, 30000);
</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[ch] as string));
}
