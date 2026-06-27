import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { CameraCapture } from "@/components/camera-capture";
import { PlateConfirmDialog } from "@/components/plate-confirm-dialog";
import { CustomerUrlDialog } from "@/components/customer-url-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { enqueueRequest } from "@/lib/offline-queue";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Camera, Keyboard, Loader2, Car, Award,
  Clock, ChevronRight, CheckCircle2, Ticket, UserPlus,
  Phone, Mail, CreditCard, ShieldCheck, CalendarDays
} from "lucide-react";
import { guessPackageFromServiceName } from "@/lib/crm-booking-utils";
import type { CountryHint, VehicleSize } from "@shared/schema";
import { SERVICE_PACKAGES, SERVICE_TIER_COLORS, VEHICLE_SIZES } from "@shared/schema";
import type { ServiceTier } from "@shared/schema";

const VEHICLE_SIZE_LABELS: Record<VehicleSize, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
};

// Sort packages by price (small vehicle)
const PACKAGE_ORDER = Object.entries(SERVICE_PACKAGES).sort(
  ([, a], [, b]) => a.pricing.small - b.pricing.small
);

export default function ScanCarwash() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [showCamera, setShowCamera] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showCustomerUrl, setShowCustomerUrl] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<{ plate: string; confidence: number }[]>([]);
  const [createdJob, setCreatedJob] = useState<{ id: string; customerUrl: string; plateDisplay: string } | null>(null);
  const [showServiceSelect, setShowServiceSelect] = useState(false);
  const [showVehicleSize, setShowVehicleSize] = useState(false);
  const [selectedPackageCode, setSelectedPackageCode] = useState<string | null>(null);
  const [pendingPlate, setPendingPlate] = useState<{ plate: string; countryHint: CountryHint } | null>(null);
  const [showMembershipInfo, setShowMembershipInfo] = useState(false);
  const [customerLookup, setCustomerLookup] = useState<any>(null);
  const [showWalkinDialog, setShowWalkinDialog] = useState(false);
  const [walkinForm, setWalkinForm] = useState({ name: "", phone: "", email: "", consent: false });
  const [walkinLoading, setWalkinLoading] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [linkedBookingId, setLinkedBookingId] = useState<string | null>(null);

  // Deep link from My Jobs: /scan/carwash?plate=ABC123&bookingId=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const plate = params.get("plate");
    const bookingId = params.get("bookingId");
    if (bookingId) setLinkedBookingId(bookingId);
    if (!plate) return;

    setPendingPlate({ plate, countryHint: "OTHER" });
    setIsLookingUp(true);
    fetch(`/api/customer/lookup-by-plate?plate=${encodeURIComponent(plate)}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setCustomerLookup(data);
          if (data.crmTodayBooking?.id) setLinkedBookingId(data.crmTodayBooking.id);
          setShowMembershipInfo(true);
        } else {
          setShowServiceSelect(true);
        }
      })
      .catch(() => setShowServiceSelect(true))
      .finally(() => setIsLookingUp(false));
  }, []);

  const createJobMutation = useMutation({
    mutationFn: async ({ plate, countryHint, photo, servicePackageCode, vehicleSize, bookingId }: {
      plate: string;
      countryHint: CountryHint;
      photo?: string;
      servicePackageCode: string;
      vehicleSize: VehicleSize;
      bookingId?: string | null;
    }) => {
      const payload: Record<string, unknown> = { plateDisplay: plate, countryHint, photo, servicePackageCode, vehicleSize };
      if (bookingId) payload.bookingId = bookingId;

      if (!navigator.onLine) {
        await enqueueRequest("POST", "/api/wash-jobs", payload);
        return { _queued: true, plateDisplay: plate } as any;
      }

      try {
        const res = await apiRequest("POST", "/api/wash-jobs", payload);
        return res.json();
      } catch (err) {
        if (err instanceof TypeError && err.message.includes("fetch")) {
          await enqueueRequest("POST", "/api/wash-jobs", payload);
          return { _queued: true, plateDisplay: plate } as any;
        }
        throw err;
      }
    },
    onSuccess: (job) => {
      if (job._queued) {
        toast({
          title: "Queued for sync",
          description: `Job for ${job.plateDisplay} will be created when back online`,
        });
        setLocation("/");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/wash-jobs"] });
      setCreatedJob(job);
      setShowCustomerUrl(true);
      const pkg = selectedPackageCode ? SERVICE_PACKAGES[selectedPackageCode] : null;
      toast({
        title: "Wash job created",
        description: `${pkg?.label || "Job"} started for ${job.plateDisplay}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  const handleCapture = async (imageData: string) => {
    setCapturedImage(imageData);
    setShowCamera(false);

    try {
      const res = await fetch("/api/ocr/plate-candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageData }),
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setCandidates(data.candidates || []);
      } else {
        setCandidates([]);
      }
    } catch {
      setCandidates([]);
    }
    setShowConfirm(true);
  };

  const handleManualEntry = () => {
    setCapturedImage(null);
    setCandidates([]);
    setShowConfirm(true);
  };

  const handleConfirmPlate = async (plate: string, countryHint: CountryHint) => {
    setShowConfirm(false);
    setPendingPlate({ plate, countryHint });

    // Lookup customer membership/loyalty by plate
    setIsLookingUp(true);
    try {
      const res = await fetch(`/api/customer/lookup-by-plate?plate=${encodeURIComponent(plate)}`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setCustomerLookup(data);
        if (data.crmTodayBooking?.id) {
          setLinkedBookingId(data.crmTodayBooking.id);
        }
        setIsLookingUp(false);
        setShowMembershipInfo(true);
        return;
      }
    } catch (err) {
      console.error("Customer lookup failed:", err);
    }
    setIsLookingUp(false);
    setShowServiceSelect(true);
  };

  const handleMembershipContinue = () => {
    const booking = customerLookup?.crmTodayBooking;
    if (booking) {
      const pkg = guessPackageFromServiceName(booking.serviceName);
      if (pkg && SERVICE_PACKAGES[pkg]) {
        setSelectedPackageCode(pkg);
        setShowMembershipInfo(false);
        setShowVehicleSize(true);
        return;
      }
    }
    setShowMembershipInfo(false);
    setShowServiceSelect(true);
  };

  const handleRegisterWalkin = () => {
    if (!pendingPlate) return;
    setWalkinForm({ name: "", phone: "", email: "", consent: false });
    setShowWalkinDialog(true);
  };

  const handleWalkinSubmit = async () => {
    if (!pendingPlate) return;
    if (!walkinForm.name.trim()) {
      toast({ title: "Name required", description: "Please enter the customer's name.", variant: "destructive" });
      return;
    }
    if (!walkinForm.consent) {
      toast({ title: "Consent required", description: "Customer must consent to registration.", variant: "destructive" });
      return;
    }
    setWalkinLoading(true);
    try {
      const res = await fetch("/api/customer/register-walkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          plate: pendingPlate.plate,
          name: walkinForm.name.trim(),
          phone: walkinForm.phone.trim() || undefined,
          email: walkinForm.email.trim() || undefined,
          consent: true,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setShowWalkinDialog(false);
        toast({ title: "Customer enrolled!", description: `${walkinForm.name.trim()} is now in the loyalty program.` });
        setCustomerLookup((prev: any) => ({
          ...prev,
          isRegistered: true,
          loyaltyAccount: data.loyaltyAccount,
        }));
      } else {
        const err = await res.json();
        toast({ title: "Registration failed", description: err.message, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to register customer", variant: "destructive" });
    } finally {
      setWalkinLoading(false);
    }
  };

  const handlePackageSelect = (code: string) => {
    setSelectedPackageCode(code);
    setShowServiceSelect(false);
    setShowVehicleSize(true);
  };

  const handleVehicleSizeSelect = (size: VehicleSize) => {
    setShowVehicleSize(false);
    if (pendingPlate && selectedPackageCode) {
      createJobMutation.mutate({
        plate: pendingPlate.plate,
        countryHint: pendingPlate.countryHint,
        photo: capturedImage || undefined,
        servicePackageCode: selectedPackageCode,
        vehicleSize: size,
        bookingId: linkedBookingId,
      });
    }
  };

  if (showCamera) {
    return (
      <CameraCapture
        onCapture={handleCapture}
        onCancel={() => setShowCamera(false)}
      />
    );
  }

  const selectedPkg = selectedPackageCode ? SERVICE_PACKAGES[selectedPackageCode] : null;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b border-border">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/")} data-testid="button-back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="font-semibold">Start Carwash</h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-8">
        {isLookingUp && (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading booking details...</span>
          </div>
        )}
        {!isLookingUp && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold mb-2">Scan License Plate</h2>
            <p className="text-muted-foreground">
              Capture or enter the vehicle's license plate
            </p>
          </div>

          <Card
            className="p-8 text-center hover-elevate active-elevate-2 cursor-pointer border-dashed border-2"
            onClick={() => setShowCamera(true)}
            data-testid="card-open-camera"
          >
            <Camera className="w-16 h-16 mx-auto mb-4 text-primary" />
            <h3 className="text-lg font-semibold mb-2">Capture Plate Photo</h3>
            <p className="text-muted-foreground text-sm">
              Take a photo of the plate, then enter the plate number
            </p>
          </Card>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">or</span>
            </div>
          </div>

          <Button
            variant="outline"
            className="w-full h-16 text-lg"
            onClick={handleManualEntry}
            data-testid="button-manual-entry"
          >
            <Keyboard className="mr-3 h-5 w-5" />
            Enter Manually
          </Button>
        </motion.div>
        )}
      </main>

      <PlateConfirmDialog
        open={showConfirm}
        onOpenChange={setShowConfirm}
        candidates={candidates}
        capturedImage={capturedImage || undefined}
        onConfirm={handleConfirmPlate}
      />

      {createdJob && (
        <CustomerUrlDialog
          open={showCustomerUrl}
          onOpenChange={(open) => {
            setShowCustomerUrl(open);
            if (!open && createdJob) {
              setLocation(`/wash-job/${createdJob.id}`);
            }
          }}
          customerUrl={createdJob.customerUrl}
          plateDisplay={createdJob.plateDisplay}
        />
      )}

      {/* Service Package Selection */}
      {showServiceSelect && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 overflow-y-auto">
          <div className="min-h-full flex items-start justify-center p-4 py-8">
            <Card className="p-5 max-w-md w-full">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-lg font-semibold">Select Service</h3>
                <Badge variant="outline" className="font-mono">{pendingPlate?.plate}</Badge>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Choose a wash package for this vehicle
              </p>

              <div className="space-y-2.5">
                {/* Show Uber Partner package first if driver is Uber */}
                {customerLookup?.isUberDriver && SERVICE_PACKAGES["UBER_PARTNER"] && (
                  <Card
                    className="p-3.5 cursor-pointer border-2 border-black dark:border-white bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors active:scale-[0.99]"
                    onClick={() => handlePackageSelect("UBER_PARTNER")}
                    data-testid="package-UBER_PARTNER"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold">⭐ {SERVICE_PACKAGES["UBER_PARTNER"].label}</p>
                          <Badge className="bg-black text-white dark:bg-white dark:text-black text-[10px] px-1.5 py-0">
                            UBER RATE
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {SERVICE_PACKAGES["UBER_PARTNER"].durationMinutes} min
                          </span>
                          <span className="text-lg font-bold text-primary">
                            R90 flat
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{SERVICE_PACKAGES["UBER_PARTNER"].description}</p>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-1" />
                    </div>
                  </Card>
                )}

                {PACKAGE_ORDER.filter(([code]) => code !== "UBER_PARTNER").map(([code, pkg]) => (
                  <Card
                    key={code}
                    className="p-3.5 cursor-pointer hover:bg-primary/5 hover:border-primary/30 transition-colors active:scale-[0.99]"
                    onClick={() => handlePackageSelect(code)}
                    data-testid={`package-${code}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold">{pkg.label}</p>
                          <Badge className={`${SERVICE_TIER_COLORS[pkg.tier]} text-white text-[10px] px-1.5 py-0`}>
                            {pkg.tier}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {pkg.durationMinutes} min
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {pkg.steps.length} steps
                          </span>
                          <span className="text-sm font-semibold text-primary">
                            from R{pkg.pricing.small}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{pkg.description}</p>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {pkg.steps.slice(0, 4).map((step) => (
                            <span key={step} className="text-[10px] bg-muted px-1.5 py-0.5 rounded">
                              {step}
                            </span>
                          ))}
                          {pkg.steps.length > 4 && (
                            <span className="text-[10px] text-muted-foreground px-1.5 py-0.5">
                              +{pkg.steps.length - 4} more
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-1" />
                    </div>
                  </Card>
                ))}
              </div>

              <Button
                variant="ghost"
                className="w-full mt-3"
                onClick={() => setShowServiceSelect(false)}
              >
                Cancel
              </Button>
            </Card>
          </div>
        </div>
      )}

      {/* Vehicle Size Selection */}
      {showVehicleSize && selectedPkg && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <Card className="p-6 max-w-sm w-full">
            <div className="text-center mb-4">
              <Badge className={`${SERVICE_TIER_COLORS[selectedPkg.tier]} text-white mb-2`}>
                {selectedPkg.tier}
              </Badge>
              <h3 className="text-lg font-semibold">{selectedPkg.label}</h3>
              <p className="text-sm text-muted-foreground">{selectedPkg.durationMinutes} min</p>
            </div>

            <p className="text-sm font-medium mb-3 text-center">Select vehicle size</p>

            <div className="space-y-2">
              {VEHICLE_SIZES.map((size) => (
                <Card
                  key={size}
                  className="p-4 cursor-pointer hover:bg-primary/5 hover:border-primary/30 transition-colors active:scale-[0.98]"
                  onClick={() => handleVehicleSizeSelect(size)}
                  data-testid={`size-${size}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Car className={`h-6 w-6 text-primary ${
                        size === "small" ? "scale-75" : size === "large" ? "scale-110" : ""
                      }`} />
                      <span className="font-medium">{VEHICLE_SIZE_LABELS[size]}</span>
                    </div>
                    <span className="text-lg font-bold text-primary">
                      R{selectedPkg.pricing[size]}
                    </span>
                  </div>
                </Card>
              ))}
            </div>

            {/* Steps preview */}
            <div className="mt-4 pt-3 border-t">
              <p className="text-xs font-medium text-muted-foreground mb-2">
                {selectedPkg.steps.length} steps included:
              </p>
              <div className="space-y-1">
                {selectedPkg.steps.map((step, i) => (
                  <div key={step} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-3 w-3 text-green-500 flex-shrink-0" />
                    <span>{step}</span>
                  </div>
                ))}
              </div>
            </div>

            <Button
              variant="ghost"
              className="w-full mt-4"
              onClick={() => {
                setShowVehicleSize(false);
                setShowServiceSelect(true);
              }}
            >
              Back to Services
            </Button>
          </Card>
        </div>
      )}

      {/* Membership/Loyalty Info Screen */}
      {showMembershipInfo && customerLookup && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <Card className="p-6 max-w-md w-full">
            <div className="text-center mb-4">
              {customerLookup.isRegistered ? (
                <Badge className="bg-green-500 text-white mb-2">Registered Member</Badge>
              ) : (
                <Badge variant="secondary" className="mb-2">Walk-in Customer</Badge>
              )}
              <h3 className="text-lg font-semibold">
                {customerLookup.crmCustomer?.customerName || customerLookup.crmMembership?.customerName || "Customer"}
              </h3>
              <p className="text-sm text-muted-foreground font-mono">{pendingPlate?.plate}</p>
            </div>

            {customerLookup.crmTodayBooking && (
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-4 space-y-1">
                <div className="flex items-center gap-2 mb-1">
                  <CalendarDays className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">Today's Booking</span>
                </div>
                <p className="text-sm font-medium">{customerLookup.crmTodayBooking.serviceName}</p>
                <p className="text-sm text-muted-foreground">
                  {customerLookup.crmTodayBooking.timeSlot}
                  {customerLookup.crmTodayBooking.bookingDate && (
                    <> · {customerLookup.crmTodayBooking.bookingDate.split("T")[0]}</>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  Continue to use the booked service automatically
                </p>
              </div>
            )}

            {customerLookup.crmMembership && (
              <div className="bg-muted/50 rounded-lg p-4 mb-4 space-y-2">
                <div className="flex items-center gap-2 mb-2">
                  <Award className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-semibold">Membership</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Member ID</span>
                  <span className="font-mono font-semibold text-xs">{customerLookup.crmMembership.memberNumber}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Tier</span>
                  <Badge variant="outline">{customerLookup.crmMembership.tierName}</Badge>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Discount</span>
                  <span className="font-semibold">{Math.round(customerLookup.crmMembership.discountRate * 100)}%</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Points Balance</span>
                  <span className="font-bold text-primary">{customerLookup.crmMembership.loyaltyPoints}</span>
                </div>
                {customerLookup.crmMembership.loyaltyMultiplier > 1 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Points Multiplier</span>
                    <Badge className="bg-amber-500 text-white">{customerLookup.crmMembership.loyaltyMultiplier}x</Badge>
                  </div>
                )}
              </div>
            )}

            {customerLookup.crmSubscription && (
              <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4 mb-4 space-y-2">
                <p className="text-sm font-semibold text-blue-600 dark:text-blue-400">Active Subscription</p>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Plan</span>
                  <span>{customerLookup.crmSubscription.planName}</span>
                </div>
                {customerLookup.crmSubscription.washesRemaining !== null && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Washes Remaining</span>
                    <span className="font-semibold">{customerLookup.crmSubscription.washesRemaining}</span>
                  </div>
                )}
              </div>
            )}

            {/* Local loyalty points */}
            {customerLookup.loyaltyAccount && (
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 mb-4 space-y-2">
                <div className="flex items-center gap-2 mb-1">
                  <Award className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold">Loyalty Points</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Balance</span>
                  <span className="font-bold text-primary">{customerLookup.loyaltyAccount.pointsBalance} pts</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Washes</span>
                  <span>{customerLookup.loyaltyAccount.totalWashes}</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2 mt-1">
                  <div
                    className="bg-primary h-2 rounded-full transition-all"
                    data-progress={Math.min(100, Math.round(((customerLookup.loyaltyAccount.pointsBalance % 1000) / 1000) * 100))}
                    ref={(el) => { if (el) el.style.width = `${Math.min(100, ((customerLookup.loyaltyAccount.pointsBalance % 1000) / 1000) * 100)}%`; }}
                  />
                </div>
                <p className="text-xs text-muted-foreground text-right">
                  {1000 - (customerLookup.loyaltyAccount.pointsBalance % 1000)} pts to next free wash
                </p>
              </div>
            )}

            {/* Active vouchers */}
            {customerLookup.activeVouchers && customerLookup.activeVouchers.length > 0 && (
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 mb-4 space-y-2">
                <div className="flex items-center gap-2 mb-1">
                  <Ticket className="w-4 h-4 text-green-600" />
                  <span className="text-sm font-semibold text-green-700 dark:text-green-400">
                    {customerLookup.activeVouchers.length} Active Voucher{customerLookup.activeVouchers.length > 1 ? "s" : ""}
                  </span>
                </div>
                {customerLookup.activeVouchers.map((v: any) => (
                  <div key={v.id} className="flex justify-between items-center text-sm bg-white/50 dark:bg-white/5 rounded p-2">
                    <div>
                      <p className="font-mono font-bold text-green-700 dark:text-green-300">{v.code}</p>
                      <p className="text-xs text-muted-foreground">
                        Free {v.forPackageCode || "wash"} · Expires {new Date(v.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge className="bg-green-500 text-white text-xs">Active</Badge>
                  </div>
                ))}
              </div>
            )}

            {/* Uber Partner Badge */}
            {customerLookup.isUberDriver && (
              <div className="bg-black/5 border border-black/20 dark:bg-white/5 dark:border-white/20 rounded-lg p-4 mb-4 space-y-2">
                <div className="flex items-center gap-2 mb-1">
                  <Car className="w-4 h-4" />
                  <span className="text-sm font-semibold">Uber Partner</span>
                  <Badge className="bg-black text-white dark:bg-white dark:text-black text-[10px] ml-auto">UBER</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Registered Uber driver — eligible for <span className="font-semibold text-primary">flat R90 rate</span>.
                </p>
              </div>
            )}

            {!customerLookup.crmMembership && !customerLookup.isRegistered && !customerLookup.loyaltyAccount && !customerLookup.isUberDriver && (
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 mb-4">
                <p className="text-sm text-amber-700 dark:text-amber-400 mb-2">
                  Walk-in customer — not registered. Loyalty points won't be earned.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
                  onClick={handleRegisterWalkin}
                >
                  <UserPlus className="w-4 h-4 mr-2" />
                  Register Walk-in Customer
                </Button>
              </div>
            )}

            <Button className="w-full" onClick={handleMembershipContinue}>
              Continue to Service Selection
            </Button>
          </Card>
        </div>
      )}

      {/* Customer Lookup Loading */}
      {isLookingUp && (
        <div className="fixed inset-0 bg-background/80 flex items-center justify-center z-50">
          <Card className="p-6 flex items-center gap-4">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span>Looking up customer...</span>
          </Card>
        </div>
      )}

      {createJobMutation.isPending && (
        <div className="fixed inset-0 bg-background/80 flex items-center justify-center z-50">
          <Card className="p-6 flex items-center gap-4">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span>Creating wash job...</span>
          </Card>
        </div>
      )}

      {/* Walk-in Registration Dialog */}
      <Dialog open={showWalkinDialog} onOpenChange={setShowWalkinDialog}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden">
          {/* Gradient header band */}
          <div className="bg-gradient-to-r from-primary via-primary/90 to-primary/70 px-6 pt-6 pb-5">
            <div className="flex items-center gap-3 mb-1">
              <div className="bg-white/20 rounded-full p-2">
                <UserPlus className="w-5 h-5 text-white" />
              </div>
              <DialogTitle className="text-white text-lg font-bold tracking-tight">
                Walk-in Registration
              </DialogTitle>
            </div>
            <DialogDescription className="text-white/75 text-sm ml-11">
              Enroll this customer in the loyalty rewards programme
            </DialogDescription>
          </div>

          <div className="px-6 py-5 space-y-4">
            {/* Plate badge */}
            <div className="flex items-center gap-3 bg-muted/60 border rounded-lg px-4 py-3">
              <CreditCard className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Licence Plate</p>
                <p className="font-mono font-bold text-base tracking-widest text-foreground">{pendingPlate?.plate}</p>
              </div>
              <Badge variant="secondary" className="text-xs shrink-0">Auto-filled</Badge>
            </div>

            <Separator />

            {/* Name */}
            <div className="space-y-1.5">
              <Label htmlFor="wk-name" className="text-sm font-semibold flex items-center gap-1.5">
                Full Name <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="wk-name"
                placeholder="e.g. Thabo Nkosi"
                value={walkinForm.name}
                onChange={e => setWalkinForm(f => ({ ...f, name: e.target.value }))}
                className="h-10"
                autoFocus
              />
            </div>

            {/* Phone */}
            <div className="space-y-1.5">
              <Label htmlFor="wk-phone" className="text-sm font-semibold flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-muted-foreground" /> Phone Number
                <span className="text-muted-foreground font-normal text-xs ml-1">(optional)</span>
              </Label>
              <Input
                id="wk-phone"
                type="tel"
                placeholder="e.g. 082 456 7890"
                value={walkinForm.phone}
                onChange={e => setWalkinForm(f => ({ ...f, phone: e.target.value }))}
                className="h-10"
              />
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <Label htmlFor="wk-email" className="text-sm font-semibold flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-muted-foreground" /> Email Address
                <span className="text-muted-foreground font-normal text-xs ml-1">(optional)</span>
              </Label>
              <Input
                id="wk-email"
                type="email"
                placeholder="e.g. thabo@email.com"
                value={walkinForm.email}
                onChange={e => setWalkinForm(f => ({ ...f, email: e.target.value }))}
                className="h-10"
              />
            </div>

            {/* Consent */}
            <div className="flex items-start gap-3 bg-amber-500/8 border border-amber-500/20 rounded-lg px-4 py-3">
              <Checkbox
                id="wk-consent"
                checked={walkinForm.consent}
                onCheckedChange={v => setWalkinForm(f => ({ ...f, consent: !!v }))}
                className="mt-0.5 border-amber-500/60 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500"
              />
              <label htmlFor="wk-consent" className="text-sm leading-snug cursor-pointer">
                <span className="flex items-center gap-1.5 font-semibold mb-0.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
                  Customer gives consent
                </span>
                <span className="text-muted-foreground text-xs">
                  Customer agrees to be enrolled in the loyalty programme and receive wash notifications.
                </span>
              </label>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowWalkinDialog(false)}
                disabled={walkinLoading}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 gap-2"
                onClick={handleWalkinSubmit}
                disabled={walkinLoading || !walkinForm.name.trim() || !walkinForm.consent}
              >
                {walkinLoading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Enrolling...</>
                ) : (
                  <><UserPlus className="w-4 h-4" /> Enrol Customer</>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
