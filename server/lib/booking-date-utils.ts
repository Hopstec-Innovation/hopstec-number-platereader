/** Business timezone for booking dates (Ekhaya CMS + local app). */
export const BUSINESS_TIMEZONE =
  process.env.BUSINESS_TIMEZONE || "Africa/Johannesburg";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date as YYYY-MM-DD in the business timezone. */
export function todayInBusinessTimezone(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
  }).format(new Date());
}

/** Format a PostgreSQL bookingDate value as YYYY-MM-DD in the business timezone. */
export function formatBookingDateFromDb(
  value: Date | string | null | undefined,
): string {
  if (value == null || value === "") return "";
  if (typeof value === "string" && DATE_ONLY.test(value)) return value;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
  }).format(date);
}

/** Parse YYYY-MM-DD for writing back to the CRM (date-only, no UTC shift). */
export function parseBookingDateForDb(dateStr: string): string {
  if (!DATE_ONLY.test(dateStr)) {
    throw new Error(`Invalid booking date: ${dateStr}`);
  }
  return dateStr;
}

/**
 * Combine a calendar date + HH:MM slot into a UTC Date for comparisons.
 * Interprets both parts in the business timezone.
 */
export function combineBookingDateAndTime(
  bookingDateYmd: string,
  timeSlot: string,
): Date {
  const dateYmd = formatBookingDateFromDb(bookingDateYmd);
  const [hours, minutes] = (timeSlot || "00:00").split(":").map(Number);
  const [y, mo, d] = dateYmd.split("-").map(Number);

  let utcGuess = Date.UTC(y, mo - 1, d, hours || 0, minutes || 0);
  const target = `${dateYmd} ${String(hours || 0).padStart(2, "0")}:${String(minutes || 0).padStart(2, "0")}:00`;

  for (let i = 0; i < 3; i++) {
    const formatted = new Intl.DateTimeFormat("sv-SE", {
      timeZone: BUSINESS_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(utcGuess));

    if (formatted === target) break;

    const [fd, ft] = formatted.split(" ");
    const [fy, fm, fdd] = fd.split("-").map(Number);
    const [fh, fmi] = ft.split(":").map(Number);
    const diffMs =
      Date.UTC(y, mo - 1, d, hours || 0, minutes || 0) -
      Date.UTC(fy, fm - 1, fdd, fh, fmi);
    utcGuess += diffMs;
  }

  return new Date(utcGuess);
}
