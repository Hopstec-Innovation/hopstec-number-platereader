import "dotenv/config";
import { cleanupTestBookings } from "./lib/cleanup-test-bookings";

async function main() {
  const dryRun = !process.argv.includes("--execute");

  if (dryRun) {
    console.log("Dry run — no data will be deleted. Pass --execute to delete.\n");
  } else {
    console.log("EXECUTING cleanup — test bookings will be permanently deleted.\n");
  }

  try {
    const result = await cleanupTestBookings(dryRun);

    if (result.matched.length === 0) {
      console.log("No test bookings found for: Herve, Papy, Cindy, Ryan, Brett");
      process.exit(0);
    }

    console.log(`Found ${result.matched.length} test booking(s):\n`);
    for (const booking of result.matched) {
      console.log(
        `  [${booking.source}] ${booking.id.slice(-8).toUpperCase()} | ${booking.customerName} | ${booking.bookingDate} ${booking.timeSlot} | ${booking.status} | R${((booking.totalAmount ?? 0) / 100).toFixed(2)}`,
      );
    }

    if (!dryRun) {
      console.log("\nDeleted:");
      console.log(`  CRM bookings:        ${result.deleted.crmBookings}`);
      console.log(`  CRM payments:        ${result.deleted.crmPayments}`);
      console.log(`  CRM receipts:        ${result.deleted.crmReceipts}`);
      console.log(`  CRM refund requests: ${result.deleted.crmRefundRequests}`);
      console.log(`  CRM booking add-ons: ${result.deleted.crmBookingAddOns}`);
      console.log(`  Local bookings:      ${result.deleted.localBookings}`);
      console.log(`  Local payments:      ${result.deleted.localPayments}`);
    }

    if (result.errors.length > 0) {
      console.error("\nErrors:");
      for (const err of result.errors) console.error(`  - ${err}`);
      process.exit(1);
    }

    console.log(dryRun ? "\nRe-run with --execute to delete these records." : "\nCleanup complete.");
    process.exit(0);
  } catch (error) {
    console.error("Cleanup failed:", error);
    process.exit(1);
  }
}

main();
