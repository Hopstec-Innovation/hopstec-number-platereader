import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { AppHeader } from "@/components/app-header";
import { AppFooter } from "@/components/app-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Search,
  Calendar,
  Clock,
  Car,
  User,
  Phone,
  Mail,
  AlertTriangle,
  Edit,
  Trash2,
  Eye,
  RefreshCw,
  Filter,
  X,
  Bell,
  Send,
  CreditCard,
  Receipt,
  Printer,
  CheckCircle2,
  Download,
} from "lucide-react";
import { format } from "date-fns";

interface Booking {
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
  source?: "ekhaya" | "local";
}

const statusColors: Record<string, string> = {
  CONFIRMED: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  IN_PROGRESS: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  COMPLETED: "bg-green-500/20 text-green-400 border-green-500/30",
  CANCELLED: "bg-red-500/20 text-red-400 border-red-500/30",
  NO_SHOW: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  READY_FOR_PICKUP: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  confirmed: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  in_progress: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  completed: "bg-green-500/20 text-green-400 border-green-500/30",
  cancelled: "bg-red-500/20 text-red-400 border-red-500/30",
  no_show: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  ready_for_pickup: "bg-purple-500/20 text-purple-400 border-purple-500/30",
};

export default function ManagerBookings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("");

  // Dialog states
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [notifyDialogOpen, setNotifyDialogOpen] = useState(false);

  // Edit form state
  const [editDate, setEditDate] = useState("");
  const [editTimeSlot, setEditTimeSlot] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editReason, setEditReason] = useState("");
  const [cancelReason, setCancelReason] = useState("");

  // Notification state
  const [notifyType, setNotifyType] = useState<"BOOKING_CANCELLED" | "BOOKING_MODIFIED" | "BOOKING_RESCHEDULED">("BOOKING_MODIFIED");
  const [notifySubject, setNotifySubject] = useState("");
  const [notifyBody, setNotifyBody] = useState("");
  const [notifyReason, setNotifyReason] = useState("");

  // Payment state
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentSuccessOpen, setPaymentSuccessOpen] = useState(false);
  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentConfirmedBy, setPaymentConfirmedBy] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [lastPayment, setLastPayment] = useState<any>(null);

  // Check if user has manager, admin, or super_admin role
  const canManageBookings = user?.role === "manager" || user?.role === "admin" || user?.role === "super_admin";
  // Fetch bookings
  const { data, isLoading, refetch, error: fetchError } = useQuery({
    queryKey: ["manager-bookings", search, statusFilter, dateFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.append("search", search);
      if (statusFilter && statusFilter !== "all") params.append("status", statusFilter);
      if (dateFilter) {
        params.append("fromDate", dateFilter);
        params.append("toDate", dateFilter);
      }
      params.append("limit", "50");

      const res = await fetch(`/api/crm/bookings/manager?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || `Failed to fetch bookings (${res.status})`);
      }
      return res.json() as Promise<{ bookings: Booking[]; total: number }>;
    },
    enabled: canManageBookings,
  });

  const { data: localData, isLoading: localLoading } = useQuery({
    queryKey: ["manager-bookings-local", search, statusFilter, dateFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.append("search", search);
      if (statusFilter && statusFilter !== "all") params.append("status", statusFilter);
      if (dateFilter) {
        params.append("fromDate", dateFilter);
        params.append("toDate", dateFilter);
      }
      params.append("limit", "50");
      const res = await fetch(`/api/manager/bookings?${params.toString()}`, { credentials: "include" });
      if (!res.ok) return { bookings: [] as Booking[], total: 0 };
      return res.json() as Promise<{ bookings: Booking[]; total: number }>;
    },
    enabled: canManageBookings,
  });

  const mergedBookings = useMemo(() => {
    const crm = (data?.bookings || []).map((b) => ({ ...b, source: "ekhaya" as const }));
    const local = (localData?.bookings || []).map((b) => ({
      ...b,
      source: "local" as const,
      status: b.status?.toUpperCase?.() || b.status,
    }));
    return [...crm, ...local].sort((a, b) => {
      const dateCmp = `${b.bookingDate}`.localeCompare(`${a.bookingDate}`);
      if (dateCmp !== 0) return dateCmp;
      return `${a.timeSlot}`.localeCompare(`${b.timeSlot}`);
    });
  }, [data?.bookings, localData?.bookings]);

  const bookingsLoading = isLoading || localLoading;

  // Update booking mutation
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
      queryClient.invalidateQueries({ queryKey: ["manager-bookings"] });
      setEditDialogOpen(false);
      setSelectedBooking(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update booking",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Cancel booking mutation
  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/crm/bookings/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: cancelReason || undefined }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to cancel booking");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Booking cancelled", description: "Customer notification queued." });
      queryClient.invalidateQueries({ queryKey: ["manager-bookings"] });
      setCancelDialogOpen(false);
      setCancelReason("");
      setSelectedBooking(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to cancel booking",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Send notification mutation
  const sendNotificationMutation = useMutation({
    mutationFn: async ({ bookingId, type, body, reason }: { bookingId: string; type: string; body: string; reason?: string }) => {
      const res = await fetch("/api/manager/notifications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ bookingId, type, body, reason }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to send notification");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Notification queued", description: "Customer will be notified shortly." });
      setNotifyDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to send notification", description: error.message, variant: "destructive" });
    },
  });

  // Preview notification template for a booking
  const previewNotification = async (booking: Booking, type: "BOOKING_CANCELLED" | "BOOKING_MODIFIED" | "BOOKING_RESCHEDULED", reason?: string) => {
    try {
      const res = await fetch("/api/manager/notifications/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ bookingId: booking.id, type, reason }),
      });
      if (res.ok) {
        const { subject, body } = await res.json();
        setNotifySubject(subject);
        setNotifyBody(body);
      }
    } catch {
      // fallback — leave fields empty for manual entry
    }
  };

  const openNotifyDialog = async (booking: Booking, type: "BOOKING_CANCELLED" | "BOOKING_MODIFIED" | "BOOKING_RESCHEDULED") => {
    setSelectedBooking(booking);
    setNotifyType(type);
    setNotifyReason("");
    setNotifySubject("");
    setNotifyBody("");
    setNotifyDialogOpen(true);
    await previewNotification(booking, type);
  };

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
      queryClient.invalidateQueries({ queryKey: ["manager-bookings"] });
    },
    onError: (error: Error) => {
      toast({ title: "Payment failed", description: error.message, variant: "destructive" });
    },
  });

  const openPaymentDialog = (booking: Booking) => {
    setSelectedBooking(booking);
    setPaymentAmount(String((booking.totalAmount || 0) / 100));
    setPaymentMethod("cash");
    setPaymentReference("");
    setPaymentConfirmedBy(user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() : "");
    setPaymentNotes("");
    setViewDialogOpen(false);
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

  const fetchPaymentForInvoice = async (bookingId: string) => {
    try {
      const res = await fetch(`/api/crm/bookings/${bookingId}/payment`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setLastPayment(data.payment);
        setViewDialogOpen(false);
        setReceiptDialogOpen(true);
      } else {
        toast({ title: "No payment recorded yet", description: "Record a payment first to generate an invoice." });
        if (selectedBooking) openPaymentDialog(selectedBooking);
      }
    } catch {
      toast({ title: "Error", description: "Failed to fetch payment details", variant: "destructive" });
    }
  };

  const getReceiptHtml = () => {
    const receiptEl = document.getElementById("printable-receipt-bookings");
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

  const openEditDialog = (booking: Booking) => {
    if (booking.source === "local") {
      toast({ title: "Self-service booking", description: "Edit local bookings from the app dashboard or contact the customer directly." });
      return;
    }
    setSelectedBooking(booking);
    setEditDate(booking.bookingDate.split("T")[0]);
    setEditTimeSlot(booking.timeSlot);
    setEditNotes(booking.notes || "");
    setEditStatus(booking.status);
    setEditReason("");
    setEditDialogOpen(true);
  };

  const handleSaveEdit = () => {
    if (!selectedBooking) return;

    const updates: any = {};
    if (editDate !== selectedBooking.bookingDate.split("T")[0]) {
      updates.bookingDate = editDate;
    }
    if (editTimeSlot !== selectedBooking.timeSlot) {
      updates.timeSlot = editTimeSlot;
    }
    if (editNotes !== (selectedBooking.notes || "")) {
      updates.notes = editNotes;
    }
    if (editStatus !== selectedBooking.status) {
      updates.status = editStatus;
    }

    if (Object.keys(updates).length === 0) {
      toast({ title: "No changes to save" });
      return;
    }

    if (editReason) updates.reason = editReason;
    updateMutation.mutate({ id: selectedBooking.id, data: updates });
  };

  if (!canManageBookings) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <AppHeader />
        <main className="flex-1 container mx-auto px-4 py-8">
          <Card className="max-w-md mx-auto">
            <CardContent className="pt-6 text-center">
              <AlertTriangle className="h-12 w-12 mx-auto text-yellow-500 mb-4" />
              <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
              <p className="text-muted-foreground">
                You need Manager or Admin role to access booking management.
              </p>
            </CardContent>
          </Card>
        </main>
        <AppFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader />

      <main className="flex-1 container mx-auto px-4 py-6 pb-24">
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-2">Booking Management</h1>
          <p className="text-muted-foreground">
            View, modify, reschedule, or cancel customer bookings
          </p>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="pt-4">
            <div className="flex flex-col md:flex-row gap-4">
              {/* Search */}
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by reference, name, email, phone, or plate..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Status Filter */}
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full md:w-[180px]">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="CONFIRMED">Confirmed</SelectItem>
                  <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                  <SelectItem value="READY_FOR_PICKUP">Ready for Pickup</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                  <SelectItem value="NO_SHOW">No Show</SelectItem>
                </SelectContent>
              </Select>

              {/* Date Filter */}
              <Input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="w-full md:w-[180px]"
              />

              {/* Refresh */}
              <Button variant="outline" size="icon" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4" />
              </Button>

              {/* Clear Filters */}
              {(search || statusFilter !== "all" || dateFilter) && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setSearch("");
                    setStatusFilter("all");
                    setDateFilter("");
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Error Message */}
        {fetchError && (
          <Card className="mb-4 border-destructive">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                <span className="font-medium">Error: {fetchError.message}</span>
              </div>
            </CardContent>
          </Card>
        )}


        {/* Results Count */}
        {data && (
          <p className="text-sm text-muted-foreground mb-4">
            Showing {data.bookings.length} of {data.total} bookings
          </p>
        )}

        {/* Bookings List */}
        {bookingsLoading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <Card key={i}>
                <CardContent className="pt-4">
                  <Skeleton className="h-24 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : mergedBookings.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center">
              <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="font-semibold mb-2">No bookings found</h3>
              <p className="text-muted-foreground text-sm">
                Try adjusting your search or filters, or create a new booking.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {mergedBookings.map((booking) => (
              <Card key={`${booking.source}-${booking.id}`} className="overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex flex-col md:flex-row md:items-center gap-4">
                    {/* Booking Info */}
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-semibold text-primary">
                          #{booking.bookingReference}
                        </span>
                        <Badge className={statusColors[booking.status] || statusColors[booking.status.toLowerCase()] || ""}>
                          {booking.status.replace(/_/g, " ")}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {booking.source === "local" ? "Self-service" : "Ekhaya"}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <User className="h-4 w-4" />
                          <span>{booking.customerName || "N/A"}</span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Mail className="h-4 w-4" />
                          <span className="truncate">{booking.customerEmail}</span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Phone className="h-4 w-4" />
                          <span>{booking.customerPhone || "N/A"}</span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Car className="h-4 w-4" />
                          <span className="font-mono">{booking.licensePlate}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-sm">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-4 w-4 text-primary" />
                          <span>
                            {format(new Date(booking.bookingDate + "T00:00:00"), "EEE, MMM d, yyyy")}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="h-4 w-4 text-primary" />
                          <span>{booking.timeSlot}</span>
                        </div>
                      </div>

                      <div className="text-sm">
                        <span className="text-muted-foreground">Service: </span>
                        <span className="font-medium">{booking.serviceName}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 md:flex-col">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedBooking(booking);
                          setViewDialogOpen(true);
                        }}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        View
                      </Button>
                      {booking.source !== "local" && booking.status !== "CANCELLED" && (
                        <Button
                          size="sm"
                          className="bg-green-600 hover:bg-green-700 text-white"
                          onClick={() => openPaymentDialog(booking)}
                        >
                          <CreditCard className="h-4 w-4 mr-1" />
                          Payment
                        </Button>
                      )}
                      {booking.source !== "local" && booking.status !== "COMPLETED" && booking.status !== "CANCELLED" && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEditDialog(booking)}
                          >
                            <Edit className="h-4 w-4 mr-1" />
                            Edit
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                              setSelectedBooking(booking);
                              setCancelDialogOpen(true);
                            }}
                          >
                            <Trash2 className="h-4 w-4 mr-1" />
                            Cancel
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* View Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Booking Details</DialogTitle>
            <DialogDescription>
              Reference: #{selectedBooking?.bookingReference}
            </DialogDescription>
          </DialogHeader>

          {selectedBooking && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge className={statusColors[selectedBooking.status] || ""}>
                  {selectedBooking.status.replace(/_/g, " ")}
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
                    R{(selectedBooking.totalAmount / 100).toFixed(2)}
                  </p>
                </div>
              </div>

              {selectedBooking.notes && (
                <div>
                  <Label className="text-muted-foreground">Notes</Label>
                  <p className="text-sm mt-1 p-2 bg-muted rounded">
                    {selectedBooking.notes}
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setViewDialogOpen(false);
                if (selectedBooking) openNotifyDialog(selectedBooking, "BOOKING_MODIFIED");
              }}
            >
              <Bell className="h-4 w-4 mr-1" />
              Notify Customer
            </Button>
            {selectedBooking?.status !== "CANCELLED" && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => selectedBooking && fetchPaymentForInvoice(selectedBooking.id)}
                >
                  <Receipt className="h-4 w-4 mr-1" />
                  Invoice
                </Button>
                <Button
                  size="sm"
                  className="bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => selectedBooking && openPaymentDialog(selectedBooking)}
                >
                  <CreditCard className="h-4 w-4 mr-1" />
                  Payment
                </Button>
              </>
            )}
            <Button variant="outline" onClick={() => setViewDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Booking</DialogTitle>
            <DialogDescription>
              Modify booking #{selectedBooking?.bookingReference}
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

            <div className="space-y-2">
              <Label>Reason for Change <span className="text-muted-foreground text-xs">(optional — included in customer notification)</span></Label>
              <Textarea
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                placeholder="e.g. Staff availability, equipment maintenance..."
                rows={2}
              />
            </div>
          </div>

          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "Saving..." : "Save & Notify Customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Booking?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel booking #{selectedBooking?.bookingReference}?
              This action cannot be undone. The customer will be notified automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1 pb-2">
            <Label className="text-sm">Reason for cancellation <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="e.g. Unexpected closure, technician unavailable..."
              rows={2}
              className="mt-1"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setCancelReason("")}>Keep Booking</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedBooking && cancelMutation.mutate(selectedBooking.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cancelMutation.isPending ? "Cancelling..." : "Yes, Cancel & Notify Customer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Send Notification Dialog */}
      <Dialog open={notifyDialogOpen} onOpenChange={setNotifyDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-primary" />
              Send Customer Notification
            </DialogTitle>
            <DialogDescription>
              Notify {selectedBooking?.customerName || selectedBooking?.customerEmail} about their booking #{selectedBooking?.bookingReference}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Notification Type</Label>
              <Select
                value={notifyType}
                onValueChange={async (val: typeof notifyType) => {
                  setNotifyType(val);
                  if (selectedBooking) await previewNotification(selectedBooking, val, notifyReason);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BOOKING_MODIFIED">Booking Modified</SelectItem>
                  <SelectItem value="BOOKING_RESCHEDULED">Booking Rescheduled</SelectItem>
                  <SelectItem value="BOOKING_CANCELLED">Booking Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Reason <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                value={notifyReason}
                onChange={(e) => setNotifyReason(e.target.value)}
                placeholder="Reason for the change..."
                onBlur={async () => {
                  if (selectedBooking) await previewNotification(selectedBooking, notifyType, notifyReason);
                }}
              />
            </div>

            {notifySubject && (
              <div className="space-y-2">
                <Label>Subject</Label>
                <Input value={notifySubject} onChange={(e) => setNotifySubject(e.target.value)} />
              </div>
            )}

            <div className="space-y-2">
              <Label>Message</Label>
              <Textarea
                value={notifyBody}
                onChange={(e) => setNotifyBody(e.target.value)}
                placeholder="Loading template..."
                rows={10}
                className="font-mono text-xs"
              />
            </div>

            <div className="text-xs text-muted-foreground p-2 bg-muted rounded">
              <strong>Sending to:</strong> {selectedBooking?.customerEmail}
              {selectedBooking?.customerPhone && ` · ${selectedBooking.customerPhone}`}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setNotifyDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!selectedBooking) return;
                sendNotificationMutation.mutate({
                  bookingId: selectedBooking.id,
                  type: notifyType,
                  body: notifyBody,
                  reason: notifyReason || undefined,
                });
              }}
              disabled={sendNotificationMutation.isPending || !notifyBody}
            >
              <Send className="h-4 w-4 mr-2" />
              {sendNotificationMutation.isPending ? "Sending..." : "Queue Notification"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment Confirmation Dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-green-600" />
              Confirm Payment
            </DialogTitle>
            <DialogDescription>
              Record payment for booking #{selectedBooking?.bookingReference}
            </DialogDescription>
          </DialogHeader>

          {selectedBooking && (
            <div className="space-y-4">
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

              <div className="space-y-2">
                <Label>Confirmed By (Staff Name)</Label>
                <Input
                  value={paymentConfirmedBy}
                  onChange={(e) => setPaymentConfirmedBy(e.target.value)}
                  placeholder="Your name"
                />
              </div>

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
            <Button variant="outline" onClick={() => setPaymentDialogOpen(false)}>Cancel</Button>
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
              <p className="text-sm text-muted-foreground mt-1">Booking marked as completed.</p>
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
                  <span className="capitalize font-medium">{lastPayment.paymentMethod === "eft" ? "EFT" : lastPayment.paymentMethod}</span>
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setPaymentSuccessOpen(false); setSelectedBooking(null); }}>
                Close
              </Button>
              <Button className="flex-1" onClick={() => { setPaymentSuccessOpen(false); setReceiptDialogOpen(true); }}>
                <Receipt className="h-4 w-4 mr-2" />
                View Invoice
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Invoice / Receipt Dialog */}
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
            <div id="printable-receipt-bookings">
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
            <Button variant="outline" onClick={() => { setReceiptDialogOpen(false); setSelectedBooking(null); }}>
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
