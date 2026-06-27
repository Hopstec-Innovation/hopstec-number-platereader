import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AppHeader } from "@/components/app-header";
import { AppFooter } from "@/components/app-footer";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  CalendarDays,
  Clock,
  Car,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  User,
  Phone,
  Mail,
  Package,
  ArrowRight,
  Sparkles,
} from "lucide-react";

interface BookingService {
  id: string;
  name: string;
  description: string | null;
  price: number;
  durationMinutes: number;
  isActive: boolean;
}

interface TimeSlot {
  time: string;
  available: number;
  maxConcurrent: number;
}

type Step = "service" | "date" | "slots" | "details" | "confirmed";

const DEFAULT_TENANT = "default";

function getTenantId(): string {
  if (typeof window === "undefined") return DEFAULT_TENANT;
  return new URLSearchParams(window.location.search).get("tenant") || DEFAULT_TENANT;
}

function getNextDays(count: number): { label: string; value: string; dayName: string }[] {
  const days = [];
  for (let i = 0; i < count; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const value = new Intl.DateTimeFormat("en-CA").format(d);
    const label = d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
    const dayName = i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString("en-ZA", { weekday: "long" });
    days.push({ label, value, dayName });
  }
  return days;
}

function centsToDisplay(cents: number): string {
  return `R ${(cents / 100).toFixed(2)}`;
}

export default function CustomerBooking() {
  const tenantId = useMemo(() => getTenantId(), []);
  const initialPlate = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("plate") || "";
  }, []);
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("service");
  const [selectedService, setSelectedService] = useState<BookingService | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedSlot, setSelectedSlot] = useState<string>("");
  const [form, setForm] = useState({ name: "", phone: "", email: "", plate: initialPlate });
  const [confirmedRef, setConfirmedRef] = useState("");

  const days = getNextDays(14);

  const { data: services = [], isLoading: servicesLoading } = useQuery<BookingService[]>({
    queryKey: ["/api/booking/services", tenantId],
    queryFn: () =>
      fetch(`/api/booking/services?tenantId=${tenantId}`).then((r) => r.json()),
  });

  const { data: slots = [], isLoading: slotsLoading } = useQuery<TimeSlot[]>({
    queryKey: ["/api/booking/available-slots", selectedDate],
    queryFn: () =>
      fetch(`/api/booking/available-slots?date=${selectedDate}&tenantId=${tenantId}`).then((r) => r.json()),
    enabled: !!selectedDate,
  });

  const bookMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/booking/self-service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          serviceId: selectedService?.id,
          date: selectedDate,
          time: selectedSlot,
          customerName: form.name,
          customerPhone: form.phone || undefined,
          customerEmail: form.email || undefined,
          plateDisplay: form.plate || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Booking failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setConfirmedRef(data.bookingReference || data.bookingId?.slice(0, 8)?.toUpperCase() || "");
      setStep("confirmed");
    },
    onError: (err: Error) =>
      toast({ title: "Booking failed", description: err.message, variant: "destructive" }),
  });

  const selectedDay = days.find((d) => d.value === selectedDate);
  const availableSlots = slots.filter((s) => s.available > 0);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader />

      <main className="flex-1 max-w-2xl mx-auto px-4 py-8 w-full">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">

          {/* Header */}
          {step !== "confirmed" && (
            <div className="text-center space-y-1">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-3">
                <CalendarDays className="w-7 h-7 text-primary" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">Book a Wash</h1>
              <p className="text-muted-foreground text-sm">
                Choose your service and pick a convenient time
              </p>
            </div>
          )}

          {/* Step indicator */}
          {step !== "confirmed" && (
            <div className="flex items-center justify-center gap-2">
              {(["service", "date", "slots", "details"] as Step[]).map((s, i) => (
                <div key={s} className="flex items-center gap-2">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                      step === s
                        ? "bg-primary text-primary-foreground"
                        : ["service", "date", "slots", "details"].indexOf(step) > i
                        ? "bg-primary/20 text-primary"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {["service", "date", "slots", "details"].indexOf(step) > i ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : (
                      i + 1
                    )}
                  </div>
                  {i < 3 && <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                </div>
              ))}
            </div>
          )}

          <AnimatePresence mode="wait">
            {/* STEP 1 — Service selection */}
            {step === "service" && (
              <motion.div
                key="service"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <h2 className="text-base font-semibold">Choose your service</h2>
                {servicesLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />
                    ))}
                  </div>
                ) : services.length === 0 ? (
                  <Card className="text-center py-10">
                    <CardContent>
                      <Package className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
                      <p className="text-muted-foreground text-sm">No services available at the moment.</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {services.map((svc) => (
                      <motion.div
                        key={svc.id}
                        whileTap={{ scale: 0.98 }}
                      >
                        <Card
                          className={`cursor-pointer transition-all hover:shadow-md ${
                            selectedService?.id === svc.id
                              ? "border-primary ring-1 ring-primary bg-primary/5"
                              : "hover:border-primary/40"
                          }`}
                          onClick={() => setSelectedService(svc)}
                        >
                          <CardContent className="py-4 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                                selectedService?.id === svc.id ? "bg-primary/20" : "bg-muted"
                              }`}>
                                <Sparkles className={`w-5 h-5 ${selectedService?.id === svc.id ? "text-primary" : "text-muted-foreground"}`} />
                              </div>
                              <div>
                                <p className="font-semibold text-sm">{svc.name}</p>
                                {svc.description && (
                                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{svc.description}</p>
                                )}
                                <div className="flex items-center gap-2 mt-1">
                                  <Badge variant="outline" className="text-xs">
                                    <Clock className="w-3 h-3 mr-1" />
                                    {svc.durationMinutes}min
                                  </Badge>
                                </div>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="font-bold text-primary">{centsToDisplay(svc.price)}</p>
                              {selectedService?.id === svc.id && (
                                <CheckCircle2 className="w-4 h-4 text-primary ml-auto mt-1" />
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </div>
                )}
                <Button
                  className="w-full gap-2"
                  disabled={!selectedService}
                  onClick={() => setStep("date")}
                >
                  Continue
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </motion.div>
            )}

            {/* STEP 2 — Date selection */}
            {step === "date" && (
              <motion.div
                key="date"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStep("service")}
                    className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <h2 className="text-base font-semibold">Choose a date</h2>
                </div>

                <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                  {days.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => { setSelectedDate(d.value); setSelectedSlot(""); }}
                      className={`p-2.5 rounded-xl border-2 text-center transition-all ${
                        selectedDate === d.value
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border hover:border-primary/40"
                      }`}
                    >
                      <p className="text-xs text-muted-foreground leading-tight">{d.dayName.slice(0, 3)}</p>
                      <p className="text-sm font-semibold mt-0.5">{d.label}</p>
                    </button>
                  ))}
                </div>

                <Button
                  className="w-full gap-2"
                  disabled={!selectedDate}
                  onClick={() => setStep("slots")}
                >
                  See available times
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </motion.div>
            )}

            {/* STEP 3 — Time slot selection */}
            {step === "slots" && (
              <motion.div
                key="slots"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStep("date")}
                    className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <div>
                    <h2 className="text-base font-semibold">Choose a time</h2>
                    <p className="text-xs text-muted-foreground">
                      {selectedDay?.dayName}, {selectedDay?.label}
                    </p>
                  </div>
                </div>

                {slotsLoading ? (
                  <div className="grid grid-cols-4 gap-2">
                    {[...Array(8)].map((_, i) => (
                      <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />
                    ))}
                  </div>
                ) : availableSlots.length === 0 ? (
                  <Card className="text-center py-10">
                    <CardContent>
                      <Clock className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
                      <p className="font-medium mb-1">No slots available</p>
                      <p className="text-muted-foreground text-sm">This day is fully booked or closed. Please choose another date.</p>
                      <Button variant="outline" className="mt-4" onClick={() => setStep("date")}>
                        Choose another date
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                    {availableSlots.map((s) => (
                      <button
                        key={s.time}
                        type="button"
                        onClick={() => setSelectedSlot(s.time)}
                        className={`p-2 rounded-xl border-2 text-center transition-all ${
                          selectedSlot === s.time
                            ? "border-primary bg-primary/5 text-primary"
                            : "border-border hover:border-primary/40"
                        }`}
                      >
                        <p className="text-sm font-semibold">{s.time}</p>
                        <p className="text-xs text-muted-foreground">
                          {s.available === s.maxConcurrent ? "open" : `${s.available} left`}
                        </p>
                      </button>
                    ))}
                  </div>
                )}

                {availableSlots.length > 0 && (
                  <Button
                    className="w-full gap-2"
                    disabled={!selectedSlot}
                    onClick={() => setStep("details")}
                  >
                    Continue
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                )}
              </motion.div>
            )}

            {/* STEP 4 — Customer details */}
            {step === "details" && (
              <motion.div
                key="details"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStep("slots")}
                    className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <h2 className="text-base font-semibold">Your details</h2>
                </div>

                {/* Booking summary */}
                <Card className="border-primary/20 bg-primary/5">
                  <CardContent className="py-3">
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Service</p>
                        <p className="font-semibold truncate">{selectedService?.name}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Date</p>
                        <p className="font-semibold">{selectedDay?.label}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Time</p>
                        <p className="font-semibold">{selectedSlot}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-5 pb-5 space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5" />
                        Full name <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        value={form.name}
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="e.g. Thabo Nkosi"
                        className="text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5" />
                        Phone number
                      </Label>
                      <Input
                        type="tel"
                        value={form.phone}
                        onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                        placeholder="e.g. 082 123 4567"
                        className="text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium flex items-center gap-1.5">
                        <Mail className="w-3.5 h-3.5" />
                        Email address
                      </Label>
                      <Input
                        type="email"
                        value={form.email}
                        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                        placeholder="e.g. thabo@email.com"
                        className="text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium flex items-center gap-1.5">
                        <Car className="w-3.5 h-3.5" />
                        Licence plate
                      </Label>
                      <Input
                        value={form.plate}
                        onChange={(e) => setForm((f) => ({ ...f, plate: e.target.value.toUpperCase() }))}
                        placeholder="e.g. ABC 123 GP"
                        className="text-sm font-mono tracking-widest"
                      />
                    </div>
                  </CardContent>
                </Card>

                <Button
                  className="w-full gap-2"
                  disabled={!form.name.trim() || bookMutation.isPending}
                  onClick={() => bookMutation.mutate()}
                  size="lg"
                >
                  {bookMutation.isPending ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      Submitting booking...
                    </span>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Confirm booking
                    </>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  By booking you agree to our{" "}
                  <a href="/legal/terms" className="underline">terms of service</a>
                </p>
              </motion.div>
            )}

            {/* STEP 5 — Confirmed */}
            {step === "confirmed" && (
              <motion.div
                key="confirmed"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center space-y-6 py-4"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 300, damping: 20, delay: 0.1 }}
                  className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mx-auto"
                >
                  <CheckCircle2 className="w-10 h-10 text-green-600 dark:text-green-400" />
                </motion.div>

                <div>
                  <h2 className="text-2xl font-bold mb-2">Booking Confirmed!</h2>
                  <p className="text-muted-foreground">
                    Thank you, <strong>{form.name}</strong>! Your appointment is booked
                    {confirmedRef ? <> — reference <strong className="font-mono">{confirmedRef}</strong></> : ""}.
                  </p>
                </div>

                <Card className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950 text-left">
                  <CardContent className="py-4 space-y-2 text-sm">
                    {confirmedRef && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Reference</span>
                        <span className="font-mono font-semibold">{confirmedRef}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Service</span>
                      <span className="font-semibold">{selectedService?.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Date</span>
                      <span className="font-semibold">{selectedDay?.dayName}, {selectedDay?.label}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Time</span>
                      <span className="font-semibold">{selectedSlot}</span>
                    </div>
                    {selectedService && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Price</span>
                        <span className="font-bold text-primary">{centsToDisplay(selectedService.price)}</span>
                      </div>
                    )}
                    {form.plate && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Vehicle</span>
                        <span className="font-semibold font-mono">{form.plate}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Button
                  variant="outline"
                  onClick={() => {
                    setStep("service");
                    setSelectedService(null);
                    setSelectedDate("");
                    setSelectedSlot("");
                    setForm({ name: "", phone: "", email: "", plate: "" });
                  }}
                  className="w-full"
                >
                  Book another appointment
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </main>

      <AppFooter />
    </div>
  );
}
