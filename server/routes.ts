import type { Express } from "express";
import { createServer, type Server } from "http";
import express from "express";
import path from "path";
import { storage } from "./storage";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import { normalizePlate, displayPlate } from "./lib/plate-utils";
import { requireRole, ensureUserRole, isSuperAdmin, requireSuperAdminMiddleware } from "./lib/roles";
import { savePhoto } from "./lib/photo-storage";
import {
  queueBookingNotification,
  detectBookingChangeType,
  renderBookingNotification,
  markNotificationSent,
  type BookingNotificationType,
} from "./lib/notification-service";
import { authenticateWithCredentials, seedUsers, generateJobToken } from "./lib/credentials-auth";
import { extractTenantContext } from "./lib/tenant-context";
import { getEnabledFeatures, seedFeatureFlags, requireFeature } from "./lib/feature-flags";
import { generateBillingSnapshot, generateAllSnapshots } from "./lib/billing-snapshot";
import { overseerRequestScanner, trackFailedLogin, clearFailedLogins, getClientIp } from "./lib/overseer-security";
import { z } from "zod";
import { WASH_STATUS_ORDER, COUNTRY_HINTS, RESERVATION_STATUSES, SERVICE_CODES, SERVICE_TYPE_CONFIG, LOYALTY_POINTS_PER_SERVICE, LOYALTY_POINTS_PER_PACKAGE, LOYALTY_VOUCHER_THRESHOLD, SERVICE_PACKAGES, VEHICLE_SIZES } from "@shared/schema";
import type { ServiceCode, WashStatus, VehicleSize } from "@shared/schema";
import {
  // CRM functions — used ONLY by /api/crm/* routes (Ekhaya's own system)
  getUpcomingBookings,
  getTodayBookings,
  findBookingByPlate,
  updateBookingStatus,
  getManagerBookings,
  getBookingById,
  updateBooking as updateCRMBooking,
  cancelBooking as cancelCRMBooking,
  getCRMNotifications,
  createCRMNotification,
  updateCRMNotificationStatus,
  getCRMNotificationsForCustomer,
  getCRMSubscriptions,
  findCRMSubscriptionByPlate,
  findCRMSubscriptionByEmail,
  findCRMSubscriptionByPhone,
  getBookingWithMembership,
  getUpcomingBookingsWithMemberships,
  findCRMCustomerByPlate,
  findCRMUberDriverByPlate,
  findCRMMembershipByPlate,
  getCRMLoyaltyAnalytics,
  getCRMGrowthAnalytics,
  getCRMCorporateAccounts,
  getCRMCorporateAccount,
  updateCRMCorporateAccount,
  deleteCRMCorporateAccount,
  creditCRMLoyaltyPoints,
} from "./lib/booking-db";
import {
  calculateParkingFee,
  calculateParkingDuration,
  enrichSessionWithCalculations,
  generateConfirmationCode,
  formatCurrency
} from "./lib/parking-utils";
import { startNotificationProcessor } from "./lib/notification-processor";
import { getVapidPublicKey, sendPushToCustomer, sendPushToAllManagers } from "./lib/web-push-service";
import { calculateJobPriority } from "./lib/priority-calculator";
import { fireWebhook } from "./lib/webhook-service";
import { startWebhookProcessor } from "./lib/webhook-processor";
import { getQueuePosition } from "./lib/eta-calculator";

// SSE clients for real-time updates
const sseClients: Set<any> = new Set();
const customerSseClients: Set<{ res: any; washJobId: string }> = new Set();

function broadcastEvent(data: any) {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => {
    client.write(message);
  });
  
  // Also notify customer clients watching specific jobs
  const jobId = data.job?.id || data.washJobId || data.jobId;
  if (jobId) {
    customerSseClients.forEach(client => {
      if (client.washJobId === jobId) {
        client.res.write(message);
      }
    });
  }
}

// Helper to get base URL (handles Vercel's proxy headers)
function getBaseUrl(req: any): string {
  if (process.env.APP_URL) {
    return process.env.APP_URL;
  }
  // Vercel and other proxies set x-forwarded-host
  const forwardedHost = req.get('x-forwarded-host');
  const host = forwardedHost || req.hostname;
  const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';
  return `${protocol}://${host}`;
}

// Validation schemas
const createWashJobSchema = z.object({
  plateDisplay: z.string().min(1, "Plate is required"),
  countryHint: z.enum(COUNTRY_HINTS).optional().default("OTHER"),
  photo: z.string().optional(),
  serviceCode: z.enum(SERVICE_CODES).optional().default("STANDARD"),
  servicePackageCode: z.string().optional(), // Named package (e.g. "VAMOS", "LA_OBRA")
  vehicleSize: z.enum(VEHICLE_SIZES).optional(), // small/medium/large for pricing
  customSteps: z.array(z.string()).optional(), // Custom step list override
});

const updateStatusSchema = z.object({
  status: z.enum(WASH_STATUS_ORDER),
});

const parkingSchema = z.object({
  plateDisplay: z.string().min(1, "Plate is required"),
  countryHint: z.enum(COUNTRY_HINTS).optional().default("OTHER"),
  photo: z.string().optional(),
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Setup authentication
  await setupAuth(app);
  registerAuthRoutes(app);

  // Seed credentials users from env vars
  await seedUsers();

  // Start notification delivery processor (Twilio SMS/WhatsApp)
  startNotificationProcessor();

  // Start webhook retry processor (CRM webhook exponential backoff)
  startWebhookProcessor();

  // HOPSTECH-OVERSEER security scanner (SQL injection, XSS, etc.)
  app.use("/api", overseerRequestScanner());

  // Multi-tenancy context middleware
  app.use("/api", extractTenantContext());

  // Serve uploaded files
  app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

  // Credentials registration endpoint
  const credentialsRegisterSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    firstName: z.string().min(1),
    lastName: z.string().optional(),
    tenantSlug: z.string().optional(),
  });

  app.post("/api/auth/credentials/register", async (req, res) => {
    try {
      const result = credentialsRegisterSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "Please fill in all required fields correctly" });
      }

      const { email, password, firstName, lastName, tenantSlug } = result.data;

      // Check if email already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "An account with this email already exists" });
      }

      // Resolve tenant if tenantSlug is provided
      let tenantId = "default";
      let role: "technician" | "manager" | "admin" = "technician";

      if (tenantSlug) {
        const tenant = await storage.getTenantBySlug(tenantSlug);
        if (!tenant || !tenant.isActive) {
          return res.status(404).json({ message: "Business not found or inactive" });
        }
        tenantId = tenant.id;

        // Check if this is the first user for the tenant — make them manager
        const existingUsers = await storage.getUsers(tenantId);
        const tenantUsers = existingUsers.filter((u) => u.tenantId === tenant.id);
        if (tenantUsers.length === 0) {
          role = "manager";
        }
      }

      const { createCredentialsUser } = await import("./lib/credentials-auth");
      const name = lastName ? `${firstName} ${lastName}` : firstName;
      await createCredentialsUser(email, password, role, name, tenantId);

      res.json({
        success: true,
        message: role === "manager"
          ? "Account created as tenant manager"
          : "Account created successfully",
        role,
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "Failed to create account" });
    }
  });

  // Credentials login endpoint
  const credentialsLoginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  });

  app.post("/api/auth/credentials/login", async (req: any, res) => {
    try {
      const result = credentialsLoginSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "Invalid email or password format" });
      }

      const { email, password } = result.data;
      const authResult = await authenticateWithCredentials(email, password);

      if (!authResult.success || !authResult.user) {
        // Track failed login for brute-force detection
        trackFailedLogin(getClientIp(req));
        return res.status(401).json({ message: authResult.error || "Authentication failed" });
      }

      const user = authResult.user;

      // Clear failed-login counter on success
      clearFailedLogins(getClientIp(req));

      // Set up passport session for credentials user
      req.login({
        claims: { sub: user.id },
        authType: "credentials",
        role: user.role,
        email: user.email,
        name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
      }, (err: any) => {
        if (err) {
          console.error("Login error:", err);
          return res.status(500).json({ message: "Login failed" });
        }
        res.json({
          message: "Login successful",
          user: {
            id: user.id,
            email: user.email,
            name: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
            role: user.role,
          }
        });
      });
    } catch (error) {
      console.error("Credentials login error:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  // Universal logout endpoint (works for both credentials and Replit auth)
  app.post("/api/auth/logout", (req: any, res) => {
    req.logout((err: any) => {
      if (err) {
        console.error("Logout error:", err);
        return res.status(500).json({ message: "Logout failed" });
      }
      req.session.destroy((err: any) => {
        if (err) {
          console.error("Session destroy error:", err);
        }
        res.json({ message: "Logged out successfully" });
      });
    });
  });

  // Middleware to ensure user has a role assigned after auth
  app.use("/api", async (req: any, res, next) => {
    // For credentials auth, role is already in session
    if (req.user?.authType === "credentials") {
      return next();
    }
    // For Replit auth, ensure role in userRoles table
    if (req.user?.claims?.sub) {
      await ensureUserRole(req.user.claims.sub);
    }
    next();
  });

  // Get current user with role
  app.get("/api/user/role", isAuthenticated, async (req: any, res) => {
    try {
      // For credentials auth, role is in session
      if (req.user?.authType === "credentials") {
        return res.json({ role: req.user.role || "technician" });
      }
      // For Replit auth, get from userRoles table
      const userId = req.user?.claims?.sub;
      const tenantId = (req as any).tenantId || "default";
      const userRole = await storage.getUserRole(tenantId, userId);
      res.json({ role: userRole?.role || "technician" });
    } catch (error) {
      console.error("Error fetching user role:", error);
      res.status(500).json({ message: "Failed to fetch role" });
    }
  });

  // Debug endpoint to check current user info (including role)
  app.get("/api/user/me", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      const tenantId = (req as any).tenantId || "default";
      let role = "technician";
      let userDetails = null;

      // For credentials auth, role is in session
      if (req.user?.authType === "credentials") {
        role = req.user.role || "technician";
        userDetails = await storage.getUserById(userId);
      } else {
        // For Replit auth, get from userRoles table
        const userRole = await storage.getUserRole(tenantId, userId);
        role = userRole?.role || "technician";
      }

      res.json({
        userId,
        role,
        authType: req.user?.authType || "replit",
        email: req.user?.email,
        name: req.user?.name,
        userDetails
      });
    } catch (error) {
      console.error("Error fetching user info:", error);
      res.status(500).json({ message: "Failed to fetch user info" });
    }
  });

  // SSE endpoint for real-time updates
  app.get("/api/stream", isAuthenticated, (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    sseClients.add(res);
    
    req.on("close", () => {
      sseClients.delete(res);
    });

    // Send initial ping
    res.write("data: {\"type\":\"connected\"}\n\n");
  });

  // =====================
  // WASH JOBS
  // =====================

  // Create wash job
  app.post("/api/wash-jobs", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const result = createWashJobSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: result.error.errors[0].message });
      }

      const { plateDisplay, countryHint, photo, serviceCode, servicePackageCode, vehicleSize, customSteps } = result.data;
      const userId = req.user?.claims?.sub;

      // Save photo if provided
      let photoUrl: string | undefined;
      if (photo) {
        try {
          const saved = await savePhoto(photo);
          photoUrl = saved.url;
        } catch (err) {
          console.error("Photo save error:", err);
        }
      }

      // Resolve service steps: customSteps > named package > service type config
      let resolvedSteps: string[] = [];
      let resolvedServiceCode = serviceCode || "STANDARD";
      let resolvedPackageName: string | null = null;
      let resolvedPrice: number | null = null;
      if (customSteps && customSteps.length > 0) {
        resolvedSteps = customSteps;
      } else if (servicePackageCode && SERVICE_PACKAGES[servicePackageCode]) {
        const pkg = SERVICE_PACKAGES[servicePackageCode];
        resolvedSteps = pkg.steps;
        resolvedServiceCode = pkg.serviceCode;
        resolvedPackageName = pkg.label;
        if (vehicleSize && pkg.pricing[vehicleSize]) {
          resolvedPrice = pkg.pricing[vehicleSize];
        }
      } else {
        const cfg = SERVICE_TYPE_CONFIG[resolvedServiceCode as ServiceCode];
        resolvedSteps = cfg?.steps || [];
      }

      const job = await storage.createWashJob(tenantId, {
        plateDisplay: displayPlate(plateDisplay),
        plateNormalized: normalizePlate(plateDisplay),
        countryHint,
        technicianId: userId,
        status: "received",
        serviceCode: resolvedServiceCode,
        packageName: resolvedPackageName,
        vehicleSize: vehicleSize || null,
        price: resolvedPrice ? resolvedPrice * 100 : null, // store in cents
        startAt: new Date(),
      });

      // Create customer access token for tracking
      const token = generateJobToken();
      await storage.createCustomerJobAccess({
        washJobId: job.id,
        token,
        customerName: null,
        customerEmail: null,
        serviceCode: resolvedPackageName || servicePackageCode || resolvedServiceCode,
      });

      // Auto-populate service checklist items based on resolved steps
      if (resolvedSteps.length > 0) {
        await storage.createServiceChecklistItems(tenantId,
          resolvedSteps.map((label, index) => ({
            washJobId: job.id,
            label,
            orderIndex: index,
            expected: true,
            confirmed: false,
          }))
        );
      }

      // Save initial photo if provided
      if (photoUrl) {
        await storage.addWashPhoto(tenantId, {
          washJobId: job.id,
          url: photoUrl,
          statusAtTime: "received",
        });
      }

      // Log event
      await storage.logEvent(tenantId, {
        type: "wash_created",
        plateDisplay: job.plateDisplay,
        plateNormalized: job.plateNormalized,
        countryHint: job.countryHint,
        washJobId: job.id,
        userId,
        payloadJson: { hasPhoto: !!photoUrl },
      });

      // Broadcast to SSE clients
      broadcastEvent({ type: "wash_created", job });

      // Fire CRM webhook (non-blocking)
      fireWebhook("wash_created", { jobId: job.id, plate: job.plateDisplay, plateNormalized: job.plateNormalized, serviceCode: job.serviceCode, status: job.status }).catch(() => {});

      // Push notification to managers about new job
      try {
        await sendPushToAllManagers({
          title: "New Wash Job",
          body: `${job.plateDisplay} — ${job.serviceCode} added to queue`,
          url: "/manager/dashboard",
          tag: `new-job-${job.id}`,
        }, tenantId);
      } catch (_pushErr) { /* non-blocking */ }

      // Return job with customer tracking URL and service info
      const baseUrl = getBaseUrl(req);
      res.json({
        ...job,
        customerUrl: `${baseUrl}/customer/job/${token}`,
        customerToken: token,
        packageName: resolvedPackageName,
        vehicleSize: vehicleSize || null,
        price: resolvedPrice,
      });
    } catch (error) {
      console.error("Error creating wash job:", error);
      res.status(500).json({ message: "Failed to create wash job" });
    }
  });

  // Get wash jobs
  app.get("/api/wash-jobs", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { status, my } = req.query;
      const userId = req.user?.claims?.sub;

      const filters: any = {};
      if (status) filters.status = status;
      if (my === "true" || my === "") filters.technicianId = userId;

      const jobs = await storage.getWashJobs(tenantId, filters);
      res.json(jobs);
    } catch (error) {
      console.error("Error fetching wash jobs:", error);
      res.status(500).json({ message: "Failed to fetch wash jobs" });
    }
  });

  // Get single wash job
  app.get("/api/wash-jobs/:id", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const job = await storage.getWashJob(req.params.id as string, tenantId);
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }
      // Include checklist items in the response
      const checklist = await storage.getServiceChecklistItems(job.id);
      res.json({ ...job, checklist });
    } catch (error) {
      console.error("Error fetching wash job:", error);
      res.status(500).json({ message: "Failed to fetch wash job" });
    }
  });

  // Admin price override on wash job
  app.patch("/api/wash-jobs/:id/price", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const userId = req.user?.claims?.sub;

      const schema = z.object({
        adminPrice: z.number().min(0, "Price must be non-negative"),
        reason: z.string().min(1, "Reason is required"),
      });
      const result = schema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: result.error.errors[0].message });
      }

      const { adminPrice, reason } = result.data;

      const job = await storage.updateWashJobPrice(
        req.params.id,
        adminPrice, // already in cents from frontend
        reason,
        userId || "unknown",
        tenantId
      );

      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }

      // Log event
      await storage.logEvent(tenantId, {
        type: "wash_price_override",
        plateDisplay: job.plateDisplay,
        plateNormalized: job.plateNormalized,
        countryHint: job.countryHint,
        washJobId: job.id,
        userId,
        payloadJson: { adminPrice, reason, originalPrice: job.price },
      });

      // Broadcast update
      broadcastEvent({ type: "wash_price_override", job });

      res.json(job);
    } catch (error) {
      console.error("Error updating wash job price:", error);
      res.status(500).json({ message: "Failed to update price" });
    }
  });

  // Update wash job status
  app.patch("/api/wash-jobs/:id/status", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const result = updateStatusSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: result.error.errors[0].message });
      }

      const { status } = result.data;
      const userId = req.user?.claims?.sub;

      // Get current job to validate transition
      const currentJob = await storage.getWashJob(req.params.id as string, tenantId);
      if (!currentJob) {
        return res.status(404).json({ message: "Job not found" });
      }

      // Determine service mode
      const svcCode = (currentJob.serviceCode as ServiceCode) || "STANDARD";
      const svcConfig = SERVICE_TYPE_CONFIG[svcCode];

      // For timer-mode services only allow "complete"
      if (svcConfig?.mode === "timer" && status !== "complete") {
        return res.status(400).json({ message: "This service type only supports marking as complete" });
      }

      // Ensure we're not going backward
      const currentIdx = WASH_STATUS_ORDER.indexOf(currentJob.status as WashStatus);
      const newIdx = WASH_STATUS_ORDER.indexOf(status as WashStatus);
      if (newIdx >= 0 && currentIdx >= 0 && newIdx <= currentIdx) {
        return res.status(400).json({ message: "Cannot move to a previous or current status" });
      }

      let job;
      if (status === "complete") {
        job = await storage.completeWashJob(req.params.id, tenantId);
      } else {
        job = await storage.updateWashJobStatus(req.params.id, status, tenantId);
      }

      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }

      // Log event
      await storage.logEvent(tenantId, {
        type: "wash_status_update",
        plateDisplay: job.plateDisplay,
        plateNormalized: job.plateNormalized,
        countryHint: job.countryHint,
        washJobId: job.id,
        userId,
        payloadJson: { status },
      });

      // Broadcast update
      broadcastEvent({ type: "wash_status_update", job });

      // Fire CRM webhook (non-blocking)
      fireWebhook("wash_status_update", { jobId: job.id, plate: job.plateDisplay, plateNormalized: job.plateNormalized, status, serviceCode: job.serviceCode }).catch(() => {});

      // === AUTO-CREDIT LOYALTY POINTS ON COMPLETION (LOCAL) ===
      if (status === "complete" && job) {
        try {
          const svcCode = (job.serviceCode || "STANDARD") as ServiceCode;
          // Package-specific points take priority over service-code points
          const packageCode = job.packageName?.toUpperCase() || null;
          const basePoints = (packageCode && LOYALTY_POINTS_PER_PACKAGE[packageCode])
            ? LOYALTY_POINTS_PER_PACKAGE[packageCode]
            : (LOYALTY_POINTS_PER_SERVICE[svcCode] || 0);

          if (basePoints > 0) {
            // Look up CRM customer to enrich local loyalty account with name/phone
            const crmCustForAccount = await findCRMCustomerByPlate(job.plateDisplay).catch(() => null);

            // Get or create local loyalty account for this plate (pass CRM data if available)
            const loyaltyAccount = await storage.getOrCreateLoyaltyAccount(
              tenantId, job.plateNormalized, job.plateDisplay,
              crmCustForAccount ? {
                name: crmCustForAccount.customerName || undefined,
                phone: crmCustForAccount.customerPhone || undefined,
                email: crmCustForAccount.customerEmail || undefined,
              } : undefined
            );

            const pointsToAward = basePoints;

            // Credit points to local loyalty account
            const updatedAccount = await storage.creditLoyaltyPoints(tenantId, loyaltyAccount.id, pointsToAward);
            const newBalance = updatedAccount?.pointsBalance || (loyaltyAccount.pointsBalance || 0) + pointsToAward;

            // Log transaction locally
            const packageLabel = packageCode ? (SERVICE_PACKAGES[packageCode]?.label || packageCode) : SERVICE_TYPE_CONFIG[svcCode]?.label;
            await storage.logLoyaltyTransaction(tenantId, {
              crmUserId: loyaltyAccount.id,
              memberNumber: loyaltyAccount.membershipNumber,
              type: "earn_wash",
              points: pointsToAward,
              balanceAfter: newBalance,
              washJobId: job.id,
              serviceCode: svcCode,
              description: `Earned ${pointsToAward} points for ${packageLabel}`,
              createdBy: userId,
            });

            // === AUTO-ISSUE VOUCHER when balance crosses the 1000-pt threshold ===
            const issuedVouchers: Awaited<ReturnType<typeof storage.issueVoucher>>[] = [];
            if (newBalance >= LOYALTY_VOUCHER_THRESHOLD) {
              const vouchersToIssue = Math.floor(newBalance / LOYALTY_VOUCHER_THRESHOLD);
              for (let i = 0; i < vouchersToIssue; i++) {
                const v = await storage.issueVoucher(tenantId, {
                  loyaltyAccountId: loyaltyAccount.id,
                  forPackageCode: packageCode || undefined,
                  forServiceCode: svcCode,
                  branchId: job.branchId || undefined,
                });
                issuedVouchers.push(v);
              }
              // Deduct 1000 pts per voucher — leftover points carry forward
              const pointsDeducted = vouchersToIssue * LOYALTY_VOUCHER_THRESHOLD;
              const balanceAfterDeduction = newBalance - pointsDeducted;
              await storage.deductLoyaltyPoints(tenantId, loyaltyAccount.id, pointsDeducted);
              await storage.logLoyaltyTransaction(tenantId, {
                crmUserId: loyaltyAccount.id,
                memberNumber: loyaltyAccount.membershipNumber,
                type: "redeem",
                points: -pointsDeducted,
                balanceAfter: balanceAfterDeduction,
                washJobId: job.id,
                serviceCode: svcCode,
                description: `Auto-issued ${vouchersToIssue} free wash voucher(s) — ${pointsDeducted} pts redeemed`,
                createdBy: "system",
              });
              const lastVoucher = issuedVouchers[issuedVouchers.length - 1];
              await storage.logEvent(tenantId, {
                type: "loyalty_voucher_issued",
                plateDisplay: job.plateDisplay,
                plateNormalized: job.plateNormalized,
                washJobId: job.id,
                payloadJson: {
                  voucherCode: lastVoucher?.code,
                  forPackageCode: packageCode,
                  pointsDeducted,
                  balanceAfter: balanceAfterDeduction,
                },
              });
              broadcastEvent({
                type: "loyalty_voucher_issued",
                washJobId: job.id,
                voucherCode: lastVoucher?.code,
                forPackageCode: packageCode,
                balance: balanceAfterDeduction,
                memberNumber: loyaltyAccount.membershipNumber,
              });
              // Fire CRM webhook for each issued voucher (non-blocking)
              for (const v of issuedVouchers) {
                fireWebhook("loyalty_voucher_issued", {
                  voucherCode: v.code,
                  plate: job.plateDisplay,
                  plateNormalized: job.plateNormalized,
                  memberNumber: loyaltyAccount.membershipNumber,
                  loyaltyAccountId: loyaltyAccount.id,
                  forPackageCode: v.forPackageCode ?? null,
                  forServiceCode: v.forServiceCode ?? null,
                  pointsRedeemed: v.pointsRedeemed,
                  issuedAt: v.issuedAt?.toISOString() ?? null,
                  expiresAt: v.expiresAt?.toISOString() ?? null,
                  washJobId: job.id,
                  branchId: job.branchId ?? null,
                }, tenantId).catch(() => {});
              }
            }
            const voucherIssued = issuedVouchers[issuedVouchers.length - 1] ?? null;

            // === NOTIFY CUSTOMER ON VOUCHER ISSUANCE ===
            if (issuedVouchers.length > 0 && voucherIssued) {
              const notifPhone = loyaltyAccount.customerPhone;
              const notifName = loyaltyAccount.customerName || "there";
              const expiryStr = voucherIssued.expiresAt
                ? new Date(voucherIssued.expiresAt).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })
                : "1 year from today";
              if (notifPhone) {
                storage.createNotification(tenantId, {
                  customerName: loyaltyAccount.customerName || undefined,
                  customerPhone: notifPhone,
                  customerEmail: loyaltyAccount.customerEmail || undefined,
                  plateNormalized: job.plateNormalized,
                  channel: "sms",
                  type: "VOUCHER_ISSUED",
                  message: `🎉 Hi ${notifName}! You've earned a FREE wash voucher. Code: ${voucherIssued.code}. Valid until ${expiryStr}. Show this code at your next visit. Thank you for being a loyal customer!`,
                  washJobId: job.id,
                  status: "pending",
                }).catch(() => {});
              }
              // Push notification to customer if they subscribed via customer tracking page
              const customerAccess = await storage.getCustomerJobAccessByJobId(job.id).catch(() => null);
              if (customerAccess) {
                sendPushToCustomer(customerAccess.token, {
                  title: "🎉 You've Earned a Free Wash!",
                  body: `Voucher code: ${voucherIssued.code}. Use it on your next visit!`,
                  url: `/customer/job/${customerAccess.token}`,
                  tag: `voucher-issued-${voucherIssued.id}`,
                }).catch(() => {});
              }
            }

            // Log the loyalty event
            await storage.logEvent(tenantId, {
              type: "loyalty_points_earned",
              plateDisplay: job.plateDisplay,
              plateNormalized: job.plateNormalized,
              washJobId: job.id,
              userId,
              payloadJson: {
                points: pointsToAward,
                serviceCode: svcCode,
                packageCode,
                balanceAfter: newBalance,
                memberNumber: loyaltyAccount.membershipNumber,
                tier: loyaltyAccount.tier,
                voucherIssued: voucherIssued?.code || null,
              },
            });

            // Broadcast loyalty update
            broadcastEvent({
              type: "loyalty_points_earned",
              washJobId: job.id,
              points: pointsToAward,
              balance: newBalance,
              memberNumber: loyaltyAccount.membershipNumber,
            });

            // Also increment local membership wash count if applicable
            const localMembership = await storage.getActiveMembershipForPlate(tenantId, job.plateNormalized);
            if (localMembership) {
              await storage.incrementMembershipWashUsed(localMembership.id, tenantId);
            }

            // === ALSO CREDIT CRM USER POINTS (non-blocking) ===
            if (crmCustForAccount?.userId) {
              creditCRMLoyaltyPoints(crmCustForAccount.userId, pointsToAward).catch(() => {});
            }
          }
        } catch (loyaltyErr) {
          // Non-blocking: log error but don't fail the wash completion
          console.error("Loyalty points credit failed (non-blocking):", loyaltyErr);
        }

        // === AUTO-QUEUE "CAR READY" SMS/WHATSAPP NOTIFICATION ===
        try {
          const loyaltyAccount = await storage.getLoyaltyAccountByPlate(tenantId, job.plateNormalized);
          const customerPhone = loyaltyAccount?.customerPhone;
          const customerName = loyaltyAccount?.customerName;
          if (customerPhone) {
            await storage.createNotification(tenantId, {
              customerName: customerName || undefined,
              customerPhone,
              customerEmail: loyaltyAccount?.customerEmail || undefined,
              plateNormalized: job.plateNormalized,
              channel: "sms",
              type: "wash_complete",
              message: `Hi ${customerName || "there"}! Your vehicle (${job.plateDisplay}) is ready for pickup.`,
              washJobId: job.id,
              status: "pending",
            });
          }
        } catch (notifErr) {
          console.error("Auto-notification queue failed (non-blocking):", notifErr);
        }

        // Push notification to customer on wash complete
        try {
          const customerAccess = await storage.getCustomerJobAccessByJobId(job.id);
          if (customerAccess) {
            await sendPushToCustomer(customerAccess.token, {
              title: "Your Car is Ready!",
              body: `Your vehicle (${job.plateDisplay}) is ready for pickup.`,
              url: `/customer/job/${customerAccess.token}`,
              tag: `wash-complete-${job.id}`,
            });
          }
        } catch (_pushErr) { /* non-blocking */ }

        // === AUTO-CONSUME INVENTORY ON WASH COMPLETION ===
        try {
          const svcCode = (job.serviceCode || "STANDARD") as string;
          await storage.autoConsumeForWashJob(tenantId, job.id, svcCode, userId);
        } catch (_invErr) {
          console.error("Inventory auto-consumption failed (non-blocking):", _invErr);
        }
      }

      res.json(job);
    } catch (error) {
      console.error("Error updating wash job status:", error);
      res.status(500).json({ message: "Failed to update status" });
    }
  });

  // Delete wash job (manager/admin only)
  app.delete("/api/wash-jobs/:id", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const job = await storage.getWashJob(req.params.id, tenantId);
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }

      const deleted = await storage.deleteWashJob(req.params.id, tenantId);
      if (!deleted) {
        return res.status(500).json({ message: "Failed to delete job" });
      }

      // Log the deletion event
      await storage.logEvent(tenantId, {
        type: "wash_deleted",
        plateDisplay: job.plateDisplay,
        plateNormalized: job.plateNormalized,
        countryHint: job.countryHint,
        userId: req.user.id,
        payloadJson: { jobId: job.id, serviceCode: job.serviceCode, status: job.status },
      });

      res.json({ message: "Job deleted" });
    } catch (error) {
      console.error("Error deleting wash job:", error);
      res.status(500).json({ message: "Failed to delete job" });
    }
  });

  // Send custom SMS/WhatsApp notification (manager/admin only)
  app.post("/api/notifications/send", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    const tenantId = (req as any).tenantId || "default";
    const schema = z.object({
      customerPhone: z.string().min(1),
      message: z.string().min(1),
      channel: z.enum(["sms", "whatsapp"]).default("sms"),
    });
    const result = schema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ message: result.error.errors[0].message });

    try {
      const notification = await storage.createNotification(tenantId, {
        customerPhone: result.data.customerPhone,
        channel: result.data.channel,
        type: "custom",
        message: result.data.message,
        status: "pending",
        createdBy: req.user?.claims?.sub || req.user?.id,
      });
      res.json(notification);
    } catch (error) {
      console.error("Error creating notification:", error);
      res.status(500).json({ message: "Failed to queue notification" });
    }
  });

  // =====================
  // WEB PUSH NOTIFICATIONS
  // =====================

  // Get VAPID public key (public endpoint)
  app.get("/api/push/vapid-key", (_req, res) => {
    const key = getVapidPublicKey();
    res.json({ vapidPublicKey: key });
  });

  // Staff push subscription (authenticated)
  app.post("/api/push/subscribe", isAuthenticated, async (req: any, res) => {
    const tenantId = (req as any).tenantId || "default";
    const schema = z.object({
      endpoint: z.string().url(),
      p256dh: z.string().min(1),
      auth: z.string().min(1),
    });
    const result = schema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ message: result.error.errors[0].message });

    try {
      const userId = req.user?.claims?.sub || req.user?.id;
      const sub = await storage.savePushSubscription(tenantId, {
        endpoint: result.data.endpoint,
        p256dh: result.data.p256dh,
        auth: result.data.auth,
        userId,
      });
      res.json(sub);
    } catch (error) {
      console.error("Error saving push subscription:", error);
      res.status(500).json({ message: "Failed to save subscription" });
    }
  });

  // Customer push subscription (token-gated)
  app.post("/api/customer/push/subscribe/:token", async (req, res) => {
    const { token } = req.params;
    const access = await storage.getCustomerJobAccessByToken(token);
    if (!access) return res.status(404).json({ message: "Invalid token" });

    const schema = z.object({
      endpoint: z.string().url(),
      p256dh: z.string().min(1),
      auth: z.string().min(1),
    });
    const result = schema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ message: result.error.errors[0].message });

    try {
      const tenantId = (req as any).tenantId || "default";
      const sub = await storage.savePushSubscription(tenantId, {
        endpoint: result.data.endpoint,
        p256dh: result.data.p256dh,
        auth: result.data.auth,
        customerToken: token,
      });
      res.json(sub);
    } catch (error) {
      console.error("Error saving customer push subscription:", error);
      res.status(500).json({ message: "Failed to save subscription" });
    }
  });

  // =====================
  // ETA & QUEUE POSITION
  // =====================

  // Helper: get priority-sorted active jobs for today
  async function getSortedActiveJobs(tenantId?: string) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const allJobs = await storage.getWashJobs(tenantId || "default", { fromDate: todayStart });
    const active = allJobs.filter(j => j.status !== "complete");
    const withPriority = await Promise.all(
      active.map(async (job) => {
        try {
          const { score } = await calculateJobPriority(job);
          return { ...job, priority: score };
        } catch {
          return { ...job, priority: 0 };
        }
      })
    );
    withPriority.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return withPriority;
  }

  // Queue position for authenticated users (technicians/managers)
  app.get("/api/wash-jobs/:id/queue-position", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const analytics = await storage.getAnalyticsSummary(tenantId);
      const sortedJobs = await getSortedActiveJobs(tenantId);
      const result = getQueuePosition(req.params.id as string, sortedJobs, analytics.avgCycleTimeMinutes);
      if (!result) return res.status(404).json({ message: "Job not in active queue" });
      res.json(result);
    } catch (error) {
      console.error("Error getting queue position:", error);
      res.status(500).json({ message: "Failed to get queue position" });
    }
  });

  // Queue position for customers (token-gated)
  app.get("/api/customer/job/:token/queue-position", async (req, res) => {
    try {
      const access = await storage.getCustomerJobAccessByToken(req.params.token);
      if (!access) return res.status(404).json({ message: "Invalid token" });

      const tenantId = (req as any).tenantId || "default";
      const analytics = await storage.getAnalyticsSummary(tenantId);
      const sortedJobs = await getSortedActiveJobs(tenantId);
      const result = getQueuePosition(access.washJobId, sortedJobs, analytics.avgCycleTimeMinutes);
      if (!result) return res.json({ position: 0, estimatedMinutes: 0, totalInQueue: 0, estimatedReadyAt: null });
      res.json(result);
    } catch (error) {
      console.error("Error getting customer queue position:", error);
      res.status(500).json({ message: "Failed to get queue position" });
    }
  });

  // Add photo to wash job
  app.post("/api/wash-jobs/:id/photos", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { photo } = req.body;
      if (!photo) {
        return res.status(400).json({ message: "Photo is required" });
      }

      const job = await storage.getWashJob(req.params.id, tenantId);
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }

      const saved = await savePhoto(photo);
      const washPhoto = await storage.addWashPhoto(tenantId, {
        washJobId: job.id,
        url: saved.url,
        statusAtTime: job.status as any,
      });

      // Log event
      await storage.logEvent(tenantId, {
        type: "wash_photo",
        plateDisplay: job.plateDisplay,
        plateNormalized: job.plateNormalized,
        countryHint: job.countryHint,
        washJobId: job.id,
        userId: req.user?.claims?.sub,
        payloadJson: { photoUrl: saved.url },
      });

      res.json(washPhoto);
    } catch (error) {
      console.error("Error adding wash photo:", error);
      res.status(500).json({ message: "Failed to add photo" });
    }
  });

  // =====================
  // WASH JOB CHECKLIST
  // =====================

  // Get checklist items for a wash job
  app.get("/api/wash-jobs/:id/checklist", isAuthenticated, async (req: any, res) => {
    try {
      const items = await storage.getServiceChecklistItems(req.params.id);
      res.json(items);
    } catch (error) {
      console.error("Error fetching checklist:", error);
      res.status(500).json({ message: "Failed to fetch checklist" });
    }
  });

  // Confirm/unconfirm a checklist item (technician marks step done)
  app.patch("/api/wash-jobs/:id/checklist/:itemId/confirm", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { confirmed } = req.body;
      const item = await storage.updateChecklistItemConfirmedForJob(
        req.params.itemId,
        req.params.id,
        confirmed !== false
      );
      if (!item) {
        return res.status(404).json({ message: "Checklist item not found" });
      }
      // Auto-advance job from "received" to "high_pressure_wash" on first checklist action
      let job = await storage.getWashJob(req.params.id, tenantId);
      if (job && job.status === "received") {
        job = await storage.updateWashJobStatus(req.params.id, "high_pressure_wash", tenantId) || job;
        broadcastEvent({ type: "wash_status_update", job });
      }
      // Broadcast checklist update to SSE clients
      if (job) broadcastEvent({ type: "checklist_updated", jobId: job.id, item });
      res.json(item);
    } catch (error) {
      console.error("Error confirming checklist item:", error);
      res.status(500).json({ message: "Failed to confirm checklist item" });
    }
  });

  // Skip a checklist item with optional reason
  app.patch("/api/wash-jobs/:id/checklist/:itemId/skip", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { reason } = req.body;
      const item = await storage.skipChecklistItem(
        req.params.itemId,
        req.params.id,
        reason
      );
      if (!item) {
        return res.status(404).json({ message: "Checklist item not found" });
      }
      // Auto-advance job from "received" to "high_pressure_wash" on first checklist action
      let job = await storage.getWashJob(req.params.id, tenantId);
      if (job && job.status === "received") {
        job = await storage.updateWashJobStatus(req.params.id, "high_pressure_wash", tenantId) || job;
        broadcastEvent({ type: "wash_status_update", job });
      }
      // Broadcast checklist update to SSE clients
      if (job) broadcastEvent({ type: "checklist_updated", jobId: job.id, item });
      res.json(item);
    } catch (error) {
      console.error("Error skipping checklist item:", error);
      res.status(500).json({ message: "Failed to skip checklist item" });
    }
  });

  // Get available service packages (for service selection UI)
  app.get("/api/service-packages", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      // Return both custom tenant packages from DB and built-in packages
      const dbPackages = await storage.getServicePackages(tenantId, true);
      const builtIn = Object.entries(SERVICE_PACKAGES).map(([code, pkg]) => ({
        code,
        name: pkg.label,
        description: pkg.description,
        tier: pkg.tier,
        durationMinutes: pkg.durationMinutes,
        steps: pkg.steps,
        pricing: pkg.pricing,
        serviceCode: pkg.serviceCode,
        isBuiltIn: true,
      }));
      res.json({ packages: dbPackages, builtInPackages: builtIn });
    } catch (error) {
      console.error("Error fetching service packages:", error);
      res.status(500).json({ message: "Failed to fetch service packages" });
    }
  });

  // Get steps for a specific service code (for preview)
  app.get("/api/service-steps/:code", async (req, res) => {
    const { code } = req.params;
    // Check named packages first
    if (SERVICE_PACKAGES[code]) {
      return res.json({
        code,
        label: SERVICE_PACKAGES[code].label,
        steps: SERVICE_PACKAGES[code].steps,
        durationMinutes: SERVICE_PACKAGES[code].durationMinutes,
      });
    }
    // Check service type config
    const cfg = SERVICE_TYPE_CONFIG[code as ServiceCode];
    if (cfg) {
      return res.json({
        code,
        label: cfg.label,
        steps: cfg.steps,
        durationMinutes: cfg.durationMinutes,
      });
    }
    res.status(404).json({ message: "Service not found" });
  });

  // =====================
  // PARKING
  // =====================
  // Feature gate: all parking endpoints require "parking" feature
  app.use("/api/parking", requireFeature("parking"));

  // Parking entry
  app.post("/api/parking/entry", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const result = parkingSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: result.error.errors[0].message });
      }

      const { plateDisplay, countryHint, photo } = result.data;
      const userId = req.user?.claims?.sub;
      const normalized = normalizePlate(plateDisplay);

      // Check for existing open session
      const existing = await storage.findOpenParkingSession(tenantId, normalized);
      if (existing) {
        return res.status(409).json({ 
          message: "Vehicle already has an open parking session",
          existingSession: existing
        });
      }

      // Save photo if provided
      let entryPhotoUrl: string | null = null;
      if (photo) {
        try {
          const saved = await savePhoto(photo);
          entryPhotoUrl = saved.url;
        } catch (err) {
          console.error("Photo save error:", err);
        }
      }

      const session = await storage.createParkingEntry(tenantId, {
        plateDisplay: displayPlate(plateDisplay),
        plateNormalized: normalized,
        countryHint,
        technicianId: userId,
        entryAt: new Date(),
        entryPhotoUrl,
      });

      // Log event
      await storage.logEvent(tenantId, {
        type: "parking_entry",
        plateDisplay: session.plateDisplay,
        plateNormalized: session.plateNormalized,
        countryHint: session.countryHint,
        parkingSessionId: session.id,
        userId,
        payloadJson: { hasPhoto: !!entryPhotoUrl },
      });

      broadcastEvent({ type: "parking_entry", session });

      // Fire CRM webhook (non-blocking)
      fireWebhook("parking_entry", { sessionId: session.id, plate: session.plateDisplay, plateNormalized: session.plateNormalized }).catch(() => {});

      res.json(session);
    } catch (error) {
      console.error("Error creating parking entry:", error);
      res.status(500).json({ message: "Failed to create parking entry" });
    }
  });

  // Parking exit
  app.post("/api/parking/exit", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const result = parkingSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: result.error.errors[0].message });
      }

      const { plateDisplay, photo } = result.data;
      const userId = req.user?.claims?.sub;
      const normalized = normalizePlate(plateDisplay);

      // Find open session
      const session = await storage.findOpenParkingSession(tenantId, normalized);
      if (!session) {
        return res.status(404).json({
          message: "No open parking session found for this plate"
        });
      }

      // Save exit photo if provided
      let exitPhotoUrl: string | undefined;
      if (photo) {
        try {
          const saved = await savePhoto(photo);
          exitPhotoUrl = saved.url;
        } catch (err) {
          console.error("Photo save error:", err);
        }
      }

      // Calculate fee with business settings
      const settings = await storage.getParkingSettings(tenantId);
      const businessSettings = await storage.getBusinessSettings(tenantId);
      const parker = await storage.getFrequentParker(tenantId, normalized);
      const validations = await storage.getParkingValidations(tenantId, session.id);
      const feeResult = calculateParkingFee(session, settings || null, parker, businessSettings, validations);

      const closedSession = await storage.closeParkingSession(session.id, exitPhotoUrl, feeResult.finalFee, tenantId);
      if (!closedSession) {
        return res.status(500).json({ message: "Failed to close parking session" });
      }

      // Update frequent parker stats
      if (parker) {
        await storage.incrementParkerVisit(tenantId, normalized, feeResult.finalFee);
      }

      // Log event
      await storage.logEvent(tenantId, {
        type: "parking_exit",
        plateDisplay: session.plateDisplay,
        plateNormalized: session.plateNormalized,
        countryHint: session.countryHint,
        parkingSessionId: session.id,
        userId,
        payloadJson: {
          hasPhoto: !!exitPhotoUrl,
          fee: feeResult.finalFee,
          duration: feeResult.durationMinutes
        },
      });

      broadcastEvent({ type: "parking_exit", session: closedSession });

      // Fire CRM webhook (non-blocking)
      fireWebhook("parking_exit", { sessionId: closedSession.id, plate: closedSession.plateDisplay, plateNormalized: closedSession.plateNormalized, fee: feeResult.finalFee, durationMinutes: feeResult.durationMinutes }).catch(() => {});

      res.json({
        ...closedSession,
        feeDetails: feeResult,
        formattedFee: formatCurrency(feeResult.finalFee, feeResult.currency)
      });
    } catch (error) {
      console.error("Error processing parking exit:", error);
      res.status(500).json({ message: "Failed to process parking exit" });
    }
  });

  // ==========================================
  // PARKING VALIDATIONS (Merchant Discounts)
  // ==========================================

  // Lookup active session by plate for validation (public route — validator kiosk)
  app.get("/api/parking/validate/lookup", async (req: any, res) => {
    try {
      const { plate, tenantId: qTenantId } = req.query as { plate?: string; tenantId?: string };
      if (!plate) return res.status(400).json({ message: "plate is required" });
      const tenantId = qTenantId || "default";
      const normalized = normalizePlate(plate as string);
      const session = await storage.findOpenParkingSession(tenantId, normalized);
      if (!session) return res.status(404).json({ message: "No active parking session found for this plate" });
      const settings = await storage.getParkingSettings(tenantId);
      const existing = await storage.getParkingValidations(tenantId, session.id);
      res.json({ session, settings, validations: existing });
    } catch (error) {
      console.error("Validation lookup error:", error);
      res.status(500).json({ message: "Lookup failed" });
    }
  });

  // Apply a validation discount (public route — validator kiosk)
  app.post("/api/parking/validate/apply", async (req: any, res) => {
    try {
      const { plate, validatorCode, validatorName, discountMinutes, discountPercent, discountAmount, tenantId: bodyTenantId } = req.body;
      if (!plate || !validatorCode || !validatorName) {
        return res.status(400).json({ message: "plate, validatorCode, and validatorName are required" });
      }
      const tenantId = bodyTenantId || "default";
      const normalized = normalizePlate(plate);
      const session = await storage.findOpenParkingSession(tenantId, normalized);
      if (!session) return res.status(404).json({ message: "No active parking session found" });
      const validation = await storage.createParkingValidation(tenantId, {
        parkingSessionId: session.id,
        validatorName,
        validatorCode,
        discountMinutes: discountMinutes || 0,
        discountPercent: discountPercent || 0,
        discountAmount: discountAmount || 0,
        validatedBy: validatorCode,
      });
      await storage.logEvent(tenantId, {
        type: "parking_validated",
        plateDisplay: session.plateDisplay,
        plateNormalized: session.plateNormalized,
        payloadJson: { validatorCode, validatorName, discountMinutes, discountPercent, discountAmount },
      });
      res.json(validation);
    } catch (error) {
      console.error("Validation apply error:", error);
      res.status(500).json({ message: "Failed to apply validation" });
    }
  });

  // List validations for a session (authenticated)
  app.get("/api/parking/sessions/:id/validations", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const validations = await storage.getParkingValidations(tenantId, req.params.id);
      res.json(validations);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch validations" });
    }
  });

  // Get parking sessions with enriched data
  app.get("/api/parking/sessions", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { open, plateSearch, fromDate, toDate, zoneId } = req.query;
      const filters: any = {};
      if (open === "true") filters.open = true;
      if (open === "false") filters.open = false;
      if (plateSearch) filters.plateSearch = plateSearch as string;
      if (fromDate) filters.fromDate = new Date(fromDate as string);
      if (toDate) filters.toDate = new Date(toDate as string);
      if (zoneId) filters.zoneId = zoneId as string;

      const sessions = await storage.getParkingSessions(tenantId, filters);
      const settings = await storage.getParkingSettings(tenantId);

      // Enrich sessions with duration and fee calculations
      const enrichedSessions = await Promise.all(
        sessions.map(async (session) => {
          const parker = await storage.getFrequentParker(tenantId, session.plateNormalized);
          return enrichSessionWithCalculations(session, settings || null, parker);
        })
      );

      res.json(enrichedSessions);
    } catch (error) {
      console.error("Error fetching parking sessions:", error);
      res.status(500).json({ message: "Failed to fetch parking sessions" });
    }
  });

  // Get single parking session with details
  app.get("/api/parking/sessions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const session = await storage.getParkingSession(String(req.params.id), tenantId);
      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }

      const settings = await storage.getParkingSettings(tenantId);
      const parker = await storage.getFrequentParker(tenantId, session.plateNormalized);
      const enriched = enrichSessionWithCalculations(session, settings || null, parker);

      res.json(enriched);
    } catch (error) {
      console.error("Error fetching parking session:", error);
      res.status(500).json({ message: "Failed to fetch parking session" });
    }
  });

  // Update parking session (assign zone/spot, add notes, link to wash)
  app.patch("/api/parking/sessions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { zoneId, spotNumber, notes, washJobId } = req.body;
      const session = await storage.updateParkingSession(String(req.params.id), {
        zoneId,
        spotNumber,
        notes,
        washJobId
      }, tenantId);

      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }

      broadcastEvent({ type: "parking_updated", session });
      res.json(session);
    } catch (error) {
      console.error("Error updating parking session:", error);
      res.status(500).json({ message: "Failed to update parking session" });
    }
  });

  // Parking analytics
  app.get("/api/parking/analytics", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const analytics = await storage.getParkingAnalytics(tenantId);
      res.json(analytics);
    } catch (error) {
      console.error("Error fetching parking analytics:", error);
      res.status(500).json({ message: "Failed to fetch parking analytics" });
    }
  });

  // =====================
  // PARKING SETTINGS
  // =====================

  app.get("/api/parking/settings", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      let settings = await storage.getParkingSettings(tenantId);
      if (!settings) {
        // Return defaults
        settings = {
          id: "",
          tenantId: "default",
          branchId: null,
          hourlyRate: 500,
          firstHourRate: null,
          dailyMaxRate: 3000,
          weeklyRate: null,
          monthlyPassRate: 5000,
          nightRate: null,
          nightStartHour: 22,
          nightEndHour: 6,
          weekendRate: null,
          gracePeriodMinutes: 15,
          overstayPenaltyRate: null,
          lostTicketFee: 2000,
          validationDiscountPercent: 0,
          totalCapacity: 50,
          currency: "USD",
          updatedBy: null,
          updatedAt: null,
          createdAt: null
        };
      }
      res.json(settings);
    } catch (error) {
      console.error("Error fetching parking settings:", error);
      res.status(500).json({ message: "Failed to fetch parking settings" });
    }
  });

  app.put("/api/parking/settings", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const {
        hourlyRate, firstHourRate, dailyMaxRate, weeklyRate, monthlyPassRate,
        nightRate, nightStartHour, nightEndHour, weekendRate,
        gracePeriodMinutes, overstayPenaltyRate, lostTicketFee, validationDiscountPercent,
        totalCapacity, currency
      } = req.body;
      const userId = req.user?.claims?.sub;

      const settings = await storage.upsertParkingSettings(tenantId, {
        hourlyRate,
        firstHourRate,
        dailyMaxRate,
        weeklyRate,
        monthlyPassRate,
        nightRate,
        nightStartHour,
        nightEndHour,
        weekendRate,
        gracePeriodMinutes,
        overstayPenaltyRate,
        lostTicketFee,
        validationDiscountPercent,
        totalCapacity,
        currency,
        updatedBy: userId
      });

      res.json(settings);
    } catch (error) {
      console.error("Error updating parking settings:", error);
      res.status(500).json({ message: "Failed to update parking settings" });
    }
  });

  // =====================
  // BUSINESS SETTINGS
  // =====================

  app.get("/api/business/settings", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      let settings = await storage.getBusinessSettings(tenantId);
      if (!settings) {
        // Return defaults
        settings = {
          id: "",
          tenantId: "default",
          branchId: null,
          businessName: "ParkWash Pro",
          businessLogo: null,
          businessAddress: null,
          businessPhone: null,
          businessEmail: null,
          currency: "USD",
          currencySymbol: "$",
          locale: "en-US",
          timezone: "UTC",
          taxRate: 0,
          taxLabel: "Tax",
          receiptFooter: null,
          updatedBy: null,
          updatedAt: null,
          createdAt: null
        };
      }
      res.json(settings);
    } catch (error) {
      console.error("Error fetching business settings:", error);
      res.status(500).json({ message: "Failed to fetch business settings" });
    }
  });

  app.put("/api/business/settings", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const {
        businessName, businessLogo, businessAddress, businessPhone, businessEmail,
        currency, currencySymbol, locale, timezone, taxRate, taxLabel, receiptFooter
      } = req.body;
      const userId = req.user?.claims?.sub;

      const settings = await storage.upsertBusinessSettings(tenantId, {
        businessName,
        businessLogo,
        businessAddress,
        businessPhone,
        businessEmail,
        currency,
        currencySymbol,
        locale,
        timezone,
        taxRate,
        taxLabel,
        receiptFooter,
        updatedBy: userId
      });

      res.json(settings);
    } catch (error) {
      console.error("Error updating business settings:", error);
      res.status(500).json({ message: "Failed to update business settings" });
    }
  });

  // =====================
  // PARKING ZONES
  // =====================

  app.get("/api/parking/zones", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { all } = req.query;
      const zones = await storage.getParkingZones(tenantId, all !== "true");

      // Add occupancy info
      const zonesWithOccupancy = await Promise.all(
        zones.map(async (zone) => {
          const occupied = await storage.getZoneOccupancy(tenantId, zone.id);
          return { ...zone, occupied, available: (zone.capacity || 0) - occupied };
        })
      );

      res.json(zonesWithOccupancy);
    } catch (error) {
      console.error("Error fetching parking zones:", error);
      res.status(500).json({ message: "Failed to fetch parking zones" });
    }
  });

  app.post("/api/parking/zones", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { name, code, capacity, hourlyRate, description } = req.body;
      const zone = await storage.createParkingZone(tenantId, {
        name,
        code,
        capacity,
        hourlyRate,
        description
      });
      res.json(zone);
    } catch (error) {
      console.error("Error creating parking zone:", error);
      res.status(500).json({ message: "Failed to create parking zone" });
    }
  });

  app.put("/api/parking/zones/:id", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { name, code, capacity, hourlyRate, description, isActive } = req.body;
      const zone = await storage.updateParkingZone(String(req.params.id), {
        name,
        code,
        capacity,
        hourlyRate,
        description,
        isActive
      }, tenantId);

      if (!zone) {
        return res.status(404).json({ message: "Zone not found" });
      }

      res.json(zone);
    } catch (error) {
      console.error("Error updating parking zone:", error);
      res.status(500).json({ message: "Failed to update parking zone" });
    }
  });

  // =====================
  // FREQUENT PARKERS / VIP
  // =====================

  app.get("/api/parking/frequent-parkers", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { vip, monthlyPass } = req.query;
      const filters: any = {};
      if (vip === "true") filters.isVip = true;
      if (monthlyPass === "true") filters.hasMonthlyPass = true;

      const parkers = await storage.getFrequentParkers(tenantId, filters);
      res.json(parkers);
    } catch (error) {
      console.error("Error fetching frequent parkers:", error);
      res.status(500).json({ message: "Failed to fetch frequent parkers" });
    }
  });

  app.get("/api/parking/frequent-parkers/:plate", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const normalized = normalizePlate(String(req.params.plate));
      const parker = await storage.getFrequentParker(tenantId, normalized);

      if (!parker) {
        return res.status(404).json({ message: "Parker not found" });
      }

      res.json(parker);
    } catch (error) {
      console.error("Error fetching frequent parker:", error);
      res.status(500).json({ message: "Failed to fetch frequent parker" });
    }
  });

  app.put("/api/parking/frequent-parkers/:id", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { customerName, customerPhone, customerEmail, isVip, monthlyPassExpiry, notes } = req.body;
      const parker = await storage.updateFrequentParker(String(req.params.id), {
        customerName,
        customerPhone,
        customerEmail,
        isVip,
        monthlyPassExpiry: monthlyPassExpiry ? new Date(monthlyPassExpiry) : undefined,
        notes
      }, tenantId);

      if (!parker) {
        return res.status(404).json({ message: "Parker not found" });
      }

      res.json(parker);
    } catch (error) {
      console.error("Error updating frequent parker:", error);
      res.status(500).json({ message: "Failed to update frequent parker" });
    }
  });

  // =====================
  // PARKING RESERVATIONS
  // =====================

  app.get("/api/parking/reservations", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { status, fromDate, toDate } = req.query;
      const filters: any = {};
      if (status) filters.status = status as string;
      if (fromDate) filters.fromDate = new Date(fromDate as string);
      if (toDate) filters.toDate = new Date(toDate as string);

      const reservations = await storage.getParkingReservations(tenantId, filters);
      res.json(reservations);
    } catch (error) {
      console.error("Error fetching reservations:", error);
      res.status(500).json({ message: "Failed to fetch reservations" });
    }
  });

  app.post("/api/parking/reservations", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { plateDisplay, customerName, customerPhone, customerEmail, zoneId, spotNumber, reservedFrom, reservedUntil, notes } = req.body;

      const confirmationCode = generateConfirmationCode();

      const reservation = await storage.createParkingReservation(tenantId, {
        plateDisplay,
        customerName,
        customerPhone,
        customerEmail,
        zoneId,
        spotNumber,
        reservedFrom: new Date(reservedFrom),
        reservedUntil: new Date(reservedUntil),
        confirmationCode,
        status: "confirmed",
        notes
      });

      res.json(reservation);
    } catch (error) {
      console.error("Error creating reservation:", error);
      res.status(500).json({ message: "Failed to create reservation" });
    }
  });

  app.get("/api/parking/reservations/lookup/:code", async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const reservation = await storage.getParkingReservationByCode(String(req.params.code), tenantId);
      if (!reservation) {
        return res.status(404).json({ message: "Reservation not found" });
      }
      res.json(reservation);
    } catch (error) {
      console.error("Error looking up reservation:", error);
      res.status(500).json({ message: "Failed to lookup reservation" });
    }
  });

  app.put("/api/parking/reservations/:id", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { status, plateDisplay, zoneId, spotNumber, notes } = req.body;
      const reservation = await storage.updateParkingReservation(String(req.params.id), {
        status,
        plateDisplay,
        zoneId,
        spotNumber,
        notes
      }, tenantId);

      if (!reservation) {
        return res.status(404).json({ message: "Reservation not found" });
      }

      res.json(reservation);
    } catch (error) {
      console.error("Error updating reservation:", error);
      res.status(500).json({ message: "Failed to update reservation" });
    }
  });

  // Check-in with reservation code
  app.post("/api/parking/reservations/:id/check-in", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const reservation = await storage.getParkingReservation(String(req.params.id), tenantId);
      if (!reservation) {
        return res.status(404).json({ message: "Reservation not found" });
      }

      if (reservation.status !== "confirmed") {
        return res.status(400).json({ message: "Reservation is not in confirmed status" });
      }

      const userId = req.user?.claims?.sub;
      const plateDisplay = reservation.plateDisplay || "RESERVED";
      const plateNormalized = normalizePlate(plateDisplay);

      // Create parking session
      const session = await storage.createParkingEntry(tenantId, {
        plateDisplay,
        plateNormalized,
        technicianId: userId,
        zoneId: reservation.zoneId || undefined,
        spotNumber: reservation.spotNumber || undefined
      });

      // Update reservation
      await storage.checkInReservation(reservation.id, session.id, tenantId);

      // Track frequent parker
      if (reservation.plateDisplay) {
        const normalized = normalizePlate(reservation.plateDisplay);
        await storage.getOrCreateFrequentParker(tenantId, normalized, reservation.plateDisplay);
      }

      broadcastEvent({ type: "parking_entry", session });

      res.json({ session, reservation: { ...reservation, status: "checked_in" } });
    } catch (error) {
      console.error("Error checking in reservation:", error);
      res.status(500).json({ message: "Failed to check in reservation" });
    }
  });

  // =====================
  // MANAGER ENDPOINTS (require manager/admin role)
  // =====================

  // Events / Audit Log
  app.get("/api/events", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { plate, type, limit } = req.query;
      const events = await storage.getEvents(tenantId, {
        plate: plate as string,
        type: type as string,
        limit: limit ? parseInt(limit as string) : 100,
      });

      // Enrich events with user display names
      const allUsers = await storage.getUsers(tenantId);
      const userMap = new Map(allUsers.map(u => [u.id, u]));

      const enriched = events.map(event => {
        const user = event.userId ? userMap.get(event.userId) : null;
        return {
          ...event,
          userDisplayName: user
            ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email
            : null,
        };
      });

      res.json(enriched);
    } catch (error) {
      console.error("Error fetching events:", error);
      res.status(500).json({ message: "Failed to fetch events" });
    }
  });

  // Analytics
  app.get("/api/analytics/summary", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const summary = await storage.getAnalyticsSummary(tenantId);
      res.json(summary);
    } catch (error) {
      console.error("Error fetching analytics:", error);
      res.status(500).json({ message: "Failed to fetch analytics" });
    }
  });

  // Technician performance (customer ratings aggregation)
  app.get("/api/analytics/technician-performance", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const performance = await storage.getTechnicianPerformance(tenantId);
      res.json(performance);
    } catch (error) {
      console.error("Error fetching technician performance:", error);
      res.status(500).json({ message: "Failed to fetch technician performance" });
    }
  });

  // Revenue analytics
  app.get("/api/analytics/revenue", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const revenue = await storage.getRevenueSummary(tenantId);
      res.json(revenue);
    } catch (error) {
      console.error("Error fetching revenue analytics:", error);
      res.status(500).json({ message: "Failed to fetch revenue analytics" });
    }
  });

  // Customer insights analytics
  app.get("/api/analytics/customer-insights", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const insights = await storage.getCustomerInsights(tenantId);
      res.json(insights);
    } catch (error) {
      console.error("Error fetching customer insights:", error);
      res.status(500).json({ message: "Failed to fetch customer insights" });
    }
  });

  // Cross-branch consolidated analytics
  app.get("/api/analytics/cross-branch", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const data = await storage.getCrossBranchAnalytics(tenantId);
      res.json(data);
    } catch (error) {
      console.error("Error fetching cross-branch analytics:", error);
      res.status(500).json({ message: "Failed to fetch cross-branch analytics" });
    }
  });

  // Live queue stats
  app.get("/api/queue/stats", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      // Only show today's jobs in the live queue
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const todayJobs = await storage.getWashJobs(tenantId, { fromDate: todayStart });
      const openParking = await storage.getParkingSessions(tenantId, { open: true });
      const analytics = await storage.getAnalyticsSummary(tenantId);

      // Calculate priority for active jobs
      const activeJobs = todayJobs.filter(j => j.status !== "complete");
      const jobsWithPriority = await Promise.all(
        activeJobs.map(async (job) => {
          try {
            const { score, factors } = await calculateJobPriority(job);
            // Include checklist progress for live queue display
            const checklist = await storage.getServiceChecklistItems(job.id);
            const totalSteps = checklist.length;
            const doneSteps = checklist.filter(i => i.confirmed || i.skipped).length;
            // Find current step name (first unfinished step)
            const currentStep = checklist.find(i => !i.confirmed && !i.skipped);
            const currentStepLabel = currentStep?.label || null;

            // Auto-fix: if job is still "received" but has confirmed/skipped steps, advance to "high_pressure_wash"
            let updatedJob = job;
            if (job.status === "received" && doneSteps > 0) {
              const advanced = await storage.updateWashJobStatus(job.id, "high_pressure_wash", tenantId);
              if (advanced) {
                updatedJob = advanced;
                broadcastEvent({ type: "wash_status_update", job: advanced });
              }
            }

            return { ...updatedJob, priority: score, priorityFactors: factors, checklistTotal: totalSteps, checklistDone: doneSteps, currentStepLabel };
          } catch {
            return { ...job, priority: 0, priorityFactors: {}, checklistTotal: 0, checklistDone: 0, currentStepLabel: null };
          }
        })
      );

      // Sort by priority descending
      jobsWithPriority.sort((a, b) => (b.priority || 0) - (a.priority || 0));

      res.json({
        activeWashes: activeJobs.length,
        parkedVehicles: openParking.length,
        todayWashes: analytics.todayWashes,
        activeJobs: jobsWithPriority,
      });
    } catch (error) {
      console.error("Error fetching queue stats:", error);
      res.status(500).json({ message: "Failed to fetch queue stats" });
    }
  });

  // =====================
  // CRM BOOKINGS (from external booking database)
  // =====================

  // Get upcoming bookings from CRM
  app.get("/api/crm/bookings", isAuthenticated, async (req, res) => {
    try {
      const bookings = await getUpcomingBookings(30);
      res.json(bookings);
    } catch (error) {
      console.error("Error fetching CRM bookings:", error);
      res.status(500).json({ message: "Failed to fetch bookings" });
    }
  });

  // Get today's bookings from CRM
  app.get("/api/crm/bookings/today", isAuthenticated, async (req, res) => {
    try {
      const bookings = await getTodayBookings();
      res.json(bookings);
    } catch (error) {
      console.error("Error fetching today's bookings:", error);
      res.status(500).json({ message: "Failed to fetch bookings" });
    }
  });

  // Search booking by license plate
  app.get("/api/crm/bookings/search", isAuthenticated, async (req, res) => {
    try {
      const { plate } = req.query;
      if (!plate || typeof plate !== "string") {
        return res.status(400).json({ message: "Plate parameter required" });
      }

      const booking = await findBookingByPlate(plate);
      if (!booking) {
        return res.status(404).json({ message: "No booking found for this plate" });
      }

      res.json(booking);
    } catch (error) {
      console.error("Error searching CRM booking:", error);
      res.status(500).json({ message: "Failed to search booking" });
    }
  });

  // Update booking status in CRM (when wash completes)
  app.patch("/api/crm/bookings/:id/status", isAuthenticated, async (req, res) => {
    try {
      const id = req.params.id as string;
      const status = req.body.status as string;

      if (!["IN_PROGRESS", "COMPLETED", "READY_FOR_PICKUP"].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }

      const success = await updateBookingStatus(id, status as "IN_PROGRESS" | "COMPLETED" | "READY_FOR_PICKUP");
      if (!success) {
        return res.status(500).json({ message: "Failed to update booking status" });
      }

      res.json({ message: "Booking status updated" });
    } catch (error) {
      console.error("Error updating CRM booking status:", error);
      res.status(500).json({ message: "Failed to update status" });
    }
  });

  // Get booking with membership info
  app.get("/api/crm/bookings/:id/details", isAuthenticated, async (req, res) => {
    try {
      const id = req.params.id as string;
      const booking = await getBookingWithMembership(id);
      if (!booking) {
        return res.status(404).json({ message: "Booking not found" });
      }
      res.json(booking);
    } catch (error) {
      console.error("Error fetching booking details:", error);
      res.status(500).json({ message: "Failed to fetch booking details" });
    }
  });

  // Get upcoming bookings with membership info
  app.get("/api/crm/bookings/with-memberships", isAuthenticated, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 30;
      const bookings = await getUpcomingBookingsWithMemberships(limit);
      res.json(bookings);
    } catch (error) {
      console.error("Error fetching bookings with memberships:", error);
      res.status(500).json({ message: "Failed to fetch bookings" });
    }
  });

  // =====================
  // CRM NOTIFICATIONS (from external CRM database)
  // =====================

  // Get notifications from CRM
  app.get("/api/crm/notifications", isAuthenticated, async (req, res) => {
    try {
      const { userId, status, type, limit } = req.query;
      const notifications = await getCRMNotifications({
        userId: userId as string | undefined,
        status: status as string | undefined,
        type: type as string | undefined,
        limit: limit ? parseInt(limit as string) : undefined,
      });
      res.json(notifications);
    } catch (error) {
      console.error("Error fetching CRM notifications:", error);
      res.status(500).json({ message: "Failed to fetch notifications" });
    }
  });

  // Get notifications for a customer by email or phone
  app.get("/api/crm/notifications/customer", isAuthenticated, async (req, res) => {
    try {
      const { email, phone, limit } = req.query;
      if (!email && !phone) {
        return res.status(400).json({ message: "Email or phone required" });
      }

      const notifications = await getCRMNotificationsForCustomer(
        email as string | undefined,
        phone as string | undefined,
        limit ? parseInt(limit as string) : 50
      );
      res.json(notifications);
    } catch (error) {
      console.error("Error fetching customer notifications:", error);
      res.status(500).json({ message: "Failed to fetch notifications" });
    }
  });

  // Create notification in CRM
  app.post("/api/crm/notifications", isAuthenticated, async (req, res) => {
    try {
      const schema = z.object({
        userId: z.string(),
        type: z.string(),
        title: z.string(),
        message: z.string(),
        channel: z.enum(["sms", "email", "push", "both"]),
        bookingId: z.string().optional(),
        vehicleId: z.string().optional(),
      });

      const data = schema.parse(req.body);
      const notification = await createCRMNotification(data);

      if (!notification) {
        return res.status(500).json({ message: "Failed to create notification" });
      }

      res.status(201).json(notification);
    } catch (error) {
      console.error("Error creating CRM notification:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create notification" });
    }
  });

  // Update notification status in CRM
  app.patch("/api/crm/notifications/:id/status", isAuthenticated, async (req, res) => {
    try {
      const id = req.params.id as string;
      const { status } = req.body;
      if (!["pending", "sent", "failed", "read"].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }

      const success = await updateCRMNotificationStatus(id, status);
      if (!success) {
        return res.status(500).json({ message: "Failed to update notification status" });
      }

      res.json({ message: "Notification status updated" });
    } catch (error) {
      console.error("Error updating CRM notification status:", error);
      res.status(500).json({ message: "Failed to update status" });
    }
  });

  // =====================
  // CRM SUBSCRIPTIONS/MEMBERSHIPS (from external CRM database)
  // =====================

  // Get subscriptions from CRM
  app.get("/api/crm/subscriptions", isAuthenticated, async (req, res) => {
    try {
      const { userId, status, type } = req.query;
      const subscriptions = await getCRMSubscriptions({
        userId: userId as string | undefined,
        status: status as string | undefined,
        type: type as string | undefined,
      });
      res.json(subscriptions);
    } catch (error) {
      console.error("Error fetching CRM subscriptions:", error);
      res.status(500).json({ message: "Failed to fetch subscriptions" });
    }
  });

  // Find subscription by license plate
  app.get("/api/crm/subscriptions/by-plate", isAuthenticated, async (req, res) => {
    try {
      const { plate } = req.query;
      if (!plate || typeof plate !== "string") {
        return res.status(400).json({ message: "Plate parameter required" });
      }

      const subscription = await findCRMSubscriptionByPlate(plate);
      if (!subscription) {
        return res.status(404).json({ message: "No active subscription found for this plate" });
      }

      res.json(subscription);
    } catch (error) {
      console.error("Error finding subscription by plate:", error);
      res.status(500).json({ message: "Failed to find subscription" });
    }
  });

  // Find subscription by email
  app.get("/api/crm/subscriptions/by-email", isAuthenticated, async (req, res) => {
    try {
      const { email } = req.query;
      if (!email || typeof email !== "string") {
        return res.status(400).json({ message: "Email parameter required" });
      }

      const subscription = await findCRMSubscriptionByEmail(email);
      if (!subscription) {
        return res.status(404).json({ message: "No active subscription found for this email" });
      }

      res.json(subscription);
    } catch (error) {
      console.error("Error finding subscription by email:", error);
      res.status(500).json({ message: "Failed to find subscription" });
    }
  });

  // Find subscription by phone
  app.get("/api/crm/subscriptions/by-phone", isAuthenticated, async (req, res) => {
    try {
      const { phone } = req.query;
      if (!phone || typeof phone !== "string") {
        return res.status(400).json({ message: "Phone parameter required" });
      }

      const subscription = await findCRMSubscriptionByPhone(phone);
      if (!subscription) {
        return res.status(404).json({ message: "No active subscription found for this phone" });
      }

      res.json(subscription);
    } catch (error) {
      console.error("Error finding subscription by phone:", error);
      res.status(500).json({ message: "Failed to find subscription" });
    }
  });

  // =====================
  // CRM BOOKING MANAGEMENT (Ekhaya)
  // =====================

  // Manager search bookings (by name, email, phone, plate, reference)
  app.get("/api/crm/bookings/manager", isAuthenticated, async (req, res) => {
    try {
      const { search, status, limit } = req.query;
      const filters: any = {};
      if (search && typeof search === "string") filters.customerSearch = search;
      if (status && typeof status === "string") filters.status = status;
      if (limit) filters.limit = parseInt(limit as string, 10);

      const result = await getManagerBookings(filters);
      res.json(result);
    } catch (error) {
      console.error("Error fetching CRM manager bookings:", error);
      res.status(500).json({ message: "Failed to fetch bookings" });
    }
  });

  // Get single CRM booking details
  app.get("/api/crm/bookings/:id", isAuthenticated, async (req, res) => {
    try {
      const id = req.params.id as string;
      const booking = await getBookingById(id);
      if (!booking) {
        return res.status(404).json({ message: "Booking not found" });
      }
      res.json(booking);
    } catch (error) {
      console.error("Error fetching CRM booking:", error);
      res.status(500).json({ message: "Failed to fetch booking" });
    }
  });

  // Update CRM booking (reschedule, change status, update notes)
  app.patch("/api/crm/bookings/:id", isAuthenticated, async (req, res) => {
    try {
      const bookingId = req.params.id as string;
      const { bookingDate, timeSlot, serviceId, notes, status } = req.body;

      const updates: any = {};
      if (bookingDate) updates.bookingDate = bookingDate;
      if (timeSlot) updates.timeSlot = timeSlot;
      if (serviceId) updates.serviceId = serviceId;
      if (notes !== undefined) updates.notes = notes;
      if (status) updates.status = status;

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No updates provided" });
      }

      const success = await updateCRMBooking(bookingId, updates);
      if (!success) {
        return res.status(500).json({ message: "Failed to update booking" });
      }

      res.json({ message: "Booking updated successfully" });
    } catch (error) {
      console.error("Error updating CRM booking:", error);
      res.status(500).json({ message: "Failed to update booking" });
    }
  });

  // Cancel CRM booking
  app.delete("/api/crm/bookings/:id", isAuthenticated, async (req, res) => {
    try {
      const id = req.params.id as string;
      const success = await cancelCRMBooking(id);
      if (!success) {
        return res.status(500).json({ message: "Failed to cancel booking" });
      }
      res.json({ message: "Booking cancelled successfully" });
    } catch (error) {
      console.error("Error cancelling CRM booking:", error);
      res.status(500).json({ message: "Failed to cancel booking" });
    }
  });

  // =====================
  // BOOKING PAYMENTS
  // =====================

  // Confirm payment for a CRM booking
  app.post("/api/crm/bookings/:id/payment", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const bookingId = req.params.id;
      const userId = (req as any).user?.claims?.sub;
      const { amount, paymentMethod, paymentReference, confirmedBy, notes } = req.body;

      if (!amount || !paymentMethod || !confirmedBy) {
        return res.status(400).json({ message: "amount, paymentMethod, and confirmedBy are required" });
      }

      if (!["cash", "card", "eft", "mobile"].includes(paymentMethod)) {
        return res.status(400).json({ message: "Invalid payment method" });
      }

      // Check if payment already exists for this booking
      const existing = await storage.getBookingPaymentByBookingId(bookingId, tenantId);
      if (existing) {
        return res.status(409).json({ message: "Payment already recorded for this booking", payment: existing });
      }

      // Get booking details from CRM for the receipt
      const booking = await getBookingById(bookingId);
      if (!booking) {
        return res.status(404).json({ message: "Booking not found" });
      }

      // Generate receipt number
      const receiptNumber = await storage.generateReceiptNumber(tenantId);

      // Create payment record
      const payment = await storage.createBookingPayment(tenantId, {
        bookingId,
        receiptNumber,
        amount: parseInt(String(amount), 10),
        paymentMethod,
        paymentReference: paymentReference || null,
        confirmedBy,
        confirmedByUserId: userId,
        customerName: booking.customerName,
        customerEmail: booking.customerEmail,
        customerPhone: booking.customerPhone,
        licensePlate: booking.licensePlate,
        serviceName: booking.serviceName,
        bookingDate: booking.bookingDate,
        timeSlot: booking.timeSlot,
        notes: notes || null,
      });

      // Update CRM booking status to COMPLETED
      await updateCRMBooking(bookingId, { status: "COMPLETED" });

      // Log the payment event
      await storage.logEvent(tenantId, {
        type: "booking_payment_confirmed",
        userId,
        payloadJson: {
          bookingId,
          receiptNumber,
          amount,
          paymentMethod,
          confirmedBy,
          confirmedAt: new Date().toISOString(),
        },
      });

      res.json({
        message: "Payment confirmed successfully",
        payment,
      });
    } catch (error) {
      console.error("Error confirming payment:", error);
      res.status(500).json({ message: "Failed to confirm payment" });
    }
  });

  // Get payment for a booking
  app.get("/api/crm/bookings/:id/payment", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const bookingId = req.params.id;
      const payment = await storage.getBookingPaymentByBookingId(bookingId, tenantId);
      if (!payment) {
        return res.status(404).json({ message: "No payment found for this booking" });
      }

      // Get business settings for receipt branding
      const settings = await storage.getBusinessSettings(tenantId);

      res.json({
        payment,
        businessSettings: settings ? {
          businessName: settings.businessName,
          businessLogo: settings.businessLogo,
          businessAddress: settings.businessAddress,
          businessPhone: settings.businessPhone,
          businessEmail: settings.businessEmail,
          currency: settings.currency,
          currencySymbol: settings.currencySymbol,
          taxRate: settings.taxRate,
          taxLabel: settings.taxLabel,
          receiptFooter: settings.receiptFooter,
        } : null,
      });
    } catch (error) {
      console.error("Error fetching payment:", error);
      res.status(500).json({ message: "Failed to fetch payment" });
    }
  });

  // Send receipt email to customer
  app.post("/api/crm/bookings/:id/send-receipt", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const bookingId = req.params.id;
      const { paymentId } = req.body;

      // Get payment record
      let payment;
      if (paymentId) {
        payment = await storage.getBookingPayment(paymentId, tenantId);
      } else {
        payment = await storage.getBookingPaymentByBookingId(bookingId, tenantId);
      }
      if (!payment) {
        return res.status(404).json({ message: "No payment found for this booking" });
      }

      const recipientEmail = payment.customerEmail;
      if (!recipientEmail) {
        return res.status(400).json({ message: "No email address on file for this customer" });
      }

      // Get business settings for branding
      const settings = await storage.getBusinessSettings(tenantId);
      const businessName = settings?.businessName || "EKHAYA CAR WASH";
      const businessPhone = settings?.businessPhone || "";
      const businessEmail = settings?.businessEmail || "";
      const businessAddress = settings?.businessAddress || "";
      const currencySymbol = settings?.currencySymbol || "R";

      const formatAmount = (cents: number) => `${currencySymbol} ${(cents / 100).toFixed(2)}`;
      const paymentDate = payment.createdAt ? new Date(payment.createdAt).toLocaleDateString("en-ZA", { year: "numeric", month: "long", day: "numeric" }) : "N/A";
      const serviceDate = payment.bookingDate ? new Date(payment.bookingDate + "T00:00:00").toLocaleDateString("en-ZA", { year: "numeric", month: "long", day: "numeric" }) : "N/A";
      const generatedDate = new Date().toLocaleDateString("en-ZA", { year: "numeric", month: "long", day: "numeric" });

      const receiptHTML = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family: Arial, sans-serif; color: #333; background: #f9fafb; margin: 0; padding: 0;">
  <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; margin-top: 32px; margin-bottom: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <div style="background: #2563eb; padding: 24px 32px; text-align: center; color: #fff;">
      <h1 style="margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 1px;">${businessName}</h1>
      <p style="margin: 4px 0 0; font-size: 12px; opacity: 0.9;">Premium Car Care Services</p>
    </div>
    <div style="padding: 24px 32px;">
      <div style="border-left: 4px solid #2563eb; padding: 12px 16px; background: #f8fafc; margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <p style="margin: 0; font-size: 12px; color: #6b7280;">Receipt Number</p>
            <p style="margin: 2px 0; font-weight: 700; font-size: 15px;">${payment.receiptNumber || "N/A"}</p>
            <p style="margin: 2px 0; font-size: 11px; color: #9ca3af;">Generated: ${generatedDate}</p>
          </div>
          <div style="background: #dcfce7; color: #166534; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 700;">PAID</div>
        </div>
      </div>

      <h3 style="font-size: 13px; text-transform: uppercase; color: #6b7280; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; margin-bottom: 12px;">Customer Information</h3>
      <table style="width: 100%; margin-bottom: 20px; font-size: 14px;">
        <tr><td style="padding: 4px 0; color: #6b7280; width: 120px;">Name</td><td style="padding: 4px 0; font-weight: 600;">${payment.customerName || "N/A"}</td></tr>
        <tr><td style="padding: 4px 0; color: #6b7280;">Email</td><td style="padding: 4px 0;">${payment.customerEmail || "N/A"}</td></tr>
        <tr><td style="padding: 4px 0; color: #6b7280;">Phone</td><td style="padding: 4px 0;">${payment.customerPhone || "N/A"}</td></tr>
      </table>

      <h3 style="font-size: 13px; text-transform: uppercase; color: #6b7280; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; margin-bottom: 12px;">Service Details</h3>
      <table style="width: 100%; margin-bottom: 20px; font-size: 14px;">
        <tr><td style="padding: 4px 0; color: #6b7280; width: 120px;">Service</td><td style="padding: 4px 0; font-weight: 600;">${payment.serviceName || "N/A"}</td></tr>
        <tr><td style="padding: 4px 0; color: #6b7280;">Vehicle</td><td style="padding: 4px 0;">${payment.licensePlate || "N/A"}</td></tr>
        <tr><td style="padding: 4px 0; color: #6b7280;">Service Date</td><td style="padding: 4px 0;">${serviceDate}</td></tr>
        <tr><td style="padding: 4px 0; color: #6b7280;">Service Time</td><td style="padding: 4px 0;">${payment.timeSlot || "N/A"}</td></tr>
      </table>

      <h3 style="font-size: 13px; text-transform: uppercase; color: #6b7280; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; margin-bottom: 12px;">Payment Information</h3>
      <table style="width: 100%; margin-bottom: 20px; font-size: 14px;">
        <tr><td style="padding: 4px 0; color: #6b7280; width: 120px;">Service Amount</td><td style="padding: 4px 0;">${formatAmount(payment.amount)}</td></tr>
        <tr><td style="padding: 4px 0; color: #6b7280;">Amount Paid</td><td style="padding: 4px 0; font-weight: 700; color: #16a34a; font-size: 18px;">${formatAmount(payment.amount)}</td></tr>
        <tr><td style="padding: 4px 0; color: #6b7280;">Payment Method</td><td style="padding: 4px 0; text-transform: uppercase;">${payment.paymentMethod}</td></tr>
        <tr><td style="padding: 4px 0; color: #6b7280;">Payment Date</td><td style="padding: 4px 0;">${paymentDate}</td></tr>
        <tr><td style="padding: 4px 0; color: #6b7280;">Confirmed By</td><td style="padding: 4px 0;">${payment.confirmedBy || "N/A"}</td></tr>
      </table>
    </div>

    <div style="background: #f0f9ff; padding: 20px 32px; text-align: center; border-top: 1px solid #e5e7eb;">
      <p style="font-size: 14px; font-weight: 600; color: #1e40af; margin: 0;">Thank You for Choosing PRESTIGE by Ekhaya!</p>
      ${businessPhone || businessEmail ? `<p style="font-size: 12px; color: #6b7280; margin: 8px 0 0;">${[businessPhone, businessEmail].filter(Boolean).join(" | ")}</p>` : ""}
      ${businessAddress ? `<p style="font-size: 12px; color: #6b7280; margin: 4px 0 0;">${businessAddress}</p>` : ""}
    </div>

    <div style="padding: 12px 32px; text-align: center; background: #f9fafb;">
      <p style="font-size: 10px; color: #9ca3af; margin: 0;">This is a computer-generated receipt. No signature is required.</p>
    </div>
  </div>
</body>
</html>`;

      // Send via nodemailer — same pattern as invoice sending
      const nodemailer = await import("nodemailer");
      let transporter;
      if (process.env.SMTP_HOST) {
        transporter = nodemailer.default.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || "587"),
          secure: process.env.SMTP_SECURE === "true",
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        });
      } else {
        const testAccount = await nodemailer.default.createTestAccount();
        transporter = nodemailer.default.createTransport({
          host: "smtp.ethereal.email",
          port: 587,
          secure: false,
          auth: { user: testAccount.user, pass: testAccount.pass },
        });
      }

      const info = await transporter.sendMail({
        from: process.env.SMTP_FROM || `"${businessName}" <noreply@hopsvoir.com>`,
        to: recipientEmail,
        subject: `Receipt ${payment.receiptNumber} — ${businessName}`,
        html: receiptHTML,
      });

      const previewUrl = nodemailer.default.getTestMessageUrl(info);
      if (previewUrl) {
        console.log("Receipt email preview URL:", previewUrl);
      }

      res.json({
        success: true,
        message: `Receipt sent to ${recipientEmail}`,
        previewUrl: previewUrl || undefined,
      });
    } catch (error) {
      console.error("Error sending receipt email:", error);
      res.status(500).json({ message: "Failed to send receipt email" });
    }
  });

  // List recent payments
  app.get("/api/payments", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { fromDate, toDate, limit } = req.query;
      const payments = await storage.getBookingPayments(tenantId, {
        fromDate: fromDate as string,
        toDate: toDate as string,
        limit: limit ? parseInt(limit as string, 10) : 50,
      });
      res.json({ payments });
    } catch (error) {
      console.error("Error fetching payments:", error);
      res.status(500).json({ message: "Failed to fetch payments" });
    }
  });

  // =====================
  // LOYALTY POINTS
  // =====================

  // Combined customer lookup by plate: local data + CRM data (membership, subscription, Uber)
  app.get("/api/customer/lookup-by-plate", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { plate } = req.query;
      if (!plate || typeof plate !== "string") {
        return res.status(400).json({ message: "Plate parameter required" });
      }

      const plateNormalized = normalizePlate(plate);

      const [frequentParker, membership, loyaltyAccount, crmCustomer, crmMembership, crmSubscription, crmUberDriver] = await Promise.all([
        storage.getFrequentParker(tenantId, plateNormalized).catch(() => null),
        storage.findMembershipByPlate(tenantId, plateNormalized).catch(() => null),
        storage.getLoyaltyAccountByPlate(tenantId, plateNormalized).catch(() => null),
        findCRMCustomerByPlate(plate).catch(() => null),
        findCRMMembershipByPlate(plate).catch(() => null),
        findCRMSubscriptionByPlate(plate).catch(() => null),
        findCRMUberDriverByPlate(plate).catch(() => null),
      ]);

      const activeVouchers = loyaltyAccount
        ? await storage.getActiveVouchersForAccount(tenantId, loyaltyAccount.id).catch(() => [])
        : [];

      const isRegistered = !!(frequentParker || membership || loyaltyAccount || crmCustomer);
      const isUberDriver = !!crmUberDriver;

      res.json({
        isRegistered,
        frequentParker,
        membership,
        loyaltyAccount,
        activeVouchers,
        crmCustomer,
        crmMembership,
        crmSubscription,
        isUberDriver,
        crmUberDriver,
      });
    } catch (error) {
      console.error("Error looking up customer by plate:", error);
      res.status(500).json({ message: "Failed to look up customer" });
    }
  });

  // =====================================================
  // CUSTOMER SELF-SERVICE PORTAL (phone lookup)
  // =====================================================

  // Look up customer data by phone number (public — for self-serve portal)
  app.get("/api/customer/portal", async (req: any, res) => {
    try {
      const { phone, tenantId: qTenant } = req.query as { phone?: string; tenantId?: string };
      if (!phone) return res.status(400).json({ message: "phone is required" });
      const tenantId = qTenant || "default";

      const account = await storage.getLoyaltyAccountByPhone(tenantId, phone.trim());
      if (!account) {
        return res.status(404).json({ message: "No account found for this phone number. Visit us to register!" });
      }

      const [transactions, vouchers, bookings] = await Promise.all([
        storage.getLoyaltyTransactionsByAccount(tenantId, account.id, 20).catch(() => []),
        storage.getVouchersForAccount(tenantId, account.id).catch(() => []),
        storage.getBookingsByPlate(tenantId, account.plateNormalized).catch(() => []),
      ]);

      res.json({ account, transactions, vouchers, bookings });
    } catch (error) {
      console.error("Customer portal error:", error);
      res.status(500).json({ message: "Failed to load portal data" });
    }
  });

  // Walk-in customer registration (technician registers walk-in with consent)
  app.post("/api/customer/register-walkin", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const userId = req.user?.claims?.sub;

      const walkinSchema = z.object({
        plate: z.string().min(1, "Plate is required"),
        name: z.string().min(1, "Name is required"),
        phone: z.string().optional(),
        email: z.string().email().optional().or(z.literal("")),
        consent: z.boolean().refine(v => v === true, "Customer consent is required"),
      });

      const result = walkinSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: result.error.errors[0].message });
      }

      const { plate, name, phone, email, consent } = result.data;
      const plateNormalized = normalizePlate(plate);
      const plateDisplay = displayPlate(plate);

      // Check if customer already exists
      const existing = await storage.getBookingCustomerByPlate(tenantId, plateNormalized).catch(() => null);
      if (existing) {
        return res.status(409).json({ message: "Customer already registered with this plate", customer: existing });
      }

      // Create booking customer record
      const customer = await storage.createBookingCustomer(tenantId, {
        name,
        email: email || null,
        phone: phone || null,
        plateNormalized,
        notes: `Walk-in registered by technician. Consent given.`,
      });

      // Auto-create loyalty account for the walk-in
      const loyaltyAccount = await storage.getOrCreateLoyaltyAccount(
        tenantId,
        plateNormalized,
        plateDisplay,
        { name, phone: phone || undefined, email: email || undefined }
      );

      // Log event
      await storage.logEvent(tenantId, {
        type: "walkin_registered",
        plateDisplay,
        plateNormalized,
        washJobId: null,
        userId,
        payloadJson: { customerName: name, hasEmail: !!email, hasPhone: !!phone },
      });

      res.status(201).json({
        customer,
        loyaltyAccount,
        message: "Walk-in customer registered successfully",
      });
    } catch (error) {
      console.error("Error registering walk-in customer:", error);
      res.status(500).json({ message: "Failed to register customer" });
    }
  });

  // Get loyalty account by plate (local)
  app.get("/api/loyalty/by-plate", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { plate } = req.query;
      if (!plate || typeof plate !== "string") {
        return res.status(400).json({ message: "Plate parameter required" });
      }

      const plateNormalized = normalizePlate(plate);
      const loyaltyAccount = await storage.getLoyaltyAccountByPlate(tenantId, plateNormalized);

      if (!loyaltyAccount) {
        return res.status(404).json({ message: "No loyalty account found for this plate" });
      }

      res.json(loyaltyAccount);
    } catch (error) {
      console.error("Error fetching loyalty account:", error);
      res.status(500).json({ message: "Failed to fetch loyalty account" });
    }
  });

  // Loyalty analytics (local accounts + transaction history)
  app.get("/api/loyalty/analytics", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const [crmAnalytics, localAnalytics] = await Promise.all([
        getCRMLoyaltyAnalytics().catch(() => null),
        storage.getLoyaltyAnalytics(tenantId).catch(() => null),
      ]);

      if (!crmAnalytics && !localAnalytics) {
        return res.json({
          totalAccounts: 0,
          totalPointsIssued: 0,
          totalPointsRedeemed: 0,
          pointsIssuedToday: 0,
          topEarners: [],
        });
      }

      res.json({
        totalAccounts: crmAnalytics?.totalMembers ?? localAnalytics?.totalAccounts ?? 0,
        totalPointsIssued: crmAnalytics?.totalPointsAcrossMembers ?? localAnalytics?.totalPointsIssued ?? 0,
        totalPointsRedeemed: 0,
        pointsIssuedToday: localAnalytics?.pointsIssuedToday ?? 0,
        topEarners: crmAnalytics?.topMembers.map(m => ({
          plateDisplay: m.memberNumber || "N/A",
          customerName: m.customerName,
          pointsBalance: m.loyaltyPoints,
          totalWashes: 0,
        })) ?? localAnalytics?.topEarners ?? [],
      });
    } catch (error) {
      console.error("Error fetching loyalty analytics:", error);
      res.status(500).json({ message: "Failed to fetch loyalty analytics" });
    }
  });

  // Customer/member growth analytics — monthly trends from CRM
  app.get("/api/crm/growth-analytics", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const growth = await getCRMGrowthAnalytics();
      if (!growth) {
        return res.json({ months: [], totals: { totalUsers: 0, totalMembers: 0, totalBookings: 0 }, peaks: {}, growthRate: {} });
      }
      res.json(growth);
    } catch (error) {
      console.error("Error fetching growth analytics:", error);
      res.status(500).json({ message: "Failed to fetch growth analytics" });
    }
  });

  // Get loyalty info for a specific wash job (used on completion screen)
  app.get("/api/loyalty/by-wash-job/:washJobId", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const washJobId = req.params.washJobId as string;
      const job = await storage.getWashJob(washJobId, tenantId);
      if (!job) {
        return res.status(404).json({ message: "Wash job not found" });
      }

      // Look up local loyalty account by plate
      const loyaltyAccount = await storage.getLoyaltyAccountByPlate(tenantId, job.plateNormalized);
      if (!loyaltyAccount) {
        return res.json({ account: null, transaction: null });
      }

      // Find the local transaction for this wash job
      const transactions = await storage.getLoyaltyTransactions(tenantId, { limit: 200 });
      const washTransaction = transactions.find(t => t.washJobId === washJobId);

      res.json({
        account: {
          membershipNumber: loyaltyAccount.membershipNumber,
          pointsBalance: loyaltyAccount.pointsBalance,
          tier: loyaltyAccount.tier,
          totalWashes: loyaltyAccount.totalWashes,
        },
        transaction: washTransaction ? {
          points: washTransaction.points,
          balanceAfter: washTransaction.balanceAfter,
        } : null,
      });
    } catch (error) {
      console.error("Error fetching loyalty info for wash job:", error);
      res.status(500).json({ message: "Failed to fetch loyalty info" });
    }
  });

  // Manager: Award manual bonus points (local loyalty)
  app.post("/api/loyalty/bonus", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const schema = z.object({
        plate: z.string().min(1),
        points: z.number().int().min(1),
        description: z.string().optional(),
      });

      const result = schema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "Invalid data" });
      }

      const { plate, points, description } = result.data;
      const opUserId = req.user?.claims?.sub;
      const plateNormalized = normalizePlate(plate);

      // Get or create local loyalty account
      const loyaltyAccount = await storage.getOrCreateLoyaltyAccount(tenantId, plateNormalized, displayPlate(plate));
      if (!loyaltyAccount) {
        return res.status(500).json({ message: "Failed to get or create loyalty account" });
      }

      // Credit points locally
      const updatedAccount = await storage.creditLoyaltyPoints(tenantId, loyaltyAccount.id, points);
      const newBalance = updatedAccount?.pointsBalance || (loyaltyAccount.pointsBalance || 0) + points;

      // Log locally
      await storage.logLoyaltyTransaction(tenantId, {
        crmUserId: loyaltyAccount.id,
        memberNumber: loyaltyAccount.membershipNumber,
        type: "earn_bonus",
        points,
        balanceAfter: newBalance,
        description: description || `Bonus ${points} points awarded by manager`,
        createdBy: opUserId,
      });

      await storage.logEvent(tenantId, {
        type: "loyalty_bonus_awarded",
        plateDisplay: displayPlate(plate),
        plateNormalized,
        userId: opUserId,
        payloadJson: { points, balanceAfter: newBalance, memberNumber: loyaltyAccount.membershipNumber },
      });

      res.json({ loyaltyAccount: { ...loyaltyAccount, pointsBalance: newBalance }, points });
    } catch (error) {
      console.error("Error awarding bonus points:", error);
      res.status(500).json({ message: "Failed to award bonus points" });
    }
  });

  // =====================
  // LOYALTY VOUCHERS
  // =====================

  // Get active vouchers for a plate (used on scan page)
  app.get("/api/loyalty/vouchers/by-plate", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { plate } = req.query;
      if (!plate) return res.status(400).json({ message: "plate is required" });

      const plateNormalized = normalizePlate(plate as string);
      const loyaltyAccount = await storage.getLoyaltyAccountByPlate(tenantId, plateNormalized);
      if (!loyaltyAccount) return res.json({ vouchers: [], account: null });

      const vouchers = await storage.getActiveVouchersForAccount(tenantId, loyaltyAccount.id);
      res.json({ vouchers, account: loyaltyAccount });
    } catch (error) {
      console.error("Error fetching vouchers by plate:", error);
      res.status(500).json({ message: "Failed to fetch vouchers" });
    }
  });

  // Get all vouchers (active + history) for a loyalty account
  app.get("/api/loyalty/vouchers/history/:loyaltyAccountId", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { loyaltyAccountId } = req.params;
      const vouchers = await storage.getVouchersForAccount(tenantId, loyaltyAccountId);
      res.json({ vouchers });
    } catch (error) {
      console.error("Error fetching voucher history:", error);
      res.status(500).json({ message: "Failed to fetch voucher history" });
    }
  });

  // Validate (redeem) a voucher by code
  app.post("/api/loyalty/vouchers/redeem", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const staffId = req.user?.claims?.sub || req.user?.id;
      const schema = z.object({
        code: z.string().min(1),
        washJobId: z.string().optional(),
      });
      const { code, washJobId } = schema.parse(req.body);

      const voucher = await storage.redeemVoucher(tenantId, code, staffId, washJobId);

      await storage.logEvent(tenantId, {
        type: "loyalty_voucher_redeemed",
        plateDisplay: "",
        plateNormalized: "",
        washJobId: washJobId || undefined,
        userId: staffId,
        payloadJson: { voucherCode: code, usedInWashJobId: washJobId },
      });

      // Fire CRM webhook (non-blocking)
      fireWebhook("loyalty_voucher_redeemed", {
        voucherCode: voucher.code,
        loyaltyAccountId: voucher.loyaltyAccountId,
        forPackageCode: voucher.forPackageCode ?? null,
        forServiceCode: voucher.forServiceCode ?? null,
        usedAt: voucher.usedAt?.toISOString() ?? new Date().toISOString(),
        usedInWashJobId: washJobId ?? null,
        usedByStaffId: staffId ?? null,
      }, tenantId).catch(() => {});

      res.json({ voucher, message: "Voucher redeemed successfully" });
    } catch (error: any) {
      console.error("Error redeeming voucher:", error);
      res.status(400).json({ message: error.message || "Failed to redeem voucher" });
    }
  });

  // Look up a voucher by code (for pre-validation check)
  app.get("/api/loyalty/vouchers/check/:code", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const code = (req.params.code as string).toUpperCase();
      const voucher = await storage.getVoucherByCode(tenantId, code);
      if (!voucher) return res.status(404).json({ message: "Voucher not found" });

      // Check expiry
      if (voucher.status === "active" && voucher.expiresAt && new Date(voucher.expiresAt) < new Date()) {
        return res.json({ voucher: { ...voucher, status: "expired" }, valid: false, reason: "Voucher has expired" });
      }
      const valid = voucher.status === "active";
      res.json({ voucher, valid, reason: valid ? null : `Voucher is ${voucher.status}` });
    } catch (error) {
      console.error("Error checking voucher:", error);
      res.status(500).json({ message: "Failed to check voucher" });
    }
  });

  // =====================
  // MANAGER BOOKING MANAGEMENT (Admin/Manager only)
  // =====================

  // Get all bookings with filters (local storage)
  app.get("/api/manager/bookings", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { status, fromDate, toDate, search, limit } = req.query;

      const filters: any = {};
      if (status && typeof status === "string") filters.status = status;
      if (fromDate && typeof fromDate === "string") filters.fromDate = fromDate;
      if (toDate && typeof toDate === "string") filters.toDate = toDate;
      if (search && typeof search === "string") filters.search = search;
      if (limit) filters.limit = parseInt(limit as string);

      const bookingsList = await storage.getBookings(tenantId, filters);

      // Enrich bookings with service and customer details
      const enrichedBookings = await Promise.all(bookingsList.map(async (b) => {
        const [service, customer, vehicle] = await Promise.all([
          storage.getBookingService(b.serviceId, tenantId).catch(() => null),
          storage.getBookingCustomer(b.customerId, tenantId).catch(() => null),
          b.vehicleId ? storage.getBookingVehicles(tenantId, b.customerId).then(vs => vs.find(v => v.id === b.vehicleId)).catch(() => null) : null,
        ]);

        return {
          id: b.id,
          bookingReference: b.id.slice(0, 8).toUpperCase(),
          status: b.status,
          bookingDate: b.bookingDate,
          timeSlot: b.timeSlot,
          licensePlate: vehicle?.licensePlate || "",
          vehicleMake: vehicle?.make || "",
          vehicleModel: vehicle?.model || "",
          vehicleColor: vehicle?.color || "",
          serviceName: service?.name || "Unknown Service",
          serviceDescription: service?.description || "",
          customerName: customer?.name || "Unknown",
          customerEmail: customer?.email || "",
          customerPhone: customer?.phone || "",
          totalAmount: b.totalAmount,
          notes: b.notes,
          createdAt: b.createdAt,
        };
      }));

      res.json({
        bookings: enrichedBookings,
        total: enrichedBookings.length,
      });
    } catch (error) {
      console.error("Error fetching manager bookings:", error);
      res.status(500).json({ message: "Failed to fetch bookings" });
    }
  });

  // Get single booking details
  app.get("/api/manager/bookings/:id", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const id = req.params.id as string;
      const booking = await storage.getBooking(id, tenantId);

      if (!booking) {
        return res.status(404).json({ message: "Booking not found" });
      }

      // Enrich with service/customer/vehicle details
      const [service, customer] = await Promise.all([
        storage.getBookingService(booking.serviceId, tenantId).catch(() => null),
        storage.getBookingCustomer(booking.customerId, tenantId).catch(() => null),
      ]);
      const vehicle = booking.vehicleId
        ? await storage.getBookingVehicles(tenantId, booking.customerId).then(vs => vs.find(v => v.id === booking.vehicleId)).catch(() => null)
        : null;

      res.json({
        ...booking,
        bookingReference: booking.id.slice(0, 8).toUpperCase(),
        licensePlate: vehicle?.licensePlate || "",
        vehicleMake: vehicle?.make || "",
        vehicleModel: vehicle?.model || "",
        vehicleColor: vehicle?.color || "",
        serviceName: service?.name || "Unknown Service",
        serviceDescription: service?.description || "",
        customerName: customer?.name || "Unknown",
        customerEmail: customer?.email || "",
        customerPhone: customer?.phone || "",
      });
    } catch (error) {
      console.error("Error fetching booking details:", error);
      res.status(500).json({ message: "Failed to fetch booking" });
    }
  });

  // Update booking (reschedule, change service, update notes)
  app.patch("/api/manager/bookings/:id", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const id = req.params.id as string;
      const userId = (req as any).user?.claims?.sub;

      const updateSchema = z.object({
        bookingDate: z.string().optional(),
        timeSlot: z.string().optional(),
        serviceId: z.string().optional(),
        notes: z.string().optional(),
        status: z.enum(["confirmed", "in_progress", "completed", "cancelled", "no_show", "ready_for_pickup"]).optional(),
        reason: z.string().optional(),
      });

      const result = updateSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "Invalid update data", errors: result.error.errors });
      }

      const { reason, ...updates } = result.data;

      // Fetch original booking
      const originalBooking = await storage.getBooking(id, tenantId);
      if (!originalBooking) {
        return res.status(404).json({ message: "Booking not found" });
      }

      // If rescheduling, check time slot availability
      if (updates.bookingDate || updates.timeSlot) {
        const newDate = updates.bookingDate || originalBooking.bookingDate;
        const newTimeSlot = updates.timeSlot || originalBooking.timeSlot;
        const slots = await storage.getAvailableTimeSlots(tenantId, newDate);
        const slot = slots.find(s => s.time === newTimeSlot);
        if (slot && slot.available <= 0) {
          return res.status(409).json({ message: "Time slot is not available" });
        }
      }

      const updateData: any = {};
      if (updates.bookingDate) updateData.bookingDate = updates.bookingDate;
      if (updates.timeSlot) updateData.timeSlot = updates.timeSlot;
      if (updates.serviceId) updateData.serviceId = updates.serviceId;
      if (updates.notes !== undefined) updateData.notes = updates.notes;
      if (updates.status) {
        updateData.status = updates.status;
        if (updates.status === "completed") updateData.completedAt = new Date();
        if (updates.status === "cancelled") {
          updateData.cancelledAt = new Date();
          updateData.cancelReason = reason || null;
        }
      }

      const updatedBooking = await storage.updateBooking(id, updateData, tenantId);
      if (!updatedBooking) {
        return res.status(500).json({ message: "Failed to update booking" });
      }

      await storage.logEvent(tenantId, {
        type: "booking_modified",
        userId,
        payloadJson: {
          bookingId: id,
          updates: updateData,
          modifiedBy: userId,
          modifiedAt: new Date().toISOString(),
        },
      });

      res.json({
        message: "Booking updated successfully",
        booking: updatedBooking,
      });
    } catch (error) {
      console.error("Error updating booking:", error);
      res.status(500).json({ message: "Failed to update booking" });
    }
  });

  // Cancel booking
  app.delete("/api/manager/bookings/:id", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const id = req.params.id as string;
      const userId = (req as any).user?.claims?.sub;
      const { reason } = req.body || {};

      const booking = await storage.getBooking(id, tenantId);
      if (!booking) {
        return res.status(404).json({ message: "Booking not found" });
      }

      if (booking.status === "cancelled") {
        return res.status(400).json({ message: "Booking is already cancelled" });
      }

      if (booking.status === "completed") {
        return res.status(400).json({ message: "Cannot cancel a completed booking" });
      }

      const cancelled = await storage.cancelBooking(id, reason, tenantId);
      if (!cancelled) {
        return res.status(500).json({ message: "Failed to cancel booking" });
      }

      await storage.logEvent(tenantId, {
        type: "booking_cancelled",
        userId,
        payloadJson: {
          bookingId: id,
          bookingDate: booking.bookingDate,
          timeSlot: booking.timeSlot,
          cancelledBy: userId,
          cancelledAt: new Date().toISOString(),
          reason,
        },
      });

      res.json({ message: "Booking cancelled successfully" });
    } catch (error) {
      console.error("Error cancelling booking:", error);
      res.status(500).json({ message: "Failed to cancel booking" });
    }
  });

  // =====================
  // BOOKING NOTIFICATIONS
  // =====================

  // Preview a notification before sending manually
  app.post("/api/manager/notifications/preview", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { bookingId, type, reason } = req.body;
      if (!bookingId || !type) {
        return res.status(400).json({ message: "bookingId and type are required" });
      }

      const validTypes: BookingNotificationType[] = ["BOOKING_CANCELLED", "BOOKING_MODIFIED", "BOOKING_RESCHEDULED"];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ message: "Invalid notification type" });
      }

      const booking = await storage.getBooking(bookingId, tenantId);
      if (!booking) {
        return res.status(404).json({ message: "Booking not found" });
      }

      const [service, customer] = await Promise.all([
        storage.getBookingService(booking.serviceId, tenantId).catch(() => null),
        storage.getBookingCustomer(booking.customerId, tenantId).catch(() => null),
      ]);

      const { subject, body } = renderBookingNotification(type as BookingNotificationType, {
        customerName: customer?.name || "Customer",
        customerEmail: customer?.email || "",
        customerPhone: customer?.phone || "",
        bookingReference: booking.id.slice(0, 8).toUpperCase(),
        licensePlate: "",
        vehicleMake: "",
        vehicleModel: "",
        serviceName: service?.name || "Service",
        originalDate: booking.bookingDate,
        originalTimeSlot: booking.timeSlot,
        reason,
        bookingId,
      });

      res.json({ subject, body, customerEmail: customer?.email, customerPhone: customer?.phone });
    } catch (error) {
      console.error("Error previewing notification:", error);
      res.status(500).json({ message: "Failed to generate preview" });
    }
  });

  // Manually queue/send a notification
  app.post("/api/manager/notifications/send", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { bookingId, type, subject, body, reason } = req.body;
      const userId = (req as any).user?.claims?.sub;

      if (!bookingId || !type || !body) {
        return res.status(400).json({ message: "bookingId, type, and body are required" });
      }

      const booking = await storage.getBooking(bookingId, tenantId);
      if (!booking) {
        return res.status(404).json({ message: "Booking not found" });
      }

      const [service, customer] = await Promise.all([
        storage.getBookingService(booking.serviceId, tenantId).catch(() => null),
        storage.getBookingCustomer(booking.customerId, tenantId).catch(() => null),
      ]);

      const notificationId = await queueBookingNotification(
        type as BookingNotificationType,
        {
          customerName: customer?.name || "Customer",
          customerEmail: customer?.email || "",
          customerPhone: customer?.phone || "",
          bookingReference: booking.id.slice(0, 8).toUpperCase(),
          licensePlate: "",
          vehicleMake: "",
          vehicleModel: "",
          serviceName: service?.name || "Service",
          originalDate: booking.bookingDate,
          originalTimeSlot: booking.timeSlot,
          reason,
          bookingId,
        },
        userId,
        tenantId
      );

      if (!notificationId) {
        return res.status(500).json({ message: "Failed to queue notification" });
      }

      await markNotificationSent(notificationId);

      await storage.logEvent(tenantId, {
        type: "notification_sent_manual",
        userId,
        payloadJson: { notificationId, bookingId, notificationType: type, customerEmail: customer?.email },
      });

      res.json({ message: "Notification queued successfully", notificationId });
    } catch (error) {
      console.error("Error sending notification:", error);
      res.status(500).json({ message: "Failed to send notification" });
    }
  });

  // =============================================
  // NOTIFICATION TEMPLATES (customisable by manager)
  // =============================================

  // List all templates for this tenant
  app.get("/api/manager/notification-templates", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const templates = await storage.getNotificationTemplates(tenantId, false);
      res.json(templates);
    } catch (error) {
      console.error("Error fetching notification templates:", error);
      res.status(500).json({ message: "Failed to fetch templates" });
    }
  });

  // Update a template
  app.put("/api/manager/notification-templates/:id", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { subject, body, isActive } = req.body;
      const updated = await storage.updateNotificationTemplate(req.params.id, { subject, body, isActive }, tenantId);
      if (!updated) return res.status(404).json({ message: "Template not found" });
      res.json(updated);
    } catch (error) {
      console.error("Error updating notification template:", error);
      res.status(500).json({ message: "Failed to update template" });
    }
  });

  // Create (seed) a new template
  app.post("/api/manager/notification-templates", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { code, name, channel, subject, body } = req.body;
      if (!code || !name || !channel || !body) {
        return res.status(400).json({ message: "code, name, channel, and body are required" });
      }
      const template = await storage.createNotificationTemplate(tenantId, { code, name, channel, subject, body, isActive: true });
      res.json(template);
    } catch (error) {
      console.error("Error creating notification template:", error);
      res.status(500).json({ message: "Failed to create template" });
    }
  });

  // Get available services (tenant's own catalog)
  app.get("/api/manager/services", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const services = await storage.getBookingServices(tenantId, true);
      res.json(services);
    } catch (error) {
      console.error("Error fetching services:", error);
      res.status(500).json({ message: "Failed to fetch services" });
    }
  });

  // Get available time slots for a date (local)
  app.get("/api/manager/timeslots", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { date } = req.query;
      if (!date || typeof date !== "string") {
        return res.status(400).json({ message: "Date parameter required" });
      }

      const slots = await storage.getAvailableTimeSlots(tenantId, date);
      res.json(slots);
    } catch (error) {
      console.error("Error fetching time slots:", error);
      res.status(500).json({ message: "Failed to fetch time slots" });
    }
  });

  // =====================
  // NEW BOOKING MANAGEMENT ENDPOINTS
  // =====================

  // Create a new booking
  app.post("/api/manager/bookings", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const userId = (req as any).user?.claims?.sub;

      const createSchema = z.object({
        customerId: z.string().min(1),
        vehicleId: z.string().optional(),
        serviceId: z.string().min(1),
        bookingDate: z.string().min(1), // "YYYY-MM-DD"
        timeSlot: z.string().min(1), // "HH:MM"
        notes: z.string().optional(),
      });

      const result = createSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "Invalid booking data", errors: result.error.errors });
      }

      // Check slot availability
      const slots = await storage.getAvailableTimeSlots(tenantId, result.data.bookingDate);
      const slot = slots.find(s => s.time === result.data.timeSlot);
      if (slot && slot.available <= 0) {
        return res.status(409).json({ message: "Time slot is fully booked" });
      }

      // Get service for price
      const service = await storage.getBookingService(result.data.serviceId, tenantId);

      const booking = await storage.createBooking(tenantId, {
        ...result.data,
        totalAmount: service?.price || 0,
        createdBy: userId,
        status: "confirmed" as any,
      });

      await storage.logEvent(tenantId, {
        type: "booking_created",
        userId,
        payloadJson: { bookingId: booking.id, bookingDate: result.data.bookingDate, timeSlot: result.data.timeSlot },
      });

      res.status(201).json(booking);
    } catch (error) {
      console.error("Error creating booking:", error);
      res.status(500).json({ message: "Failed to create booking" });
    }
  });

  // Booking Services CRUD (tenant catalog management)
  app.post("/api/manager/booking-services", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const schema = z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        price: z.number().int().min(0),
        durationMinutes: z.number().int().min(5).default(30),
        category: z.string().optional(),
        sortOrder: z.number().int().default(0),
      });

      const result = schema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "Invalid service data", errors: result.error.errors });
      }

      const service = await storage.createBookingService(tenantId, { ...result.data, isActive: true } as any);
      res.status(201).json(service);
    } catch (error) {
      console.error("Error creating booking service:", error);
      res.status(500).json({ message: "Failed to create service" });
    }
  });

  app.get("/api/manager/booking-services", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const activeOnly = req.query.activeOnly !== "false";
      const services = await storage.getBookingServices(tenantId, activeOnly);
      res.json(services);
    } catch (error) {
      console.error("Error fetching booking services:", error);
      res.status(500).json({ message: "Failed to fetch services" });
    }
  });

  app.patch("/api/manager/booking-services/:id", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const id = req.params.id as string;
      const updated = await storage.updateBookingService(id, req.body, tenantId);
      if (!updated) return res.status(404).json({ message: "Service not found" });
      res.json(updated);
    } catch (error) {
      console.error("Error updating booking service:", error);
      res.status(500).json({ message: "Failed to update service" });
    }
  });

  // Booking Customers CRUD
  app.post("/api/manager/booking-customers", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const schema = z.object({
        name: z.string().min(1),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        plateNormalized: z.string().optional(),
        notes: z.string().optional(),
      });

      const result = schema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "Invalid customer data", errors: result.error.errors });
      }

      const customer = await storage.createBookingCustomer(tenantId, result.data as any);
      res.status(201).json(customer);
    } catch (error) {
      console.error("Error creating booking customer:", error);
      res.status(500).json({ message: "Failed to create customer" });
    }
  });

  app.get("/api/manager/booking-customers", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const search = req.query.search as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const customers = await storage.getBookingCustomers(tenantId, { search, limit });
      res.json(customers);
    } catch (error) {
      console.error("Error fetching booking customers:", error);
      res.status(500).json({ message: "Failed to fetch customers" });
    }
  });

  // Booking Vehicles
  app.post("/api/manager/booking-vehicles", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const schema = z.object({
        customerId: z.string().min(1),
        licensePlate: z.string().min(1),
        make: z.string().optional(),
        model: z.string().optional(),
        color: z.string().optional(),
      });

      const result = schema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "Invalid vehicle data", errors: result.error.errors });
      }

      const vehicle = await storage.createBookingVehicle(tenantId, result.data as any);
      res.status(201).json(vehicle);
    } catch (error) {
      console.error("Error creating booking vehicle:", error);
      res.status(500).json({ message: "Failed to create vehicle" });
    }
  });

  app.get("/api/manager/booking-vehicles", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const customerId = req.query.customerId as string | undefined;
      const vehicles = await storage.getBookingVehicles(tenantId, customerId);
      res.json(vehicles);
    } catch (error) {
      console.error("Error fetching booking vehicles:", error);
      res.status(500).json({ message: "Failed to fetch vehicles" });
    }
  });

  // Time Slot Configuration
  app.get("/api/manager/timeslot-config", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const config = await storage.getTimeSlotConfig(tenantId);
      res.json(config);
    } catch (error) {
      console.error("Error fetching timeslot config:", error);
      res.status(500).json({ message: "Failed to fetch timeslot config" });
    }
  });

  app.put("/api/manager/timeslot-config", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const configs = req.body;
      if (!Array.isArray(configs)) {
        return res.status(400).json({ message: "Expected array of time slot configurations" });
      }
      const result = await storage.upsertTimeSlotConfig(tenantId, configs);
      res.json(result);
    } catch (error) {
      console.error("Error updating timeslot config:", error);
      res.status(500).json({ message: "Failed to update timeslot config" });
    }
  });

  // ================================================
  // CUSTOMER SELF-BOOKING (public, rate-limited)
  // ================================================

  // Public: get available services for booking page
  app.get("/api/booking/services", async (req: any, res) => {
    try {
      const tenantId = (req.query.tenantId as string) || "default";
      const services = await storage.getBookingServices(tenantId, true);
      res.json(services);
    } catch (error) {
      res.status(500).json({ message: "Failed to load services" });
    }
  });

  // Public: get available slots for a specific date
  app.get("/api/booking/available-slots", async (req: any, res) => {
    try {
      const { date, tenantId: qTenant } = req.query as { date?: string; tenantId?: string };
      if (!date) return res.status(400).json({ message: "date is required (YYYY-MM-DD)" });
      const tenantId = qTenant || "default";
      const slots = await storage.getAvailableTimeSlots(tenantId, date);
      res.json(slots);
    } catch (error) {
      res.status(500).json({ message: "Failed to load slots" });
    }
  });

  // Public: submit a self-service booking (creates as PENDING status)
  app.post("/api/booking/self-service", async (req: any, res) => {
    try {
      const { tenantId: bodyTenant, serviceId, date, time, customerName, customerPhone, customerEmail, plateDisplay } = req.body;
      if (!serviceId || !date || !time || !customerName) {
        return res.status(400).json({ message: "serviceId, date, time, and customerName are required" });
      }
      const tenantId = bodyTenant || "default";

      // Get or create customer record (required — bookings.customerId is NOT NULL)
      let customer = customerEmail
        ? await storage.getBookingCustomerByEmail(tenantId, customerEmail).catch(() => null)
        : null;
      if (!customer) {
        customer = await storage.createBookingCustomer(tenantId, {
          name: customerName,
          email: customerEmail || null,
          phone: customerPhone || null,
          plateNormalized: plateDisplay ? normalizePlate(plateDisplay) : null,
        } as any);
      }

      // Get service details
      const service = await storage.getBookingService(serviceId, tenantId).catch(() => null);

      // Create the booking (confirmed — manager can review and cancel if capacity exceeded)
      const booking = await storage.createBooking(tenantId, {
        customerId: customer.id,
        serviceId,
        vehicleId: null,
        bookingDate: date,
        timeSlot: time,
        status: "confirmed",
        totalAmount: service?.price || null,
        notes: `Self-service booking by ${customerName}${plateDisplay ? ` (${plateDisplay})` : ""}${customerPhone ? ` — ${customerPhone}` : ""}`,
        createdBy: "self-service",
      } as any);

      await storage.logEvent(tenantId, {
        type: "booking_self_service",
        plateDisplay: plateDisplay || customerName,
        payloadJson: { bookingId: booking.id, date, time, serviceId, customerName },
      });

      res.status(201).json({ bookingId: booking.id, message: "Booking submitted. You will be contacted to confirm." });
    } catch (error) {
      console.error("Self-service booking error:", error);
      res.status(500).json({ message: "Failed to submit booking" });
    }
  });

  // Booking Analytics
  app.get("/api/manager/booking-analytics", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const analytics = await storage.getBookingAnalytics(tenantId);
      res.json(analytics);
    } catch (error) {
      console.error("Error fetching booking analytics:", error);
      res.status(500).json({ message: "Failed to fetch booking analytics" });
    }
  });

  // =====================
  // ADMIN USER MANAGEMENT
  // =====================

  // Get all users (admin only)
  app.get("/api/admin/users", isAuthenticated, requireRole("admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      let users;
      if (req.user?.isSuperAdmin) {
        users = await storage.getUsers(); // global — super admin sees all
      } else {
        users = await storage.getUsers(tenantId); // scoped — tenant admin sees own
      }
      res.json(users);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // Create new user (admin only)
  app.post("/api/admin/users", isAuthenticated, requireRole("admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const schema = z.object({
        email: z.string().email(),
        password: z.string().min(6),
        firstName: z.string().min(1),
        lastName: z.string().optional(),
        role: z.enum(["technician", "manager", "admin"]),
      });

      const result = schema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "Invalid user data" });
      }

      const { email, password, firstName, lastName, role } = result.data;

      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "Email already exists" });
      }

      const { createCredentialsUser } = await import("./lib/credentials-auth");
      const name = lastName ? `${firstName} ${lastName}` : firstName;
      const user = await createCredentialsUser(email, password, role, name, tenantId);

      res.json(user);
    } catch (error) {
      console.error("Error creating user:", error);
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  // Update user role (admin only)
  app.patch("/api/admin/users/:userId/role", isAuthenticated, requireRole("admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const userId = req.params.userId as string;
      const { role } = req.body;

      if (!["technician", "manager", "admin"].includes(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }

      // Get the user first to check if they're the super admin
      const allUsers = await storage.getUsers(tenantId);
      const targetUser = allUsers.find(u => u.id === userId);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }

      // Protect super admin from role changes
      if (isSuperAdmin(targetUser.email)) {
        return res.status(403).json({ message: "Cannot modify super admin account" });
      }

      const user = await storage.updateUser(userId, { role });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json(user);
    } catch (error) {
      console.error("Error updating user role:", error);
      res.status(500).json({ message: "Failed to update role" });
    }
  });

  // Toggle user active status (admin only)
  app.patch("/api/admin/users/:userId/active", isAuthenticated, requireRole("admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const userId = req.params.userId as string;
      const { isActive } = req.body;

      if (typeof isActive !== "boolean") {
        return res.status(400).json({ message: "Invalid status" });
      }

      // Get the user first to check if they're the super admin
      const allUsers = await storage.getUsers(tenantId);
      const targetUser = allUsers.find(u => u.id === userId);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }

      // Protect super admin from being disabled
      if (isSuperAdmin(targetUser.email)) {
        return res.status(403).json({ message: "Cannot disable super admin account" });
      }

      const user = await storage.updateUser(userId, { isActive });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json(user);
    } catch (error) {
      console.error("Error updating user status:", error);
      res.status(500).json({ message: "Failed to update status" });
    }
  });

  // Permanently delete a user (admin only)
  app.delete("/api/admin/users/:userId", isAuthenticated, requireRole("admin"), async (req: any, res) => {
    try {
      const userId = req.params.userId as string;

      // Get the user first
      const targetUser = await storage.getUserById(userId);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }

      // Protect super admin from being deleted
      if (isSuperAdmin(targetUser.email)) {
        return res.status(403).json({ message: "Cannot delete super admin account" });
      }

      // Prevent self-deletion
      const requestingUserId = (req as any).user?.claims?.sub;
      if (userId === requestingUserId) {
        return res.status(403).json({ message: "Cannot delete your own account" });
      }

      const deleted = await storage.deleteUser(userId);
      if (!deleted) {
        return res.status(500).json({ message: "Failed to delete user" });
      }

      const tenantId = (req as any).tenantId || "default";
      await storage.logEvent(tenantId, {
        type: "user_deleted",
        userId: requestingUserId,
        payloadJson: {
          deletedUserId: userId,
          deletedUserEmail: targetUser.email,
          deletedUserName: `${targetUser.firstName} ${targetUser.lastName}`,
        },
      });

      res.json({ message: "User permanently deleted" });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  // =====================
  // TECHNICIAN TIME TRACKING
  // =====================

  // Get current clock-in status for the logged-in technician
  app.get("/api/time/status", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const userId = (req as any).user?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const activeLog = await storage.getActiveTimeLog(tenantId, userId);
      res.json({ clockedIn: !!activeLog, activeLog: activeLog || null });
    } catch (error) {
      res.status(500).json({ message: "Failed to get time status" });
    }
  });

  // Clock in
  app.post("/api/time/clock-in", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const userId = (req as any).user?.claims?.sub;
      const { notes } = req.body;

      // Check if already clocked in
      const existing = await storage.getActiveTimeLog(tenantId, userId);
      if (existing) {
        return res.status(400).json({ message: "Already clocked in" });
      }

      const log = await storage.clockIn(tenantId, userId, notes);
      await storage.logEvent(tenantId, { type: "clock_in", userId, payloadJson: { logId: log.id } });
      res.json({ message: "Clocked in successfully", log });
    } catch (error) {
      res.status(500).json({ message: "Failed to clock in" });
    }
  });

  // Clock out
  app.post("/api/time/clock-out", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const userId = (req as any).user?.claims?.sub;

      const activeLog = await storage.getActiveTimeLog(tenantId, userId);
      if (!activeLog) {
        return res.status(400).json({ message: "Not currently clocked in" });
      }

      const log = await storage.clockOut(activeLog.id, tenantId);
      await storage.logEvent(tenantId, { type: "clock_out", userId, payloadJson: { logId: activeLog.id, totalMinutes: log?.totalMinutes } });
      res.json({ message: "Clocked out successfully", log });
    } catch (error) {
      res.status(500).json({ message: "Failed to clock out" });
    }
  });

  // Log a break start
  app.post("/api/time/break/start", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const userId = (req as any).user?.claims?.sub;
      const { type, notes } = req.body;

      if (!["lunch", "short", "absent"].includes(type)) {
        return res.status(400).json({ message: "Invalid break type" });
      }

      const activeLog = await storage.getActiveTimeLog(tenantId, userId);
      if (!activeLog) {
        return res.status(400).json({ message: "Not clocked in" });
      }

      const log = await storage.addBreakLog(activeLog.id, { type, notes }, tenantId);
      res.json({ message: "Break started", log });
    } catch (error) {
      res.status(500).json({ message: "Failed to start break" });
    }
  });

  // End a break
  app.post("/api/time/break/end", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const userId = (req as any).user?.claims?.sub;

      const activeLog = await storage.getActiveTimeLog(tenantId, userId);
      if (!activeLog) {
        return res.status(400).json({ message: "Not clocked in" });
      }

      const log = await storage.endBreakLog(activeLog.id, tenantId);
      res.json({ message: "Break ended", log });
    } catch (error) {
      res.status(500).json({ message: "Failed to end break" });
    }
  });

  // Get my own time logs (technician)
  app.get("/api/time/logs", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const userId = (req as any).user?.claims?.sub;
      const { fromDate, toDate } = req.query;

      const logs = await storage.getTimeLogs(tenantId, {
        technicianId: userId,
        fromDate: fromDate ? new Date(fromDate as string) : undefined,
        toDate: toDate ? new Date(toDate as string) : undefined,
        limit: 50,
      });
      res.json(logs);
    } catch (error) {
      res.status(500).json({ message: "Failed to get time logs" });
    }
  });

  // Manager/Admin: Get all time logs (roster view)
  app.get("/api/manager/roster", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { technicianId, fromDate, toDate } = req.query;

      const logs = await storage.getTimeLogs(tenantId, {
        technicianId: technicianId as string | undefined,
        fromDate: fromDate ? new Date(fromDate as string) : undefined,
        toDate: toDate ? new Date(toDate as string) : undefined,
        limit: 200,
      });

      // Attach user details to each log
      const allUsers = await storage.getUsers(tenantId);
      const userMap = new Map(allUsers.map(u => [u.id, u]));

      const enriched = logs.map(log => ({
        ...log,
        technician: userMap.get(log.technicianId) || null,
      }));

      res.json(enriched);
    } catch (error) {
      res.status(500).json({ message: "Failed to get roster" });
    }
  });

  // Manager/Admin: Who is currently clocked in
  app.get("/api/manager/roster/active", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const logs = await storage.getTimeLogs(tenantId, { limit: 200 });
      const activeLogs = logs.filter(l => !l.clockOutAt);

      const allUsers = await storage.getUsers(tenantId);
      const userMap = new Map(allUsers.map(u => [u.id, u]));

      const enriched = activeLogs.map(log => ({
        ...log,
        technician: userMap.get(log.technicianId) || null,
      }));

      res.json(enriched);
    } catch (error) {
      res.status(500).json({ message: "Failed to get active roster" });
    }
  });

  // Manager/Admin: Force clock-out a technician who forgot to clock out
  app.post("/api/manager/roster/force-clockout/:logId", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const logId = String(req.params.logId);
      const managerId = (req as any).user?.claims?.sub;

      const log = await storage.clockOut(logId, tenantId);
      if (!log) {
        return res.status(404).json({ message: "Time log not found or already clocked out" });
      }

      storage.logEvent(tenantId, {
        type: "force_clock_out",
        userId: managerId,
        payloadJson: { logId, technicianId: log.technicianId, totalMinutes: log.totalMinutes },
      }).catch((err: Error) => console.error("Failed to log force_clock_out event:", err));

      res.json({ message: "Technician clocked out successfully", log });
    } catch (error) {
      console.error("POST /api/manager/roster/force-clockout error:", error);
      res.status(500).json({ message: "Failed to force clock-out" });
    }
  });

  // =====================
  // STAFF ALERTS (running late, absent, etc.)
  // =====================

  // Technician: Send an alert to management
  app.post("/api/time/alert", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const userId = (req as any).user?.claims?.sub;
      const { type, message, estimatedArrival } = req.body;

      if (!userId) {
        return res.status(401).json({ message: "User ID not found" });
      }

      if (!type || !["running_late", "absent", "emergency", "other"].includes(type)) {
        return res.status(400).json({ message: "Invalid alert type" });
      }

      const alert = await storage.createStaffAlert(tenantId, {
        technicianId: String(userId),
        type,
        message: message || undefined,
        estimatedArrival: estimatedArrival || undefined,
      });

      // Log event in background — don't block the response
      storage.logEvent(tenantId, {
        type: "staff_alert",
        userId: String(userId),
        payloadJson: { alertId: alert.id, alertType: type },
      }).catch(err => console.error("Failed to log staff_alert event:", err));

      res.json({ alert });
    } catch (error) {
      console.error("POST /api/time/alert error:", error);
      res.status(500).json({ message: "Failed to send alert" });
    }
  });

  // Manager/Admin: Get staff alerts
  app.get("/api/manager/alerts", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { unacknowledgedOnly } = req.query;
      const alerts = await storage.getStaffAlerts(tenantId, {
        unacknowledgedOnly: unacknowledgedOnly === "true",
      });

      const allUsers = await storage.getUsers(tenantId);
      const userMap = new Map(allUsers.map(u => [u.id, u]));

      const enriched = alerts.map(a => ({
        ...a,
        technician: userMap.get(a.technicianId) || null,
      }));

      res.json(enriched);
    } catch (error) {
      console.error("GET /api/manager/alerts error:", error);
      res.status(500).json({ message: "Failed to get alerts" });
    }
  });

  // Manager/Admin: Acknowledge a staff alert
  app.patch("/api/manager/alerts/:id/acknowledge", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const userId = (req as any).user?.claims?.sub;
      const alertId = String(req.params.id);
      const alert = await storage.acknowledgeStaffAlert(alertId, String(userId), tenantId);
      if (!alert) return res.status(404).json({ message: "Alert not found" });
      res.json({ alert });
    } catch (error) {
      res.status(500).json({ message: "Failed to acknowledge alert" });
    }
  });

  // =====================================================
  // STAFF MESSAGES (two-way messaging)
  // =====================================================

  // Send a message (any authenticated user)
  app.post("/api/staff/messages", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const userId = (req as any).user?.claims?.sub;
      const userObj = await storage.getUserById(userId).catch(() => null);
      const { message, recipientId } = req.body;
      if (!message?.trim()) return res.status(400).json({ message: "message is required" });

      const msg = await storage.createStaffMessage(tenantId, {
        senderId: userId,
        senderName: (userObj ? `${userObj.firstName || ""} ${userObj.lastName || ""}`.trim() || userObj.email : null) || userId,
        senderRole: (req as any).user?.role || "staff",
        recipientId: recipientId || null,
        message: message.trim(),
      });

      // Real-time broadcast
      broadcastEvent({ type: "new_staff_message", messageId: msg.id, senderId: userId, recipientId: recipientId || null });

      res.status(201).json(msg);
    } catch (error) {
      console.error("POST /api/staff/messages error:", error);
      res.status(500).json({ message: "Failed to send message" });
    }
  });

  // Get messages for current user
  app.get("/api/staff/messages", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const userId = (req as any).user?.claims?.sub;
      const { unreadOnly, limit } = req.query;
      const messages = await storage.getStaffMessages(tenantId, {
        userId: String(userId),
        unreadOnly: unreadOnly === "true",
        limit: limit ? parseInt(limit as string) : 50,
      });
      res.json(messages);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  // Get unread count
  app.get("/api/staff/messages/unread-count", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const userId = (req as any).user?.claims?.sub;
      const count = await storage.getUnreadStaffMessageCount(tenantId, String(userId));
      res.json({ count });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch unread count" });
    }
  });

  // Mark message as read
  app.patch("/api/staff/messages/:id/read", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const updated = await storage.markStaffMessageRead(req.params.id, tenantId);
      if (!updated) return res.status(404).json({ message: "Message not found" });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to mark message as read" });
    }
  });

  // Get all staff for recipient selection (manager/admin)
  app.get("/api/staff/members", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const users = await storage.getUsers(tenantId);
      res.json(users.map((u) => ({ id: u.id, name: `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email, email: u.email, role: u.role })));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch staff" });
    }
  });

  // =====================
  // CUSTOMER ACCESS (Public routes with token)
  // =====================

  // Get job by customer token (public)
  app.get("/api/customer/job/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const access = await storage.getCustomerJobAccessByToken(token);
      
      if (!access) {
        return res.status(404).json({ message: "Job not found" });
      }

      // Update last viewed
      await storage.updateCustomerJobAccessViewedAt(token);

      const tenantId = (req as any).tenantId || "default";
      const job = await storage.getWashJob(access.washJobId, tenantId);
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }

      const photos = await storage.getWashPhotos(access.washJobId);
      const checklist = await storage.getServiceChecklistItems(access.washJobId);
      const confirmation = await storage.getCustomerConfirmation(access.washJobId);

      res.json({
        job,
        photos,
        checklist,
        confirmation,
        customerName: access.customerName,
        serviceCode: access.serviceCode,
      });
    } catch (error) {
      console.error("Error fetching customer job:", error);
      res.status(500).json({ message: "Failed to fetch job" });
    }
  });

  // Customer SSE for job updates
  app.get("/api/customer/stream/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const access = await storage.getCustomerJobAccessByToken(token);
      
      if (!access) {
        return res.status(404).json({ message: "Job not found" });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      // Add to job-specific SSE clients
      const client = { res, washJobId: access.washJobId };
      customerSseClients.add(client);
      
      req.on("close", () => {
        customerSseClients.delete(client);
      });

      res.write("data: {\"type\":\"connected\"}\n\n");
    } catch (error) {
      res.status(500).json({ message: "Stream error" });
    }
  });

  // Customer confirm checklist
  app.post("/api/customer/confirm/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const { checklistConfirmations, rating, notes, issueReported } = req.body;
      
      const access = await storage.getCustomerJobAccessByToken(token);
      if (!access) {
        return res.status(404).json({ message: "Job not found" });
      }

      // Update checklist items - verify each item belongs to this job
      if (checklistConfirmations && Array.isArray(checklistConfirmations)) {
        for (const item of checklistConfirmations) {
          if (item.id && typeof item.confirmed === "boolean") {
            await storage.updateChecklistItemConfirmedForJob(
              item.id, 
              access.washJobId, 
              item.confirmed
            );
          }
        }
      }

      // Create confirmation record
      const confirmation = await storage.createCustomerConfirmation({
        washJobId: access.washJobId,
        accessToken: token,
        rating: rating || null,
        notes: notes || null,
        issueReported: issueReported || null,
      });

      // Log event
      const tenantId = (req as any).tenantId || "default";
      await storage.logEvent(tenantId, {
        type: "customer_confirmation",
        washJobId: access.washJobId,
        payloadJson: { rating, hasNotes: !!notes, hasIssue: !!issueReported },
      });

      // Push notification to managers if issue reported
      if (issueReported) {
        try {
          const job = await storage.getWashJob(access.washJobId, tenantId);
          await sendPushToAllManagers({
            title: "Issue Reported",
            body: `Customer reported an issue${job ? ` for ${job.plateDisplay}` : ""}: ${typeof issueReported === "string" ? issueReported : "See details"}`,
            url: "/manager/dashboard",
            tag: `issue-${access.washJobId}`,
          }, tenantId);
        } catch (_pushErr) { /* non-blocking */ }
      }

      res.json({ message: "Confirmation recorded", confirmation });
    } catch (error) {
      console.error("Error saving customer confirmation:", error);
      res.status(500).json({ message: "Failed to save confirmation" });
    }
  });

  // =====================
  // INTEGRATION ENDPOINT (for CRM)
  // =====================

  const integrationJobSchema = z.object({
    plateDisplay: z.string().min(1),
    customerName: z.string().optional(),
    customerEmail: z.string().email().optional(),
    serviceCode: z.string().optional(),
    servicePackageCode: z.string().optional(), // Named package (e.g. "VAMOS", "LA_OBRA")
    serviceChecklist: z.array(z.string()).optional(),
  });

  app.post("/api/integrations/create-job", async (req, res) => {
    try {
      // Verify integration secret
      const secret = req.headers["x-integration-secret"] || req.headers["authorization"];
      if (secret !== process.env.INTEGRATION_SECRET) {
        return res.status(401).json({ message: "Invalid integration secret" });
      }

      const result = integrationJobSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: result.error.errors[0].message });
      }

      const { plateDisplay, customerName, customerEmail, serviceCode, servicePackageCode, serviceChecklist } = result.data;

      // Resolve steps: explicit checklist > named package > service type config > fallback
      let resolvedSteps: string[] = [];
      let resolvedServiceCode = serviceCode || "STANDARD";
      if (serviceChecklist && serviceChecklist.length > 0) {
        resolvedSteps = serviceChecklist;
      } else if (servicePackageCode && SERVICE_PACKAGES[servicePackageCode]) {
        const pkg = SERVICE_PACKAGES[servicePackageCode];
        resolvedSteps = pkg.steps;
        resolvedServiceCode = pkg.serviceCode;
      } else if (resolvedServiceCode && SERVICE_TYPE_CONFIG[resolvedServiceCode as ServiceCode]) {
        resolvedSteps = SERVICE_TYPE_CONFIG[resolvedServiceCode as ServiceCode].steps;
      }

      // Create wash job
      const tenantId = (req as any).tenantId || "default";
      const job = await storage.createWashJob(tenantId, {
        plateDisplay: displayPlate(plateDisplay),
        plateNormalized: normalizePlate(plateDisplay),
        countryHint: "OTHER",
        technicianId: "integration",
        status: "received",
        serviceCode: resolvedServiceCode,
        startAt: new Date(),
      });

      // Create customer access token
      const token = generateJobToken();
      const access = await storage.createCustomerJobAccess({
        washJobId: job.id,
        token,
        customerName: customerName || null,
        customerEmail: customerEmail || null,
        serviceCode: servicePackageCode || resolvedServiceCode || null,
      });

      // Create service checklist items from resolved steps
      const checklistItems = resolvedSteps.length > 0 ? resolvedSteps : WASH_STATUS_ORDER.filter(s => s !== "received");
      await storage.createServiceChecklistItems(tenantId,
        checklistItems.map((label, index) => ({
          washJobId: job.id,
          label,
          orderIndex: index,
          expected: true,
          confirmed: false,
        }))
      );

      // Log event
      await storage.logEvent(tenantId, {
        type: "integration_job_created",
        plateDisplay: job.plateDisplay,
        plateNormalized: job.plateNormalized,
        washJobId: job.id,
        payloadJson: { serviceCode, hasCustomer: !!customerName },
      });

      // Broadcast update
      broadcastEvent({ type: "wash_created", job });

      // Fire CRM webhook (non-blocking)
      fireWebhook("wash_created", { jobId: job.id, plate: job.plateDisplay, plateNormalized: job.plateNormalized, serviceCode: job.serviceCode, status: job.status, source: "integration" }).catch(() => {});

      const baseUrl = getBaseUrl(req);
      res.json({
        job,
        customerUrl: `${baseUrl}/customer/job/${token}`,
        token,
      });
    } catch (error) {
      console.error("Error creating integration job:", error);
      res.status(500).json({ message: "Failed to create job" });
    }
  });

  // =====================
  // TENANTS & BRANCHES (Multi-tenancy)
  // =====================

  // --- Public Tenant Info (for tenant portal page) ---
  app.get("/api/public/tenant/:slug", async (req, res) => {
    try {
      const tenant = await storage.getTenantBySlug(req.params.slug as string);
      if (!tenant || !tenant.isActive) return res.status(404).json({ message: "Tenant not found" });
      res.json({
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
        status: tenant.status,
        primaryColor: tenant.primaryColor,
        secondaryColor: tenant.secondaryColor,
        logoUrl: tenant.logoUrl,
        faviconUrl: tenant.faviconUrl,
        contactEmail: tenant.contactEmail,
        contactPhone: tenant.contactPhone,
        address: tenant.address,
      });
    } catch (error) {
      console.error("Error fetching public tenant info:", error);
      res.status(500).json({ message: "Failed to fetch tenant" });
    }
  });

  // --- Tenant Branding (public for login page) ---
  app.get("/api/public/branding/:slug", async (req, res) => {
    try {
      const tenant = await storage.getTenantBySlug(req.params.slug as string);
      if (!tenant || !tenant.isActive) return res.status(404).json({ message: "Tenant not found" });
      res.json({
        name: tenant.name,
        primaryColor: tenant.primaryColor,
        secondaryColor: tenant.secondaryColor,
        logoUrl: tenant.logoUrl,
        faviconUrl: tenant.faviconUrl,
      });
    } catch (error) {
      console.error("Error fetching public branding:", error);
      res.status(500).json({ message: "Failed to fetch branding" });
    }
  });

  // --- Tenant Branding (authenticated) ---
  app.get("/api/tenant/branding", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = req.tenantId || "default";
      const tenant = await storage.getTenant(tenantId);
      if (!tenant) return res.status(404).json({ message: "Tenant not found" });
      res.json(tenant);
    } catch (error) {
      console.error("Error fetching tenant branding:", error);
      res.status(500).json({ message: "Failed to fetch branding" });
    }
  });

  app.put("/api/tenant/branding", isAuthenticated, requireRole("admin"), async (req: any, res) => {
    try {
      const tenantId = req.tenantId || "default";
      const { primaryColor, secondaryColor, logoUrl, faviconUrl, customDomain } = req.body;
      const tenant = await storage.updateTenant(tenantId, { primaryColor, secondaryColor, logoUrl, faviconUrl, customDomain });
      if (!tenant) return res.status(404).json({ message: "Tenant not found" });
      res.json(tenant);
    } catch (error) {
      console.error("Error updating tenant branding:", error);
      res.status(500).json({ message: "Failed to update branding" });
    }
  });

  // --- Branches ---
  app.get("/api/branches", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = req.tenantId || "default";
      const result = await storage.getBranches(tenantId);
      res.json(result);
    } catch (error) {
      console.error("Error fetching branches:", error);
      res.status(500).json({ message: "Failed to fetch branches" });
    }
  });

  app.post("/api/branches", isAuthenticated, requireRole("admin"), async (req: any, res) => {
    try {
      const tenantId = req.tenantId || "default";
      const branch = await storage.createBranch({ ...req.body, tenantId });
      res.status(201).json(branch);
    } catch (error) {
      console.error("Error creating branch:", error);
      res.status(500).json({ message: "Failed to create branch" });
    }
  });

  app.get("/api/branches/:id", isAuthenticated, async (req: any, res) => {
    try {
      const branch = await storage.getBranch(req.params.id as string);
      if (!branch) return res.status(404).json({ message: "Branch not found" });
      res.json(branch);
    } catch (error) {
      console.error("Error fetching branch:", error);
      res.status(500).json({ message: "Failed to fetch branch" });
    }
  });

  app.patch("/api/branches/:id", isAuthenticated, requireRole("admin"), async (req: any, res) => {
    try {
      const branch = await storage.updateBranch(req.params.id as string, req.body);
      if (!branch) return res.status(404).json({ message: "Branch not found" });
      res.json(branch);
    } catch (error) {
      console.error("Error updating branch:", error);
      res.status(500).json({ message: "Failed to update branch" });
    }
  });

  // --- Admin Tenant Management (Super Admin) ---
  app.get("/api/admin/tenants", isAuthenticated, requireSuperAdminMiddleware(), async (req: any, res) => {
    try {
      const result = await storage.getTenants();
      res.json(result);
    } catch (error) {
      console.error("Error fetching tenants:", error);
      res.status(500).json({ message: "Failed to fetch tenants" });
    }
  });

  app.post("/api/admin/tenants", isAuthenticated, requireSuperAdminMiddleware(), async (req: any, res) => {
    try {
      const { name, slug, plan, contactEmail, contactPhone, address, billingEmail, primaryColor, secondaryColor, status } = req.body;
      if (!name || !slug) return res.status(400).json({ message: "name and slug are required" });
      // Check slug uniqueness
      const existing = await storage.getTenantBySlug(slug);
      if (existing) return res.status(409).json({ message: "Slug already in use" });
      // Set trial end date: 14 days from now
      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + 14);
      const tenant = await storage.createTenant({
        name,
        slug,
        plan: plan || "free",
        status: status || "trial",
        contactEmail: contactEmail || null,
        contactPhone: contactPhone || null,
        address: address || null,
        billingEmail: billingEmail || contactEmail || null,
        primaryColor: primaryColor || null,
        secondaryColor: secondaryColor || null,
        trialEndsAt,
      });
      // Create a default branch for the new tenant
      const branch = await storage.createBranch({ tenantId: tenant.id, name: "Main Branch" });

      // Seed default booking services for the new tenant
      const defaultServices = [
        { name: "Express Wash", description: "Quick exterior wash", price: 8000, durationMinutes: 15, sortOrder: 0 },
        { name: "Standard Wash", description: "Full exterior and interior wash", price: 15000, durationMinutes: 30, sortOrder: 1 },
        { name: "Premium Wash", description: "Complete wash with wax and polish", price: 25000, durationMinutes: 45, sortOrder: 2 },
        { name: "Full Detail", description: "Comprehensive interior and exterior detailing", price: 45000, durationMinutes: 90, sortOrder: 3 },
      ];
      for (const svc of defaultServices) {
        await storage.createBookingService(tenant.id, { ...svc, isActive: true, branchId: branch.id } as any);
      }

      // Seed default time slot config (Mon-Sat, 08:00-17:00, 30min intervals, max 3 concurrent)
      const defaultSlotConfigs = [];
      for (let day = 1; day <= 6; day++) { // Monday(1) through Saturday(6)
        defaultSlotConfigs.push({
          tenantId: tenant.id,
          branchId: branch.id,
          dayOfWeek: day,
          startTime: "08:00",
          endTime: "17:00",
          slotIntervalMinutes: 30,
          maxConcurrentBookings: 3,
          isActive: true,
        });
      }
      await storage.upsertTimeSlotConfig(tenant.id, defaultSlotConfigs as any);

      // Generate the tenant access URL
      const host = req.get("host") || "localhost:5000";
      const protocol = req.protocol || "https";
      const tenantUrl = `${protocol}://${host}/t/${tenant.slug}`;
      res.status(201).json({ tenant, branch, tenantUrl });
    } catch (error) {
      console.error("Error creating tenant:", error);
      res.status(500).json({ message: "Failed to create tenant" });
    }
  });

  app.get("/api/admin/tenants/:id", isAuthenticated, requireSuperAdminMiddleware(), async (req: any, res) => {
    try {
      const tenant = await storage.getTenant(req.params.id as string);
      if (!tenant) return res.status(404).json({ message: "Tenant not found" });
      const tenantBranches = await storage.getBranches(tenant.id);
      res.json({ ...tenant, branches: tenantBranches });
    } catch (error) {
      console.error("Error fetching tenant:", error);
      res.status(500).json({ message: "Failed to fetch tenant" });
    }
  });

  app.patch("/api/admin/tenants/:id", isAuthenticated, requireSuperAdminMiddleware(), async (req: any, res) => {
    try {
      const tenant = await storage.updateTenant(req.params.id as string, req.body);
      if (!tenant) return res.status(404).json({ message: "Tenant not found" });
      res.json(tenant);
    } catch (error) {
      console.error("Error updating tenant:", error);
      res.status(500).json({ message: "Failed to update tenant" });
    }
  });

  app.delete("/api/admin/tenants/:id", isAuthenticated, requireSuperAdminMiddleware(), async (req: any, res) => {
    try {
      // Soft delete: set isActive = false
      const tenant = await storage.updateTenant(req.params.id as string, { isActive: false });
      if (!tenant) return res.status(404).json({ message: "Tenant not found" });
      res.json({ message: "Tenant deactivated", tenant });
    } catch (error) {
      console.error("Error deactivating tenant:", error);
      res.status(500).json({ message: "Failed to deactivate tenant" });
    }
  });

  // Tenant stats (for admin dashboard cards)
  app.get("/api/admin/tenants/:id/stats", isAuthenticated, requireSuperAdminMiddleware(), async (req: any, res) => {
    try {
      const stats = await storage.getTenantStats(req.params.id as string);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching tenant stats:", error);
      res.status(500).json({ message: "Failed to fetch tenant stats" });
    }
  });

  // All tenants with stats (enriched list)
  app.get("/api/admin/tenants-with-stats", isAuthenticated, requireSuperAdminMiddleware(), async (req: any, res) => {
    try {
      const allTenants = await storage.getTenants();
      const enriched = await Promise.all(
        allTenants.map(async (tenant) => {
          try {
            const stats = await storage.getTenantStats(tenant.id);
            return { ...tenant, stats };
          } catch {
            return { ...tenant, stats: { userCount: 0, washCount: 0, parkingSessionCount: 0, branchCount: 0 } };
          }
        })
      );
      res.json(enriched);
    } catch (error) {
      console.error("Error fetching tenants with stats:", error);
      res.status(500).json({ message: "Failed to fetch tenants" });
    }
  });

  // =====================
  // INVOICES
  // =====================

  // Super admin: list all invoices (optionally filtered by tenant)
  app.get("/api/admin/invoices", isAuthenticated, requireSuperAdminMiddleware(), async (req: any, res) => {
    try {
      const { tenantId, status } = req.query;
      const result = await storage.getInvoices({ tenantId: tenantId as string, status: status as string });
      res.json(result);
    } catch (error) {
      console.error("Error fetching invoices:", error);
      res.status(500).json({ message: "Failed to fetch invoices" });
    }
  });

  // Super admin: generate invoice for a tenant
  app.post("/api/admin/invoices", isAuthenticated, requireSuperAdminMiddleware(), async (req: any, res) => {
    try {
      const { tenantId, month } = req.body;
      if (!tenantId) return res.status(400).json({ message: "tenantId is required" });

      const tenant = await storage.getTenant(tenantId);
      if (!tenant) return res.status(404).json({ message: "Tenant not found" });

      const { BILLING_PLANS, generateInvoiceNumber } = await import("../shared/billing");
      type TenantPlan = keyof typeof BILLING_PLANS;
      const plan = BILLING_PLANS[tenant.plan as TenantPlan];

      // Get usage stats
      const stats = await storage.getTenantStats(tenantId);

      // Calculate period
      const targetMonth = month || new Date().toISOString().slice(0, 7);
      const [year, mon] = targetMonth.split("-").map(Number);
      const periodStart = new Date(year, mon - 1, 1);
      const periodEnd = new Date(year, mon, 0, 23, 59, 59);
      const dueDate = new Date(year, mon, 15); // Due 15th of next month

      // Build line items
      const lineItems = [
        { description: `${plan.label} Plan - Monthly Subscription`, quantity: 1, unitPrice: plan.price, total: plan.price },
      ];
      const subtotal = plan.price;
      const tax = 0;
      const total = subtotal + tax;

      const invoice = await storage.createInvoice({
        tenantId,
        invoiceNumber: generateInvoiceNumber(tenant.slug, periodStart),
        status: "pending",
        periodStart,
        periodEnd,
        subtotal,
        tax,
        total,
        planAtTime: tenant.plan,
        washCount: stats.washCount,
        parkingSessionCount: stats.parkingSessionCount,
        activeUserCount: stats.userCount,
        branchCount: stats.branchCount,
        lineItems,
        issuedAt: new Date(),
        dueDate,
      });

      res.status(201).json(invoice);
    } catch (error) {
      console.error("Error creating invoice:", error);
      res.status(500).json({ message: "Failed to create invoice" });
    }
  });

  // Super admin: update invoice status
  app.patch("/api/admin/invoices/:id", isAuthenticated, requireSuperAdminMiddleware(), async (req: any, res) => {
    try {
      const { status, paidAt, notes } = req.body;
      const update: any = {};
      if (status) update.status = status;
      if (paidAt) update.paidAt = new Date(paidAt);
      if (status === "paid" && !paidAt) update.paidAt = new Date();
      if (notes !== undefined) update.notes = notes;
      const invoice = await storage.updateInvoice(req.params.id as string, update);
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });
      res.json(invoice);
    } catch (error) {
      console.error("Error updating invoice:", error);
      res.status(500).json({ message: "Failed to update invoice" });
    }
  });

  // Super admin: send invoice to tenant via email
  app.post("/api/admin/invoices/:id/send", isAuthenticated, requireSuperAdminMiddleware(), async (req: any, res) => {
    try {
      const invoice = await storage.getInvoice(req.params.id as string);
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });

      const tenant = await storage.getTenant(invoice.tenantId);
      if (!tenant) return res.status(404).json({ message: "Tenant not found" });

      const recipientEmail = tenant.billingEmail || tenant.contactEmail;
      if (!recipientEmail) {
        return res.status(400).json({
          message: "No billing or contact email configured for this tenant. Please update the tenant's email in settings.",
        });
      }

      const { formatCents } = await import("../shared/billing");
      const nodemailer = await import("nodemailer");

      // Configure transporter — uses SMTP_* env vars or defaults to Ethereal for testing
      let transporter;
      if (process.env.SMTP_HOST) {
        transporter = nodemailer.default.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || "587"),
          secure: process.env.SMTP_SECURE === "true",
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        });
      } else {
        // Fallback: create test account (Ethereal) for development
        const testAccount = await nodemailer.default.createTestAccount();
        transporter = nodemailer.default.createTransport({
          host: "smtp.ethereal.email",
          port: 587,
          secure: false,
          auth: { user: testAccount.user, pass: testAccount.pass },
        });
      }

      const lineItemsHTML = (invoice.lineItems as any[] || [])
        .map((item: any) => `
          <tr>
            <td style="padding: 10px 16px; border-bottom: 1px solid #f3f4f6;">${item.description}</td>
            <td style="padding: 10px 16px; border-bottom: 1px solid #f3f4f6; text-align: center;">${item.quantity}</td>
            <td style="padding: 10px 16px; border-bottom: 1px solid #f3f4f6; text-align: right;">$${(item.unitPrice / 100).toFixed(2)}</td>
            <td style="padding: 10px 16px; border-bottom: 1px solid #f3f4f6; text-align: right; font-weight: 600;">$${(item.total / 100).toFixed(2)}</td>
          </tr>
        `).join("");

      const periodLabel = invoice.periodStart
        ? new Date(invoice.periodStart).toLocaleDateString("en-US", { month: "long", year: "numeric" })
        : "Current Period";

      const dueDateLabel = invoice.dueDate
        ? new Date(invoice.dueDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
        : "Upon receipt";

      const emailHTML = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family: 'Segoe UI', Tahoma, sans-serif; color: #1a1a1a; background: #f9fafb; margin: 0; padding: 0;">
  <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; margin-top: 32px; margin-bottom: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <div style="background: #3B82F6; padding: 24px 32px; color: #fff;">
      <h1 style="margin: 0; font-size: 24px; font-weight: 700;">HOPSVOIR</h1>
      <p style="margin: 4px 0 0; font-size: 13px; opacity: 0.9;">Invoice for ${periodLabel}</p>
    </div>
    <div style="padding: 32px;">
      <p style="font-size: 15px; color: #374151; margin-bottom: 24px;">
        Dear <strong>${tenant.name}</strong>,<br><br>
        Please find your invoice details below. Invoice <strong>${invoice.invoiceNumber}</strong> is due by <strong>${dueDateLabel}</strong>.
      </p>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <thead>
          <tr style="background: #f9fafb;">
            <th style="padding: 10px 16px; text-align: left; font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.5px; border-bottom: 2px solid #e5e7eb;">Description</th>
            <th style="padding: 10px 16px; text-align: center; font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.5px; border-bottom: 2px solid #e5e7eb;">Qty</th>
            <th style="padding: 10px 16px; text-align: right; font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.5px; border-bottom: 2px solid #e5e7eb;">Unit Price</th>
            <th style="padding: 10px 16px; text-align: right; font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.5px; border-bottom: 2px solid #e5e7eb;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${lineItemsHTML}
        </tbody>
      </table>
      <div style="text-align: right; margin-bottom: 24px;">
        <p style="font-size: 14px; color: #6b7280; margin: 4px 0;">Subtotal: <strong style="color: #1a1a1a;">${formatCents(invoice.subtotal || 0)}</strong></p>
        <p style="font-size: 14px; color: #6b7280; margin: 4px 0;">Tax: <strong style="color: #1a1a1a;">${formatCents(invoice.tax || 0)}</strong></p>
        <div style="border-top: 2px solid #1a1a1a; display: inline-block; padding-top: 8px; margin-top: 8px;">
          <p style="font-size: 20px; font-weight: 700; margin: 0;">Total: ${formatCents(invoice.total || 0)}</p>
        </div>
      </div>
      <div style="background: #f0f9ff; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <p style="font-size: 13px; color: #374151; margin: 0;"><strong>Usage Summary:</strong> ${invoice.washCount} washes, ${invoice.parkingSessionCount} parking sessions, ${invoice.activeUserCount} active users, ${invoice.branchCount} branch(es)</p>
      </div>
      ${invoice.notes ? `<p style="font-size: 13px; color: #92400e; background: #fffbeb; padding: 12px; border-radius: 4px;"><strong>Notes:</strong> ${invoice.notes}</p>` : ""}
    </div>
    <div style="background: #f9fafb; padding: 20px 32px; text-align: center; border-top: 1px solid #e5e7eb;">
      <p style="font-size: 12px; color: #9ca3af; margin: 0;">Thank you for your business.</p>
      <p style="font-size: 12px; color: #9ca3af; margin: 4px 0 0;">HOPSVOIR — Professional Carwash & Parking Management</p>
    </div>
  </div>
</body>
</html>`;

      const info = await transporter.sendMail({
        from: process.env.SMTP_FROM || '"HOPSVOIR Billing" <billing@hopsvoir.com>',
        to: recipientEmail,
        subject: `Invoice ${invoice.invoiceNumber} — ${periodLabel}`,
        html: emailHTML,
      });

      // Update invoice status to pending if it was draft
      if (invoice.status === "draft") {
        await storage.updateInvoice(invoice.id, { status: "pending", issuedAt: new Date() } as any);
      }

      // Log the Ethereal preview URL in development
      const previewUrl = nodemailer.default.getTestMessageUrl(info);
      if (previewUrl) {
        console.log("Invoice email preview URL:", previewUrl);
      }

      res.json({
        success: true,
        message: `Invoice sent to ${recipientEmail}`,
        previewUrl: previewUrl || undefined,
      });
    } catch (error) {
      console.error("Error sending invoice:", error);
      res.status(500).json({ message: "Failed to send invoice email" });
    }
  });

  // Tenant admin: view own invoices
  app.get("/api/tenant/invoices", isAuthenticated, requireRole("admin"), async (req: any, res) => {
    try {
      const tenantId = req.tenantId || "default";
      const result = await storage.getInvoicesByTenant(tenantId);
      res.json(result);
    } catch (error) {
      console.error("Error fetching tenant invoices:", error);
      res.status(500).json({ message: "Failed to fetch invoices" });
    }
  });

  // =====================
  // INVENTORY
  // =====================
  // Feature gate: all inventory endpoints require "inventory" feature
  app.use("/api/inventory", requireFeature("inventory"));

  // --- Inventory Items ---
  app.get("/api/inventory/items", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { category, lowStock, active } = req.query;
      const items = await storage.getInventoryItems(tenantId, {
        category: category as string | undefined,
        lowStock: lowStock === "true",
        active: active !== undefined ? active === "true" : undefined,
      });
      res.json(items);
    } catch (error) {
      console.error("Error fetching inventory items:", error);
      res.status(500).json({ message: "Failed to fetch inventory items" });
    }
  });

  app.post("/api/inventory/items", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const item = await storage.createInventoryItem(tenantId, req.body);
      res.status(201).json(item);
    } catch (error) {
      console.error("Error creating inventory item:", error);
      res.status(500).json({ message: "Failed to create inventory item" });
    }
  });

  app.get("/api/inventory/items/:id", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const item = await storage.getInventoryItem(req.params.id as string, tenantId);
      if (!item) return res.status(404).json({ message: "Item not found" });
      res.json(item);
    } catch (error) {
      console.error("Error fetching inventory item:", error);
      res.status(500).json({ message: "Failed to fetch inventory item" });
    }
  });

  app.patch("/api/inventory/items/:id", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const item = await storage.updateInventoryItem(req.params.id as string, req.body, tenantId);
      if (!item) return res.status(404).json({ message: "Item not found" });
      res.json(item);
    } catch (error) {
      console.error("Error updating inventory item:", error);
      res.status(500).json({ message: "Failed to update inventory item" });
    }
  });

  app.post("/api/inventory/items/:id/adjust", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { quantity, notes } = req.body;
      if (typeof quantity !== "number") return res.status(400).json({ message: "quantity is required" });
      const item = await storage.adjustInventoryStock(req.params.id as string, quantity, tenantId);
      if (!item) return res.status(404).json({ message: "Item not found" });
      // Log the manual adjustment as a consumption record for audit trail
      if (quantity !== 0) {
        await storage.logEvent(tenantId, {
          type: "inventory_adjustment",
          userId: req.user?.id,
          payloadJson: { itemId: req.params.id, quantity, notes, itemName: item.name },
        });
      }
      res.json(item);
    } catch (error) {
      console.error("Error adjusting inventory stock:", error);
      res.status(500).json({ message: "Failed to adjust stock" });
    }
  });

  // --- Stock Take (bulk adjust) ---
  app.post("/api/inventory/stock-take", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { adjustments, notes } = req.body;
      if (!Array.isArray(adjustments) || adjustments.length === 0) {
        return res.status(400).json({ message: "No adjustments provided" });
      }

      const results: Array<{
        itemId: string;
        itemName: string;
        unit: string;
        previousStock: number;
        newStock: number;
        difference: number;
        isLowStock: boolean;
        minimumStock: number;
      }> = [];

      for (const adj of adjustments) {
        if (!adj.itemId || typeof adj.newStock !== "number") continue;
        const item = await storage.getInventoryItem(adj.itemId, tenantId);
        if (!item) continue;
        const currentStock = item.currentStock ?? 0;
        const delta = adj.newStock - currentStock;
        if (delta === 0) continue;
        const updated = await storage.adjustInventoryStock(adj.itemId, delta, tenantId);
        if (updated) {
          results.push({
            itemId: adj.itemId,
            itemName: updated.name,
            unit: updated.unit,
            previousStock: currentStock,
            newStock: adj.newStock,
            difference: delta,
            isLowStock: adj.newStock <= (updated.minimumStock ?? 0),
            minimumStock: updated.minimumStock ?? 0,
          });
        }
      }

      const dateStr = new Date().toISOString().split("T")[0];
      await storage.logEvent(tenantId, {
        type: "stock_take",
        userId: req.user?.id,
        payloadJson: {
          date: dateStr,
          notes: notes || `Stock take - ${dateStr}`,
          itemCount: results.length,
          adjustments: results.map((r) => ({
            itemId: r.itemId,
            itemName: r.itemName,
            previousStock: r.previousStock,
            newStock: r.newStock,
            difference: r.difference,
          })),
        },
      });

      res.json({
        success: true,
        adjustedCount: results.length,
        results,
        lowStockItems: results.filter((r) => r.isLowStock),
      });
    } catch (error) {
      console.error("Error performing stock take:", error);
      res.status(500).json({ message: "Failed to complete stock take" });
    }
  });

  // --- Suppliers ---
  app.get("/api/inventory/suppliers", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const activeOnly = req.query.active === "true";
      const result = await storage.getSuppliers(tenantId, activeOnly || undefined);
      res.json(result);
    } catch (error) {
      console.error("Error fetching suppliers:", error);
      res.status(500).json({ message: "Failed to fetch suppliers" });
    }
  });

  app.post("/api/inventory/suppliers", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const supplier = await storage.createSupplier(tenantId, req.body);
      res.status(201).json(supplier);
    } catch (error) {
      console.error("Error creating supplier:", error);
      res.status(500).json({ message: "Failed to create supplier" });
    }
  });

  app.get("/api/inventory/suppliers/:id", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const supplier = await storage.getSupplier(req.params.id as string, tenantId);
      if (!supplier) return res.status(404).json({ message: "Supplier not found" });
      res.json(supplier);
    } catch (error) {
      console.error("Error fetching supplier:", error);
      res.status(500).json({ message: "Failed to fetch supplier" });
    }
  });

  app.patch("/api/inventory/suppliers/:id", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const supplier = await storage.updateSupplier(req.params.id as string, req.body, tenantId);
      if (!supplier) return res.status(404).json({ message: "Supplier not found" });
      res.json(supplier);
    } catch (error) {
      console.error("Error updating supplier:", error);
      res.status(500).json({ message: "Failed to update supplier" });
    }
  });

  // --- Inventory Consumption ---
  app.get("/api/inventory/consumption", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { itemId, fromDate, toDate } = req.query;
      const result = await storage.getInventoryConsumption(tenantId, {
        itemId: itemId as string | undefined,
        fromDate: fromDate ? new Date(fromDate as string) : undefined,
        toDate: toDate ? new Date(toDate as string) : undefined,
      });
      res.json(result);
    } catch (error) {
      console.error("Error fetching consumption:", error);
      res.status(500).json({ message: "Failed to fetch consumption records" });
    }
  });

  app.post("/api/inventory/consumption", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const record = await storage.logInventoryConsumption(tenantId, {
        ...req.body,
        createdBy: req.user?.id,
      });
      res.status(201).json(record);
    } catch (error) {
      console.error("Error logging consumption:", error);
      res.status(500).json({ message: "Failed to log consumption" });
    }
  });

  // --- Purchase Orders ---
  app.get("/api/inventory/purchase-orders", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const { status, supplierId } = req.query;
      const result = await storage.getPurchaseOrders(tenantId, {
        status: status as string | undefined,
        supplierId: supplierId as string | undefined,
      });
      res.json(result);
    } catch (error) {
      console.error("Error fetching purchase orders:", error);
      res.status(500).json({ message: "Failed to fetch purchase orders" });
    }
  });

  app.post("/api/inventory/purchase-orders", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const order = await storage.createPurchaseOrder(tenantId, {
        ...req.body,
        createdBy: req.user?.id,
      });
      res.status(201).json(order);
    } catch (error) {
      console.error("Error creating purchase order:", error);
      res.status(500).json({ message: "Failed to create purchase order" });
    }
  });

  app.get("/api/inventory/purchase-orders/:id", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const order = await storage.getPurchaseOrder(req.params.id as string, tenantId);
      if (!order) return res.status(404).json({ message: "Purchase order not found" });
      res.json(order);
    } catch (error) {
      console.error("Error fetching purchase order:", error);
      res.status(500).json({ message: "Failed to fetch purchase order" });
    }
  });

  app.patch("/api/inventory/purchase-orders/:id", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const order = await storage.updatePurchaseOrder(req.params.id as string, req.body, tenantId);
      if (!order) return res.status(404).json({ message: "Purchase order not found" });
      res.json(order);
    } catch (error) {
      console.error("Error updating purchase order:", error);
      res.status(500).json({ message: "Failed to update purchase order" });
    }
  });

  app.post("/api/inventory/purchase-orders/:id/receive", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const order = await storage.receivePurchaseOrder(req.params.id as string, tenantId);
      if (!order) return res.status(404).json({ message: "Purchase order not found" });
      await storage.logEvent(tenantId, {
        type: "purchase_order_received",
        userId: req.user?.id,
        payloadJson: { orderId: order.id, supplierId: order.supplierId, totalCost: order.totalCost },
      });
      res.json(order);
    } catch (error) {
      console.error("Error receiving purchase order:", error);
      res.status(500).json({ message: "Failed to receive purchase order" });
    }
  });

  // --- Inventory Analytics & Alerts ---
  app.get("/api/inventory/analytics", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const analytics = await storage.getInventoryAnalytics(tenantId);
      res.json(analytics);
    } catch (error) {
      console.error("Error fetching inventory analytics:", error);
      res.status(500).json({ message: "Failed to fetch inventory analytics" });
    }
  });

  app.get("/api/inventory/low-stock", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const items = await storage.getLowStockItems(tenantId);
      res.json(items);
    } catch (error) {
      console.error("Error fetching low-stock items:", error);
      res.status(500).json({ message: "Failed to fetch low-stock items" });
    }
  });

  // Inventory forecast
  app.get("/api/inventory/forecast", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const tenantId = (req as any).tenantId || "default";
      const days = Math.min(parseInt(String(req.query.days || "7")), 30);
      const data = await storage.getInventoryForecast(tenantId, days);
      res.json(data);
    } catch (error) {
      console.error("Error fetching inventory forecast:", error);
      res.status(500).json({ message: "Failed to fetch inventory forecast" });
    }
  });

  // =====================
  // BILLING
  // =====================

  // Tenant admin: own billing usage
  app.get("/api/tenant/billing/usage", isAuthenticated, requireRole("admin"), async (req: any, res) => {
    try {
      const tenantId = req.tenantId || "default";
      const tenant = await storage.getTenant(tenantId);
      if (!tenant) return res.status(404).json({ message: "Tenant not found" });

      const { BILLING_PLANS } = await import("../shared/billing");
      type TenantPlanKey = keyof typeof BILLING_PLANS;
      const planLimits = BILLING_PLANS[(tenant.plan || "free") as TenantPlanKey];

      // Get current month usage
      const stats = await storage.getTenantStats(tenantId);

      res.json({
        plan: tenant.plan,
        status: tenant.status || "active",
        washCount: stats.washCount,
        parkingSessionCount: stats.parkingSessionCount,
        activeUserCount: stats.userCount,
        branchCount: stats.branchCount,
        limits: planLimits,
        trialEndsAt: tenant.trialEndsAt,
      });
    } catch (error) {
      console.error("Error fetching billing usage:", error);
      res.status(500).json({ message: "Failed to fetch usage" });
    }
  });

  // Super admin: all tenants billing overview
  app.get("/api/admin/billing", isAuthenticated, requireSuperAdminMiddleware(), async (req: any, res) => {
    try {
      const { db: dbRef } = await import("./db");
      const { billingSnapshots } = await import("@shared/schema");
      const { desc } = await import("drizzle-orm");
      const snapshots = await dbRef.select().from(billingSnapshots).orderBy(desc(billingSnapshots.month));

      // Also get all invoices for revenue calculations
      const allInvoices = await storage.getInvoices({});
      const allTenants = await storage.getTenants();

      res.json({
        snapshots,
        invoices: allInvoices,
        tenants: allTenants,
      });
    } catch (error) {
      console.error("Error fetching billing:", error);
      res.status(500).json({ message: "Failed to fetch billing" });
    }
  });

  // Super admin: trigger snapshot generation
  app.post("/api/admin/billing/snapshot", isAuthenticated, requireSuperAdminMiddleware(), async (req: any, res) => {
    try {
      const month = req.body.month || new Date().toISOString().slice(0, 7);
      const count = await generateAllSnapshots(month);
      res.json({ message: `Generated snapshots for ${count} tenants`, month });
    } catch (error) {
      console.error("Error generating snapshots:", error);
      res.status(500).json({ message: "Failed to generate snapshots" });
    }
  });

  // =====================
  // FEATURE FLAGS
  // =====================

  // Get current tenant's enabled features
  app.get("/api/features", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = req.tenantId || "default";
      const features = await getEnabledFeatures(tenantId);
      res.json({ features });
    } catch (error) {
      console.error("Error fetching features:", error);
      res.status(500).json({ message: "Failed to fetch features" });
    }
  });

  // Super admin: list all feature flags
  app.get("/api/admin/features", isAuthenticated, requireSuperAdminMiddleware(), async (req: any, res) => {
    try {
      const { db: dbRef } = await import("./db");
      const { featureFlags } = await import("@shared/schema");
      const flags = await dbRef.select().from(featureFlags);
      res.json(flags);
    } catch (error) {
      console.error("Error fetching feature flags:", error);
      res.status(500).json({ message: "Failed to fetch feature flags" });
    }
  });

  // Super admin: seed default feature flags
  app.post("/api/admin/features/seed", isAuthenticated, requireSuperAdminMiddleware(), async (req: any, res) => {
    try {
      await seedFeatureFlags();
      res.json({ message: "Feature flags seeded" });
    } catch (error) {
      console.error("Error seeding features:", error);
      res.status(500).json({ message: "Failed to seed features" });
    }
  });

  // Super admin: set feature overrides for a tenant
  app.put("/api/admin/tenants/:id/features", isAuthenticated, requireSuperAdminMiddleware(), async (req: any, res) => {
    try {
      const tenantId = req.params.id as string;
      const { overrides } = req.body; // [{ featureCode: string, enabled: boolean }]
      if (!Array.isArray(overrides)) return res.status(400).json({ message: "overrides array required" });

      const { db: dbRef } = await import("./db");
      const { tenantFeatureOverrides } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");

      for (const override of overrides) {
        const [existing] = await dbRef.select().from(tenantFeatureOverrides).where(
          and(eq(tenantFeatureOverrides.tenantId, tenantId), eq(tenantFeatureOverrides.featureCode, override.featureCode))
        );
        if (existing) {
          await dbRef.update(tenantFeatureOverrides).set({ enabled: override.enabled, updatedAt: new Date() }).where(eq(tenantFeatureOverrides.id, existing.id));
        } else {
          await dbRef.insert(tenantFeatureOverrides).values({ tenantId, featureCode: override.featureCode, enabled: override.enabled });
        }
      }

      const features = await getEnabledFeatures(tenantId);
      res.json({ features });
    } catch (error) {
      console.error("Error setting feature overrides:", error);
      res.status(500).json({ message: "Failed to set feature overrides" });
    }
  });

  // =====================
  // GLOBAL ANALYTICS (Super Admin)
  // =====================

  app.get("/api/admin/analytics/global", isAuthenticated, requireSuperAdminMiddleware(), async (req: any, res) => {
    try {
      const { db: dbRef } = await import("./db");
      const { tenants: tenantsTable, washJobs: wjTable, parkingSessions: psTable } = await import("@shared/schema");
      const { sql: sqlFn, eq, gte } = await import("drizzle-orm");

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      // Total tenants
      const [tenantCount] = await dbRef.select({ count: sqlFn<number>`count(*)::int` }).from(tenantsTable);

      // Total washes this month
      const [washCount] = await dbRef.select({ count: sqlFn<number>`count(*)::int` }).from(wjTable).where(gte(wjTable.createdAt, startOfMonth));

      // Total parking sessions this month
      const [parkCount] = await dbRef.select({ count: sqlFn<number>`count(*)::int` }).from(psTable).where(gte(psTable.createdAt, startOfMonth));

      // Top tenants by wash count
      const topTenants = await dbRef
        .select({
          tenantId: wjTable.tenantId,
          tenantName: tenantsTable.name,
          washCount: sqlFn<number>`count(*)::int`,
        })
        .from(wjTable)
        .leftJoin(tenantsTable, eq(wjTable.tenantId, tenantsTable.id))
        .where(gte(wjTable.createdAt, startOfMonth))
        .groupBy(wjTable.tenantId, tenantsTable.name)
        .orderBy(sqlFn`count(*) desc`)
        .limit(10);

      // Plan distribution
      const planDist = await dbRef
        .select({ plan: tenantsTable.plan, count: sqlFn<number>`count(*)::int` })
        .from(tenantsTable)
        .where(eq(tenantsTable.isActive, true))
        .groupBy(tenantsTable.plan);

      res.json({
        totalTenants: tenantCount?.count || 0,
        monthlyWashes: washCount?.count || 0,
        monthlyParkingSessions: parkCount?.count || 0,
        topTenants,
        planDistribution: planDist,
      });
    } catch (error) {
      console.error("Error fetching global analytics:", error);
      res.status(500).json({ message: "Failed to fetch global analytics" });
    }
  });

  app.get("/api/admin/analytics/trends", isAuthenticated, requireSuperAdminMiddleware(), async (req: any, res) => {
    try {
      const { db: dbRef } = await import("./db");
      const { washJobs: wjTable, tenants: tenantsTable } = await import("@shared/schema");
      const { sql: sqlFn, gte } = await import("drizzle-orm");

      const months = parseInt(req.query.months as string) || 6;
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - months);

      // Monthly wash counts
      const monthlyWashes = await dbRef
        .select({
          month: sqlFn<string>`to_char(${wjTable.createdAt}, 'YYYY-MM')`,
          count: sqlFn<number>`count(*)::int`,
        })
        .from(wjTable)
        .where(gte(wjTable.createdAt, startDate))
        .groupBy(sqlFn`to_char(${wjTable.createdAt}, 'YYYY-MM')`)
        .orderBy(sqlFn`to_char(${wjTable.createdAt}, 'YYYY-MM')`);

      // Monthly new tenants
      const monthlyTenants = await dbRef
        .select({
          month: sqlFn<string>`to_char(${tenantsTable.createdAt}, 'YYYY-MM')`,
          count: sqlFn<number>`count(*)::int`,
        })
        .from(tenantsTable)
        .where(gte(tenantsTable.createdAt, startDate))
        .groupBy(sqlFn`to_char(${tenantsTable.createdAt}, 'YYYY-MM')`)
        .orderBy(sqlFn`to_char(${tenantsTable.createdAt}, 'YYYY-MM')`);

      res.json({ monthlyWashes, monthlyTenants });
    } catch (error) {
      console.error("Error fetching trends:", error);
      res.status(500).json({ message: "Failed to fetch trends" });
    }
  });

  // =====================
  // Corporate Account Management (Admin/Manager only)
  // =====================

  // List all corporate accounts (from CRM database)
  app.get("/api/corporate/accounts", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const status = req.query.status as string | undefined;
      const accounts = await getCRMCorporateAccounts(status);
      res.json(accounts);
    } catch (error) {
      console.error("Error fetching corporate accounts:", error);
      res.status(500).json({ message: "Failed to fetch corporate accounts" });
    }
  });

  // Get single corporate account (from CRM database)
  app.get("/api/corporate/accounts/:id", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const account = await getCRMCorporateAccount(req.params.id as string);
      if (!account) return res.status(404).json({ message: "Corporate account not found" });
      res.json(account);
    } catch (error) {
      console.error("Error fetching corporate account:", error);
      res.status(500).json({ message: "Failed to fetch corporate account" });
    }
  });

  // Approve corporate account (in CRM database)
  app.patch("/api/corporate/accounts/:id/approve", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const id = req.params.id as string;
      const { managementNote } = req.body || {};
      const approvedBy = (req as any).user?.claims?.sub || (req as any).user?.email || "admin";

      const existing = await getCRMCorporateAccount(id);
      if (!existing) return res.status(404).json({ message: "Corporate account not found" });
      if (existing.status === "APPROVED") return res.status(400).json({ message: "Account is already approved" });

      const updated = await updateCRMCorporateAccount(id, {
        status: "APPROVED",
        approvedAt: new Date(),
        approvedBy,
        managementNote: managementNote || existing.managementNote || undefined,
      });

      // Send approval email directly via nodemailer (Zoho SMTP)
      try {
        console.log("[Corporate Approval] Sending approval email to:", existing.contactEmail);
        const nodemailer = await import("nodemailer");

        const emailUser = process.env.EMAIL_USER;
        const emailPass = process.env.EMAIL_PASS;

        if (!emailUser || !emailPass) {
          console.warn("[Corporate Approval] EMAIL_USER or EMAIL_PASS not configured — skipping email");
        } else {
          const transporter = nodemailer.default.createTransport({
            host: process.env.SMTP_HOST || "smtp.zoho.eu",
            port: parseInt(process.env.SMTP_PORT || "465"),
            secure: true,
            auth: { user: emailUser, pass: emailPass },
          });

          const approvalHTML = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);padding:32px;text-align:center;">
      <h1 style="color:#f5c518;margin:0;font-size:28px;letter-spacing:1px;">PRESTIGE</h1>
      <p style="color:#94a3b8;margin:8px 0 0;font-size:14px;">Premium Car Wash & Detailing</p>
    </div>
    <div style="padding:32px;">
      <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:16px;margin-bottom:24px;text-align:center;">
        <span style="font-size:32px;">✅</span>
        <h2 style="color:#065f46;margin:8px 0 0;font-size:20px;">Corporate Account Approved</h2>
      </div>
      <p style="color:#374151;font-size:15px;line-height:1.6;">Dear <strong>${existing.contactName}</strong>,</p>
      <p style="color:#374151;font-size:15px;line-height:1.6;">
        We are pleased to inform you that your corporate account application for
        <strong>${existing.companyName}</strong> has been <strong style="color:#059669;">approved</strong>.
      </p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:24px 0;">
        <h3 style="color:#1e293b;margin:0 0 12px;font-size:16px;">Your Account Details</h3>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:8px 0;color:#64748b;font-size:14px;">Company</td><td style="padding:8px 0;color:#1e293b;font-size:14px;font-weight:600;text-align:right;">${existing.companyName}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b;font-size:14px;border-top:1px solid #e2e8f0;">Registration Code</td><td style="padding:8px 0;color:#1e293b;font-size:14px;font-weight:600;text-align:right;border-top:1px solid #e2e8f0;"><code style="background:#fef3c7;padding:4px 10px;border-radius:4px;color:#92400e;font-size:15px;">${existing.registrationCode}</code></td></tr>
        </table>
      </div>
      <h3 style="color:#1e293b;font-size:16px;">What's Next?</h3>
      <ol style="color:#374151;font-size:14px;line-height:2;padding-left:20px;">
        <li>Visit <a href="https://prestigebyekhaya.com/corporate/register?code=${encodeURIComponent(existing.registrationCode)}" style="color:#2563eb;text-decoration:none;font-weight:600;">prestigebyekhaya.com</a> to complete your account setup</li>
        <li>Your registration code is <strong>${existing.registrationCode}</strong></li>
        <li>Your fleet vehicles will receive corporate pricing and priority service</li>
      </ol>
      <div style="text-align:center;margin:32px 0 16px;">
        <a href="https://prestigebyekhaya.com/corporate/register?code=${encodeURIComponent(existing.registrationCode)}" style="display:inline-block;background:linear-gradient(135deg,#f5c518,#eab308);color:#1a1a2e;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;box-shadow:0 2px 8px rgba(245,197,24,0.3);">
          Create Your Account →
        </a>
      </div>
    </div>
    <div style="background:#f9fafb;padding:20px 32px;text-align:center;border-top:1px solid #e5e7eb;">
      <p style="font-size:12px;color:#9ca3af;margin:0;">Thank you for choosing PRESTIGE Car Wash.</p>
      <p style="font-size:12px;color:#9ca3af;margin:4px 0 0;">This is an automated email — please do not reply directly.</p>
    </div>
  </div>
</body>
</html>`;

          const adminEmails = [
            process.env.ADMIN_EMAIL,
            process.env.MANAGER_EMAIL,
            process.env.EMAIL_NOTIFICATION,
          ].filter(Boolean).join(", ");

          const info = await transporter.sendMail({
            from: `"PRESTIGE Car Wash" <${emailUser}>`,
            to: existing.contactEmail,
            cc: adminEmails || undefined,
            subject: `✅ Corporate Account Approved — ${existing.companyName}`,
            html: approvalHTML,
          });

          console.log("[Corporate Approval] Email sent successfully. MessageId:", info.messageId);
        }
      } catch (emailError) {
        console.error("[Corporate Approval] Failed to send approval email:", emailError);
        // Don't fail the approval if email fails
      }

      res.json(updated);
    } catch (error) {
      console.error("Error approving corporate account:", error);
      res.status(500).json({ message: "Failed to approve corporate account" });
    }
  });

  // Reject corporate account (in CRM database)
  app.patch("/api/corporate/accounts/:id/reject", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const id = req.params.id as string;
      const { managementNote } = req.body || {};

      const existing = await getCRMCorporateAccount(id);
      if (!existing) return res.status(404).json({ message: "Corporate account not found" });
      if (existing.status === "REJECTED") return res.status(400).json({ message: "Account is already rejected" });

      const updated = await updateCRMCorporateAccount(id, {
        status: "REJECTED",
        managementNote: managementNote || existing.managementNote || undefined,
      });

      res.json(updated);
    } catch (error) {
      console.error("Error rejecting corporate account:", error);
      res.status(500).json({ message: "Failed to reject corporate account" });
    }
  });

  // Reset corporate account back to PENDING (in CRM database)
  app.patch("/api/corporate/accounts/:id/reset", isAuthenticated, requireRole("manager", "admin"), async (req: any, res) => {
    try {
      const id = req.params.id as string;

      const existing = await getCRMCorporateAccount(id);
      if (!existing) return res.status(404).json({ message: "Corporate account not found" });
      if (existing.status === "PENDING") return res.status(400).json({ message: "Account is already pending" });

      const updated = await updateCRMCorporateAccount(id, {
        status: "PENDING",
        managementNote: existing.managementNote || undefined,
      });

      res.json(updated);
    } catch (error) {
      console.error("Error resetting corporate account:", error);
      res.status(500).json({ message: "Failed to reset corporate account" });
    }
  });

  // Delete corporate account (in CRM database)
  app.delete("/api/corporate/accounts/:id", isAuthenticated, requireRole("admin"), async (req: any, res) => {
    try {
      const id = req.params.id as string;

      const existing = await getCRMCorporateAccount(id);
      if (!existing) return res.status(404).json({ message: "Corporate account not found" });

      const deleted = await deleteCRMCorporateAccount(id);
      if (!deleted) return res.status(500).json({ message: "Failed to delete corporate account" });

      res.json({ message: "Corporate account deleted", id });
    } catch (error) {
      console.error("Error deleting corporate account:", error);
      res.status(500).json({ message: "Failed to delete corporate account" });
    }
  });

  // =====================
  // CORPORATE PORTAL (public — auth by registration code)
  // =====================

  app.get("/api/corporate/portal/:code", async (req: any, res) => {
    try {
      const { code } = req.params;
      const accounts = await storage.getCorporateAccounts();
      const account = accounts.find((a) => a.registrationCode === code);
      if (!account) return res.status(404).json({ message: "Account not found" });
      if (account.status !== "APPROVED") {
        return res.json({
          id: account.id,
          companyName: account.companyName,
          status: account.status,
          contactName: account.contactName,
          contactEmail: account.contactEmail,
        });
      }
      res.json({
        id: account.id,
        companyName: account.companyName,
        companySlug: account.companySlug,
        registrationNumber: account.registrationNumber,
        registrationCode: account.registrationCode,
        status: account.status,
        contactName: account.contactName,
        contactEmail: account.contactEmail,
        contactPhone: account.contactPhone,
        fleetSize: account.fleetSize,
        fleetWashCount: account.fleetWashCount,
        freeWashCredits: account.freeWashCredits,
        approvedAt: account.approvedAt,
        createdAt: account.createdAt,
      });
    } catch (error) {
      console.error("Error fetching corporate portal data:", error);
      res.status(500).json({ message: "Failed to load portal" });
    }
  });

  // =====================
  // OCR — plate candidate extraction
  // =====================

  app.post("/api/ocr/plate-candidates", isAuthenticated, async (req, res) => {
    try {
      const { image } = req.body;
      if (!image || typeof image !== "string") {
        return res.status(400).json({ message: "Missing base64 image data" });
      }

      const { recognizePlate } = await import("./lib/ocr-service");
      const candidates = await recognizePlate(image);

      res.json({ candidates });
    } catch (error) {
      console.error("OCR error:", error);
      res.json({ candidates: [], message: "OCR processing failed" });
    }
  });

  return httpServer;
}
