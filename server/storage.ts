import { eq, and, isNull, isNotNull, desc, gte, lt, sql, lte, between, or, asc } from "drizzle-orm";
import { db } from "./db";
import { formatBookingDateFromDb, todayInBusinessTimezone } from "./lib/booking-date-utils";
import {
  washJobs, washPhotos, parkingSessions, eventLogs, userRoles, users,
  customerJobAccess, serviceChecklistItems, customerConfirmations, photoRules,
  parkingSettings, parkingZones, frequentParkers, parkingReservations,
  businessSettings, servicePackages, customerMemberships, parkingValidations,
  customerNotifications, notificationTemplates, technicianTimeLogs, staffAlerts,
  loyaltyAccounts, loyaltyTransactions, loyaltyVouchers, pushSubscriptions,
  suppliers, inventoryItems, inventoryConsumption, purchaseOrders,
  tenants, branches, webhookRetries, invoices,
  bookingServices, bookingCustomers, bookingVehicles, bookings, bookingTimeSlotConfig, bookingPayments,
  corporateAccounts, staffMessages,
  type WashJob, type InsertWashJob,
  type WashPhoto, type InsertWashPhoto,
  type ParkingSession, type InsertParkingSession,
  type ParkingSettings, type InsertParkingSettings,
  type ParkingZone, type InsertParkingZone,
  type FrequentParker, type InsertFrequentParker,
  type ParkingReservation, type InsertParkingReservation,
  type BusinessSettings, type InsertBusinessSettings,
  type ServicePackage, type InsertServicePackage,
  type CustomerMembership, type InsertCustomerMembership,
  type ParkingValidation, type InsertParkingValidation,
  type CustomerNotification, type InsertCustomerNotification,
  type NotificationTemplate, type InsertNotificationTemplate,
  type TechnicianTimeLog, type InsertTechnicianTimeLog,
  type StaffAlert, type InsertStaffAlert,
  type StaffMessage, type InsertStaffMessage,
  type LoyaltyAccount,
  type LoyaltyTransaction,
  type LoyaltyVoucher,
  type PushSubscription, type InsertPushSubscription,
  type Supplier, type InsertSupplier,
  type InventoryItem, type InsertInventoryItem,
  type InventoryConsumption, type InsertInventoryConsumption,
  type PurchaseOrder, type InsertPurchaseOrder,
  type Tenant, type InsertTenant,
  type Branch, type InsertBranch,
  type Invoice, type InsertInvoice,
  type EventLog, type InsertEventLog,
  type UserRole, type InsertUserRole,
  type User, type InsertUser,
  type CustomerJobAccess, type InsertCustomerJobAccess,
  type ServiceChecklistItem, type InsertServiceChecklistItem,
  type CustomerConfirmation, type InsertCustomerConfirmation,
  type PhotoRule, type InsertPhotoRule,
  type WebhookRetry, type InsertWebhookRetry,
  type BookingService, type InsertBookingService,
  type BookingCustomer, type InsertBookingCustomer,
  type BookingVehicle, type InsertBookingVehicle,
  type Booking, type InsertBooking,
  type BookingTimeSlotConfig, type InsertBookingTimeSlotConfig,
  type BookingPayment, type InsertBookingPayment,
  type CorporateAccount,
  WASH_STATUS_ORDER
} from "@shared/schema";
import { normalizePlate } from "./lib/plate-utils";

export interface IStorage {
  // User roles
  getUserRole(tenantId: string, userId: string): Promise<UserRole | undefined>;
  upsertUserRole(tenantId: string, role: InsertUserRole): Promise<UserRole>;

  // Users (credentials auth)
  getUserById(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined>;
  deleteUser(id: string): Promise<boolean>;
  getUsers(tenantId?: string): Promise<User[]>;

  // Customer job access (token-scoped, stays global)
  createCustomerJobAccess(access: InsertCustomerJobAccess): Promise<CustomerJobAccess>;
  getCustomerJobAccessByToken(token: string): Promise<CustomerJobAccess | undefined>;
  getCustomerJobAccessByJobId(washJobId: string): Promise<CustomerJobAccess | undefined>;
  updateCustomerJobAccessViewedAt(token: string): Promise<CustomerJobAccess | undefined>;

  // Service checklist
  createServiceChecklistItems(tenantId: string, items: InsertServiceChecklistItem[]): Promise<ServiceChecklistItem[]>;
  getServiceChecklistItems(washJobId: string): Promise<ServiceChecklistItem[]>;
  updateChecklistItemConfirmed(id: string, confirmed: boolean): Promise<ServiceChecklistItem | undefined>;
  updateChecklistItemConfirmedForJob(id: string, washJobId: string, confirmed: boolean): Promise<ServiceChecklistItem | undefined>;
  skipChecklistItem(id: string, washJobId: string, reason?: string): Promise<ServiceChecklistItem | undefined>;

  // Customer confirmations
  createCustomerConfirmation(confirmation: InsertCustomerConfirmation): Promise<CustomerConfirmation>;
  getCustomerConfirmation(washJobId: string): Promise<CustomerConfirmation | undefined>;

  // Photo rules
  getPhotoRules(tenantId: string): Promise<PhotoRule[]>;
  upsertPhotoRule(tenantId: string, rule: InsertPhotoRule): Promise<PhotoRule>;

  // Wash Jobs
  createWashJob(tenantId: string, job: InsertWashJob): Promise<WashJob>;
  getWashJob(id: string, tenantId: string): Promise<WashJob | undefined>;
  getWashJobs(tenantId: string, filters?: { status?: string; technicianId?: string; fromDate?: Date }): Promise<WashJob[]>;
  updateWashJobStatus(id: string, status: string, tenantId?: string): Promise<WashJob | undefined>;
  updateWashJobPrice(id: string, adminPrice: number, reason: string, overrideBy: string, tenantId?: string): Promise<WashJob | undefined>;
  completeWashJob(id: string, tenantId?: string): Promise<WashJob | undefined>;
  deleteWashJob(id: string, tenantId?: string): Promise<boolean>;

  // Wash Photos
  addWashPhoto(tenantId: string, photo: InsertWashPhoto): Promise<WashPhoto>;
  getWashPhotos(washJobId: string): Promise<WashPhoto[]>;

  // Parking Sessions
  createParkingEntry(tenantId: string, session: InsertParkingSession): Promise<ParkingSession>;
  findOpenParkingSession(tenantId: string, plateNormalized: string): Promise<ParkingSession | undefined>;
  closeParkingSession(id: string, exitPhotoUrl?: string, calculatedFee?: number, tenantId?: string): Promise<ParkingSession | undefined>;
  getParkingSessions(tenantId: string, filters?: { open?: boolean; plateSearch?: string; fromDate?: Date; toDate?: Date; zoneId?: string }): Promise<ParkingSession[]>;
  getParkingSession(id: string, tenantId?: string): Promise<ParkingSession | undefined>;
  updateParkingSession(id: string, data: Partial<InsertParkingSession>, tenantId?: string): Promise<ParkingSession | undefined>;

  // Parking Settings
  getParkingSettings(tenantId: string): Promise<ParkingSettings | undefined>;
  upsertParkingSettings(tenantId: string, settings: InsertParkingSettings): Promise<ParkingSettings>;

  // Parking Zones
  createParkingZone(tenantId: string, zone: InsertParkingZone): Promise<ParkingZone>;
  getParkingZones(tenantId: string, activeOnly?: boolean): Promise<ParkingZone[]>;
  getParkingZone(id: string, tenantId?: string): Promise<ParkingZone | undefined>;
  updateParkingZone(id: string, data: Partial<InsertParkingZone>, tenantId?: string): Promise<ParkingZone | undefined>;
  getZoneOccupancy(tenantId: string, zoneId: string): Promise<number>;

  // Frequent Parkers
  getOrCreateFrequentParker(tenantId: string, plateNormalized: string, plateDisplay: string): Promise<FrequentParker>;
  getFrequentParker(tenantId: string, plateNormalized: string): Promise<FrequentParker | undefined>;
  updateFrequentParker(id: string, data: Partial<InsertFrequentParker>, tenantId?: string): Promise<FrequentParker | undefined>;
  getFrequentParkers(tenantId: string, filters?: { isVip?: boolean; hasMonthlyPass?: boolean }): Promise<FrequentParker[]>;
  incrementParkerVisit(tenantId: string, plateNormalized: string, amountSpent?: number): Promise<FrequentParker | undefined>;

  // Parking Reservations
  createParkingReservation(tenantId: string, reservation: InsertParkingReservation): Promise<ParkingReservation>;
  getParkingReservations(tenantId: string, filters?: { status?: string; fromDate?: Date; toDate?: Date }): Promise<ParkingReservation[]>;
  getParkingReservation(id: string, tenantId?: string): Promise<ParkingReservation | undefined>;
  getParkingReservationByCode(code: string, tenantId?: string): Promise<ParkingReservation | undefined>;
  updateParkingReservation(id: string, data: Partial<InsertParkingReservation>, tenantId?: string): Promise<ParkingReservation | undefined>;
  checkInReservation(id: string, parkingSessionId: string, tenantId?: string): Promise<ParkingReservation | undefined>;

  // Parking Analytics
  getParkingAnalytics(tenantId: string): Promise<{
    totalActiveSessions: number;
    totalCapacity: number;
    occupancyRate: number;
    todayRevenue: number;
    todayEntries: number;
    todayExits: number;
    avgDurationMinutes: number;
    zoneOccupancy: { zoneId: string; zoneName: string; occupied: number; capacity: number }[];
  }>;

  // Business Settings
  getBusinessSettings(tenantId: string): Promise<BusinessSettings | undefined>;
  upsertBusinessSettings(tenantId: string, settings: InsertBusinessSettings): Promise<BusinessSettings>;

  // Service Packages
  createServicePackage(tenantId: string, pkg: InsertServicePackage): Promise<ServicePackage>;
  getServicePackages(tenantId: string, activeOnly?: boolean): Promise<ServicePackage[]>;
  getServicePackage(id: string, tenantId?: string): Promise<ServicePackage | undefined>;
  updateServicePackage(id: string, data: Partial<InsertServicePackage>, tenantId?: string): Promise<ServicePackage | undefined>;

  // Customer Memberships
  createCustomerMembership(tenantId: string, membership: InsertCustomerMembership): Promise<CustomerMembership>;
  getCustomerMemberships(tenantId: string, filters?: { status?: string; plateNormalized?: string }): Promise<CustomerMembership[]>;
  getCustomerMembership(id: string, tenantId?: string): Promise<CustomerMembership | undefined>;
  getActiveMembershipForPlate(tenantId: string, plateNormalized: string): Promise<CustomerMembership | undefined>;
  updateCustomerMembership(id: string, data: Partial<InsertCustomerMembership>, tenantId?: string): Promise<CustomerMembership | undefined>;
  incrementMembershipWashUsed(id: string, tenantId?: string): Promise<CustomerMembership | undefined>;

  // Parking Validations
  createParkingValidation(tenantId: string, validation: InsertParkingValidation): Promise<ParkingValidation>;
  getParkingValidations(tenantId: string, parkingSessionId: string): Promise<ParkingValidation[]>;

  // Customer Notifications
  createNotification(tenantId: string, notification: InsertCustomerNotification): Promise<CustomerNotification>;
  getNotifications(tenantId: string, filters?: { status?: string; type?: string; customerPhone?: string; limit?: number }): Promise<CustomerNotification[]>;
  getNotification(id: string, tenantId?: string): Promise<CustomerNotification | undefined>;
  updateNotificationStatus(id: string, status: string, externalId?: string, failureReason?: string): Promise<CustomerNotification | undefined>;
  getPendingNotifications(limit?: number): Promise<CustomerNotification[]>;

  // Notification Templates
  createNotificationTemplate(tenantId: string, template: InsertNotificationTemplate): Promise<NotificationTemplate>;
  getNotificationTemplates(tenantId: string, activeOnly?: boolean): Promise<NotificationTemplate[]>;
  getNotificationTemplate(tenantId: string, code: string): Promise<NotificationTemplate | undefined>;
  updateNotificationTemplate(id: string, data: Partial<InsertNotificationTemplate>, tenantId?: string): Promise<NotificationTemplate | undefined>;

  // Membership lookup by plate (for CRM integration)
  findMembershipByPlate(tenantId: string, plateNormalized: string): Promise<CustomerMembership | undefined>;
  findMembershipByPhone(tenantId: string, phone: string): Promise<CustomerMembership | undefined>;
  findMembershipByEmail(tenantId: string, email: string): Promise<CustomerMembership | undefined>;

  // Push Subscriptions
  savePushSubscription(tenantId: string, sub: InsertPushSubscription): Promise<PushSubscription>;
  getPushSubscriptionsByUser(tenantId: string, userId: string): Promise<PushSubscription[]>;
  getPushSubscriptionsByCustomerToken(customerToken: string): Promise<PushSubscription[]>;
  getPushSubscriptionsByRole(tenantId: string, role: string): Promise<PushSubscription[]>;
  deletePushSubscription(id: string): Promise<void>;

  // Suppliers
  createSupplier(tenantId: string, supplier: InsertSupplier): Promise<Supplier>;
  getSuppliers(tenantId: string, activeOnly?: boolean): Promise<Supplier[]>;
  getSupplier(id: string, tenantId?: string): Promise<Supplier | undefined>;
  updateSupplier(id: string, data: Partial<InsertSupplier>, tenantId?: string): Promise<Supplier | undefined>;

  // Inventory Items
  createInventoryItem(tenantId: string, item: InsertInventoryItem): Promise<InventoryItem>;
  getInventoryItems(tenantId: string, filters?: { category?: string; lowStock?: boolean; active?: boolean }): Promise<InventoryItem[]>;
  getInventoryItem(id: string, tenantId?: string): Promise<InventoryItem | undefined>;
  updateInventoryItem(id: string, data: Partial<InsertInventoryItem>, tenantId?: string): Promise<InventoryItem | undefined>;
  adjustInventoryStock(id: string, quantityChange: number, tenantId?: string): Promise<InventoryItem | undefined>;

  // Inventory Consumption
  logInventoryConsumption(tenantId: string, consumption: InsertInventoryConsumption): Promise<InventoryConsumption>;
  getInventoryConsumption(tenantId: string, filters?: { itemId?: string; fromDate?: Date; toDate?: Date }): Promise<InventoryConsumption[]>;
  autoConsumeForWashJob(tenantId: string, washJobId: string, serviceCode: string, createdBy: string): Promise<void>;

  // Purchase Orders
  createPurchaseOrder(tenantId: string, order: InsertPurchaseOrder): Promise<PurchaseOrder>;
  getPurchaseOrders(tenantId: string, filters?: { status?: string; supplierId?: string }): Promise<PurchaseOrder[]>;
  getPurchaseOrder(id: string, tenantId?: string): Promise<PurchaseOrder | undefined>;
  updatePurchaseOrder(id: string, data: Partial<InsertPurchaseOrder>, tenantId?: string): Promise<PurchaseOrder | undefined>;
  receivePurchaseOrder(id: string, tenantId?: string): Promise<PurchaseOrder | undefined>;

  // Inventory Analytics
  getInventoryAnalytics(tenantId: string): Promise<{
    totalItems: number;
    lowStockItems: number;
    totalStockValue: number;
    topConsumedItems: { itemId: string; itemName: string; totalQuantity: number }[];
    monthlyConsumptionCost: number;
    profitMarginByService: { serviceCode: string; avgCost: number; avgRevenue: number; margin: number }[];
  }>;
  getLowStockItems(tenantId: string): Promise<InventoryItem[]>;

  // Technician Time Logs
  clockIn(tenantId: string, technicianId: string, notes?: string): Promise<TechnicianTimeLog>;
  clockOut(logId: string, tenantId?: string): Promise<TechnicianTimeLog | undefined>;
  getActiveTimeLog(tenantId: string, technicianId: string): Promise<TechnicianTimeLog | undefined>;
  getTimeLogs(tenantId: string, filters?: { technicianId?: string; fromDate?: Date; toDate?: Date; limit?: number }): Promise<TechnicianTimeLog[]>;
  addBreakLog(logId: string, breakEntry: { type: "lunch" | "short" | "absent"; notes?: string }, tenantId?: string): Promise<TechnicianTimeLog | undefined>;
  endBreakLog(logId: string, tenantId?: string): Promise<TechnicianTimeLog | undefined>;

  // Staff Alerts
  createStaffAlert(tenantId: string, data: { technicianId: string; type: "running_late" | "absent" | "emergency" | "other"; message?: string; estimatedArrival?: string }): Promise<StaffAlert>;
  getStaffAlerts(tenantId: string, filters?: { unacknowledgedOnly?: boolean; technicianId?: string }): Promise<StaffAlert[]>;
  acknowledgeStaffAlert(alertId: string, acknowledgedBy: string, tenantId?: string): Promise<StaffAlert | undefined>;

  // Staff Messages (two-way messaging)
  createStaffMessage(tenantId: string, data: { senderId: string; senderName?: string; senderRole?: string; recipientId?: string; message: string; branchId?: string }): Promise<StaffMessage>;
  getStaffMessages(tenantId: string, filters?: { userId?: string; unreadOnly?: boolean; limit?: number }): Promise<StaffMessage[]>;
  markStaffMessageRead(id: string, tenantId?: string): Promise<StaffMessage | undefined>;
  getUnreadStaffMessageCount(tenantId: string, userId: string): Promise<number>;

  // Loyalty Accounts
  getLoyaltyAccountByPlate(tenantId: string, plateNormalized: string): Promise<LoyaltyAccount | undefined>;
  getLoyaltyAccountByPhone(tenantId: string, phone: string): Promise<LoyaltyAccount | undefined>;
  getLoyaltyTransactionsByAccount(tenantId: string, loyaltyAccountId: string, limit?: number): Promise<LoyaltyTransaction[]>;
  getOrCreateLoyaltyAccount(tenantId: string, plateNormalized: string, plateDisplay: string, customerData?: { name?: string; phone?: string; email?: string }): Promise<LoyaltyAccount>;
  creditLoyaltyPoints(tenantId: string, accountId: string, points: number): Promise<LoyaltyAccount | undefined>;
  getLoyaltyAnalytics(tenantId: string): Promise<{ totalAccounts: number; totalPointsIssued: number; pointsIssuedToday: number; topEarners: { plateDisplay: string; customerName: string | null; pointsBalance: number; totalWashes: number }[] }>;

  // Loyalty Transactions
  getLoyaltyTransactions(tenantId: string, filters?: { type?: string; limit?: number }): Promise<LoyaltyTransaction[]>;
  logLoyaltyTransaction(tenantId: string, data: { crmUserId: string; memberNumber: string; type: "earn_wash" | "earn_bonus" | "adjust"; points: number; balanceAfter: number; washJobId?: string; serviceCode?: string; description?: string; createdBy?: string }): Promise<LoyaltyTransaction>;

  // Technician Performance
  getTechnicianPerformance(tenantId: string): Promise<{ technicianId: string; technicianName: string; avgRating: number; totalRatings: number; issueCount: number; issuePercent: number; recentFeedback: { rating: number | null; notes: string | null; issueReported: string | null; createdAt: Date | null; plateDisplay: string }[] }[]>;

  // ===== Booking System (tenant-isolated) =====

  // Booking Services (tenant service catalog)
  createBookingService(tenantId: string, service: Omit<InsertBookingService, "tenantId">): Promise<BookingService>;
  getBookingServices(tenantId: string, activeOnly?: boolean): Promise<BookingService[]>;
  getBookingService(id: string, tenantId?: string): Promise<BookingService | undefined>;
  updateBookingService(id: string, data: Partial<InsertBookingService>, tenantId?: string): Promise<BookingService | undefined>;

  // Booking Customers
  createBookingCustomer(tenantId: string, customer: Omit<InsertBookingCustomer, "tenantId">): Promise<BookingCustomer>;
  getBookingCustomers(tenantId: string, filters?: { search?: string; limit?: number }): Promise<BookingCustomer[]>;
  getBookingCustomer(id: string, tenantId?: string): Promise<BookingCustomer | undefined>;
  getBookingCustomerByEmail(tenantId: string, email: string): Promise<BookingCustomer | undefined>;
  getBookingCustomerByPlate(tenantId: string, plateNormalized: string): Promise<BookingCustomer | undefined>;
  updateBookingCustomer(id: string, data: Partial<InsertBookingCustomer>, tenantId?: string): Promise<BookingCustomer | undefined>;

  // Booking Vehicles
  createBookingVehicle(tenantId: string, vehicle: Omit<InsertBookingVehicle, "tenantId">): Promise<BookingVehicle>;
  getBookingVehicles(tenantId: string, customerId?: string): Promise<BookingVehicle[]>;
  getBookingVehicleByPlate(tenantId: string, plateNormalized: string): Promise<BookingVehicle | undefined>;

  // Bookings
  createBooking(tenantId: string, booking: Omit<InsertBooking, "tenantId">): Promise<Booking>;
  getBookings(tenantId: string, filters?: { status?: string; fromDate?: string; toDate?: string; search?: string; customerId?: string; limit?: number }): Promise<Booking[]>;
  getBooking(id: string, tenantId?: string): Promise<Booking | undefined>;
  updateBooking(id: string, data: Partial<InsertBooking>, tenantId?: string): Promise<Booking | undefined>;
  cancelBooking(id: string, reason?: string, tenantId?: string): Promise<Booking | undefined>;
  getTodayBookings(tenantId: string): Promise<Booking[]>;
  getUpcomingBookings(tenantId: string, days?: number): Promise<Booking[]>;
  getBookingsByPlate(tenantId: string, plateNormalized: string): Promise<Booking[]>;

  // Time Slot Config
  getTimeSlotConfig(tenantId: string): Promise<BookingTimeSlotConfig[]>;
  upsertTimeSlotConfig(tenantId: string, configs: InsertBookingTimeSlotConfig[]): Promise<BookingTimeSlotConfig[]>;
  getAvailableTimeSlots(tenantId: string, date: string): Promise<{ time: string; available: number; maxConcurrent: number }[]>;

  // Booking Analytics
  getBookingAnalytics(tenantId: string): Promise<{
    todayBookings: number;
    weekBookings: number;
    monthBookings: number;
    completionRate: number;
    bookingRevenue: number;
  }>;

  // Booking Payments
  createBookingPayment(tenantId: string, payment: Omit<InsertBookingPayment, "tenantId">): Promise<BookingPayment>;
  getBookingPayment(id: string, tenantId?: string): Promise<BookingPayment | undefined>;
  getBookingPaymentByBookingId(bookingId: string, tenantId?: string): Promise<BookingPayment | undefined>;
  getBookingPayments(tenantId: string, filters?: { fromDate?: string; toDate?: string; limit?: number }): Promise<BookingPayment[]>;
  generateReceiptNumber(tenantId: string): Promise<string>;

  // Tenants (admin-level, stays global)
  createTenant(tenant: InsertTenant): Promise<Tenant>;
  getTenants(): Promise<Tenant[]>;
  getTenant(id: string): Promise<Tenant | undefined>;
  getTenantBySlug(slug: string): Promise<Tenant | undefined>;
  updateTenant(id: string, data: Partial<InsertTenant>): Promise<Tenant | undefined>;

  // Branches (already scoped)
  createBranch(branch: InsertBranch): Promise<Branch>;
  getBranches(tenantId: string): Promise<Branch[]>;
  getBranch(id: string): Promise<Branch | undefined>;
  updateBranch(id: string, data: Partial<InsertBranch>): Promise<Branch | undefined>;

  // Invoices (admin-level, stays global)
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;
  getInvoices(filters?: { tenantId?: string; status?: string }): Promise<Invoice[]>;
  getInvoice(id: string): Promise<Invoice | undefined>;
  updateInvoice(id: string, data: Partial<InsertInvoice>): Promise<Invoice | undefined>;
  getInvoicesByTenant(tenantId: string): Promise<Invoice[]>;

  // Tenant Stats (already scoped)
  getTenantStats(tenantId: string): Promise<{
    userCount: number;
    washCount: number;
    parkingSessionCount: number;
    branchCount: number;
  }>;

  // Event Logs
  logEvent(tenantId: string, event: InsertEventLog): Promise<EventLog>;
  getEvents(tenantId: string, filters?: { plate?: string; type?: string; limit?: number }): Promise<EventLog[]>;

  // Webhook Retries (system-level, stays global)
  createWebhookRetry(retry: InsertWebhookRetry): Promise<WebhookRetry>;
  getPendingWebhookRetries(limit?: number): Promise<WebhookRetry[]>;
  updateWebhookRetry(id: string, data: Partial<{ attempts: number; lastError: string | null; nextRetryAt: Date | null }>): Promise<WebhookRetry | undefined>;
  deleteWebhookRetry(id: string): Promise<boolean>;
  getWebhookRetries(limit?: number): Promise<WebhookRetry[]>;

  // Analytics
  getAnalyticsSummary(tenantId: string): Promise<{
    todayWashes: number;
    weekWashes: number;
    monthWashes: number;
    avgCycleTimeMinutes: number;
    avgTimePerStage: Record<string, number>;
    technicianStats: { userId: string; name: string; count: number }[];
  }>;

  // Revenue Summary
  getRevenueSummary(tenantId: string): Promise<any>;

  // Customer Insights
  getCustomerInsights(tenantId: string): Promise<any>;

  // Corporate Accounts
  getCorporateAccounts(status?: string): Promise<CorporateAccount[]>;
  getCorporateAccount(id: string): Promise<CorporateAccount | undefined>;
  updateCorporateAccount(id: string, data: Partial<CorporateAccount>): Promise<CorporateAccount | undefined>;
}

export class DatabaseStorage implements IStorage {
  // User Roles
  async getUserRole(tenantId: string, userId: string): Promise<UserRole | undefined> {
    const [role] = await db.select().from(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.tenantId, tenantId)));
    return role;
  }

  async upsertUserRole(tenantId: string, role: InsertUserRole): Promise<UserRole> {
    // Check if role exists first to avoid ON CONFLICT issues
    const existing = await this.getUserRole(tenantId, role.userId);
    
    if (existing) {
      // Update existing role
      const [result] = await db
        .update(userRoles)
        .set({ role: role.role })
        .where(eq(userRoles.userId, role.userId))
        .returning();
      return result;
    } else {
      // Insert new role
      const [result] = await db
        .insert(userRoles)
        .values({ ...role, tenantId })
        .returning();
      return result;
    }
  }

  // Users (credentials auth)
  async getUserById(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [result] = await db.insert(users).values(user).returning();
    return result;
  }

  async updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined> {
    const [result] = await db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return result;
  }

  async deleteUser(id: string): Promise<boolean> {
    const result = await db.delete(users).where(eq(users.id, id)).returning();
    return result.length > 0;
  }

  async getUsers(tenantId?: string): Promise<User[]> {
    if (tenantId) {
      return db.select().from(users).where(eq(users.tenantId, tenantId)).orderBy(desc(users.createdAt));
    }
    return db.select().from(users).orderBy(desc(users.createdAt));
  }

  // Customer job access
  async createCustomerJobAccess(access: InsertCustomerJobAccess): Promise<CustomerJobAccess> {
    const [result] = await db.insert(customerJobAccess).values(access).returning();
    return result;
  }

  async getCustomerJobAccessByToken(token: string): Promise<CustomerJobAccess | undefined> {
    const [result] = await db.select().from(customerJobAccess).where(eq(customerJobAccess.token, token));
    return result;
  }

  async getCustomerJobAccessByJobId(washJobId: string): Promise<CustomerJobAccess | undefined> {
    const [result] = await db.select().from(customerJobAccess).where(eq(customerJobAccess.washJobId, washJobId));
    return result;
  }

  async updateCustomerJobAccessViewedAt(token: string): Promise<CustomerJobAccess | undefined> {
    const [result] = await db
      .update(customerJobAccess)
      .set({ lastViewedAt: new Date() })
      .where(eq(customerJobAccess.token, token))
      .returning();
    return result;
  }

  // Service checklist
  async createServiceChecklistItems(tenantId: string, items: InsertServiceChecklistItem[]): Promise<ServiceChecklistItem[]> {
    if (items.length === 0) return [];
    return db.insert(serviceChecklistItems).values(items.map(i => ({ ...i, tenantId }))).returning();
  }

  async getServiceChecklistItems(washJobId: string): Promise<ServiceChecklistItem[]> {
    return db
      .select()
      .from(serviceChecklistItems)
      .where(eq(serviceChecklistItems.washJobId, washJobId))
      .orderBy(serviceChecklistItems.orderIndex);
  }

  async updateChecklistItemConfirmed(id: string, confirmed: boolean): Promise<ServiceChecklistItem | undefined> {
    const [result] = await db
      .update(serviceChecklistItems)
      .set({ confirmed, confirmedAt: confirmed ? new Date() : null })
      .where(eq(serviceChecklistItems.id, id))
      .returning();
    return result;
  }

  async updateChecklistItemConfirmedForJob(id: string, washJobId: string, confirmed: boolean): Promise<ServiceChecklistItem | undefined> {
    const [result] = await db
      .update(serviceChecklistItems)
      .set({ confirmed, confirmedAt: confirmed ? new Date() : null })
      .where(and(
        eq(serviceChecklistItems.id, id),
        eq(serviceChecklistItems.washJobId, washJobId)
      ))
      .returning();
    return result;
  }

  async skipChecklistItem(id: string, washJobId: string, reason?: string): Promise<ServiceChecklistItem | undefined> {
    const [result] = await db
      .update(serviceChecklistItems)
      .set({ skipped: true, skippedReason: reason || null })
      .where(and(
        eq(serviceChecklistItems.id, id),
        eq(serviceChecklistItems.washJobId, washJobId)
      ))
      .returning();
    return result;
  }

  // Customer confirmations
  async createCustomerConfirmation(confirmation: InsertCustomerConfirmation): Promise<CustomerConfirmation> {
    const [result] = await db.insert(customerConfirmations).values(confirmation).returning();
    return result;
  }

  async getCustomerConfirmation(washJobId: string): Promise<CustomerConfirmation | undefined> {
    const [result] = await db.select().from(customerConfirmations).where(eq(customerConfirmations.washJobId, washJobId));
    return result;
  }

  // Photo rules
  async getPhotoRules(tenantId: string): Promise<PhotoRule[]> {
    return db.select().from(photoRules).where(eq(photoRules.tenantId, tenantId));
  }

  async upsertPhotoRule(tenantId: string, rule: InsertPhotoRule): Promise<PhotoRule> {
    const existing = await db.select().from(photoRules).where(and(eq(photoRules.step, rule.step), eq(photoRules.tenantId, tenantId)));

    if (existing.length > 0) {
      const [result] = await db
        .update(photoRules)
        .set({ rule: rule.rule, updatedBy: rule.updatedBy, updatedAt: new Date() })
        .where(and(eq(photoRules.step, rule.step), eq(photoRules.tenantId, tenantId)))
        .returning();
      return result;
    } else {
      const [result] = await db.insert(photoRules).values({ ...rule, tenantId }).returning();
      return result;
    }
  }

  // Wash Jobs
  async createWashJob(tenantId: string, job: InsertWashJob): Promise<WashJob> {
    const plateNormalized = normalizePlate(job.plateDisplay);
    const stageTimestamps = { received: new Date().toISOString() };
    const [result] = await db
      .insert(washJobs)
      .values({ ...job, tenantId, plateNormalized, stageTimestamps })
      .returning();
    return result;
  }

  async getWashJob(id: string, tenantId: string): Promise<WashJob | undefined> {
    const [job] = await db.select().from(washJobs).where(and(eq(washJobs.id, id), eq(washJobs.tenantId, tenantId)));
    return job;
  }

  async getWashJobs(tenantId: string, filters?: { status?: string; technicianId?: string; fromDate?: Date }): Promise<WashJob[]> {
    let query = db.select().from(washJobs);

    const conditions = [eq(washJobs.tenantId, tenantId)];
    if (filters?.status) {
      conditions.push(eq(washJobs.status, filters.status as any));
    }
    if (filters?.technicianId) {
      conditions.push(eq(washJobs.technicianId, filters.technicianId));
    }
    if (filters?.fromDate) {
      conditions.push(gte(washJobs.createdAt, filters.fromDate));
    }

    query = query.where(and(...conditions)) as any;

    return query.orderBy(desc(washJobs.createdAt));
  }

  async updateWashJobStatus(id: string, status: string, tenantId?: string): Promise<WashJob | undefined> {
    // Get current job to update stage timestamps
    const conditions = [eq(washJobs.id, id)];
    if (tenantId) conditions.push(eq(washJobs.tenantId, tenantId));
    const [current] = await db.select().from(washJobs).where(and(...conditions));
    if (!current) return undefined;
    
    const timestamps = (current.stageTimestamps || {}) as Record<string, string>;
    timestamps[status] = new Date().toISOString();
    
    const [result] = await db
      .update(washJobs)
      .set({ 
        status: status as any, 
        stageTimestamps: timestamps,
        updatedAt: new Date() 
      })
      .where(eq(washJobs.id, id))
      .returning();
    return result;
  }

  async updateWashJobPrice(id: string, adminPrice: number, reason: string, overrideBy: string, tenantId?: string): Promise<WashJob | undefined> {
    const conditions = [eq(washJobs.id, id)];
    if (tenantId) conditions.push(eq(washJobs.tenantId, tenantId));

    const [result] = await db
      .update(washJobs)
      .set({
        adminPrice,
        priceOverrideReason: reason,
        priceOverrideBy: overrideBy,
        updatedAt: new Date(),
      })
      .where(and(...conditions))
      .returning();
    return result;
  }

  async completeWashJob(id: string, tenantId?: string): Promise<WashJob | undefined> {
    // Get current job to update stage timestamps
    const conditions = [eq(washJobs.id, id)];
    if (tenantId) conditions.push(eq(washJobs.tenantId, tenantId));
    const [current] = await db.select().from(washJobs).where(and(...conditions));
    if (!current) return undefined;
    
    const timestamps = (current.stageTimestamps || {}) as Record<string, string>;
    timestamps["complete"] = new Date().toISOString();
    
    const [result] = await db
      .update(washJobs)
      .set({ 
        status: "complete", 
        stageTimestamps: timestamps,
        endAt: new Date(), 
        updatedAt: new Date() 
      })
      .where(eq(washJobs.id, id))
      .returning();
    return result;
  }

  async deleteWashJob(id: string, tenantId?: string): Promise<boolean> {
    // Delete related records first, then the job
    await db.delete(washPhotos).where(eq(washPhotos.washJobId, id));
    await db.delete(customerJobAccess).where(eq(customerJobAccess.washJobId, id));
    await db.delete(serviceChecklistItems).where(eq(serviceChecklistItems.washJobId, id));
    await db.delete(customerConfirmations).where(eq(customerConfirmations.washJobId, id));
    await db.delete(loyaltyTransactions).where(eq(loyaltyTransactions.washJobId, id));
    const result = await db.delete(washJobs).where(eq(washJobs.id, id)).returning();
    return result.length > 0;
  }

  // Wash Photos
  async addWashPhoto(tenantId: string, photo: InsertWashPhoto): Promise<WashPhoto> {
    const [result] = await db.insert(washPhotos).values({ ...photo, tenantId }).returning();
    return result;
  }

  async getWashPhotos(washJobId: string): Promise<WashPhoto[]> {
    return db.select().from(washPhotos).where(eq(washPhotos.washJobId, washJobId));
  }

  // Parking Sessions
  async createParkingEntry(tenantId: string, session: InsertParkingSession): Promise<ParkingSession> {
    const plateNormalized = normalizePlate(session.plateDisplay);
    const [result] = await db
      .insert(parkingSessions)
      .values({ ...session, tenantId, plateNormalized })
      .returning();
    return result;
  }

  async findOpenParkingSession(tenantId: string, plateNormalized: string): Promise<ParkingSession | undefined> {
    const [session] = await db
      .select()
      .from(parkingSessions)
      .where(and(
        eq(parkingSessions.tenantId, tenantId),
        eq(parkingSessions.plateNormalized, plateNormalized),
        isNull(parkingSessions.exitAt)
      ));
    return session;
  }

  async closeParkingSession(id: string, exitPhotoUrl?: string, calculatedFee?: number, tenantId?: string): Promise<ParkingSession | undefined> {
    const conditions = [eq(parkingSessions.id, id)];
    if (tenantId) conditions.push(eq(parkingSessions.tenantId, tenantId));
    const [result] = await db
      .update(parkingSessions)
      .set({
        exitAt: new Date(),
        exitPhotoUrl: exitPhotoUrl || null,
        calculatedFee: calculatedFee || null,
        updatedAt: new Date()
      })
      .where(and(...conditions))
      .returning();
    return result;
  }

  async getParkingSessions(tenantId: string, filters?: { open?: boolean; plateSearch?: string; fromDate?: Date; toDate?: Date; zoneId?: string }): Promise<ParkingSession[]> {
    let query = db.select().from(parkingSessions);
    const conditions = [eq(parkingSessions.tenantId, tenantId)];

    if (filters?.open === true) {
      conditions.push(isNull(parkingSessions.exitAt));
    } else if (filters?.open === false) {
      conditions.push(sql`${parkingSessions.exitAt} IS NOT NULL`);
    }

    if (filters?.plateSearch) {
      const normalized = normalizePlate(filters.plateSearch);
      conditions.push(sql`${parkingSessions.plateNormalized} ILIKE ${'%' + normalized + '%'}`);
    }

    if (filters?.fromDate) {
      conditions.push(gte(parkingSessions.entryAt, filters.fromDate));
    }

    if (filters?.toDate) {
      conditions.push(lte(parkingSessions.entryAt, filters.toDate));
    }

    if (filters?.zoneId) {
      conditions.push(eq(parkingSessions.zoneId, filters.zoneId));
    }

    query = query.where(and(...conditions)) as any;

    return query.orderBy(desc(parkingSessions.entryAt));
  }

  async getParkingSession(id: string, tenantId?: string): Promise<ParkingSession | undefined> {
    const conditions = [eq(parkingSessions.id, id)];
    if (tenantId) conditions.push(eq(parkingSessions.tenantId, tenantId));
    const [session] = await db.select().from(parkingSessions).where(and(...conditions));
    return session;
  }

  async updateParkingSession(id: string, data: Partial<InsertParkingSession>, tenantId?: string): Promise<ParkingSession | undefined> {
    const conditions = [eq(parkingSessions.id, id)];
    if (tenantId) conditions.push(eq(parkingSessions.tenantId, tenantId));
    const [result] = await db
      .update(parkingSessions)
      .set({ ...data, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return result;
  }

  // Parking Settings
  async getParkingSettings(tenantId: string): Promise<ParkingSettings | undefined> {
    const [settings] = await db.select().from(parkingSettings).where(eq(parkingSettings.tenantId, tenantId)).limit(1);
    return settings;
  }

  async upsertParkingSettings(tenantId: string, settings: InsertParkingSettings): Promise<ParkingSettings> {
    const existing = await this.getParkingSettings(tenantId);
    if (existing) {
      const [result] = await db
        .update(parkingSettings)
        .set({ ...settings, updatedAt: new Date() })
        .where(eq(parkingSettings.id, existing.id))
        .returning();
      return result;
    } else {
      const [result] = await db.insert(parkingSettings).values({ ...settings, tenantId }).returning();
      return result;
    }
  }

  // Parking Zones
  async createParkingZone(tenantId: string, zone: InsertParkingZone): Promise<ParkingZone> {
    const [result] = await db.insert(parkingZones).values({ ...zone, tenantId }).returning();
    return result;
  }

  async getParkingZones(tenantId: string, activeOnly = true): Promise<ParkingZone[]> {
    const conditions = [eq(parkingZones.tenantId, tenantId)];
    if (activeOnly) conditions.push(eq(parkingZones.isActive, true));
    return db.select().from(parkingZones).where(and(...conditions)).orderBy(asc(parkingZones.name));
  }

  async getParkingZone(id: string, tenantId?: string): Promise<ParkingZone | undefined> {
    const conditions = [eq(parkingZones.id, id)];
    if (tenantId) conditions.push(eq(parkingZones.tenantId, tenantId));
    const [zone] = await db.select().from(parkingZones).where(and(...conditions));
    return zone;
  }

  async updateParkingZone(id: string, data: Partial<InsertParkingZone>, tenantId?: string): Promise<ParkingZone | undefined> {
    const conditions = [eq(parkingZones.id, id)];
    if (tenantId) conditions.push(eq(parkingZones.tenantId, tenantId));
    const [result] = await db
      .update(parkingZones)
      .set({ ...data, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return result;
  }

  async getZoneOccupancy(tenantId: string, zoneId: string): Promise<number> {
    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(parkingSessions)
      .where(and(eq(parkingSessions.tenantId, tenantId), eq(parkingSessions.zoneId, zoneId), isNull(parkingSessions.exitAt)));
    return result?.count || 0;
  }

  // Frequent Parkers
  async getOrCreateFrequentParker(tenantId: string, plateNormalized: string, plateDisplay: string): Promise<FrequentParker> {
    const existing = await this.getFrequentParker(tenantId, plateNormalized);
    if (existing) return existing;

    const [result] = await db.insert(frequentParkers).values({
      tenantId,
      plateNormalized,
      plateDisplay,
      visitCount: 1,
      lastVisitAt: new Date()
    }).returning();
    return result;
  }

  async getFrequentParker(tenantId: string, plateNormalized: string): Promise<FrequentParker | undefined> {
    const [parker] = await db.select().from(frequentParkers).where(and(eq(frequentParkers.tenantId, tenantId), eq(frequentParkers.plateNormalized, plateNormalized)));
    return parker;
  }

  async updateFrequentParker(id: string, data: Partial<InsertFrequentParker>, tenantId?: string): Promise<FrequentParker | undefined> {
    const conditions = [eq(frequentParkers.id, id)];
    if (tenantId) conditions.push(eq(frequentParkers.tenantId, tenantId));
    const [result] = await db
      .update(frequentParkers)
      .set({ ...data, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return result;
  }

  async getFrequentParkers(tenantId: string, filters?: { isVip?: boolean; hasMonthlyPass?: boolean }): Promise<FrequentParker[]> {
    const conditions = [eq(frequentParkers.tenantId, tenantId)];

    if (filters?.isVip !== undefined) {
      conditions.push(eq(frequentParkers.isVip, filters.isVip));
    }

    if (filters?.hasMonthlyPass) {
      conditions.push(gte(frequentParkers.monthlyPassExpiry, new Date()));
    }

    return db.select().from(frequentParkers).where(and(...conditions)).orderBy(desc(frequentParkers.visitCount));
  }

  async incrementParkerVisit(tenantId: string, plateNormalized: string, amountSpent = 0): Promise<FrequentParker | undefined> {
    const parker = await this.getFrequentParker(tenantId, plateNormalized);
    if (!parker) return undefined;

    const [result] = await db
      .update(frequentParkers)
      .set({
        visitCount: (parker.visitCount || 0) + 1,
        totalSpent: (parker.totalSpent || 0) + amountSpent,
        lastVisitAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(frequentParkers.id, parker.id))
      .returning();
    return result;
  }

  // Parking Reservations
  async createParkingReservation(tenantId: string, reservation: InsertParkingReservation): Promise<ParkingReservation> {
    const plateNormalized = reservation.plateDisplay ? normalizePlate(reservation.plateDisplay) : null;
    const [result] = await db
      .insert(parkingReservations)
      .values({ ...reservation, tenantId, plateNormalized })
      .returning();
    return result;
  }

  async getParkingReservations(tenantId: string, filters?: { status?: string; fromDate?: Date; toDate?: Date }): Promise<ParkingReservation[]> {
    const conditions = [eq(parkingReservations.tenantId, tenantId)];

    if (filters?.status) {
      conditions.push(eq(parkingReservations.status, filters.status));
    }

    if (filters?.fromDate) {
      conditions.push(gte(parkingReservations.reservedFrom, filters.fromDate));
    }

    if (filters?.toDate) {
      conditions.push(lte(parkingReservations.reservedUntil, filters.toDate));
    }

    return db.select().from(parkingReservations).where(and(...conditions)).orderBy(asc(parkingReservations.reservedFrom));
  }

  async getParkingReservation(id: string, tenantId?: string): Promise<ParkingReservation | undefined> {
    const conditions = [eq(parkingReservations.id, id)];
    if (tenantId) conditions.push(eq(parkingReservations.tenantId, tenantId));
    const [reservation] = await db.select().from(parkingReservations).where(and(...conditions));
    return reservation;
  }

  async getParkingReservationByCode(code: string, tenantId?: string): Promise<ParkingReservation | undefined> {
    const conditions = [eq(parkingReservations.confirmationCode, code)];
    if (tenantId) conditions.push(eq(parkingReservations.tenantId, tenantId));
    const [reservation] = await db.select().from(parkingReservations).where(and(...conditions));
    return reservation;
  }

  async updateParkingReservation(id: string, data: Partial<InsertParkingReservation>, tenantId?: string): Promise<ParkingReservation | undefined> {
    const conditions = [eq(parkingReservations.id, id)];
    if (tenantId) conditions.push(eq(parkingReservations.tenantId, tenantId));
    const [result] = await db
      .update(parkingReservations)
      .set({ ...data, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return result;
  }

  async checkInReservation(id: string, parkingSessionId: string, tenantId?: string): Promise<ParkingReservation | undefined> {
    const conditions = [eq(parkingReservations.id, id)];
    if (tenantId) conditions.push(eq(parkingReservations.tenantId, tenantId));
    const [result] = await db
      .update(parkingReservations)
      .set({ status: "checked_in", parkingSessionId, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return result;
  }

  // Parking Analytics
  async getParkingAnalytics(tenantId: string) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tf = eq(parkingSessions.tenantId, tenantId);

    // Active sessions count
    const [activeResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(parkingSessions)
      .where(and(tf, isNull(parkingSessions.exitAt)));

    // Get settings for capacity
    const settings = await this.getParkingSettings(tenantId);
    const totalCapacity = settings?.totalCapacity || 50;

    // Today's revenue (sum of calculated fees for closed sessions)
    const [revenueResult] = await db
      .select({ total: sql<number>`COALESCE(SUM(${parkingSessions.calculatedFee}), 0)::int` })
      .from(parkingSessions)
      .where(and(tf, gte(parkingSessions.exitAt, todayStart), sql`${parkingSessions.exitAt} IS NOT NULL`));

    // Today entries
    const [entriesResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(parkingSessions)
      .where(and(tf, gte(parkingSessions.entryAt, todayStart)));

    // Today exits
    const [exitsResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(parkingSessions)
      .where(and(tf, gte(parkingSessions.exitAt, todayStart), sql`${parkingSessions.exitAt} IS NOT NULL`));

    // Average duration for closed sessions today
    const [avgDurationResult] = await db
      .select({
        avgMinutes: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (${parkingSessions.exitAt} - ${parkingSessions.entryAt})) / 60)::int, 0)`
      })
      .from(parkingSessions)
      .where(and(tf, gte(parkingSessions.exitAt, todayStart), sql`${parkingSessions.exitAt} IS NOT NULL`));

    // Zone occupancy
    const zones = await this.getParkingZones(tenantId);
    const zoneOccupancy = await Promise.all(
      zones.map(async (zone) => {
        const occupied = await this.getZoneOccupancy(tenantId, zone.id);
        return {
          zoneId: zone.id,
          zoneName: zone.name,
          occupied,
          capacity: zone.capacity || 10
        };
      })
    );

    const totalActive = activeResult?.count || 0;

    return {
      totalActiveSessions: totalActive,
      totalCapacity,
      occupancyRate: totalCapacity > 0 ? Math.round((totalActive / totalCapacity) * 100) : 0,
      todayRevenue: revenueResult?.total || 0,
      todayEntries: entriesResult?.count || 0,
      todayExits: exitsResult?.count || 0,
      avgDurationMinutes: avgDurationResult?.avgMinutes || 0,
      zoneOccupancy
    };
  }

  // Event Logs
  async logEvent(tenantId: string, event: InsertEventLog): Promise<EventLog> {
    const [result] = await db.insert(eventLogs).values({ ...event, tenantId }).returning();
    return result;
  }

  async getEvents(tenantId: string, filters?: { plate?: string; type?: string; limit?: number }): Promise<EventLog[]> {
    let query = db.select().from(eventLogs);

    const conditions = [eq(eventLogs.tenantId, tenantId)];
    if (filters?.plate) {
      const normalized = normalizePlate(filters.plate);
      conditions.push(sql`${eventLogs.plateNormalized} ILIKE ${'%' + normalized + '%'}`);
    }
    if (filters?.type) {
      conditions.push(eq(eventLogs.type, filters.type));
    }

    query = query.where(and(...conditions)) as any;

    query = query.orderBy(desc(eventLogs.createdAt)) as any;

    if (filters?.limit) {
      query = query.limit(filters.limit) as any;
    }

    return query;
  }

  // Webhook Retries
  async createWebhookRetry(retry: InsertWebhookRetry): Promise<WebhookRetry> {
    const [result] = await db.insert(webhookRetries).values(retry).returning();
    return result;
  }

  async getPendingWebhookRetries(limit = 20): Promise<WebhookRetry[]> {
    return db
      .select()
      .from(webhookRetries)
      .where(
        and(
          lte(webhookRetries.nextRetryAt, new Date()),
          sql`${webhookRetries.attempts} < 10`
        )
      )
      .orderBy(asc(webhookRetries.nextRetryAt))
      .limit(limit);
  }

  async updateWebhookRetry(
    id: string,
    data: Partial<{ attempts: number; lastError: string | null; nextRetryAt: Date | null }>
  ): Promise<WebhookRetry | undefined> {
    const [result] = await db
      .update(webhookRetries)
      .set(data)
      .where(eq(webhookRetries.id, id))
      .returning();
    return result;
  }

  async deleteWebhookRetry(id: string): Promise<boolean> {
    const result = await db.delete(webhookRetries).where(eq(webhookRetries.id, id));
    return true;
  }

  async getWebhookRetries(limit = 50): Promise<WebhookRetry[]> {
    return db
      .select()
      .from(webhookRetries)
      .orderBy(desc(webhookRetries.createdAt))
      .limit(limit);
  }

  // Analytics
  async getAnalyticsSummary(tenantId: string) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const tf = eq(washJobs.tenantId, tenantId);

    // Count washes
    const [todayResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(washJobs)
      .where(and(tf, gte(washJobs.createdAt, todayStart)));

    const [weekResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(washJobs)
      .where(and(tf, gte(washJobs.createdAt, weekStart)));

    const [monthResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(washJobs)
      .where(and(tf, gte(washJobs.createdAt, monthStart)));

    // Average cycle time for completed jobs
    const [avgResult] = await db
      .select({
        avgMinutes: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (${washJobs.endAt} - ${washJobs.startAt})) / 60)::int, 0)`
      })
      .from(washJobs)
      .where(and(tf, eq(washJobs.status, "complete")));

    // Get completed jobs with stage timestamps for detailed KPIs
    const completedJobs = await db
      .select({ stageTimestamps: washJobs.stageTimestamps })
      .from(washJobs)
      .where(and(tf, eq(washJobs.status, "complete")));

    // Calculate average time per stage
    const stageTimeKPIs: Record<string, { avgSeconds: number; count: number }> = {};
    const stages = ["received", "high_pressure_wash", "foam_application", "rinse", "hand_dry_vacuum", "tyre_shine", "quality_check"];

    for (const job of completedJobs) {
      const timestamps = job.stageTimestamps as Record<string, string> | null;
      if (!timestamps) continue;

      // Only compute durations between stages that actually have timestamps (handles skipped steps)
      const presentStages = stages.filter(s => timestamps[s]);

      for (let i = 0; i < presentStages.length; i++) {
        const stage = presentStages[i];
        const nextStage = presentStages[i + 1] || (timestamps["complete"] ? "complete" : null);

        if (nextStage && timestamps[stage] && timestamps[nextStage]) {
          const duration = (new Date(timestamps[nextStage]).getTime() - new Date(timestamps[stage]).getTime()) / 1000;
          if (duration > 0) {
            if (!stageTimeKPIs[stage]) {
              stageTimeKPIs[stage] = { avgSeconds: 0, count: 0 };
            }
            stageTimeKPIs[stage].avgSeconds += duration;
            stageTimeKPIs[stage].count++;
          }
        }
      }
    }
    
    // Calculate averages
    const avgTimePerStage: Record<string, number> = {};
    for (const [stage, data] of Object.entries(stageTimeKPIs)) {
      if (data.count > 0) {
        avgTimePerStage[stage] = Math.round(data.avgSeconds / data.count);
      }
    }

    // Get technician stats
    const techStats = await db
      .select({
        technicianId: washJobs.technicianId,
        count: sql<number>`count(*)::int`
      })
      .from(washJobs)
      .where(and(tf, gte(washJobs.createdAt, monthStart)))
      .groupBy(washJobs.technicianId);

    return {
      todayWashes: todayResult?.count || 0,
      weekWashes: weekResult?.count || 0,
      monthWashes: monthResult?.count || 0,
      avgCycleTimeMinutes: avgResult?.avgMinutes || 0,
      avgTimePerStage,
      technicianStats: techStats.map(t => ({
        userId: t.technicianId,
        name: t.technicianId === "integration" ? "CRM Integration" : `Technician ${t.technicianId.slice(-4)}`,
        count: t.count
      }))
    };
  }

  async getRevenueSummary(tenantId: string) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastWeekStart = new Date(weekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const wf = eq(washJobs.tenantId, tenantId);
    const pf = eq(parkingSessions.tenantId, tenantId);

    // Wash revenue by period
    const [todayWash] = await db
      .select({ total: sql<number>`COALESCE(SUM(${washJobs.price}), 0)::int`, count: sql<number>`count(*)::int` })
      .from(washJobs).where(and(wf, gte(washJobs.createdAt, todayStart)));
    const [weekWash] = await db
      .select({ total: sql<number>`COALESCE(SUM(${washJobs.price}), 0)::int`, count: sql<number>`count(*)::int` })
      .from(washJobs).where(and(wf, gte(washJobs.createdAt, weekStart)));
    const [monthWash] = await db
      .select({ total: sql<number>`COALESCE(SUM(${washJobs.price}), 0)::int`, count: sql<number>`count(*)::int` })
      .from(washJobs).where(and(wf, gte(washJobs.createdAt, monthStart)));

    // Previous periods for comparison
    const [lastWeekWash] = await db
      .select({ total: sql<number>`COALESCE(SUM(${washJobs.price}), 0)::int` })
      .from(washJobs).where(and(wf, gte(washJobs.createdAt, lastWeekStart), lt(washJobs.createdAt, weekStart)));
    const [lastMonthWash] = await db
      .select({ total: sql<number>`COALESCE(SUM(${washJobs.price}), 0)::int` })
      .from(washJobs).where(and(wf, gte(washJobs.createdAt, lastMonthStart), lt(washJobs.createdAt, monthStart)));

    // Parking revenue by period
    const [todayParking] = await db
      .select({ total: sql<number>`COALESCE(SUM(${parkingSessions.calculatedFee}), 0)::int`, count: sql<number>`count(*)::int` })
      .from(parkingSessions).where(and(pf, gte(parkingSessions.exitAt, todayStart), isNotNull(parkingSessions.calculatedFee)));
    const [weekParking] = await db
      .select({ total: sql<number>`COALESCE(SUM(${parkingSessions.calculatedFee}), 0)::int` })
      .from(parkingSessions).where(and(pf, gte(parkingSessions.exitAt, weekStart), isNotNull(parkingSessions.calculatedFee)));
    const [monthParking] = await db
      .select({ total: sql<number>`COALESCE(SUM(${parkingSessions.calculatedFee}), 0)::int` })
      .from(parkingSessions).where(and(pf, gte(parkingSessions.exitAt, monthStart), isNotNull(parkingSessions.calculatedFee)));

    // Revenue by service package (this month)
    const byPackage = await db
      .select({
        packageName: washJobs.packageName,
        serviceCode: washJobs.serviceCode,
        total: sql<number>`COALESCE(SUM(${washJobs.price}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(washJobs)
      .where(and(wf, gte(washJobs.createdAt, monthStart), isNotNull(washJobs.price)))
      .groupBy(washJobs.packageName, washJobs.serviceCode);

    // Revenue by hour today
    const hourlyToday = await db
      .select({
        hour: sql<number>`EXTRACT(HOUR FROM ${washJobs.createdAt})::int`,
        total: sql<number>`COALESCE(SUM(${washJobs.price}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(washJobs)
      .where(and(wf, gte(washJobs.createdAt, todayStart)))
      .groupBy(sql`EXTRACT(HOUR FROM ${washJobs.createdAt})`);

    // Daily revenue trend (last 7 days)
    const dailyWash = await db
      .select({
        day: sql<string>`TO_CHAR(${washJobs.createdAt}, 'YYYY-MM-DD')`,
        revenue: sql<number>`COALESCE(SUM(${washJobs.price}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(washJobs)
      .where(and(wf, gte(washJobs.createdAt, weekStart)))
      .groupBy(sql`TO_CHAR(${washJobs.createdAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`TO_CHAR(${washJobs.createdAt}, 'YYYY-MM-DD')`);

    const dailyParking = await db
      .select({
        day: sql<string>`TO_CHAR(${parkingSessions.exitAt}, 'YYYY-MM-DD')`,
        revenue: sql<number>`COALESCE(SUM(${parkingSessions.calculatedFee}), 0)::int`,
      })
      .from(parkingSessions)
      .where(and(pf, gte(parkingSessions.exitAt, weekStart), isNotNull(parkingSessions.calculatedFee)))
      .groupBy(sql`TO_CHAR(${parkingSessions.exitAt}, 'YYYY-MM-DD')`);

    // Inventory COGS this month
    const [monthlyCOGS] = await db
      .select({ total: sql<number>`COALESCE(SUM(${inventoryConsumption.quantity} * ${inventoryConsumption.costAtTime} / 100), 0)::int` })
      .from(inventoryConsumption)
      .where(and(eq(inventoryConsumption.tenantId, tenantId), gte(inventoryConsumption.createdAt, monthStart)));

    // Merge daily trends
    const parkingMap = new Map(dailyParking.map((d) => [d.day, d.revenue]));
    const dailyTrend = dailyWash.map((d) => ({
      day: d.day,
      washRevenue: d.revenue,
      parkingRevenue: parkingMap.get(d.day) || 0,
      total: d.revenue + (parkingMap.get(d.day) || 0),
      washCount: d.count,
    }));

    return {
      today: { wash: todayWash.total, parking: todayParking.total, total: todayWash.total + todayParking.total, washCount: todayWash.count, parkingCount: todayParking.count },
      week: { wash: weekWash.total, parking: weekParking.total, total: weekWash.total + weekParking.total, washCount: weekWash.count },
      month: { wash: monthWash.total, parking: monthParking.total, total: monthWash.total + monthParking.total, washCount: monthWash.count, cogs: monthlyCOGS.total, grossProfit: monthWash.total + monthParking.total - monthlyCOGS.total },
      comparison: {
        weekVsLastWeek: lastWeekWash.total > 0 ? Math.round(((weekWash.total - lastWeekWash.total) / lastWeekWash.total) * 100) : null,
        monthVsLastMonth: lastMonthWash.total > 0 ? Math.round(((monthWash.total - lastMonthWash.total) / lastMonthWash.total) * 100) : null,
      },
      byPackage: byPackage.map((p) => ({ name: p.packageName || p.serviceCode || "Unknown", revenue: p.total, count: p.count })),
      hourlyToday: hourlyToday.map((h) => ({ hour: h.hour, revenue: h.total, count: h.count })),
      dailyTrend,
    };
  }

  async getCustomerInsights(tenantId: string) {
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sixtyDaysAgo = new Date(now);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const wf = eq(washJobs.tenantId, tenantId);

    // Total unique customers all time
    const [totalCustomers] = await db
      .select({ count: sql<number>`COUNT(DISTINCT ${washJobs.plateNormalized})::int` })
      .from(washJobs).where(wf);

    // New customers this month (first wash in last 30 days)
    const newCustomersResult = await db
      .select({ plate: washJobs.plateNormalized, firstVisit: sql<string>`MIN(${washJobs.createdAt})` })
      .from(washJobs).where(wf)
      .groupBy(washJobs.plateNormalized)
      .having(sql`MIN(${washJobs.createdAt}) >= ${thirtyDaysAgo}`);

    // Per-customer stats
    const customerStats = await db
      .select({
        plate: washJobs.plateNormalized,
        plateDisplay: sql<string>`MAX(${washJobs.plateDisplay})`,
        visitCount: sql<number>`COUNT(*)::int`,
        totalSpent: sql<number>`COALESCE(SUM(${washJobs.price}), 0)::int`,
        lastVisit: sql<string>`MAX(${washJobs.createdAt})`,
        firstVisit: sql<string>`MIN(${washJobs.createdAt})`,
      })
      .from(washJobs).where(wf)
      .groupBy(washJobs.plateNormalized);

    // Ratings per customer
    const ratingsResult = await db
      .select({
        plate: washJobs.plateNormalized,
        avgRating: sql<number>`COALESCE(AVG(${customerConfirmations.rating}), 0)::numeric(3,1)`,
        ratingCount: sql<number>`COUNT(${customerConfirmations.rating})::int`,
      })
      .from(customerConfirmations)
      .innerJoin(washJobs, eq(customerConfirmations.washJobId, washJobs.id))
      .where(and(isNotNull(customerConfirmations.rating), wf))
      .groupBy(washJobs.plateNormalized);
    const ratingsMap = new Map(ratingsResult.map((r) => [r.plate, { avgRating: Number(r.avgRating), count: r.ratingCount }]));

    // Parker data (names, VIP)
    const parkerData = await db
      .select({ plate: frequentParkers.plateNormalized, customerName: frequentParkers.customerName, isVip: frequentParkers.isVip })
      .from(frequentParkers).where(eq(frequentParkers.tenantId, tenantId));
    const parkerMap = new Map(parkerData.map((p) => [p.plate, p]));

    // Segment customers
    let oneTimers = 0, regulars = 0, vips = 0, churned = 0, activeThisMonth = 0;

    const enrichedCustomers = customerStats.map((c) => {
      const lastVisitDate = new Date(c.lastVisit);
      const daysSinceLastVisit = Math.floor((now.getTime() - lastVisitDate.getTime()) / (1000 * 60 * 60 * 24));
      const rating = ratingsMap.get(c.plate);
      const parker = parkerMap.get(c.plate);

      let segment: "one_timer" | "regular" | "vip" | "churned" = "one_timer";
      if (c.visitCount === 1) {
        if (daysSinceLastVisit > 60) { segment = "churned"; churned++; }
        else { segment = "one_timer"; oneTimers++; }
      } else if (parker?.isVip || c.totalSpent > 500000 || c.visitCount >= 10) {
        segment = "vip"; vips++;
      } else if (daysSinceLastVisit > 60) {
        segment = "churned"; churned++;
      } else {
        segment = "regular"; regulars++;
      }
      if (daysSinceLastVisit <= 30) activeThisMonth++;

      return {
        plate: c.plate, plateDisplay: c.plateDisplay, customerName: parker?.customerName || null,
        visitCount: c.visitCount, totalSpent: c.totalSpent,
        lastVisit: c.lastVisit, firstVisit: c.firstVisit, daysSinceLastVisit,
        avgRating: rating?.avgRating || null, ratingCount: rating?.count || 0,
        segment, isVip: parker?.isVip || false,
      };
    });

    // Retention rate: of customers active 30-60 days ago, how many came back in last 30 days
    const activeLastMonth = await db
      .select({ plate: washJobs.plateNormalized })
      .from(washJobs)
      .where(and(wf, gte(washJobs.createdAt, sixtyDaysAgo), lt(washJobs.createdAt, thirtyDaysAgo)))
      .groupBy(washJobs.plateNormalized);
    const activeNowPlates = new Set(enrichedCustomers.filter((c) => c.daysSinceLastVisit <= 30).map((c) => c.plate));
    const retained = activeLastMonth.filter((c) => activeNowPlates.has(c.plate)).length;
    const retentionRate = activeLastMonth.length > 0 ? Math.round((retained / activeLastMonth.length) * 100) : null;

    // Avg visit frequency (customers with 2+ visits)
    const multiVisitors = enrichedCustomers.filter((c) => c.visitCount >= 2);
    let avgFrequencyDays: number | null = null;
    if (multiVisitors.length > 0) {
      const totalSpan = multiVisitors.reduce((sum, c) => {
        const span = (new Date(c.lastVisit).getTime() - new Date(c.firstVisit).getTime()) / (1000 * 60 * 60 * 24);
        return sum + (span / (c.visitCount - 1));
      }, 0);
      avgFrequencyDays = Math.round(totalSpan / multiVisitors.length);
    }

    // Revenue split: new vs returning this month
    const newPlates = new Set(newCustomersResult.map((n) => n.plate));
    const monthWashes = await db
      .select({ plate: washJobs.plateNormalized, revenue: sql<number>`COALESCE(SUM(${washJobs.price}), 0)::int` })
      .from(washJobs).where(and(wf, gte(washJobs.createdAt, thirtyDaysAgo))).groupBy(washJobs.plateNormalized);
    let newCustomerRevenue = 0, returningCustomerRevenue = 0;
    for (const w of monthWashes) {
      if (newPlates.has(w.plate)) newCustomerRevenue += w.revenue;
      else returningCustomerRevenue += w.revenue;
    }

    return {
      totalCustomers: totalCustomers.count,
      newCustomers: newCustomersResult.length,
      activeThisMonth,
      retentionRate,
      avgFrequencyDays,
      segments: { oneTimers, regulars, vips, churned },
      topSpenders: [...enrichedCustomers].sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 10),
      topFrequent: [...enrichedCustomers].sort((a, b) => b.visitCount - a.visitCount).slice(0, 10),
      revenueByType: { newCustomerRevenue, returningCustomerRevenue },
      customers: enrichedCustomers,
    };
  }

  // Business Settings
  async getBusinessSettings(tenantId: string): Promise<BusinessSettings | undefined> {
    const [settings] = await db.select().from(businessSettings).where(eq(businessSettings.tenantId, tenantId)).limit(1);
    return settings;
  }

  async upsertBusinessSettings(tenantId: string, settings: InsertBusinessSettings): Promise<BusinessSettings> {
    const existing = await this.getBusinessSettings(tenantId);
    if (existing) {
      const [result] = await db
        .update(businessSettings)
        .set({ ...settings, updatedAt: new Date() })
        .where(eq(businessSettings.id, existing.id))
        .returning();
      return result;
    } else {
      const [result] = await db.insert(businessSettings).values({ ...settings, tenantId }).returning();
      return result;
    }
  }

  // Service Packages
  async createServicePackage(tenantId: string, pkg: InsertServicePackage): Promise<ServicePackage> {
    const insertData = {
      ...pkg,
      tenantId,
      services: pkg.services ? (pkg.services as string[]) : []
    };
    const [result] = await db.insert(servicePackages).values(insertData as any).returning();
    return result;
  }

  async getServicePackages(tenantId: string, activeOnly = true): Promise<ServicePackage[]> {
    const conditions = [eq(servicePackages.tenantId, tenantId)];
    if (activeOnly) conditions.push(eq(servicePackages.isActive, true));
    return db.select().from(servicePackages).where(and(...conditions)).orderBy(asc(servicePackages.sortOrder));
  }

  async getServicePackage(id: string, tenantId?: string): Promise<ServicePackage | undefined> {
    const conditions = [eq(servicePackages.id, id)];
    if (tenantId) conditions.push(eq(servicePackages.tenantId, tenantId));
    const [pkg] = await db.select().from(servicePackages).where(and(...conditions));
    return pkg;
  }

  async updateServicePackage(id: string, data: Partial<InsertServicePackage>, tenantId?: string): Promise<ServicePackage | undefined> {
    const updateData: any = { ...data, updatedAt: new Date() };
    if (data.services) {
      updateData.services = data.services as string[];
    }
    const conditions = [eq(servicePackages.id, id)];
    if (tenantId) conditions.push(eq(servicePackages.tenantId, tenantId));
    const [result] = await db
      .update(servicePackages)
      .set(updateData)
      .where(and(...conditions))
      .returning();
    return result;
  }

  // Customer Memberships
  async createCustomerMembership(tenantId: string, membership: InsertCustomerMembership): Promise<CustomerMembership> {
    const [result] = await db.insert(customerMemberships).values({ ...membership, tenantId }).returning();
    return result;
  }

  async getCustomerMemberships(tenantId: string, filters?: { status?: string; plateNormalized?: string }): Promise<CustomerMembership[]> {
    const conditions = [eq(customerMemberships.tenantId, tenantId)];

    if (filters?.status) {
      conditions.push(eq(customerMemberships.status, filters.status));
    }

    if (filters?.plateNormalized) {
      conditions.push(eq(customerMemberships.plateNormalized, filters.plateNormalized));
    }

    return db.select().from(customerMemberships).where(and(...conditions)).orderBy(desc(customerMemberships.createdAt));
  }

  async getCustomerMembership(id: string, tenantId?: string): Promise<CustomerMembership | undefined> {
    const conditions = [eq(customerMemberships.id, id)];
    if (tenantId) conditions.push(eq(customerMemberships.tenantId, tenantId));
    const [membership] = await db.select().from(customerMemberships).where(and(...conditions));
    return membership;
  }

  async getActiveMembershipForPlate(tenantId: string, plateNormalized: string): Promise<CustomerMembership | undefined> {
    const [membership] = await db
      .select()
      .from(customerMemberships)
      .where(and(
        eq(customerMemberships.tenantId, tenantId),
        eq(customerMemberships.plateNormalized, plateNormalized),
        eq(customerMemberships.status, "active"),
        gte(customerMemberships.expiryDate, new Date())
      ));
    return membership;
  }

  async updateCustomerMembership(id: string, data: Partial<InsertCustomerMembership>, tenantId?: string): Promise<CustomerMembership | undefined> {
    const conditions: any[] = [eq(customerMemberships.id, id)];
    if (tenantId) conditions.push(eq(customerMemberships.tenantId, tenantId));
    const [result] = await db
      .update(customerMemberships)
      .set({ ...data, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return result;
  }

  async incrementMembershipWashUsed(id: string, tenantId?: string): Promise<CustomerMembership | undefined> {
    const membership = await this.getCustomerMembership(id, tenantId);
    if (!membership) return undefined;

    const conditions: any[] = [eq(customerMemberships.id, id)];
    if (tenantId) conditions.push(eq(customerMemberships.tenantId, tenantId));
    const [result] = await db
      .update(customerMemberships)
      .set({
        washesUsed: (membership.washesUsed || 0) + 1,
        updatedAt: new Date()
      })
      .where(and(...conditions))
      .returning();
    return result;
  }

  // Parking Validations
  async createParkingValidation(tenantId: string, validation: InsertParkingValidation): Promise<ParkingValidation> {
    const [result] = await db.insert(parkingValidations).values({ ...validation, tenantId }).returning();
    return result;
  }

  async getParkingValidations(tenantId: string, parkingSessionId: string): Promise<ParkingValidation[]> {
    return db.select().from(parkingValidations).where(and(eq(parkingValidations.tenantId, tenantId), eq(parkingValidations.parkingSessionId, parkingSessionId)));
  }

  // Customer Notifications
  async createNotification(tenantId: string, notification: InsertCustomerNotification): Promise<CustomerNotification> {
    const [result] = await db.insert(customerNotifications).values({ ...notification, tenantId }).returning();
    return result;
  }

  async getNotifications(tenantId: string, filters?: { status?: string; type?: string; customerPhone?: string; limit?: number }): Promise<CustomerNotification[]> {
    const conditions: any[] = [eq(customerNotifications.tenantId, tenantId)];

    if (filters?.status) {
      conditions.push(eq(customerNotifications.status, filters.status));
    }
    if (filters?.type) {
      conditions.push(eq(customerNotifications.type, filters.type));
    }
    if (filters?.customerPhone) {
      conditions.push(eq(customerNotifications.customerPhone, filters.customerPhone));
    }

    let query = db.select().from(customerNotifications);
    query = query.where(and(...conditions)) as any;
    query = query.orderBy(desc(customerNotifications.createdAt)) as any;

    if (filters?.limit) {
      query = query.limit(filters.limit) as any;
    }

    return query;
  }

  async getNotification(id: string, tenantId?: string): Promise<CustomerNotification | undefined> {
    const conditions: any[] = [eq(customerNotifications.id, id)];
    if (tenantId) conditions.push(eq(customerNotifications.tenantId, tenantId));
    const [notification] = await db.select().from(customerNotifications).where(and(...conditions));
    return notification;
  }

  async updateNotificationStatus(id: string, status: string, externalId?: string, failureReason?: string): Promise<CustomerNotification | undefined> {
    const updateData: any = {
      status,
      updatedAt: new Date()
    };

    if (status === "sent") {
      updateData.sentAt = new Date();
    } else if (status === "failed") {
      updateData.failedAt = new Date();
      if (failureReason) updateData.failureReason = failureReason;
    }
    if (externalId) updateData.externalId = externalId;

    const [result] = await db
      .update(customerNotifications)
      .set(updateData)
      .where(eq(customerNotifications.id, id))
      .returning();
    return result;
  }

  async getPendingNotifications(limit = 50): Promise<CustomerNotification[]> {
    return db
      .select()
      .from(customerNotifications)
      .where(and(
        eq(customerNotifications.status, "pending"),
        or(
          isNull(customerNotifications.scheduledFor),
          lte(customerNotifications.scheduledFor, new Date())
        )
      ))
      .orderBy(asc(customerNotifications.createdAt))
      .limit(limit);
  }

  // Notification Templates
  async createNotificationTemplate(tenantId: string, template: InsertNotificationTemplate): Promise<NotificationTemplate> {
    const [result] = await db.insert(notificationTemplates).values({ ...template, tenantId }).returning();
    return result;
  }

  async getNotificationTemplates(tenantId: string, activeOnly = true): Promise<NotificationTemplate[]> {
    const conditions: any[] = [eq(notificationTemplates.tenantId, tenantId)];
    if (activeOnly) {
      conditions.push(eq(notificationTemplates.isActive, true));
    }
    return db.select().from(notificationTemplates).where(and(...conditions));
  }

  async getNotificationTemplate(tenantId: string, code: string): Promise<NotificationTemplate | undefined> {
    const [template] = await db.select().from(notificationTemplates).where(and(eq(notificationTemplates.tenantId, tenantId), eq(notificationTemplates.code, code)));
    return template;
  }

  async updateNotificationTemplate(id: string, data: Partial<InsertNotificationTemplate>, tenantId?: string): Promise<NotificationTemplate | undefined> {
    const conditions: any[] = [eq(notificationTemplates.id, id)];
    if (tenantId) conditions.push(eq(notificationTemplates.tenantId, tenantId));
    const [result] = await db
      .update(notificationTemplates)
      .set({ ...data, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return result;
  }

  // Membership lookup by plate (for CRM integration)
  async findMembershipByPlate(tenantId: string, plateNormalized: string): Promise<CustomerMembership | undefined> {
    const [membership] = await db
      .select()
      .from(customerMemberships)
      .where(and(
        eq(customerMemberships.tenantId, tenantId),
        eq(customerMemberships.plateNormalized, plateNormalized),
        eq(customerMemberships.status, "active"),
        gte(customerMemberships.expiryDate, new Date())
      ));
    return membership;
  }

  async findMembershipByPhone(tenantId: string, phone: string): Promise<CustomerMembership | undefined> {
    const [membership] = await db
      .select()
      .from(customerMemberships)
      .where(and(
        eq(customerMemberships.tenantId, tenantId),
        eq(customerMemberships.customerPhone, phone),
        eq(customerMemberships.status, "active"),
        gte(customerMemberships.expiryDate, new Date())
      ));
    return membership;
  }

  // ==========================================
  // Technician Time Logs
  // ==========================================

  async clockIn(tenantId: string, technicianId: string, notes?: string): Promise<TechnicianTimeLog> {
    const [log] = await db.insert(technicianTimeLogs).values({
      tenantId,
      technicianId,
      clockInAt: new Date(),
      notes: notes || null,
      breakLogs: [],
    }).returning();
    return log;
  }

  async clockOut(logId: string, tenantId?: string): Promise<TechnicianTimeLog | undefined> {
    const conditions: any[] = [eq(technicianTimeLogs.id, logId)];
    if (tenantId) conditions.push(eq(technicianTimeLogs.tenantId, tenantId));
    const [existing] = await db.select().from(technicianTimeLogs).where(and(...conditions));
    if (!existing || existing.clockOutAt) return undefined;

    const clockOut = new Date();
    const totalMs = clockOut.getTime() - existing.clockInAt.getTime();
    const breakMinutes = (existing.breakLogs || []).reduce((acc: number, b: any) => {
      return acc + (b.durationMinutes || 0);
    }, 0);
    const totalMinutes = Math.floor(totalMs / 60000) - breakMinutes;

    const [updated] = await db.update(technicianTimeLogs)
      .set({ clockOutAt: clockOut, totalMinutes: Math.max(0, totalMinutes), updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  }

  async getActiveTimeLog(tenantId: string, technicianId: string): Promise<TechnicianTimeLog | undefined> {
    const [log] = await db.select().from(technicianTimeLogs)
      .where(and(eq(technicianTimeLogs.tenantId, tenantId), eq(technicianTimeLogs.technicianId, technicianId), isNull(technicianTimeLogs.clockOutAt)))
      .orderBy(desc(technicianTimeLogs.clockInAt))
      .limit(1);
    return log;
  }

  async getTimeLogs(tenantId: string, filters?: { technicianId?: string; fromDate?: Date; toDate?: Date; limit?: number }): Promise<TechnicianTimeLog[]> {
    const conditions: any[] = [eq(technicianTimeLogs.tenantId, tenantId)];
    if (filters?.technicianId) conditions.push(eq(technicianTimeLogs.technicianId, filters.technicianId));
    if (filters?.fromDate) conditions.push(gte(technicianTimeLogs.clockInAt, filters.fromDate));
    if (filters?.toDate) conditions.push(lte(technicianTimeLogs.clockInAt, filters.toDate));

    let query = db.select().from(technicianTimeLogs);
    query = query.where(and(...conditions)) as any;
    query = query.orderBy(desc(technicianTimeLogs.clockInAt)) as any;
    if (filters?.limit) query = query.limit(filters.limit) as any;
    return query;
  }

  async addBreakLog(logId: string, breakEntry: { type: "lunch" | "short" | "absent"; notes?: string }, tenantId?: string): Promise<TechnicianTimeLog | undefined> {
    const conditions: any[] = [eq(technicianTimeLogs.id, logId)];
    if (tenantId) conditions.push(eq(technicianTimeLogs.tenantId, tenantId));
    const [existing] = await db.select().from(technicianTimeLogs).where(and(...conditions));
    if (!existing) return undefined;

    const updatedBreaks = [...(existing.breakLogs || []), { ...breakEntry, startAt: new Date().toISOString() }];
    const [updated] = await db.update(technicianTimeLogs)
      .set({ breakLogs: updatedBreaks, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  }

  async endBreakLog(logId: string, tenantId?: string): Promise<TechnicianTimeLog | undefined> {
    const conditions: any[] = [eq(technicianTimeLogs.id, logId)];
    if (tenantId) conditions.push(eq(technicianTimeLogs.tenantId, tenantId));
    const [existing] = await db.select().from(technicianTimeLogs).where(and(...conditions));
    if (!existing) return undefined;

    const breaks = [...(existing.breakLogs || [])];
    const lastBreak = breaks[breaks.length - 1];
    if (!lastBreak || lastBreak.endAt) return existing;

    const endAt = new Date().toISOString();
    const durationMinutes = Math.floor((new Date(endAt).getTime() - new Date(lastBreak.startAt).getTime()) / 60000);
    breaks[breaks.length - 1] = { ...lastBreak, endAt, durationMinutes };

    const [updated] = await db.update(technicianTimeLogs)
      .set({ breakLogs: breaks, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  }

  // ==========================================
  // Staff Alerts (running late, absent, etc.)
  // ==========================================

  async createStaffAlert(tenantId: string, data: {
    technicianId: string;
    type: "running_late" | "absent" | "emergency" | "other";
    message?: string;
    estimatedArrival?: string;
  }): Promise<StaffAlert> {
    const [alert] = await db.insert(staffAlerts).values({
      tenantId,
      technicianId: data.technicianId,
      type: data.type,
      message: data.message || null,
      estimatedArrival: data.estimatedArrival || null,
      acknowledged: false,
    }).returning();
    return alert;
  }

  async getStaffAlerts(tenantId: string, filters?: { unacknowledgedOnly?: boolean; technicianId?: string }): Promise<StaffAlert[]> {
    const conditions: any[] = [eq(staffAlerts.tenantId, tenantId)];
    if (filters?.unacknowledgedOnly) conditions.push(eq(staffAlerts.acknowledged, false));
    if (filters?.technicianId) conditions.push(eq(staffAlerts.technicianId, filters.technicianId));

    let query: any = db.select().from(staffAlerts);
    query = query.where(and(...conditions));
    query = query.orderBy(desc(staffAlerts.createdAt));
    return await query;
  }

  async acknowledgeStaffAlert(alertId: string, acknowledgedBy: string, tenantId?: string): Promise<StaffAlert | undefined> {
    const conditions: any[] = [eq(staffAlerts.id, alertId)];
    if (tenantId) conditions.push(eq(staffAlerts.tenantId, tenantId));
    const [updated] = await db.update(staffAlerts)
      .set({ acknowledged: true, acknowledgedBy, acknowledgedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  }

  // Staff Messages
  async createStaffMessage(tenantId: string, data: { senderId: string; senderName?: string; senderRole?: string; recipientId?: string; message: string; branchId?: string }): Promise<StaffMessage> {
    const [result] = await db.insert(staffMessages).values({ tenantId, ...data }).returning();
    return result;
  }

  async getStaffMessages(tenantId: string, filters?: { userId?: string; unreadOnly?: boolean; limit?: number }): Promise<StaffMessage[]> {
    const conditions: any[] = [eq(staffMessages.tenantId, tenantId)];
    if (filters?.unreadOnly) conditions.push(eq(staffMessages.isRead, false));
    if (filters?.userId) {
      // User sees messages sent to them or broadcast (null recipient) or sent by them
      conditions.push(
        sql`(${staffMessages.recipientId} = ${filters.userId} OR ${staffMessages.recipientId} IS NULL OR ${staffMessages.senderId} = ${filters.userId})`
      );
    }
    const query = db.select().from(staffMessages).where(and(...conditions)).orderBy(desc(staffMessages.createdAt));
    if (filters?.limit) return (query as any).limit(filters.limit);
    return query;
  }

  async markStaffMessageRead(id: string, tenantId?: string): Promise<StaffMessage | undefined> {
    const conditions: any[] = [eq(staffMessages.id, id)];
    if (tenantId) conditions.push(eq(staffMessages.tenantId, tenantId));
    const [updated] = await db.update(staffMessages)
      .set({ isRead: true, readAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  }

  async getUnreadStaffMessageCount(tenantId: string, userId: string): Promise<number> {
    const [result] = await db.select({ count: sql<number>`count(*)` })
      .from(staffMessages)
      .where(and(
        eq(staffMessages.tenantId, tenantId),
        eq(staffMessages.isRead, false),
        sql`(${staffMessages.recipientId} = ${userId} OR ${staffMessages.recipientId} IS NULL)`,
        sql`${staffMessages.senderId} != ${userId}`,
      ));
    return Number(result?.count ?? 0);
  }

  async findMembershipByEmail(tenantId: string, email: string): Promise<CustomerMembership | undefined> {
    const [membership] = await db
      .select()
      .from(customerMemberships)
      .where(and(
        eq(customerMemberships.tenantId, tenantId),
        eq(customerMemberships.customerEmail, email),
        eq(customerMemberships.status, "active"),
        gte(customerMemberships.expiryDate, new Date())
      ));
    return membership;
  }

  // ==========================================
  // Loyalty Accounts (local — replaces CRM loyalty)
  // ==========================================

  async getLoyaltyAccountByPlate(tenantId: string, plateNormalized: string): Promise<LoyaltyAccount | undefined> {
    const [result] = await db.select().from(loyaltyAccounts).where(and(
      eq(loyaltyAccounts.tenantId, tenantId),
      eq(loyaltyAccounts.plateNormalized, plateNormalized)
    ));
    return result;
  }

  async getLoyaltyAccountByPhone(tenantId: string, phone: string): Promise<LoyaltyAccount | undefined> {
    const [result] = await db.select().from(loyaltyAccounts).where(and(
      eq(loyaltyAccounts.tenantId, tenantId),
      eq(loyaltyAccounts.customerPhone, phone)
    ));
    return result;
  }

  async getLoyaltyTransactionsByAccount(tenantId: string, loyaltyAccountId: string, limit = 30): Promise<LoyaltyTransaction[]> {
    return db.select().from(loyaltyTransactions).where(and(
      eq(loyaltyTransactions.tenantId, tenantId),
      eq(loyaltyTransactions.loyaltyAccountId, loyaltyAccountId)
    )).orderBy(desc(loyaltyTransactions.createdAt)).limit(limit);
  }

  async getOrCreateLoyaltyAccount(tenantId: string, plateNormalized: string, plateDisplay: string, customerData?: { name?: string; phone?: string; email?: string }): Promise<LoyaltyAccount> {
    // Check if account already exists
    const existing = await this.getLoyaltyAccountByPlate(tenantId, plateNormalized);
    if (existing) {
      // If account is anonymous and CRM data is now available, backfill name/phone/email
      if (existing.customerName === null && customerData?.name) {
        const [updated] = await db.update(loyaltyAccounts).set({
          customerName: customerData.name,
          customerPhone: customerData.phone || existing.customerPhone,
          customerEmail: customerData.email || existing.customerEmail,
          updatedAt: new Date(),
        } as any).where(eq(loyaltyAccounts.id, existing.id)).returning();
        return updated ?? existing;
      }
      return existing;
    }

    // Generate a membership number
    const memberNumber = `LYL-${Date.now().toString(36).toUpperCase()}`;

    const [account] = await db.insert(loyaltyAccounts).values({
      tenantId,
      plateNormalized,
      plateDisplay,
      customerName: customerData?.name || null,
      customerPhone: customerData?.phone || null,
      customerEmail: customerData?.email || null,
      membershipNumber: memberNumber,
      tier: "basic",
      pointsBalance: 0,
      lifetimePoints: 0,
      totalWashes: 0,
    } as any).returning();
    return account;
  }

  async creditLoyaltyPoints(tenantId: string, accountId: string, points: number): Promise<LoyaltyAccount | undefined> {
    const [result] = await db.update(loyaltyAccounts).set({
      pointsBalance: sql`${loyaltyAccounts.pointsBalance} + ${points}`,
      lifetimePoints: sql`${loyaltyAccounts.lifetimePoints} + ${points}`,
      totalWashes: sql`${loyaltyAccounts.totalWashes} + 1`,
      updatedAt: new Date(),
    } as any).where(and(
      eq(loyaltyAccounts.id, accountId),
      eq(loyaltyAccounts.tenantId, tenantId)
    )).returning();
    return result;
  }

  async deductLoyaltyPoints(tenantId: string, accountId: string, points: number): Promise<LoyaltyAccount | undefined> {
    const [result] = await db.update(loyaltyAccounts).set({
      pointsBalance: sql`GREATEST(0, ${loyaltyAccounts.pointsBalance} - ${points})`,
      updatedAt: new Date(),
    } as any).where(and(
      eq(loyaltyAccounts.id, accountId),
      eq(loyaltyAccounts.tenantId, tenantId)
    )).returning();
    return result;
  }

  async getLoyaltyAnalytics(tenantId: string): Promise<{
    totalAccounts: number;
    totalPointsIssued: number;
    pointsIssuedToday: number;
    topEarners: { plateDisplay: string; customerName: string | null; pointsBalance: number; totalWashes: number }[];
  }> {
    const tf = eq(loyaltyAccounts.tenantId, tenantId);

    const [accountCount] = await db.select({ count: sql<number>`count(*)::int` }).from(loyaltyAccounts).where(tf);
    const [pointsSum] = await db.select({ total: sql<number>`COALESCE(SUM(${loyaltyAccounts.lifetimePoints}), 0)::int` }).from(loyaltyAccounts).where(tf);

    // Points issued today from transactions
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [todayPoints] = await db.select({
      total: sql<number>`COALESCE(SUM(${loyaltyTransactions.points}), 0)::int`
    }).from(loyaltyTransactions).where(and(
      eq(loyaltyTransactions.tenantId, tenantId),
      gte(loyaltyTransactions.createdAt, todayStart),
      sql`${loyaltyTransactions.points} > 0`
    ));

    // Top earners
    const topEarners = await db.select({
      plateDisplay: loyaltyAccounts.plateDisplay,
      customerName: loyaltyAccounts.customerName,
      pointsBalance: loyaltyAccounts.pointsBalance,
      totalWashes: loyaltyAccounts.totalWashes,
    }).from(loyaltyAccounts).where(tf).orderBy(desc(loyaltyAccounts.lifetimePoints)).limit(10);

    return {
      totalAccounts: accountCount?.count || 0,
      totalPointsIssued: pointsSum?.total || 0,
      pointsIssuedToday: todayPoints?.total || 0,
      topEarners: topEarners.map(e => ({
        plateDisplay: e.plateDisplay,
        customerName: e.customerName,
        pointsBalance: e.pointsBalance || 0,
        totalWashes: e.totalWashes || 0,
      })),
    };
  }

  // ==========================================
  // Loyalty Transactions (local audit log)
  // ==========================================

  async getLoyaltyTransactions(tenantId: string, filters?: {
    type?: string;
    limit?: number;
  }): Promise<LoyaltyTransaction[]> {
    const conditions: any[] = [eq(loyaltyTransactions.tenantId, tenantId)];
    if (filters?.type) {
      conditions.push(eq(loyaltyTransactions.type, filters.type as any));
    }

    let query = db.select().from(loyaltyTransactions);
    query = query.where(and(...conditions)) as any;
    query = (query as any).orderBy(desc(loyaltyTransactions.createdAt));
    if (filters?.limit) {
      query = (query as any).limit(filters.limit);
    }
    return query;
  }

  async logLoyaltyTransaction(tenantId: string, data: {
    crmUserId: string;
    memberNumber: string;
    type: "earn_wash" | "earn_bonus" | "redeem" | "expire" | "adjust";
    points: number;
    balanceAfter: number;
    washJobId?: string;
    serviceCode?: string;
    description?: string;
    createdBy?: string;
  }): Promise<LoyaltyTransaction> {
    const [transaction] = await db.insert(loyaltyTransactions).values({
      tenantId,
      loyaltyAccountId: data.crmUserId,
      type: data.type,
      points: data.points,
      balanceAfter: data.balanceAfter,
      washJobId: data.washJobId || null,
      serviceCode: data.serviceCode || null,
      description: data.description || null,
      createdBy: data.createdBy || null,
    }).returning();
    return transaction;
  }
  // ==========================================
  // Loyalty Vouchers
  // ==========================================

  async issueVoucher(tenantId: string, data: {
    loyaltyAccountId: string;
    forPackageCode?: string;
    forServiceCode?: string;
    branchId?: string;
  }): Promise<LoyaltyVoucher> {
    // Generate a short unique code: VCH-XXXXX
    const code = `VCH-${Date.now().toString(36).toUpperCase().slice(-5)}${Math.random().toString(36).toUpperCase().slice(2, 4)}`;
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    const [voucher] = await db.insert(loyaltyVouchers).values({
      tenantId,
      branchId: data.branchId || null,
      loyaltyAccountId: data.loyaltyAccountId,
      code,
      pointsRedeemed: 1000,
      forPackageCode: data.forPackageCode || null,
      forServiceCode: data.forServiceCode || null,
      status: "active",
      issuedAt: new Date(),
      expiresAt,
    } as any).returning();
    return voucher;
  }

  async getActiveVouchersForAccount(tenantId: string, loyaltyAccountId: string): Promise<LoyaltyVoucher[]> {
    const now = new Date();
    return db.select().from(loyaltyVouchers).where(and(
      eq(loyaltyVouchers.tenantId, tenantId),
      eq(loyaltyVouchers.loyaltyAccountId, loyaltyAccountId),
      eq(loyaltyVouchers.status, "active"),
      sql`${loyaltyVouchers.expiresAt} > ${now}`,
    )).orderBy(asc(loyaltyVouchers.issuedAt));
  }

  async getVouchersForAccount(tenantId: string, loyaltyAccountId: string): Promise<LoyaltyVoucher[]> {
    return db.select().from(loyaltyVouchers).where(and(
      eq(loyaltyVouchers.tenantId, tenantId),
      eq(loyaltyVouchers.loyaltyAccountId, loyaltyAccountId),
    )).orderBy(desc(loyaltyVouchers.issuedAt));
  }

  async getVoucherByCode(tenantId: string, code: string): Promise<LoyaltyVoucher | undefined> {
    const [result] = await db.select().from(loyaltyVouchers).where(and(
      eq(loyaltyVouchers.tenantId, tenantId),
      eq(loyaltyVouchers.code, code.toUpperCase()),
    ));
    return result;
  }

  async redeemVoucher(tenantId: string, code: string, staffId: string, washJobId?: string): Promise<LoyaltyVoucher> {
    const voucher = await this.getVoucherByCode(tenantId, code);
    if (!voucher) throw new Error("Voucher not found");
    if (voucher.status !== "active") throw new Error(`Voucher is already ${voucher.status}`);
    const now = new Date();
    if (voucher.expiresAt && voucher.expiresAt < now) {
      await db.update(loyaltyVouchers).set({ status: "expired", updatedAt: now } as any)
        .where(eq(loyaltyVouchers.id, voucher.id));
      throw new Error("Voucher has expired");
    }

    const [updated] = await db.update(loyaltyVouchers).set({
      status: "used",
      usedAt: now,
      usedInWashJobId: washJobId || null,
      usedByStaffId: staffId,
      updatedAt: now,
    } as any).where(eq(loyaltyVouchers.id, voucher.id)).returning();
    return updated;
  }

  async expireStaleVouchers(tenantId: string): Promise<number> {
    const now = new Date();
    const result = await db.update(loyaltyVouchers).set({ status: "expired", updatedAt: now } as any).where(and(
      eq(loyaltyVouchers.tenantId, tenantId),
      eq(loyaltyVouchers.status, "active"),
      sql`${loyaltyVouchers.expiresAt} <= ${now}`,
    )).returning();
    return result.length;
  }

  // ==========================================
  // Technician Performance (ratings aggregation)
  // ==========================================

  async getTechnicianPerformance(tenantId: string): Promise<{
    technicianId: string;
    technicianName: string;
    avgRating: number;
    totalRatings: number;
    issueCount: number;
    issuePercent: number;
    recentFeedback: { rating: number | null; notes: string | null; issueReported: string | null; createdAt: Date | null; plateDisplay: string }[];
  }[]> {
    // Get all confirmations joined with wash jobs for this tenant
    const results = await db
      .select({
        technicianId: washJobs.technicianId,
        rating: customerConfirmations.rating,
        notes: customerConfirmations.notes,
        issueReported: customerConfirmations.issueReported,
        createdAt: customerConfirmations.createdAt,
        plateDisplay: washJobs.plateDisplay,
      })
      .from(customerConfirmations)
      .innerJoin(washJobs, eq(customerConfirmations.washJobId, washJobs.id))
      .where(and(eq(washJobs.tenantId, tenantId), sql`${washJobs.technicianId} IS NOT NULL`))
      .orderBy(desc(customerConfirmations.createdAt));

    // Group by technician
    const techMap = new Map<string, {
      ratings: number[];
      issues: number;
      total: number;
      feedback: { rating: number | null; notes: string | null; issueReported: string | null; createdAt: Date | null; plateDisplay: string }[];
    }>();

    for (const row of results) {
      const techId = row.technicianId!;
      if (!techMap.has(techId)) {
        techMap.set(techId, { ratings: [], issues: 0, total: 0, feedback: [] });
      }
      const entry = techMap.get(techId)!;
      entry.total++;
      if (row.rating) entry.ratings.push(row.rating);
      if (row.issueReported) entry.issues++;
      if (entry.feedback.length < 10) {
        entry.feedback.push({
          rating: row.rating,
          notes: row.notes,
          issueReported: row.issueReported,
          createdAt: row.createdAt,
          plateDisplay: row.plateDisplay,
        });
      }
    }

    // Enrich with user names
    const techIds = Array.from(techMap.keys());
    const userResults = techIds.length > 0
      ? await db.select().from(users).where(sql`${users.id} IN (${sql.join(techIds.map(id => sql`${id}`), sql`, `)})`)
      : [];
    const nameMap = new Map(userResults.map(u => [u.id, [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || u.id]));

    return techIds.map(techId => {
      const entry = techMap.get(techId)!;
      const avgRating = entry.ratings.length > 0
        ? Math.round((entry.ratings.reduce((a, b) => a + b, 0) / entry.ratings.length) * 10) / 10
        : 0;
      return {
        technicianId: techId,
        technicianName: nameMap.get(techId) || techId,
        avgRating,
        totalRatings: entry.ratings.length,
        issueCount: entry.issues,
        issuePercent: entry.total > 0 ? Math.round((entry.issues / entry.total) * 100) : 0,
        recentFeedback: entry.feedback,
      };
    }).sort((a, b) => b.totalRatings - a.totalRatings);
  }

  // ==========================================
  // Push Subscriptions
  // ==========================================

  async savePushSubscription(tenantId: string, sub: InsertPushSubscription): Promise<PushSubscription> {
    // Upsert by endpoint
    const [result] = await db
      .insert(pushSubscriptions)
      .values({ ...sub, tenantId })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          p256dh: sub.p256dh,
          auth: sub.auth,
          userId: sub.userId,
          customerToken: sub.customerToken,
        },
      })
      .returning();
    return result;
  }

  async getPushSubscriptionsByUser(tenantId: string, userId: string): Promise<PushSubscription[]> {
    return db.select().from(pushSubscriptions).where(and(eq(pushSubscriptions.tenantId, tenantId), eq(pushSubscriptions.userId, userId)));
  }

  async getPushSubscriptionsByCustomerToken(customerToken: string): Promise<PushSubscription[]> {
    return db.select().from(pushSubscriptions).where(eq(pushSubscriptions.customerToken, customerToken));
  }

  async getPushSubscriptionsByRole(tenantId: string, role: string): Promise<PushSubscription[]> {
    const results = await db
      .select({ subscription: pushSubscriptions })
      .from(pushSubscriptions)
      .innerJoin(userRoles, eq(pushSubscriptions.userId, userRoles.userId))
      .where(and(eq(pushSubscriptions.tenantId, tenantId), eq(userRoles.role, role as any)));
    return results.map((r) => r.subscription);
  }

  async deletePushSubscription(id: string): Promise<void> {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
  }

  // ─── Suppliers ────────────────────────────────────────────────────────

  async createSupplier(tenantId: string, supplier: InsertSupplier): Promise<Supplier> {
    const [result] = await db.insert(suppliers).values({ ...supplier, tenantId }).returning();
    return result;
  }

  async getSuppliers(tenantId: string, activeOnly?: boolean): Promise<Supplier[]> {
    const conditions: any[] = [eq(suppliers.tenantId, tenantId)];
    if (activeOnly) conditions.push(eq(suppliers.isActive, true));
    return db.select().from(suppliers).where(and(...conditions)).orderBy(asc(suppliers.name));
  }

  async getSupplier(id: string, tenantId?: string): Promise<Supplier | undefined> {
    const conditions: any[] = [eq(suppliers.id, id)];
    if (tenantId) conditions.push(eq(suppliers.tenantId, tenantId));
    const [result] = await db.select().from(suppliers).where(and(...conditions));
    return result;
  }

  async updateSupplier(id: string, data: Partial<InsertSupplier>, tenantId?: string): Promise<Supplier | undefined> {
    const conditions: any[] = [eq(suppliers.id, id)];
    if (tenantId) conditions.push(eq(suppliers.tenantId, tenantId));
    const [result] = await db.update(suppliers).set({ ...data, updatedAt: new Date() }).where(and(...conditions)).returning();
    return result;
  }

  // ─── Inventory Items ──────────────────────────────────────────────────

  async createInventoryItem(tenantId: string, item: InsertInventoryItem): Promise<InventoryItem> {
    const [result] = await db.insert(inventoryItems).values({ ...item, tenantId }).returning();
    return result;
  }

  async getInventoryItems(tenantId: string, filters?: { category?: string; lowStock?: boolean; active?: boolean }): Promise<InventoryItem[]> {
    const conditions: any[] = [eq(inventoryItems.tenantId, tenantId)];
    if (filters?.category) conditions.push(eq(inventoryItems.category, filters.category as any));
    if (filters?.active !== undefined) conditions.push(eq(inventoryItems.isActive, filters.active));
    if (filters?.lowStock) {
      conditions.push(sql`${inventoryItems.currentStock} <= ${inventoryItems.minimumStock}`);
    }
    return db.select().from(inventoryItems).where(and(...conditions)).orderBy(asc(inventoryItems.name));
  }

  async getInventoryItem(id: string, tenantId?: string): Promise<InventoryItem | undefined> {
    const conditions: any[] = [eq(inventoryItems.id, id)];
    if (tenantId) conditions.push(eq(inventoryItems.tenantId, tenantId));
    const [result] = await db.select().from(inventoryItems).where(and(...conditions));
    return result;
  }

  async updateInventoryItem(id: string, data: Partial<InsertInventoryItem>, tenantId?: string): Promise<InventoryItem | undefined> {
    const conditions: any[] = [eq(inventoryItems.id, id)];
    if (tenantId) conditions.push(eq(inventoryItems.tenantId, tenantId));
    const [result] = await db.update(inventoryItems).set({ ...data, updatedAt: new Date() }).where(and(...conditions)).returning();
    return result;
  }

  async adjustInventoryStock(id: string, quantityChange: number, tenantId?: string): Promise<InventoryItem | undefined> {
    const conditions: any[] = [eq(inventoryItems.id, id)];
    if (tenantId) conditions.push(eq(inventoryItems.tenantId, tenantId));
    const [result] = await db
      .update(inventoryItems)
      .set({
        currentStock: sql`${inventoryItems.currentStock} + ${quantityChange}`,
        updatedAt: new Date(),
      })
      .where(and(...conditions))
      .returning();
    return result;
  }

  // ─── Inventory Consumption ────────────────────────────────────────────

  async logInventoryConsumption(tenantId: string, consumption: InsertInventoryConsumption): Promise<InventoryConsumption> {
    const [result] = await db.insert(inventoryConsumption).values({ ...consumption, tenantId }).returning();
    // Decrement stock
    await this.adjustInventoryStock(consumption.inventoryItemId, -consumption.quantity, tenantId);
    return result;
  }

  async getInventoryConsumption(tenantId: string, filters?: { itemId?: string; fromDate?: Date; toDate?: Date }): Promise<InventoryConsumption[]> {
    const conditions: any[] = [eq(inventoryConsumption.tenantId, tenantId)];
    if (filters?.itemId) conditions.push(eq(inventoryConsumption.inventoryItemId, filters.itemId));
    if (filters?.fromDate) conditions.push(gte(inventoryConsumption.createdAt, filters.fromDate));
    if (filters?.toDate) conditions.push(lte(inventoryConsumption.createdAt, filters.toDate));
    return db.select().from(inventoryConsumption).where(and(...conditions)).orderBy(desc(inventoryConsumption.createdAt));
  }

  async autoConsumeForWashJob(tenantId: string, washJobId: string, serviceCode: string, createdBy: string): Promise<void> {
    // Find all active inventory items for this tenant that have a consumption mapping
    const items = await db.select().from(inventoryItems).where(
      and(eq(inventoryItems.tenantId, tenantId), eq(inventoryItems.isActive, true), sql`${inventoryItems.consumptionMap} IS NOT NULL`)
    );

    for (const item of items) {
      const map = item.consumptionMap as Record<string, number> | null;
      if (!map || !map[serviceCode]) continue;
      const quantity = map[serviceCode];
      await this.logInventoryConsumption(tenantId, {
        inventoryItemId: item.id,
        washJobId,
        quantity,
        costAtTime: item.costPerUnit ?? 0,
        createdBy,
      });
    }
  }

  // ─── Purchase Orders ──────────────────────────────────────────────────

  async createPurchaseOrder(tenantId: string, order: InsertPurchaseOrder): Promise<PurchaseOrder> {
    const [result] = await db.insert(purchaseOrders).values({ ...(order as any), tenantId }).returning();
    return result;
  }

  async getPurchaseOrders(tenantId: string, filters?: { status?: string; supplierId?: string }): Promise<PurchaseOrder[]> {
    const conditions: any[] = [eq(purchaseOrders.tenantId, tenantId)];
    if (filters?.status) conditions.push(eq(purchaseOrders.status, filters.status as any));
    if (filters?.supplierId) conditions.push(eq(purchaseOrders.supplierId, filters.supplierId));
    return db.select().from(purchaseOrders).where(and(...conditions)).orderBy(desc(purchaseOrders.createdAt));
  }

  async getPurchaseOrder(id: string, tenantId?: string): Promise<PurchaseOrder | undefined> {
    const conditions: any[] = [eq(purchaseOrders.id, id)];
    if (tenantId) conditions.push(eq(purchaseOrders.tenantId, tenantId));
    const [result] = await db.select().from(purchaseOrders).where(and(...conditions));
    return result;
  }

  async updatePurchaseOrder(id: string, data: Partial<InsertPurchaseOrder>, tenantId?: string): Promise<PurchaseOrder | undefined> {
    const conditions: any[] = [eq(purchaseOrders.id, id)];
    if (tenantId) conditions.push(eq(purchaseOrders.tenantId, tenantId));
    const [result] = await db.update(purchaseOrders).set({ ...data, updatedAt: new Date() } as any).where(and(...conditions)).returning();
    return result;
  }

  async receivePurchaseOrder(id: string, tenantId?: string): Promise<PurchaseOrder | undefined> {
    const po = await this.getPurchaseOrder(id, tenantId);
    if (!po) return undefined;

    const conditions: any[] = [eq(purchaseOrders.id, id)];
    if (tenantId) conditions.push(eq(purchaseOrders.tenantId, tenantId));
    const [result] = await db
      .update(purchaseOrders)
      .set({ status: "received", receivedAt: new Date(), updatedAt: new Date() })
      .where(and(...conditions))
      .returning();

    // Increment stock for each line item
    const items = (po.items || []) as Array<{ inventoryItemId: string; quantity: number }>;
    for (const lineItem of items) {
      await this.adjustInventoryStock(lineItem.inventoryItemId, lineItem.quantity * 100, tenantId);
    }

    return result;
  }

  // ─── Inventory Analytics ──────────────────────────────────────────────

  async getInventoryAnalytics(tenantId: string): Promise<{
    totalItems: number;
    lowStockItems: number;
    totalStockValue: number;
    topConsumedItems: { itemId: string; itemName: string; totalQuantity: number }[];
    monthlyConsumptionCost: number;
    profitMarginByService: { serviceCode: string; avgCost: number; avgRevenue: number; margin: number }[];
  }> {
    const tf = eq(inventoryItems.tenantId, tenantId);
    const cf = eq(inventoryConsumption.tenantId, tenantId);

    // Total active items
    const [totalResult] = await db.select({ count: sql<number>`count(*)::int` }).from(inventoryItems).where(and(tf, eq(inventoryItems.isActive, true)));
    const totalItems = totalResult?.count || 0;

    // Low stock items
    const [lowResult] = await db.select({ count: sql<number>`count(*)::int` }).from(inventoryItems).where(
      and(tf, eq(inventoryItems.isActive, true), sql`${inventoryItems.currentStock} <= ${inventoryItems.minimumStock}`)
    );
    const lowStockItems = lowResult?.count || 0;

    // Total stock value
    const [valueResult] = await db.select({
      total: sql<number>`coalesce(sum((${inventoryItems.currentStock}::numeric / 100) * ${inventoryItems.costPerUnit}), 0)::int`
    }).from(inventoryItems).where(and(tf, eq(inventoryItems.isActive, true)));
    const totalStockValue = valueResult?.total || 0;

    // Top consumed items (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const topConsumed = await db
      .select({
        itemId: inventoryConsumption.inventoryItemId,
        itemName: inventoryItems.name,
        totalQuantity: sql<number>`sum(${inventoryConsumption.quantity})::int`,
      })
      .from(inventoryConsumption)
      .innerJoin(inventoryItems, eq(inventoryConsumption.inventoryItemId, inventoryItems.id))
      .where(and(cf, gte(inventoryConsumption.createdAt, thirtyDaysAgo)))
      .groupBy(inventoryConsumption.inventoryItemId, inventoryItems.name)
      .orderBy(sql`sum(${inventoryConsumption.quantity}) desc`)
      .limit(10);

    // Monthly consumption cost
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const [costResult] = await db.select({
      total: sql<number>`coalesce(sum((${inventoryConsumption.quantity}::numeric / 100) * ${inventoryConsumption.costAtTime}), 0)::int`
    }).from(inventoryConsumption).where(and(cf, gte(inventoryConsumption.createdAt, startOfMonth)));
    const monthlyConsumptionCost = costResult?.total || 0;

    return {
      totalItems,
      lowStockItems,
      totalStockValue,
      topConsumedItems: topConsumed.map(t => ({ itemId: t.itemId, itemName: t.itemName ?? "", totalQuantity: t.totalQuantity })),
      monthlyConsumptionCost,
      profitMarginByService: [],
    };
  }

  async getLowStockItems(tenantId: string): Promise<InventoryItem[]> {
    return db.select().from(inventoryItems).where(
      and(
        eq(inventoryItems.tenantId, tenantId),
        eq(inventoryItems.isActive, true),
        sql`${inventoryItems.currentStock} <= ${inventoryItems.minimumStock}`,
        sql`${inventoryItems.minimumStock} > 0`
      )
    ).orderBy(sql`${inventoryItems.currentStock}::numeric / GREATEST(${inventoryItems.minimumStock}, 1) asc`);
  }

  // ─── Inventory Forecast ────────────────────────────────────────────────

  async getInventoryForecast(tenantId: string, days: number = 7) {
    const now = new Date();
    const forecastEnd = new Date(now);
    forecastEnd.setDate(forecastEnd.getDate() + days);
    const todayStr = now.toISOString().split("T")[0];
    const endStr = forecastEnd.toISOString().split("T")[0];

    // Get upcoming confirmed/in_progress bookings within the forecast window
    const upcomingBookings = await db
      .select({ serviceId: bookings.serviceId })
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          sql`${bookings.bookingDate} >= ${todayStr}`,
          sql`${bookings.bookingDate} <= ${endStr}`,
          sql`${bookings.status} IN ('confirmed', 'in_progress')`
        )
      );

    // Get all active inventory items with consumption maps
    const items = await db
      .select()
      .from(inventoryItems)
      .where(and(eq(inventoryItems.tenantId, tenantId), eq(inventoryItems.isActive, true)));

    // Get booking services to map serviceId → name
    const services = await db
      .select({ id: bookingServices.id, name: bookingServices.name })
      .from(bookingServices)
      .where(eq(bookingServices.tenantId, tenantId));

    const serviceMap = new Map(services.map((s) => [s.id, s.name]));

    // Count bookings per serviceId
    const bookingCountByService = new Map<string, number>();
    for (const b of upcomingBookings) {
      if (b.serviceId) {
        bookingCountByService.set(b.serviceId, (bookingCountByService.get(b.serviceId) || 0) + 1);
      }
    }
    const totalBookings = upcomingBookings.length;

    // For each item: estimate projected consumption
    const forecast = items.map((item) => {
      const consumptionMap = (item.consumptionMap as Record<string, number>) || {};
      let projectedConsumption = 0;

      // If item has per-service consumption data, use it
      for (const [serviceId, count] of Array.from(bookingCountByService.entries())) {
        const consumption = consumptionMap[serviceId] || 0;
        projectedConsumption += consumption * count;
      }

      // Fallback: if no consumption map, use historical average (total consumption / 30 days * forecastDays)
      if (projectedConsumption === 0 && totalBookings > 0 && Object.keys(consumptionMap).length === 0) {
        // Skip items with no consumption mapping
        return null;
      }

      const currentStock = item.currentStock || 0;
      const projectedRemaining = currentStock - projectedConsumption;
      const willRunOut = projectedRemaining < 0;
      const shortfallAmount = willRunOut ? Math.abs(projectedRemaining) : 0;
      const neededToOrder = shortfallAmount > 0 ? Math.ceil(shortfallAmount / 100) * 100 : 0; // round up to nearest 100 hundredths

      return {
        itemId: item.id,
        itemName: item.name,
        unit: item.unit,
        currentStock,
        minimumStock: item.minimumStock || 0,
        projectedConsumption,
        projectedRemaining,
        willRunOut,
        shortfallAmount,
        neededToOrder,
        supplierId: item.supplierId,
        costPerUnit: item.costPerUnit || 0,
      };
    }).filter(Boolean) as NonNullable<ReturnType<typeof items.map>[number]>[];

    const bookingBreakdown = Array.from(bookingCountByService.entries() as Iterable<[string, number]>).map(([serviceId, count]) => ({
      serviceId,
      serviceName: serviceMap.get(serviceId) || serviceId,
      count,
    }));

    return {
      forecastDays: days,
      totalUpcomingBookings: totalBookings,
      bookingBreakdown,
      forecast,
    };
  }

  // ─── Tenants ──────────────────────────────────────────────────────────

  async createTenant(tenant: InsertTenant): Promise<Tenant> {
    const [result] = await db.insert(tenants).values(tenant).returning();
    return result;
  }

  async getTenants(): Promise<Tenant[]> {
    return db.select().from(tenants).orderBy(asc(tenants.name));
  }

  async getTenant(id: string): Promise<Tenant | undefined> {
    const [result] = await db.select().from(tenants).where(eq(tenants.id, id));
    return result;
  }

  async getTenantBySlug(slug: string): Promise<Tenant | undefined> {
    const [result] = await db.select().from(tenants).where(eq(tenants.slug, slug));
    return result;
  }

  async updateTenant(id: string, data: Partial<InsertTenant>): Promise<Tenant | undefined> {
    const [result] = await db.update(tenants).set({ ...data, updatedAt: new Date() }).where(eq(tenants.id, id)).returning();
    return result;
  }

  // ─── Branches ─────────────────────────────────────────────────────────

  async createBranch(branch: InsertBranch): Promise<Branch> {
    const [result] = await db.insert(branches).values(branch).returning();
    return result;
  }

  async getBranches(tenantId: string): Promise<Branch[]> {
    return db.select().from(branches).where(eq(branches.tenantId, tenantId)).orderBy(asc(branches.name));
  }

  async getBranch(id: string): Promise<Branch | undefined> {
    const [result] = await db.select().from(branches).where(eq(branches.id, id));
    return result;
  }

  async updateBranch(id: string, data: Partial<InsertBranch>): Promise<Branch | undefined> {
    const [result] = await db.update(branches).set({ ...data, updatedAt: new Date() }).where(eq(branches.id, id)).returning();
    return result;
  }

  // ─── Invoices ──────────────────────────────────────────────────────────

  async createInvoice(invoice: InsertInvoice): Promise<Invoice> {
    const [result] = await db.insert(invoices).values(invoice as any).returning();
    return result;
  }

  async getInvoices(filters?: { tenantId?: string; status?: string }): Promise<Invoice[]> {
    let query = db.select().from(invoices);
    const conditions = [];
    if (filters?.tenantId) conditions.push(eq(invoices.tenantId, filters.tenantId));
    if (filters?.status) conditions.push(eq(invoices.status, filters.status as any));
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }
    return (query as any).orderBy(desc(invoices.createdAt));
  }

  async getInvoice(id: string): Promise<Invoice | undefined> {
    const [result] = await db.select().from(invoices).where(eq(invoices.id, id));
    return result;
  }

  async updateInvoice(id: string, data: Partial<InsertInvoice>): Promise<Invoice | undefined> {
    const [result] = await db.update(invoices).set({ ...data, updatedAt: new Date() } as any).where(eq(invoices.id, id)).returning();
    return result;
  }

  async getInvoicesByTenant(tenantId: string): Promise<Invoice[]> {
    return db.select().from(invoices).where(eq(invoices.tenantId, tenantId)).orderBy(desc(invoices.createdAt));
  }

  // ─── Tenant Stats ─────────────────────────────────────────────────────

  // ─── Booking Services ─────────────────────────────────────────────────

  async createBookingService(tenantId: string, service: Omit<InsertBookingService, "tenantId">): Promise<BookingService> {
    const [result] = await db.insert(bookingServices).values({ ...service, tenantId } as any).returning();
    return result;
  }

  async getBookingServices(tenantId: string, activeOnly?: boolean): Promise<BookingService[]> {
    const conditions = [eq(bookingServices.tenantId, tenantId)];
    if (activeOnly) conditions.push(eq(bookingServices.isActive, true));
    return db.select().from(bookingServices).where(and(...conditions)).orderBy(asc(bookingServices.sortOrder));
  }

  async getBookingService(id: string, tenantId?: string): Promise<BookingService | undefined> {
    const conditions = [eq(bookingServices.id, id)];
    if (tenantId) conditions.push(eq(bookingServices.tenantId, tenantId));
    const [result] = await db.select().from(bookingServices).where(and(...conditions));
    return result;
  }

  async updateBookingService(id: string, data: Partial<InsertBookingService>, tenantId?: string): Promise<BookingService | undefined> {
    const conditions = [eq(bookingServices.id, id)];
    if (tenantId) conditions.push(eq(bookingServices.tenantId, tenantId));
    const [result] = await db.update(bookingServices).set({ ...data, updatedAt: new Date() } as any).where(and(...conditions)).returning();
    return result;
  }

  // ─── Booking Customers ───────────────────────────────────────────────

  async createBookingCustomer(tenantId: string, customer: Omit<InsertBookingCustomer, "tenantId">): Promise<BookingCustomer> {
    const [result] = await db.insert(bookingCustomers).values({ ...customer, tenantId } as any).returning();
    return result;
  }

  async getBookingCustomers(tenantId: string, filters?: { search?: string; limit?: number }): Promise<BookingCustomer[]> {
    const conditions = [eq(bookingCustomers.tenantId, tenantId)];
    if (filters?.search) {
      const search = `%${filters.search}%`;
      conditions.push(
        or(
          sql`${bookingCustomers.name} ILIKE ${search}`,
          sql`${bookingCustomers.email} ILIKE ${search}`,
          sql`${bookingCustomers.phone} ILIKE ${search}`,
          sql`${bookingCustomers.plateNormalized} ILIKE ${search}`
        ) as any
      );
    }
    let query = db.select().from(bookingCustomers).where(and(...conditions)).orderBy(desc(bookingCustomers.createdAt));
    if (filters?.limit) query = query.limit(filters.limit) as any;
    return query;
  }

  async getBookingCustomer(id: string, tenantId?: string): Promise<BookingCustomer | undefined> {
    const conditions = [eq(bookingCustomers.id, id)];
    if (tenantId) conditions.push(eq(bookingCustomers.tenantId, tenantId));
    const [result] = await db.select().from(bookingCustomers).where(and(...conditions));
    return result;
  }

  async getBookingCustomerByEmail(tenantId: string, email: string): Promise<BookingCustomer | undefined> {
    const [result] = await db.select().from(bookingCustomers).where(and(eq(bookingCustomers.tenantId, tenantId), eq(bookingCustomers.email, email)));
    return result;
  }

  async getBookingCustomerByPlate(tenantId: string, plateNormalized: string): Promise<BookingCustomer | undefined> {
    const [result] = await db.select().from(bookingCustomers).where(and(eq(bookingCustomers.tenantId, tenantId), eq(bookingCustomers.plateNormalized, plateNormalized)));
    return result;
  }

  async updateBookingCustomer(id: string, data: Partial<InsertBookingCustomer>, tenantId?: string): Promise<BookingCustomer | undefined> {
    const conditions = [eq(bookingCustomers.id, id)];
    if (tenantId) conditions.push(eq(bookingCustomers.tenantId, tenantId));
    const [result] = await db.update(bookingCustomers).set({ ...data, updatedAt: new Date() } as any).where(and(...conditions)).returning();
    return result;
  }

  // ─── Booking Vehicles ────────────────────────────────────────────────

  async createBookingVehicle(tenantId: string, vehicle: Omit<InsertBookingVehicle, "tenantId">): Promise<BookingVehicle> {
    const [result] = await db.insert(bookingVehicles).values({ ...vehicle, tenantId } as any).returning();
    return result;
  }

  async getBookingVehicles(tenantId: string, customerId?: string): Promise<BookingVehicle[]> {
    const conditions = [eq(bookingVehicles.tenantId, tenantId)];
    if (customerId) conditions.push(eq(bookingVehicles.customerId, customerId));
    return db.select().from(bookingVehicles).where(and(...conditions)).orderBy(desc(bookingVehicles.createdAt));
  }

  async getBookingVehicleByPlate(tenantId: string, plateNormalized: string): Promise<BookingVehicle | undefined> {
    const [result] = await db.select().from(bookingVehicles).where(and(eq(bookingVehicles.tenantId, tenantId), eq(bookingVehicles.licensePlate, plateNormalized)));
    return result;
  }

  // ─── Bookings ────────────────────────────────────────────────────────

  async createBooking(tenantId: string, booking: Omit<InsertBooking, "tenantId">): Promise<Booking> {
    // tenantId is added by the method, not the caller
    const [result] = await db.insert(bookings).values({ ...booking, tenantId } as any).returning();
    return result;
  }

  async getBookings(tenantId: string, filters?: { status?: string; fromDate?: string; toDate?: string; search?: string; customerId?: string; limit?: number }): Promise<Booking[]> {
    const conditions = [eq(bookings.tenantId, tenantId)];
    if (filters?.status) conditions.push(eq(bookings.status, filters.status as any));
    if (filters?.fromDate) conditions.push(gte(bookings.bookingDate, filters.fromDate));
    if (filters?.toDate) conditions.push(lte(bookings.bookingDate, filters.toDate));
    if (filters?.customerId) conditions.push(eq(bookings.customerId, filters.customerId));
    let query = db.select().from(bookings).where(and(...conditions)).orderBy(desc(bookings.bookingDate), asc(bookings.timeSlot));
    if (filters?.limit) query = query.limit(filters.limit) as any;
    return query;
  }

  async getBooking(id: string, tenantId?: string): Promise<Booking | undefined> {
    const conditions = [eq(bookings.id, id)];
    if (tenantId) conditions.push(eq(bookings.tenantId, tenantId));
    const [result] = await db.select().from(bookings).where(and(...conditions));
    return result;
  }

  async updateBooking(id: string, data: Partial<InsertBooking>, tenantId?: string): Promise<Booking | undefined> {
    const conditions = [eq(bookings.id, id)];
    if (tenantId) conditions.push(eq(bookings.tenantId, tenantId));
    const [result] = await db.update(bookings).set({ ...data, updatedAt: new Date() } as any).where(and(...conditions)).returning();
    return result;
  }

  async cancelBooking(id: string, reason?: string, tenantId?: string): Promise<Booking | undefined> {
    const conditions = [eq(bookings.id, id)];
    if (tenantId) conditions.push(eq(bookings.tenantId, tenantId));
    const [result] = await db.update(bookings).set({
      status: "cancelled" as any,
      cancelledAt: new Date(),
      cancelReason: reason || null,
      updatedAt: new Date(),
    }).where(and(...conditions)).returning();
    return result;
  }

  async getTodayBookings(tenantId: string): Promise<Booking[]> {
    const today = todayInBusinessTimezone();
    return db.select().from(bookings).where(and(
      eq(bookings.tenantId, tenantId),
      eq(bookings.bookingDate, today),
      sql`${bookings.status} IN ('confirmed', 'in_progress', 'ready_for_pickup')`
    )).orderBy(asc(bookings.timeSlot));
  }

  async getUpcomingBookings(tenantId: string, days: number = 7): Promise<Booking[]> {
    const today = todayInBusinessTimezone();
    const futureDate = formatBookingDateFromDb(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
    return db.select().from(bookings).where(and(
      eq(bookings.tenantId, tenantId),
      gte(bookings.bookingDate, today),
      lte(bookings.bookingDate, futureDate),
      sql`${bookings.status} IN ('confirmed', 'in_progress')`
    )).orderBy(asc(bookings.bookingDate), asc(bookings.timeSlot));
  }

  async getBookingsByPlate(tenantId: string, plateNormalized: string): Promise<Booking[]> {
    // Join bookings with vehicles to find by plate
    const vehicles = await db.select().from(bookingVehicles).where(
      and(eq(bookingVehicles.tenantId, tenantId), eq(bookingVehicles.licensePlate, plateNormalized))
    );
    if (vehicles.length === 0) return [];
    const vehicleIds = vehicles.map(v => v.id);
    return db.select().from(bookings).where(and(
      eq(bookings.tenantId, tenantId),
      sql`${bookings.vehicleId} = ANY(${vehicleIds})`
    )).orderBy(desc(bookings.bookingDate));
  }

  // ─── Time Slot Config ────────────────────────────────────────────────

  async getTimeSlotConfig(tenantId: string): Promise<BookingTimeSlotConfig[]> {
    return db.select().from(bookingTimeSlotConfig).where(eq(bookingTimeSlotConfig.tenantId, tenantId)).orderBy(asc(bookingTimeSlotConfig.dayOfWeek));
  }

  async upsertTimeSlotConfig(tenantId: string, configs: InsertBookingTimeSlotConfig[]): Promise<BookingTimeSlotConfig[]> {
    // Delete existing config for this tenant, then insert new
    await db.delete(bookingTimeSlotConfig).where(eq(bookingTimeSlotConfig.tenantId, tenantId));
    if (configs.length === 0) return [];
    const values = configs.map(c => ({ ...c, tenantId }));
    return db.insert(bookingTimeSlotConfig).values(values as any).returning();
  }

  async getAvailableTimeSlots(tenantId: string, date: string): Promise<{ time: string; available: number; maxConcurrent: number }[]> {
    // Get the day of week for the requested date
    const dayOfWeek = new Date(date).getDay(); // 0=Sunday..6=Saturday

    // Get time slot config for this day
    const configs = await db.select().from(bookingTimeSlotConfig).where(and(
      eq(bookingTimeSlotConfig.tenantId, tenantId),
      eq(bookingTimeSlotConfig.dayOfWeek, dayOfWeek),
      eq(bookingTimeSlotConfig.isActive, true)
    ));

    if (configs.length === 0) return [];

    // Generate all possible time slots from config
    const slots: { time: string; maxConcurrent: number }[] = [];
    for (const config of configs) {
      const [startH, startM] = config.startTime.split(":").map(Number);
      const [endH, endM] = config.endTime.split(":").map(Number);
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;
      const interval = config.slotIntervalMinutes;

      for (let m = startMinutes; m < endMinutes; m += interval) {
        const h = Math.floor(m / 60);
        const min = m % 60;
        const time = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
        slots.push({ time, maxConcurrent: config.maxConcurrentBookings });
      }
    }

    // Count existing bookings per slot for this date
    const existingBookings = await db.select({
      timeSlot: bookings.timeSlot,
      count: sql<number>`count(*)::int`,
    }).from(bookings).where(and(
      eq(bookings.tenantId, tenantId),
      eq(bookings.bookingDate, date),
      sql`${bookings.status} NOT IN ('cancelled', 'no_show')`
    )).groupBy(bookings.timeSlot);

    const bookingCounts = new Map(existingBookings.map(b => [b.timeSlot, b.count]));

    return slots.map(slot => {
      const booked = bookingCounts.get(slot.time) || 0;
      return {
        time: slot.time,
        available: Math.max(0, slot.maxConcurrent - booked),
        maxConcurrent: slot.maxConcurrent,
      };
    });
  }

  // ─── Booking Analytics ───────────────────────────────────────────────

  async getBookingAnalytics(tenantId: string): Promise<{
    todayBookings: number;
    weekBookings: number;
    monthBookings: number;
    completionRate: number;
    bookingRevenue: number;
  }> {
    const tf = eq(bookings.tenantId, tenantId);
    const today = todayInBusinessTimezone();
    const weekAgo = formatBookingDateFromDb(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
    const monthAgo = formatBookingDateFromDb(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

    const [todayResult] = await db.select({ count: sql<number>`count(*)::int` }).from(bookings).where(and(tf, eq(bookings.bookingDate, today)));
    const [weekResult] = await db.select({ count: sql<number>`count(*)::int` }).from(bookings).where(and(tf, gte(bookings.bookingDate, weekAgo)));
    const [monthResult] = await db.select({ count: sql<number>`count(*)::int` }).from(bookings).where(and(tf, gte(bookings.bookingDate, monthAgo)));

    // Completion rate: completed / (completed + cancelled + no_show) for last 30 days
    const [completedCount] = await db.select({ count: sql<number>`count(*)::int` }).from(bookings).where(and(tf, gte(bookings.bookingDate, monthAgo), eq(bookings.status, "completed" as any)));
    const [totalFinished] = await db.select({ count: sql<number>`count(*)::int` }).from(bookings).where(and(tf, gte(bookings.bookingDate, monthAgo), sql`${bookings.status} IN ('completed', 'cancelled', 'no_show')`));

    const completionRate = totalFinished.count > 0 ? Math.round((completedCount.count / totalFinished.count) * 100) : 0;

    // Revenue from completed bookings this month
    const [revenueResult] = await db.select({ total: sql<number>`COALESCE(SUM(${bookings.totalAmount}), 0)::int` }).from(bookings).where(and(tf, gte(bookings.bookingDate, monthAgo), eq(bookings.status, "completed" as any)));

    return {
      todayBookings: todayResult?.count || 0,
      weekBookings: weekResult?.count || 0,
      monthBookings: monthResult?.count || 0,
      completionRate,
      bookingRevenue: revenueResult?.total || 0,
    };
  }

  // ─── Booking Payments ──────────────────────────────────────────────────

  async createBookingPayment(tenantId: string, payment: Omit<InsertBookingPayment, "tenantId">): Promise<BookingPayment> {
    const [result] = await db.insert(bookingPayments).values({ ...payment, tenantId }).returning();
    return result;
  }

  async getBookingPayment(id: string, tenantId?: string): Promise<BookingPayment | undefined> {
    const conditions = [eq(bookingPayments.id, id)];
    if (tenantId) conditions.push(eq(bookingPayments.tenantId, tenantId));
    const [result] = await db.select().from(bookingPayments).where(and(...conditions));
    return result;
  }

  async getBookingPaymentByBookingId(bookingId: string, tenantId?: string): Promise<BookingPayment | undefined> {
    const conditions = [eq(bookingPayments.bookingId, bookingId)];
    if (tenantId) conditions.push(eq(bookingPayments.tenantId, tenantId));
    const [result] = await db.select().from(bookingPayments).where(and(...conditions));
    return result;
  }

  async getBookingPayments(tenantId: string, filters?: { fromDate?: string; toDate?: string; limit?: number }): Promise<BookingPayment[]> {
    const conditions = [eq(bookingPayments.tenantId, tenantId)];
    if (filters?.fromDate) conditions.push(gte(bookingPayments.createdAt, new Date(filters.fromDate)));
    if (filters?.toDate) conditions.push(lte(bookingPayments.createdAt, new Date(filters.toDate + "T23:59:59")));
    let query = db.select().from(bookingPayments).where(and(...conditions)).orderBy(desc(bookingPayments.createdAt));
    if (filters?.limit) query = query.limit(filters.limit) as any;
    return query;
  }

  async generateReceiptNumber(tenantId: string): Promise<string> {
    const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(bookingPayments).where(eq(bookingPayments.tenantId, tenantId));
    const num = (countResult?.count || 0) + 1;
    const date = new Date();
    const prefix = `RCT-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;
    return `${prefix}-${String(num).padStart(5, "0")}`;
  }

  // ─── Cross-Branch Analytics ────────────────────────────────────────────

  async getCrossBranchAnalytics(tenantId: string) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const branchList = await db.select().from(branches).where(and(eq(branches.tenantId, tenantId), eq(branches.isActive, true))).orderBy(asc(branches.name));

    // Revenue & wash counts per branch (current month)
    const washByBranch = await db
      .select({
        branchId: washJobs.branchId,
        revenue: sql<number>`COALESCE(SUM(${washJobs.price}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(washJobs)
      .where(and(eq(washJobs.tenantId, tenantId), gte(washJobs.createdAt, monthStart)))
      .groupBy(washJobs.branchId);

    // Last month for comparison
    const lastMonthWashByBranch = await db
      .select({
        branchId: washJobs.branchId,
        revenue: sql<number>`COALESCE(SUM(${washJobs.price}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(washJobs)
      .where(and(eq(washJobs.tenantId, tenantId), gte(washJobs.createdAt, lastMonthStart), lt(washJobs.createdAt, monthStart)))
      .groupBy(washJobs.branchId);

    // Parking revenue per branch (current month)
    const parkingByBranch = await db
      .select({
        branchId: parkingSessions.branchId,
        revenue: sql<number>`COALESCE(SUM(${parkingSessions.calculatedFee}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(parkingSessions)
      .where(and(eq(parkingSessions.tenantId, tenantId), gte(parkingSessions.createdAt, monthStart), isNotNull(parkingSessions.exitAt)))
      .groupBy(parkingSessions.branchId);

    // Daily revenue for last 30 days (all branches combined)
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dailyRevenue = await db
      .select({
        day: sql<string>`to_char(DATE_TRUNC('day', ${washJobs.createdAt}), 'YYYY-MM-DD')`,
        revenue: sql<number>`COALESCE(SUM(${washJobs.price}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(washJobs)
      .where(and(eq(washJobs.tenantId, tenantId), gte(washJobs.createdAt, thirtyDaysAgo)))
      .groupBy(sql`DATE_TRUNC('day', ${washJobs.createdAt})`)
      .orderBy(sql`DATE_TRUNC('day', ${washJobs.createdAt})`);

    // Build per-branch result
    const branchData = branchList.map((b) => {
      const wash = washByBranch.find((w) => w.branchId === b.id) || { revenue: 0, count: 0 };
      const lastWash = lastMonthWashByBranch.find((w) => w.branchId === b.id) || { revenue: 0, count: 0 };
      const parking = parkingByBranch.find((p) => p.branchId === b.id) || { revenue: 0, count: 0 };
      const totalRevenue = wash.revenue + parking.revenue;
      const lastTotalRevenue = lastWash.revenue;
      const pctChange = lastTotalRevenue > 0 ? Math.round(((totalRevenue - lastTotalRevenue) / lastTotalRevenue) * 100) : null;
      return {
        id: b.id,
        name: b.name,
        address: b.address,
        washCount: wash.count,
        washRevenue: wash.revenue,
        parkingCount: parking.count,
        parkingRevenue: parking.revenue,
        totalRevenue,
        lastMonthRevenue: lastTotalRevenue,
        revenueChangePct: pctChange,
      };
    });

    // Also include null-branchId as "Unassigned"
    const unassignedWash = washByBranch.find((w) => w.branchId === null) || { revenue: 0, count: 0 };
    const unassignedParking = parkingByBranch.find((p) => p.branchId === null) || { revenue: 0, count: 0 };
    if (unassignedWash.count > 0 || unassignedParking.count > 0) {
      branchData.push({
        id: "unassigned",
        name: "Unassigned",
        address: null,
        washCount: unassignedWash.count,
        washRevenue: unassignedWash.revenue,
        parkingCount: unassignedParking.count,
        parkingRevenue: unassignedParking.revenue,
        totalRevenue: unassignedWash.revenue + unassignedParking.revenue,
        lastMonthRevenue: 0,
        revenueChangePct: null,
      });
    }

    const totals = branchData.reduce(
      (acc, b) => ({
        revenue: acc.revenue + b.totalRevenue,
        washes: acc.washes + b.washCount,
        parkings: acc.parkings + b.parkingCount,
      }),
      { revenue: 0, washes: 0, parkings: 0 }
    );

    return { branches: branchData, totals, dailyRevenue };
  }

  // ─── Tenant Stats ─────────────────────────────────────────────────────

  async getTenantStats(tenantId: string): Promise<{
    userCount: number;
    washCount: number;
    parkingSessionCount: number;
    branchCount: number;
  }> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [userResult] = await db.select({ count: sql<number>`count(*)::int` }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)));
    const [washResult] = await db.select({ count: sql<number>`count(*)::int` }).from(washJobs).where(and(eq(washJobs.tenantId, tenantId), gte(washJobs.createdAt, startOfMonth)));
    const [parkingResult] = await db.select({ count: sql<number>`count(*)::int` }).from(parkingSessions).where(and(eq(parkingSessions.tenantId, tenantId), gte(parkingSessions.createdAt, startOfMonth)));
    const [branchResult] = await db.select({ count: sql<number>`count(*)::int` }).from(branches).where(and(eq(branches.tenantId, tenantId), eq(branches.isActive, true)));

    return {
      userCount: userResult?.count || 0,
      washCount: washResult?.count || 0,
      parkingSessionCount: parkingResult?.count || 0,
      branchCount: branchResult?.count || 0,
    };
  }

  // Corporate Accounts
  async getCorporateAccounts(status?: string): Promise<CorporateAccount[]> {
    if (status) {
      return db.select().from(corporateAccounts)
        .where(eq(corporateAccounts.status, status as any))
        .orderBy(desc(corporateAccounts.createdAt));
    }
    return db.select().from(corporateAccounts).orderBy(desc(corporateAccounts.createdAt));
  }

  async getCorporateAccount(id: string): Promise<CorporateAccount | undefined> {
    const [account] = await db.select().from(corporateAccounts).where(eq(corporateAccounts.id, id));
    return account;
  }

  async updateCorporateAccount(id: string, data: Partial<CorporateAccount>): Promise<CorporateAccount | undefined> {
    const [updated] = await db
      .update(corporateAccounts)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(corporateAccounts.id, id))
      .returning();
    return updated;
  }
}

export const storage = new DatabaseStorage();
