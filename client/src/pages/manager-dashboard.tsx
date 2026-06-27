import { useState } from "react";
import Swal from "sweetalert2";
import { useLocation, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ThemeToggle } from "@/components/theme-toggle";
import { AppFooter } from "@/components/app-footer";
import { LowStockAlert } from "@/components/low-stock-alert";
import { useAuth } from "@/hooks/use-auth";
import { useSSE } from "@/hooks/use-sse";
import { useToast } from "@/hooks/use-toast";
import {
  BarChart3, ClipboardList, LogOut,
  Car, ParkingSquare, Activity, Users, RefreshCw, Clock,
  TrendingUp, Calendar, Target, ArrowRight, Zap, Settings, DollarSign,
  Search, Eye, Edit, Trash2, X, Phone, Mail, User, CalendarDays, AlertTriangle, Timer, Award, Package,
  CreditCard, CheckCircle2, Receipt, Printer, Download, Send, MessageSquare, Palette
} from "lucide-react";
import type { WashJob, WashStatus } from "@shared/schema";
import { formatDistanceToNow, format } from "date-fns";
import logoPath from "@assets/hopsvoir_principal_logo_1769965389226.png";
import { AreaChart, Area, BarChart as RechartsBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface QueueStats {
  activeWashes: number;
  parkedVehicles: number;
  todayWashes: number;
  activeJobs: (WashJob & { priority?: number; priorityFactors?: Record<string, number>; checklistTotal?: number; checklistDone?: number; currentStepLabel?: string | null })[];
}

interface LocalBooking {
  id: string;
  bookingReference: string;
  status: string;
  bookingDate: string;
  timeSlot: string;
  licensePlate: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleColor: string;
  serviceName: string;
  serviceDescription: string;
  customerName: string | null;
  customerEmail: string;
  customerPhone: string | null;
  totalAmount: number;
  notes: string | null;
  createdAt?: string;
}

interface AnalyticsSummary {
  todayWashes: number;
  todayParking: number;
  weekWashes: number;
  weekParking: number;
  avgWashTime: number;
}

const STATUS_COLORS: Record<WashStatus, string> = {
  received: "bg-blue-500",
  high_pressure_wash: "bg-cyan-500",
  foam_application: "bg-teal-500",
  rinse: "bg-sky-500",
  hand_dry_vacuum: "bg-amber-500",
  tyre_shine: "bg-pink-500",
  quality_check: "bg-purple-500",
  complete: "bg-green-500",
};

const STATUS_LABELS: Record<WashStatus, string> = {
  received: "Received",
  high_pressure_wash: "High Pressure Wash",
  foam_application: "Foam Application",
  rinse: "Rinse",
  hand_dry_vacuum: "Hand Dry & Vacuum",
  tyre_shine: "Tyre Shine",
  quality_check: "Quality Check",
  complete: "Complete",
};

export default function ManagerDashboard() {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const isSuperAdmin = user?.isSuperAdmin === true;

  // Enable SSE for real-time updates
  useSSE();

  const { data: stats, isLoading, isFetching, refetch } = useQuery<QueueStats>({
    queryKey: ["/api/queue/stats"],
    refetchInterval: 10000, // 10s for live feel
  });

  const { data: analytics } = useQuery<AnalyticsSummary>({
    queryKey: ["/api/analytics/summary"],
  });

  const { data: crmBookings } = useQuery<LocalBooking[]>({
    queryKey: ["/api/crm/bookings"],
  });

  const { data: loyaltyAnalytics } = useQuery<{
    totalAccounts: number;
    totalPointsIssued: number;
    totalPointsRedeemed: number;
    pointsIssuedToday: number;
    topEarners: { plateDisplay: string; customerName: string | null; pointsBalance: number; totalWashes: number }[];
  }>({
    queryKey: ["/api/loyalty/analytics"],
  });

  const { data: growthData } = useQuery<{
    months: { month: string; label: string; newUsers: number; newMembers: number; newBookings: number; cumulativeUsers: number; cumulativeMembers: number }[];
    totals: { totalUsers: number; totalMembers: number; totalBookings: number };
    peaks: { bestUserMonth: string; bestMemberMonth: string; bestBookingMonth: string };
    growthRate: { usersLast3Months: number; membersLast3Months: number };
  }>({
    queryKey: ["/api/crm/growth-analytics"],
  });

  const { data: bookingAnalytics } = useQuery<{
    todayBookings: number;
    weekBookings: number;
    monthBookings: number;
    completionRate: number;
    bookingRevenue: number;
  }>({
    queryKey: ["/api/manager/booking-analytics"],
  });

  const upcomingBookings = crmBookings?.filter(b => b.status === "CONFIRMED").slice(0, 5) || [];

  // Booking Management Dialog State
  const { toast } = useToast();
  const qClient = useQueryClient();
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<LocalBooking | null>(null);
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentSuccessOpen, setPaymentSuccessOpen] = useState(false);
  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false);

  // Edit form state
  const [editDate, setEditDate] = useState("");
  const [editTimeSlot, setEditTimeSlot] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editStatus, setEditStatus] = useState("");

  // Payment form state
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentConfirmedBy, setPaymentConfirmedBy] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [lastPayment, setLastPayment] = useState<any>(null);

  // Search for booking
  const { data: searchResults, isLoading: isSearching, refetch: searchBookings, error: searchError } = useQuery<{ bookings: LocalBooking[]; error?: string; technicalError?: string }>({
    queryKey: ["search-bookings", searchQuery],
    queryFn: async () => {
      if (!searchQuery.trim()) return { bookings: [] };
      const res = await fetch(`/api/crm/bookings/manager?search=${encodeURIComponent(searchQuery)}&limit=10`, {
        credentials: "include",
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || `Search failed (${res.status})`);
      }
      return res.json();
    },
    enabled: false,
  });

  // Update booking mutation (CRM / Ekhaya DB)
  const updateMutation = useMutation({
    mutationFn: async (updates: { id: string; data: any }) => {
      const res = await fetch(`/api/crm/bookings/${updates.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(updates.data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to update booking");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Booking updated successfully" });
      qClient.invalidateQueries({ queryKey: ["/api/crm/bookings"] });
      qClient.invalidateQueries({ queryKey: ["search-bookings"] });
      setEditDialogOpen(false);
      setSelectedBooking(null);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update", description: error.message, variant: "destructive" });
    },
  });

  // Cancel booking mutation (CRM / Ekhaya DB)
  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/crm/bookings/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to cancel booking");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Booking cancelled successfully" });
      qClient.invalidateQueries({ queryKey: ["/api/crm/bookings"] });
      qClient.invalidateQueries({ queryKey: ["search-bookings"] });
      setCancelDialogOpen(false);
      setSelectedBooking(null);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to cancel", description: error.message, variant: "destructive" });
    },
  });

  // Payment mutation
  const paymentMutation = useMutation({
    mutationFn: async (data: { bookingId: string; amount: number; paymentMethod: string; paymentReference: string; confirmedBy: string; notes: string }) => {
      const res = await fetch(`/api/crm/bookings/${data.bookingId}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to confirm payment");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setLastPayment(data.payment);
      setPaymentDialogOpen(false);
      setPaymentSuccessOpen(true);
      qClient.invalidateQueries({ queryKey: ["/api/crm/bookings"] });
      qClient.invalidateQueries({ queryKey: ["search-bookings"] });
    },
    onError: (error: Error) => {
      toast({ title: "Payment failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteJobMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/wash-jobs/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to delete job");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Job removed from queue" });
      qClient.invalidateQueries({ queryKey: ["/api/queue/stats"] });
      qClient.invalidateQueries({ queryKey: ["/api/wash-jobs"] });
      qClient.invalidateQueries({ queryKey: ["/api/analytics/summary"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete job", description: error.message, variant: "destructive" });
    },
  });

  const handleBookingClick = (booking: LocalBooking) => {
    setSelectedBooking(booking);
    setActionDialogOpen(true);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      searchBookings();
    }
  };

  const handleSelectSearchResult = (booking: LocalBooking) => {
    setSelectedBooking(booking);
    setSearchDialogOpen(false);
    setActionDialogOpen(true);
  };

  const openEditDialog = (booking: LocalBooking) => {
    setEditDate(booking.bookingDate.split("T")[0]);
    setEditTimeSlot(booking.timeSlot);
    setEditNotes(booking.notes || "");
    setEditStatus(booking.status);
    setActionDialogOpen(false);
    setEditDialogOpen(true);
  };

  const handleSaveEdit = () => {
    if (!selectedBooking) return;
    const updates: any = {};
    if (editDate !== selectedBooking.bookingDate.split("T")[0]) updates.bookingDate = editDate;
    if (editTimeSlot !== selectedBooking.timeSlot) updates.timeSlot = editTimeSlot;
    if (editNotes !== (selectedBooking.notes || "")) updates.notes = editNotes;
    if (editStatus !== selectedBooking.status) updates.status = editStatus;

    if (Object.keys(updates).length === 0) {
      toast({ title: "No changes to save" });
      return;
    }
    updateMutation.mutate({ id: selectedBooking.id, data: updates });
  };

  const openPaymentDialog = (booking: LocalBooking) => {
    setPaymentAmount(String((booking.totalAmount || 0) / 100));
    setPaymentMethod("cash");
    setPaymentReference("");
    setPaymentConfirmedBy(user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() : "");
    setPaymentNotes("");
    setActionDialogOpen(false);
    setPaymentDialogOpen(true);
  };

  const handleConfirmPayment = () => {
    if (!selectedBooking || !paymentConfirmedBy) return;
    paymentMutation.mutate({
      bookingId: selectedBooking.id,
      amount: Math.round(parseFloat(paymentAmount) * 100),
      paymentMethod,
      paymentReference,
      confirmedBy: paymentConfirmedBy,
      notes: paymentNotes,
    });
  };

  const handlePrintReceipt = () => {
    setPaymentSuccessOpen(false);
    setReceiptDialogOpen(true);
  };

  const getReceiptHtml = () => {
    const receiptEl = document.getElementById("printable-receipt");
    if (!receiptEl) return "";
    return `<html><head><title>Receipt - ${lastPayment?.receiptNumber}</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; color: #333; }
        table { border-collapse: collapse; }
        a { color: #2563eb; }
        @media print { body { margin: 0; padding: 20px; } }
      </style></head><body>
      ${receiptEl.innerHTML}
      </body></html>`;
  };

  const printReceipt = () => {
    const html = getReceiptHtml();
    if (!html) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(html.replace("</body>", "<script>window.print(); window.close();</script></body>"));
    printWindow.document.close();
  };

  const downloadReceipt = () => {
    const html = getReceiptHtml();
    if (!html) return;
    // Open print dialog — user selects "Save as PDF" as the destination
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(html.replace("</body>", `
      <script>
        document.title = "Receipt-${lastPayment?.receiptNumber || "receipt"}";
        window.print();
      </script></body>`));
    printWindow.document.close();
    toast({ title: "Save as PDF", description: "Select 'Save as PDF' as the printer destination to download." });
  };

  const sendReceipt = async () => {
    if (!lastPayment || !selectedBooking) return;
    const email = lastPayment.customerEmail || selectedBooking.customerEmail;
    if (!email) {
      toast({ title: "No email address", description: "This customer has no email address on file.", variant: "destructive" });
      return;
    }
    try {
      const res = await fetch(`/api/crm/bookings/${selectedBooking.id}/send-receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ paymentId: lastPayment.id }),
      });
      if (res.ok) {
        toast({ title: "Receipt sent", description: `Receipt emailed to ${email}` });
      } else {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Send failed", description: err.message || "Could not send receipt email.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Send failed", description: "Network error — could not send receipt.", variant: "destructive" });
    }
  };

  // Fetch existing payment for a booking and show invoice/receipt
  const fetchPaymentForInvoice = async (bookingId: string) => {
    try {
      const res = await fetch(`/api/crm/bookings/${bookingId}/payment`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setLastPayment(data.payment);
        setReceiptDialogOpen(true);
      } else {
        // No payment yet — offer to create one
        toast({
          title: "No payment recorded yet",
          description: "Record a payment first to generate an invoice.",
        });
        if (selectedBooking) {
          openPaymentDialog(selectedBooking);
        }
      }
    } catch {
      toast({ title: "Error", description: "Failed to fetch payment details", variant: "destructive" });
    }
  };

  const initials = user ?
    `${user.firstName?.charAt(0) || ""}${user.lastName?.charAt(0) || "U"}`.toUpperCase()
    : "M";

  const navItems = [
    { href: "/manager", label: "Live Queue", icon: Activity },
    { href: "/manager/bookings", label: "Bookings", icon: CalendarDays },
    { href: "/manager/timeslots", label: "Schedule", icon: Clock },
    { href: "/manager/roster", label: "Roster", icon: Timer },
    { href: "/staff/messages", label: "Messages", icon: MessageSquare },
    { href: "/manager/inventory", label: "Inventory", icon: Package },
    { href: "/manager/revenue", label: "Revenue", icon: DollarSign },
    { href: "/manager/customers", label: "Customers", icon: Users },
    { href: "/manager/analytics", label: "Analytics", icon: BarChart3 },
    { href: "/manager/branding", label: "Branding", icon: Palette },
    { href: "/manager/billing", label: "Billing", icon: CreditCard },
    { href: "/manager/audit", label: "Audit Log", icon: ClipboardList },
    { href: "/manager/settings", label: "Settings", icon: Settings },
  ];

  const handleRefresh = () => {
    qClient.invalidateQueries({ queryKey: ["/api/queue/stats"] });
    qClient.invalidateQueries({ queryKey: ["/api/crm/bookings"] });
    refetch();
  };

  // Calculate daily target progress (assuming 50 washes/day target)
  const dailyTarget = 50;
  const targetProgress = Math.min(((stats?.todayWashes || 0) / dailyTarget) * 100, 100);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b border-border">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <img src={logoPath} alt="HOPSVOIR" className="h-9 w-auto" />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Avatar className="w-8 h-8">
              <AvatarImage src={user?.profileImageUrl || undefined} />
              <AvatarFallback className="text-sm">{initials}</AvatarFallback>
            </Avatar>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => logout()}
              data-testid="button-logout"
            >
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      <nav className="border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto">
            {navItems.map((item) => {
              const isActive = location === item.href;
              return (
                <Link key={item.href} href={item.href}>
                  <button
                    type="button"
                    className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                      isActive
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                    data-testid={`nav-${item.label.toLowerCase().replace(" ", "-")}`}
                  >
                    <item.icon className="w-4 h-4" />
                    {item.label}
                  </button>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      <main className="flex-1 max-w-4xl mx-auto px-4 py-6 w-full">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Car className="w-5 h-5 text-primary" />
                </div>
                <div>
                  {isLoading ? (
                    <Skeleton className="h-8 w-8" />
                  ) : (
                    <p className="text-2xl font-bold" data-testid="stat-active-washes">
                      {stats?.activeWashes ?? 0}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">Active Washes</p>
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                  <ParkingSquare className="w-5 h-5 text-green-500" />
                </div>
                <div>
                  {isLoading ? (
                    <Skeleton className="h-8 w-8" />
                  ) : (
                    <p className="text-2xl font-bold" data-testid="stat-parked">
                      {stats?.parkedVehicles ?? 0}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">Parked</p>
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <Activity className="w-5 h-5 text-amber-500" />
                </div>
                <div>
                  {isLoading ? (
                    <Skeleton className="h-8 w-8" />
                  ) : (
                    <p className="text-2xl font-bold" data-testid="stat-today">
                      {stats?.todayWashes ?? 0}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">Today</p>
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-purple-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold" data-testid="stat-bookings">
                    {upcomingBookings.length}
                  </p>
                  <p className="text-xs text-muted-foreground">Upcoming</p>
                </div>
              </div>
            </Card>
          </div>

          {/* Low Stock Alert */}
          <LowStockAlert />

          {/* Local booking analytics (self-service + app) */}
          {bookingAnalytics && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card className="p-3">
                <p className="text-xs text-muted-foreground">Bookings today</p>
                <p className="text-xl font-bold">{bookingAnalytics.todayBookings}</p>
              </Card>
              <Card className="p-3">
                <p className="text-xs text-muted-foreground">This week</p>
                <p className="text-xl font-bold">{bookingAnalytics.weekBookings}</p>
              </Card>
              <Card className="p-3">
                <p className="text-xs text-muted-foreground">Completion rate</p>
                <p className="text-xl font-bold">{bookingAnalytics.completionRate}%</p>
              </Card>
              <Card className="p-3">
                <p className="text-xs text-muted-foreground">Revenue (30d)</p>
                <p className="text-xl font-bold">R {((bookingAnalytics.bookingRevenue || 0) / 100).toFixed(0)}</p>
              </Card>
            </div>
          )}

          {/* Daily Target Progress */}
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Target className="w-5 h-5 text-primary" />
                <span className="font-medium">Daily Target</span>
              </div>
              <span className="text-sm text-muted-foreground">
                {stats?.todayWashes || 0} / {dailyTarget} washes
              </span>
            </div>
            <Progress value={targetProgress} className="h-2" />
            <p className="text-xs text-muted-foreground mt-2">
              {targetProgress >= 100
                ? "Target reached! Great job!"
                : `${Math.round(dailyTarget - (stats?.todayWashes || 0))} more washes to reach daily target`}
            </p>
          </Card>

          {/* Two Column Layout */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* Live Queue */}
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Zap className="w-5 h-5 text-amber-500" />
                  Live Queue
                </h2>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefresh}
                  disabled={isFetching}
                  data-testid="button-refresh"
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
                  {isFetching ? "Refreshing..." : "Refresh"}
                </Button>
              </div>

              {isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-14" />
                  <Skeleton className="h-14" />
                  <Skeleton className="h-14" />
                </div>
              ) : stats?.activeJobs?.length ? (
                <div className="space-y-3">
                  {stats.activeJobs.slice(0, 5).map((job, index) => {
                    const hasChecklist = (job.checklistTotal ?? 0) > 0;
                    const progressPct = hasChecklist ? Math.round(((job.checklistDone ?? 0) / job.checklistTotal!) * 100) : 0;
                    const isWaiting = (job.checklistDone ?? 0) === 0;
                    const progressColor = isWaiting ? "bg-blue-500" : progressPct >= 100 ? "bg-green-500" : "bg-amber-500";

                    return (
                    <motion.div
                      key={job.id}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className={`p-3 rounded-lg cursor-pointer hover:bg-muted/80 transition-colors border ${
                        (job.priority || 0) > 80 ? "bg-red-500/10 border-red-500/30" :
                        (job.priority || 0) > 50 ? "bg-amber-500/10 border-amber-500/30" :
                        "bg-muted/50 border-transparent"
                      }`}
                      onClick={() => setLocation(`/wash-job/${job.id}`)}
                      data-testid={`queue-job-${job.id}`}
                    >
                      {/* Top row: plate + actions */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Car className="w-4 h-4 text-primary" />
                          <p className="font-mono font-semibold text-sm">{job.plateDisplay}</p>
                          {job.priorityFactors?.vipBonus && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-yellow-500 text-yellow-600">
                              <Award className="w-3 h-3 mr-0.5" /> VIP
                            </Badge>
                          )}
                          {(job.priority || 0) > 0 && (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              (job.priority || 0) > 80 ? "bg-red-500/20 text-red-600" :
                              (job.priority || 0) > 50 ? "bg-amber-500/20 text-amber-600" :
                              "bg-muted text-muted-foreground"
                            }`}>
                              P{job.priority}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-muted-foreground">
                            {job.startAt ? formatDistanceToNow(new Date(job.startAt), { addSuffix: true }) : ""}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            onClick={async (e) => {
                              e.stopPropagation();
                              const result = await Swal.fire({
                                title: 'Remove from queue?',
                                text: `Remove ${job.plateDisplay} from the queue?`,
                                icon: 'warning',
                                showCancelButton: true,
                                confirmButtonColor: '#ef4444',
                                cancelButtonColor: '#6b7280',
                                confirmButtonText: 'Yes, remove it',
                                cancelButtonText: 'Cancel',
                              });
                              if (result.isConfirmed) {
                                deleteJobMutation.mutate(job.id);
                              }
                            }}
                            disabled={deleteJobMutation.isPending}
                            data-testid={`delete-job-${job.id}`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>

                      {/* Progress section */}
                      {hasChecklist ? (
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium truncate max-w-[60%]">
                              {isWaiting ? (
                                <span className="text-blue-500">Waiting to start</span>
                              ) : progressPct >= 100 ? (
                                <span className="text-green-500">All steps done</span>
                              ) : (
                                <span className="text-amber-500">{job.currentStepLabel || "In progress"}</span>
                              )}
                            </span>
                            <span className="text-[10px] font-bold text-muted-foreground">
                              {job.checklistDone}/{job.checklistTotal}
                            </span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                            <motion.div
                              className={`h-full rounded-full ${progressColor}`}
                              initial={{ width: 0 }}
                              animate={{ width: `${Math.max(progressPct, isWaiting ? 0 : 5)}%` }}
                              transition={{ duration: 0.5, ease: "easeOut" }}
                            />
                          </div>
                        </div>
                      ) : (
                        <Badge className={`${STATUS_COLORS[job.status as WashStatus] || "bg-gray-500"} text-white text-xs`}>
                          {STATUS_LABELS[job.status as WashStatus] || job.status}
                        </Badge>
                      )}
                    </motion.div>
                    );
                  })}
                  {stats.activeJobs.length > 5 && (
                    <p className="text-xs text-center text-muted-foreground pt-2">
                      +{stats.activeJobs.length - 5} more in queue
                    </p>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Activity className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No active jobs</p>
                </div>
              )}
            </Card>

            {/* Upcoming CRM Bookings */}
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-blue-500" />
                  Upcoming Bookings
                </h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchQuery("");
                    setSearchDialogOpen(true);
                  }}
                >
                  <Search className="w-4 h-4 mr-1" />
                  Search
                </Button>
              </div>

              {upcomingBookings.length > 0 ? (
                <div className="space-y-3">
                  {upcomingBookings.map((booking, index) => (
                    <motion.div
                      key={booking.id}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className="flex items-center justify-between p-3 rounded-lg bg-blue-500/5 border border-blue-500/10 cursor-pointer hover:bg-blue-500/10 transition-colors"
                      onClick={() => handleBookingClick(booking)}
                    >
                      <div>
                        <p className="font-mono font-semibold text-sm">{booking.licensePlate}</p>
                        <p className="text-xs text-muted-foreground">
                          {booking.serviceName}
                        </p>
                        {booking.bookingReference && (
                          <p className="text-xs text-primary font-mono">
                            #{booking.bookingReference}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <Badge variant="secondary" className="text-xs">
                          {booking.timeSlot}
                        </Badge>
                        <p className="text-xs text-muted-foreground mt-1">
                          {format(new Date(booking.bookingDate + "T00:00:00"), "MMM d")}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Calendar className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No upcoming bookings</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => setSearchDialogOpen(true)}
                  >
                    <Search className="w-4 h-4 mr-2" />
                    Search Bookings
                  </Button>
                </div>
              )}
            </Card>
          </div>

          {/* Performance Summary */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-green-500" />
              Performance Summary
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-4 rounded-lg bg-muted/50">
                <p className="text-3xl font-bold text-primary">
                  {analytics?.todayWashes || stats?.todayWashes || 0}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Today's Washes</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-muted/50">
                <p className="text-3xl font-bold text-green-500">
                  {analytics?.weekWashes || 0}
                </p>
                <p className="text-xs text-muted-foreground mt-1">This Week</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-muted/50">
                <p className="text-3xl font-bold text-amber-500">
                  {analytics?.avgWashTime || 0}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Avg. Minutes</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-muted/50">
                <p className="text-3xl font-bold text-purple-500">
                  {stats?.parkedVehicles || 0}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Currently Parked</p>
              </div>
            </div>
          </Card>

          {/* Loyalty Program Summary */}
          {loyaltyAnalytics && loyaltyAnalytics.totalAccounts > 0 && (
            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Award className="w-5 h-5 text-amber-500" />
                Loyalty Program
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold text-amber-500">
                    {loyaltyAnalytics.totalAccounts}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Members</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold text-green-500">
                    {loyaltyAnalytics.pointsIssuedToday.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Points Today</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold text-primary">
                    {loyaltyAnalytics.totalPointsIssued.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Total Issued</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <p className="text-2xl font-bold text-rose-500">
                    {loyaltyAnalytics.totalPointsRedeemed.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Redeemed</p>
                </div>
              </div>
              {loyaltyAnalytics.topEarners.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">Top Members</h3>
                  <div className="space-y-2">
                    {loyaltyAnalytics.topEarners.slice(0, 5).map((earner, i) => (
                      <div key={i} className="flex items-center justify-between text-sm p-2 rounded bg-muted/30">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground w-5">{i + 1}.</span>
                          <div>
                            <span className="font-mono font-medium">{earner.plateDisplay}</span>
                            {earner.customerName && (
                              <span className="text-muted-foreground ml-2 text-xs">{earner.customerName}</span>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="font-bold text-amber-500">{earner.pointsBalance}</span>
                          <span className="text-xs text-muted-foreground ml-1">pts</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* Customer Growth Analytics */}
          {growthData && growthData.months.length > 0 && (
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-blue-500" />
                  Customer Growth
                </h2>
                <div className="flex gap-3 text-xs">
                  {growthData.growthRate.usersLast3Months !== 0 && (
                    <span className={`font-semibold ${growthData.growthRate.usersLast3Months > 0 ? "text-green-600" : "text-red-500"}`}>
                      {growthData.growthRate.usersLast3Months > 0 ? "+" : ""}{growthData.growthRate.usersLast3Months}% users (3mo)
                    </span>
                  )}
                  {growthData.growthRate.membersLast3Months !== 0 && (
                    <span className={`font-semibold ${growthData.growthRate.membersLast3Months > 0 ? "text-green-600" : "text-red-500"}`}>
                      {growthData.growthRate.membersLast3Months > 0 ? "+" : ""}{growthData.growthRate.membersLast3Months}% members (3mo)
                    </span>
                  )}
                </div>
              </div>

              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="text-center p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30">
                  <p className="text-2xl font-bold text-blue-600">{growthData.totals.totalUsers}</p>
                  <p className="text-xs text-muted-foreground mt-1">Total Users</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30">
                  <p className="text-2xl font-bold text-emerald-600">{growthData.totals.totalMembers}</p>
                  <p className="text-xs text-muted-foreground mt-1">Active Members</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-purple-50 dark:bg-purple-950/30">
                  <p className="text-2xl font-bold text-purple-600">{growthData.totals.totalBookings}</p>
                  <p className="text-xs text-muted-foreground mt-1">Total Bookings</p>
                </div>
              </div>

              {/* Cumulative Growth Chart */}
              <div className="mb-6">
                <h3 className="text-sm font-medium text-muted-foreground mb-3">Cumulative Growth (12 months)</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={growthData.months} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradUsers" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradMembers" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                    <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" />
                    <Tooltip
                      contentStyle={{ borderRadius: "8px", fontSize: "12px", border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--card-foreground))" }}
                      labelStyle={{ fontWeight: "bold", marginBottom: "4px" }}
                    />
                    <Legend wrapperStyle={{ fontSize: "12px" }} />
                    <Area type="monotone" dataKey="cumulativeUsers" name="Total Users" stroke="#3b82f6" fill="url(#gradUsers)" strokeWidth={2} />
                    <Area type="monotone" dataKey="cumulativeMembers" name="Total Members" stroke="#10b981" fill="url(#gradMembers)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Monthly New Additions Bar Chart */}
              <div className="mb-4">
                <h3 className="text-sm font-medium text-muted-foreground mb-3">Monthly New Additions</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <RechartsBarChart data={growthData.months} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                    <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" />
                    <Tooltip
                      contentStyle={{ borderRadius: "8px", fontSize: "12px", border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--card-foreground))" }}
                      labelStyle={{ fontWeight: "bold", marginBottom: "4px" }}
                    />
                    <Legend wrapperStyle={{ fontSize: "12px" }} />
                    <Bar dataKey="newUsers" name="New Users" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="newMembers" name="New Members" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="newBookings" name="New Bookings" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </RechartsBarChart>
                </ResponsiveContainer>
              </div>

              {/* Peak Months */}
              <div className="grid grid-cols-3 gap-3 pt-3 border-t">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Peak Users</p>
                  <p className="text-sm font-semibold text-blue-600">{growthData.peaks.bestUserMonth}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Peak Members</p>
                  <p className="text-sm font-semibold text-emerald-600">{growthData.peaks.bestMemberMonth}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Peak Bookings</p>
                  <p className="text-sm font-semibold text-purple-600">{growthData.peaks.bestBookingMonth}</p>
                </div>
              </div>
            </Card>
          )}

          {/* Quick Actions */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Button
                variant="outline"
                className="h-auto py-4 flex flex-col gap-2"
                onClick={() => setLocation("/scan/carwash")}
              >
                <Car className="w-6 h-6" />
                <span className="text-xs">New Wash</span>
              </Button>
              <Button
                variant="outline"
                className="h-auto py-4 flex flex-col gap-2"
                onClick={() => setLocation("/scan/parking")}
              >
                <ParkingSquare className="w-6 h-6" />
                <span className="text-xs">Parking</span>
              </Button>
              <Button
                variant="outline"
                className="h-auto py-4 flex flex-col gap-2 border-primary/50"
                onClick={() => setSearchDialogOpen(true)}
              >
                <CalendarDays className="w-6 h-6 text-primary" />
                <span className="text-xs">Bookings</span>
              </Button>
              <Button
                variant="outline"
                className="h-auto py-4 flex flex-col gap-2"
                onClick={() => setLocation("/manager/analytics")}
              >
                <BarChart3 className="w-6 h-6" />
                <span className="text-xs">Reports</span>
              </Button>
              <Button
                variant="outline"
                className="h-auto py-4 flex flex-col gap-2"
                onClick={() => setLocation("/admin/users")}
              >
                <Users className="w-6 h-6" />
                <span className="text-xs">Team</span>
              </Button>
            </div>
          </Card>
        </motion.div>
      </main>

      {/* Search Booking Dialog */}
      <Dialog open={searchDialogOpen} onOpenChange={setSearchDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Search Booking</DialogTitle>
            <DialogDescription>
              Find a booking by reference, name, email, phone, or plate number
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSearchSubmit} className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by reference, name, email, phone, or plate..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                autoFocus
              />
            </div>
            <Button type="submit" className="w-full" disabled={!searchQuery.trim() || isSearching}>
              {isSearching ? "Searching..." : "Search"}
            </Button>
          </form>

          {/* Search Error */}
          {searchError && (
            <div className="mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-sm font-medium">{searchError.message}</span>
              </div>
            </div>
          )}

          {/* CRM Connection Error */}
          {searchResults?.error && (
            <div className="mt-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
              <div className="flex items-center gap-2 text-yellow-600">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-sm font-medium">{searchResults.error}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Ensure BOOKING_DATABASE_URL is configured.
              </p>
              {isSuperAdmin && searchResults.technicalError && (
                <div className="mt-2 p-2 bg-muted rounded text-xs font-mono text-muted-foreground">
                  Technical: {searchResults.technicalError}
                </div>
              )}
            </div>
          )}

          {searchResults?.bookings && searchResults.bookings.length > 0 && (
            <div className="mt-4 space-y-2 max-h-60 overflow-y-auto">
              <p className="text-sm text-muted-foreground">Results:</p>
              {searchResults.bookings.map((booking) => (
                <div
                  key={booking.id}
                  className="p-3 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
                  onClick={() => handleSelectSearchResult(booking)}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-mono text-sm font-semibold text-primary">
                        #{booking.bookingReference}
                      </p>
                      <p className="text-sm">{booking.customerName || booking.customerEmail}</p>
                      <p className="text-xs text-muted-foreground font-mono">{booking.licensePlate}</p>
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      {booking.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}

          {searchResults?.bookings && searchResults.bookings.length === 0 && searchQuery && (
            <p className="text-center text-sm text-muted-foreground py-4">
              No bookings found matching "{searchQuery}"
            </p>
          )}
        </DialogContent>
      </Dialog>

      {/* Action Selection Dialog */}
      <Dialog open={actionDialogOpen} onOpenChange={setActionDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Manage Booking</DialogTitle>
            <DialogDescription>
              {selectedBooking && (
                <span className="font-mono text-primary">
                  #{selectedBooking.bookingReference || selectedBooking.id.slice(-8).toUpperCase()}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {selectedBooking && (
            <div className="space-y-4">
              {/* Booking Summary */}
              <div className="p-3 rounded-lg bg-muted/50 space-y-2">
                <div className="flex items-center gap-2">
                  <Car className="h-4 w-4 text-primary" />
                  <span className="font-mono font-semibold">{selectedBooking.licensePlate}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <User className="h-4 w-4" />
                  <span>{selectedBooking.customerName || "N/A"}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  <span>
                    {format(new Date(selectedBooking.bookingDate + "T00:00:00"), "EEE, MMM d")} at {selectedBooking.timeSlot}
                  </span>
                </div>
                <div className="text-sm">
                  <Badge variant="secondary">{selectedBooking.serviceName}</Badge>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => {
                    setActionDialogOpen(false);
                    setViewDialogOpen(true);
                  }}
                >
                  <Eye className="h-4 w-4 mr-2" />
                  View Full Details
                </Button>

                {/* Payment & Invoice — available for all statuses except CANCELLED */}
                {selectedBooking.status !== "CANCELLED" && (
                  <>
                    <Button
                      className="w-full justify-start bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => openPaymentDialog(selectedBooking)}
                    >
                      <CreditCard className="h-4 w-4 mr-2" />
                      {selectedBooking.status === "COMPLETED" ? "Record Payment / View Receipt" : "Confirm Payment"}
                    </Button>

                    <Button
                      variant="outline"
                      className="w-full justify-start"
                      onClick={() => {
                        setActionDialogOpen(false);
                        fetchPaymentForInvoice(selectedBooking.id);
                      }}
                    >
                      <Receipt className="h-4 w-4 mr-2" />
                      Generate Invoice / Receipt
                    </Button>
                  </>
                )}

                {/* Edit & Cancel — only for non-completed, non-cancelled */}
                {selectedBooking.status !== "COMPLETED" && selectedBooking.status !== "CANCELLED" && (
                  <>
                    <Button
                      variant="outline"
                      className="w-full justify-start"
                      onClick={() => openEditDialog(selectedBooking)}
                    >
                      <Edit className="h-4 w-4 mr-2" />
                      Edit / Reschedule
                    </Button>

                    <Button
                      variant="destructive"
                      className="w-full justify-start"
                      onClick={() => {
                        setActionDialogOpen(false);
                        setCancelDialogOpen(true);
                      }}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Cancel Booking
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* View Details Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Booking Details</DialogTitle>
            <DialogDescription>
              Reference: #{selectedBooking?.bookingReference || selectedBooking?.id.slice(0, 8).toUpperCase()}
            </DialogDescription>
          </DialogHeader>

          {selectedBooking && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant={selectedBooking.status === "CONFIRMED" ? "default" : "secondary"}>
                  {selectedBooking.status}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <Label className="text-muted-foreground">Customer</Label>
                  <p className="font-medium">{selectedBooking.customerName || "N/A"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Email</Label>
                  <p className="font-medium">{selectedBooking.customerEmail}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Phone</Label>
                  <p className="font-medium">{selectedBooking.customerPhone || "N/A"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">License Plate</Label>
                  <p className="font-mono font-medium">{selectedBooking.licensePlate}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Vehicle</Label>
                  <p className="font-medium">
                    {selectedBooking.vehicleMake} {selectedBooking.vehicleModel}
                    {selectedBooking.vehicleColor && ` (${selectedBooking.vehicleColor})`}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Service</Label>
                  <p className="font-medium">{selectedBooking.serviceName}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Date</Label>
                  <p className="font-medium">
                    {format(new Date(selectedBooking.bookingDate + "T00:00:00"), "EEEE, MMMM d, yyyy")}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Time</Label>
                  <p className="font-medium">{selectedBooking.timeSlot}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Amount</Label>
                  <p className="font-medium">
                    R{((selectedBooking.totalAmount || 0) / 100).toFixed(2)}
                  </p>
                </div>
              </div>

              {selectedBooking.notes && (
                <div>
                  <Label className="text-muted-foreground">Notes</Label>
                  <p className="text-sm mt-1 p-2 bg-muted rounded">{selectedBooking.notes}</p>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={() => setViewDialogOpen(false)}>
              Close
            </Button>
            {selectedBooking?.status !== "CANCELLED" && (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setViewDialogOpen(false);
                    fetchPaymentForInvoice(selectedBooking!.id);
                  }}
                >
                  <Receipt className="h-4 w-4 mr-2" />
                  Invoice
                </Button>
                <Button
                  className="bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => {
                    setViewDialogOpen(false);
                    openPaymentDialog(selectedBooking!);
                  }}
                >
                  <CreditCard className="h-4 w-4 mr-2" />
                  Payment
                </Button>
              </>
            )}
            {selectedBooking?.status !== "COMPLETED" && selectedBooking?.status !== "CANCELLED" && (
              <Button onClick={() => {
                setViewDialogOpen(false);
                openEditDialog(selectedBooking!);
              }}>
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Booking</DialogTitle>
            <DialogDescription>
              Modify booking #{selectedBooking?.bookingReference || selectedBooking?.id.slice(0, 8).toUpperCase()}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Date</Label>
              <Input
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Time Slot</Label>
              <Input
                type="time"
                value={editTimeSlot}
                onChange={(e) => setEditTimeSlot(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CONFIRMED">Confirmed</SelectItem>
                  <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                  <SelectItem value="READY_FOR_PICKUP">Ready for Pickup</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="NO_SHOW">No Show</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Add notes about this booking..."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Cancel Booking?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel booking #{selectedBooking?.bookingReference}?
              This action cannot be undone. The customer will be notified of the cancellation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Booking</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedBooking && cancelMutation.mutate(selectedBooking.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cancelMutation.isPending ? "Cancelling..." : "Yes, Cancel Booking"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Payment Confirmation Dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-green-600" />
              Confirm Payment
            </DialogTitle>
            <DialogDescription>
              Record payment for booking #{selectedBooking?.bookingReference || selectedBooking?.id.slice(-8).toUpperCase()}
            </DialogDescription>
          </DialogHeader>

          {selectedBooking && (
            <div className="space-y-4">
              {/* Booking Summary */}
              <div className="p-3 rounded-lg bg-muted/50 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Customer</span>
                  <span className="font-medium">{selectedBooking.customerName || "N/A"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Vehicle</span>
                  <span className="font-mono font-medium">{selectedBooking.licensePlate}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Service</span>
                  <span className="font-medium">{selectedBooking.serviceName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date & Time</span>
                  <span className="font-medium">
                    {format(new Date(selectedBooking.bookingDate + "T00:00:00"), "MMM d")} at {selectedBooking.timeSlot}
                  </span>
                </div>
              </div>

              {/* Payment Method */}
              <div className="space-y-2">
                <Label>Payment Method</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="eft">EFT / Bank Transfer</SelectItem>
                    <SelectItem value="mobile">Mobile Payment</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Amount */}
              <div className="space-y-2">
                <Label>Amount Paid (R)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>

              {/* Payment Reference */}
              {paymentMethod !== "cash" && (
                <div className="space-y-2">
                  <Label>Payment Reference</Label>
                  <Input
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    placeholder="Transaction ID, card last 4 digits, etc."
                  />
                </div>
              )}

              {/* Confirmed By */}
              <div className="space-y-2">
                <Label>Confirmed By (Staff Name)</Label>
                <Input
                  value={paymentConfirmedBy}
                  onChange={(e) => setPaymentConfirmedBy(e.target.value)}
                  placeholder="Your name"
                />
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <Label>Notes (Optional)</Label>
                <Textarea
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  placeholder="Any additional notes..."
                  rows={2}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              onClick={handleConfirmPayment}
              disabled={paymentMutation.isPending || !paymentConfirmedBy || !paymentAmount}
            >
              {paymentMutation.isPending ? "Processing..." : "Confirm Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment Success Dialog */}
      <Dialog open={paymentSuccessOpen} onOpenChange={setPaymentSuccessOpen}>
        <DialogContent className="max-w-sm">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Payment Confirmed</h3>
              <p className="text-sm text-muted-foreground mt-1">
                The booking has been marked as completed.
              </p>
            </div>

            {lastPayment && (
              <div className="p-3 rounded-lg bg-muted/50 space-y-1 text-sm text-left">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Receipt #</span>
                  <span className="font-mono font-bold text-primary">{lastPayment.receiptNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-bold">R{((lastPayment.amount || 0) / 100).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Method</span>
                  <span className="capitalize">{lastPayment.paymentMethod}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Customer</span>
                  <span>{lastPayment.customerName || "N/A"}</span>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setPaymentSuccessOpen(false);
                  setSelectedBooking(null);
                }}
              >
                Close
              </Button>
              <Button
                className="flex-1"
                onClick={handlePrintReceipt}
              >
                <Receipt className="h-4 w-4 mr-2" />
                View Receipt
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Printable Invoice / Receipt Dialog */}
      <Dialog open={receiptDialogOpen} onOpenChange={setReceiptDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              Tax Invoice / Receipt
            </DialogTitle>
          </DialogHeader>

          <div className="overflow-y-auto flex-1 min-h-0">
          {lastPayment && (
            <div id="printable-receipt">
              {/* Header */}
              <div style={{ textAlign: "center", borderBottom: "3px solid #2563eb", paddingBottom: "12px", marginBottom: "20px" }}>
                <h1 style={{ fontSize: "28px", margin: "0 0 4px", fontWeight: "bold", color: "#2563eb", letterSpacing: "3px" }}>EKHAYA CAR WASH</h1>
                <p style={{ fontSize: "13px", color: "#666", margin: "0" }}>Premium Car Care Services</p>
              </div>

              {/* Receipt ID block */}
              <div style={{ borderLeft: "4px solid #2563eb", padding: "12px 16px", background: "#f0f7ff", marginBottom: "20px" }}>
                <p style={{ fontSize: "16px", fontWeight: "bold", margin: "0 0 4px", color: "#1e3a5f" }}>Receipt #{lastPayment.receiptNumber}</p>
                <p style={{ fontSize: "12px", color: "#666", margin: "0 0 6px" }}>
                  Generated: {format(new Date(lastPayment.createdAt), "M/d/yyyy, h:mm:ss a")}
                </p>
                <span style={{ display: "inline-block", background: "#16a34a", color: "white", padding: "2px 12px", borderRadius: "4px", fontSize: "12px", fontWeight: "bold", letterSpacing: "3px" }}>P A I D</span>
              </div>

              {/* Customer Information */}
              <div style={{ marginBottom: "20px" }}>
                <h3 style={{ fontSize: "14px", fontWeight: "bold", borderBottom: "1px solid #ddd", paddingBottom: "6px", marginBottom: "10px" }}>Customer Information</h3>
                <table style={{ width: "100%", fontSize: "13px" }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: "4px 0", fontWeight: "bold" }}>Name:</td>
                      <td style={{ padding: "4px 0", textAlign: "right" }}>{lastPayment.customerName || "Walk-in Customer"}</td>
                    </tr>
                    {lastPayment.customerEmail && (
                      <tr>
                        <td style={{ padding: "4px 0", fontWeight: "bold" }}>Email:</td>
                        <td style={{ padding: "4px 0", textAlign: "right" }}>{lastPayment.customerEmail}</td>
                      </tr>
                    )}
                    {lastPayment.customerPhone && (
                      <tr>
                        <td style={{ padding: "4px 0", fontWeight: "bold" }}>Phone:</td>
                        <td style={{ padding: "4px 0", textAlign: "right" }}>{lastPayment.customerPhone}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Service Details */}
              <div style={{ marginBottom: "20px" }}>
                <h3 style={{ fontSize: "14px", fontWeight: "bold", borderBottom: "1px solid #ddd", paddingBottom: "6px", marginBottom: "10px" }}>Service Details</h3>
                <table style={{ width: "100%", fontSize: "13px" }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: "4px 0", fontWeight: "bold" }}>Service:</td>
                      <td style={{ padding: "4px 0", textAlign: "right" }}>{lastPayment.serviceName || "Service"}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "4px 0", fontWeight: "bold" }}>Vehicle:</td>
                      <td style={{ padding: "4px 0", textAlign: "right" }}>{lastPayment.licensePlate ? `(${lastPayment.licensePlate})` : ""}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "4px 0", fontWeight: "bold" }}>Service Date:</td>
                      <td style={{ padding: "4px 0", textAlign: "right" }}>{lastPayment.bookingDate ? format(new Date(lastPayment.bookingDate + "T00:00:00"), "M/d/yyyy") : ""}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "4px 0", fontWeight: "bold" }}>Service Time:</td>
                      <td style={{ padding: "4px 0", textAlign: "right" }}>{lastPayment.timeSlot || ""}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "4px 0", fontWeight: "bold" }}>Location:</td>
                      <td style={{ padding: "4px 0", textAlign: "right" }}>Ekhaya Car Wash - Main Branch</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Payment Information */}
              <div style={{ marginBottom: "20px" }}>
                <h3 style={{ fontSize: "14px", fontWeight: "bold", borderBottom: "1px solid #ddd", paddingBottom: "6px", marginBottom: "10px" }}>Payment Information</h3>
                <table style={{ width: "100%", fontSize: "13px" }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: "4px 0", fontWeight: "bold" }}>Service Amount:</td>
                      <td style={{ padding: "4px 0", textAlign: "right" }}>R{((lastPayment.amount || 0) / 100).toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "4px 0", fontWeight: "bold" }}>Amount Paid:</td>
                      <td style={{ padding: "4px 0", textAlign: "right", fontSize: "22px", fontWeight: "bold", color: "#16a34a" }}>R{((lastPayment.amount || 0) / 100).toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
                <table style={{ width: "100%", fontSize: "13px", marginTop: "12px" }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: "4px 0", fontWeight: "bold" }}>Payment Method:</td>
                      <td style={{ padding: "4px 0", textAlign: "right", textTransform: "uppercase" }}>
                        {lastPayment.paymentMethod === "eft" ? "EFT" : lastPayment.paymentMethod === "card" ? "CARD" : lastPayment.paymentMethod === "mobile" ? "MOBILE" : "CASH"}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: "4px 0", fontWeight: "bold" }}>Payment Date:</td>
                      <td style={{ padding: "4px 0", textAlign: "right" }}>{format(new Date(lastPayment.createdAt), "M/d/yyyy, h:mm:ss a")}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "4px 0", fontWeight: "bold" }}>Confirmed By:</td>
                      <td style={{ padding: "4px 0", textAlign: "right" }}>{lastPayment.confirmedBy}</td>
                    </tr>
                    {lastPayment.paymentReference && (
                      <tr>
                        <td style={{ padding: "4px 0", fontWeight: "bold" }}>Reference:</td>
                        <td style={{ padding: "4px 0", textAlign: "right" }}>{lastPayment.paymentReference}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Thank You Footer */}
              <div style={{ borderTop: "1px solid #ddd", paddingTop: "20px", marginTop: "10px", textAlign: "center" }}>
                <h3 style={{ fontSize: "16px", fontWeight: "bold", color: "#2563eb", margin: "0 0 6px" }}>Thank You for Choosing PRESTIGE by Ekhaya!</h3>
                <p style={{ fontSize: "12px", color: "#666", margin: "0 0 16px" }}>We appreciate your business and look forward to serving you again.</p>

                <p style={{ fontSize: "13px", fontWeight: "bold", margin: "0 0 8px" }}>Contact Us:</p>
                <p style={{ fontSize: "11px", color: "#555", margin: "2px 0" }}>2C Piers Road, Wynberg, Cape Town, Western Cape, 7800, South Africa</p>
                <p style={{ fontSize: "11px", color: "#555", margin: "2px 0" }}>+27 78 613 2969</p>
                <p style={{ fontSize: "11px", color: "#555", margin: "2px 0" }}>infos@prestigebyekhaya.com</p>
                <p style={{ fontSize: "11px", color: "#555", margin: "2px 0" }}>Mon-Thur: 08:00-17:00, Fri-Sat: 08:00-19:30, Sun: 09:00-14:00</p>
                <p style={{ fontSize: "11px", margin: "2px 0" }}><a href="https://prestigebyekhaya.com" style={{ color: "#2563eb" }}>https://prestigebyekhaya.com</a></p>
              </div>

              {/* Disclaimer */}
              <div style={{ borderTop: "1px solid #eee", marginTop: "16px", paddingTop: "10px", textAlign: "center" }}>
                <p style={{ fontSize: "10px", color: "#999", margin: "0" }}>
                  This is an electronically generated receipt. For any queries, please contact us with receipt #{lastPayment.receiptNumber}
                </p>
              </div>
            </div>
          )}
          </div>

          <DialogFooter className="flex-shrink-0 flex-wrap gap-2 border-t pt-3">
            <Button variant="outline" onClick={() => {
              setReceiptDialogOpen(false);
              setSelectedBooking(null);
            }}>
              Close
            </Button>
            <Button variant="outline" onClick={sendReceipt}>
              <Send className="h-4 w-4 mr-2" />
              Send
            </Button>
            <Button variant="outline" onClick={downloadReceipt}>
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
            <Button onClick={printReceipt}>
              <Printer className="h-4 w-4 mr-2" />
              Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AppFooter />
    </div>
  );
}
