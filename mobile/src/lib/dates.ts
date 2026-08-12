/**
 * Parse a naive ISO-8601 datetime string from the backend (no timezone
 * offset) into a real `Date` instant. The backend stores every timestamp as
 * naive UTC, so we interpret the string as UTC here; from then on, all local
 * `Date` getters render it in the device's own timezone — mirrors the same
 * convention the web frontend documents on its equivalent helper.
 */
export function parseNaiveIso(iso: string): Date {
  return new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
}

export function formatClockTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).format(date);
}

export function formatDayLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(date);
}

export function formatMonthLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(date);
}

/** Local yyyy-MM-dd key — used both as a React list key and as the `date_from`/`date_to` query params. */
export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

/**
 * Convert a local wall-clock time (e.g. "09:00") on a given local calendar
 * date into its UTC equivalent. The backend has no timezone concept — the
 * free-slots endpoint's `day_start_hour`/`day_end_hour` and `date_from`/
 * `date_to` are taken literally as UTC — so the device's local "9 AM" has to
 * become the matching UTC date + time before being sent as a query param.
 */
export function toUtcBoundary(dateKey: string, localTime: string): { dateKey: string; time: string } {
  const [hour, minute] = localTime.split(':').map(Number);
  const local = parseDateKey(dateKey);
  local.setHours(hour, minute, 0, 0);
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    dateKey: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
    time: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`,
  };
}
