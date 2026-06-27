import { inArray, or, sql } from "drizzle-orm";
import { db } from "../db";
import { bookingPayments, bookings, bookingCustomers } from "@shared/schema";
import { getBookingPool } from "./booking-db";

const testNameMatchSql = (column: unknown) =>
  sql`LOWER(SPLIT_PART(TRIM(COALESCE(${column}, '')), ' ', 1)) IN ('herve', 'papy', 'cindy', 'ryan', 'brett')`;
/** First names used for internal test bookings (matched case-insensitively). */
export const TEST_CUSTOMER_FIRST_NAMES = [
  "herve",
  "papy",
  "cindy",
  "ryan",
  "brett",
] as const;

export interface TestBookingRecord {
  id: string;
  status: string;
  bookingDate: string;
  timeSlot: string;
  totalAmount: number | null;
  createdAt: Date;
  customerName: string | null;
  customerEmail: string | null;
  source: "crm" | "local";
}

export interface CleanupTestBookingsResult {
  dryRun: boolean;
  matched: TestBookingRecord[];
  deleted: {
    crmBookings: number;
    crmBookingAddOns: number;
    crmPayments: number;
    crmReceipts: number;
    crmRefundRequests: number;
    localBookings: number;
    localPayments: number;
  };
  errors: string[];
}

export function isTestCustomerName(name: string | null | undefined): boolean {
  if (!name?.trim()) return false;
  const first = name.trim().split(/\s+/)[0]?.toLowerCase();
  return (TEST_CUSTOMER_FIRST_NAMES as readonly string[]).includes(first);
}

export async function findTestCRMBookings(): Promise<TestBookingRecord[]> {
  const pool = getBookingPool();
  if (!pool) return [];

  const result = await pool.query(
    `
      SELECT
        b.id,
        b.status,
        b."bookingDate",
        b."timeSlot",
        b."totalAmount",
        b."createdAt",
        u.name as "customerName",
        u.email as "customerEmail"
      FROM "Booking" b
      JOIN "User" u ON b."userId" = u.id
      WHERE LOWER(SPLIT_PART(TRIM(COALESCE(u.name, '')), ' ', 1)) = ANY($1::text[])
      ORDER BY b."createdAt" DESC
    `,
    [TEST_CUSTOMER_FIRST_NAMES],
  );

  return result.rows.map((row) => ({
    id: row.id,
    status: row.status,
    bookingDate: String(row.bookingDate),
    timeSlot: row.timeSlot,
    totalAmount: row.totalAmount,
    createdAt: new Date(row.createdAt),
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    source: "crm" as const,
  }));
}

async function findTestLocalBookings(): Promise<TestBookingRecord[]> {
  const rows = await db
    .select({
      id: bookings.id,
      status: bookings.status,
      bookingDate: bookings.bookingDate,
      timeSlot: bookings.timeSlot,
      totalAmount: bookings.totalAmount,
      createdAt: bookings.createdAt,
      customerName: bookingCustomers.name,
      customerEmail: bookingCustomers.email,
    })
    .from(bookings)
    .innerJoin(bookingCustomers, sql`${bookings.customerId} = ${bookingCustomers.id}`)
    .where(testNameMatchSql(bookingCustomers.name))
    .orderBy(sql`${bookings.createdAt} DESC`);

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    bookingDate: row.bookingDate,
    timeSlot: row.timeSlot,
    totalAmount: row.totalAmount,
    createdAt: row.createdAt ?? new Date(),
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    source: "local" as const,
  }));
}

export async function cleanupTestBookings(
  dryRun = true,
): Promise<CleanupTestBookingsResult> {
  const errors: string[] = [];
  const crmMatches = await findTestCRMBookings();
  const localMatches = await findTestLocalBookings();
  const matched = [...crmMatches, ...localMatches];

  const result: CleanupTestBookingsResult = {
    dryRun,
    matched,
    deleted: {
      crmBookings: 0,
      crmBookingAddOns: 0,
      crmPayments: 0,
      crmReceipts: 0,
      crmRefundRequests: 0,
      localBookings: 0,
      localPayments: 0,
    },
    errors,
  };

  if (dryRun || matched.length === 0) {
    return result;
  }

  const crmIds = crmMatches.map((b) => b.id);
  const localIds = localMatches.map((b) => b.id);
  const allBookingIds = [...crmIds, ...localIds];

  if (allBookingIds.length > 0) {
    const paymentDelete = await db
      .delete(bookingPayments)
      .where(
        or(
          inArray(bookingPayments.bookingId, allBookingIds),
          testNameMatchSql(bookingPayments.customerName),
        ),
      )
      .returning({ id: bookingPayments.id });
    result.deleted.localPayments = paymentDelete.length;
  }

  if (localIds.length > 0) {
    const localDelete = await db
      .delete(bookings)
      .where(inArray(bookings.id, localIds))
      .returning({ id: bookings.id });
    result.deleted.localBookings = localDelete.length;
  }

  const pool = getBookingPool();
  if (pool && crmIds.length > 0) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const refundResult = await client.query(
        `DELETE FROM "RefundRequest" WHERE "bookingId" = ANY($1::text[])`,
        [crmIds],
      );
      result.deleted.crmRefundRequests = refundResult.rowCount ?? 0;

      const receiptResult = await client.query(
        `DELETE FROM "Receipt" WHERE "bookingId" = ANY($1::text[])`,
        [crmIds],
      );
      result.deleted.crmReceipts = receiptResult.rowCount ?? 0;

      const paymentResult = await client.query(
        `DELETE FROM "Payment" WHERE "bookingId" = ANY($1::text[])`,
        [crmIds],
      );
      result.deleted.crmPayments = paymentResult.rowCount ?? 0;

      const addOnResult = await client.query(
        `DELETE FROM "BookingAddOn" WHERE "bookingId" = ANY($1::text[])`,
        [crmIds],
      );
      result.deleted.crmBookingAddOns = addOnResult.rowCount ?? 0;

      const bookingResult = await client.query(
        `DELETE FROM "Booking" WHERE id = ANY($1::text[])`,
        [crmIds],
      );
      result.deleted.crmBookings = bookingResult.rowCount ?? 0;

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      errors.push(`CRM cleanup failed: ${String(error)}`);
    } finally {
      client.release();
    }
  }

  return result;
}
