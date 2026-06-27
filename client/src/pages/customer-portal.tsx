import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AppHeader } from "@/components/app-header";
import { AppFooter } from "@/components/app-footer";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  User,
  Phone,
  Award,
  Ticket,
  CalendarDays,
  CheckCircle2,
  Clock,
  TrendingUp,
  Car,
  Search,
  Star,
  XCircle,
  Sparkles,
  ArrowRight,
} from "lucide-react";

interface LoyaltyAccount {
  id: string;
  plateDisplay: string;
  customerName: string | null;
  customerPhone: string | null;
  tier: string;
  pointsBalance: number;
  lifetimePoints: number;
  totalWashes: number;
  membershipNumber: string;
}

interface LoyaltyTransaction {
  id: string;
  type: string;
  points: number;
  balanceAfter: number;
  description: string | null;
  createdAt: string;
}

interface Voucher {
  id: string;
  code: string;
  forPackageCode: string | null;
  status: string;
  issuedAt: string;
  expiresAt: string | null;
  usedAt: string | null;
}

interface Booking {
  id: string;
  bookingDate: string;
  timeSlot: string;
  status: string;
  serviceName: string | null;
  totalAmount: number | null;
}

interface PortalData {
  account: LoyaltyAccount;
  transactions: LoyaltyTransaction[];
  vouchers: Voucher[];
  bookings: Booking[];
}

const LOYALTY_THRESHOLD = 1000;

function PointsProgressBar({ balance }: { balance: number }) {
  const progress = Math.min((balance % LOYALTY_THRESHOLD) / LOYALTY_THRESHOLD, 1);
  const pct = Math.round(progress * 100);
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{balance % LOYALTY_THRESHOLD} pts</span>
        <span className="text-muted-foreground">{LOYALTY_THRESHOLD} pts for free wash</span>
      </div>
      <div className="h-2.5 rounded-full bg-muted overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="h-full bg-gradient-to-r from-primary to-primary/70 rounded-full"
        />
      </div>
      <p className="text-xs text-muted-foreground text-right">{pct}% to next free wash</p>
    </div>
  );
}

function transactionIcon(type: string) {
  if (type === "earn_wash") return <TrendingUp className="w-3.5 h-3.5 text-green-500" />;
  if (type === "redeem") return <Ticket className="w-3.5 h-3.5 text-amber-500" />;
  return <Award className="w-3.5 h-3.5 text-primary" />;
}

function voucherStatus(v: Voucher) {
  if (v.status === "used") return { label: "Used", color: "secondary" as const };
  if (v.status === "expired") return { label: "Expired", color: "destructive" as const };
  if (v.expiresAt && new Date(v.expiresAt) < new Date()) return { label: "Expired", color: "destructive" as const };
  return { label: "Active", color: "default" as const };
}

function bookingStatusBadge(status: string) {
  const map: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    confirmed: "default",
    completed: "secondary",
    cancelled: "destructive",
    in_progress: "default",
  };
  return map[status] || "outline";
}

export default function CustomerPortal() {
  const { toast } = useToast();
  const [phone, setPhone] = useState("");
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleLookup = async () => {
    if (!phone.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`/api/customer/portal?phone=${encodeURIComponent(phone.trim())}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Not found", description: err.message || "No account for this number.", variant: "destructive" });
        setData(null);
      } else {
        const json = await res.json();
        setData(json);
      }
    } catch {
      toast({ title: "Error", description: "Failed to load your details.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const activeVouchers = data?.vouchers.filter((v) => voucherStatus(v).label === "Active") || [];
  const usedVouchers = data?.vouchers.filter((v) => voucherStatus(v).label !== "Active") || [];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader />

      <main className="flex-1 max-w-2xl mx-auto px-4 py-8 w-full">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">

          {/* Header */}
          <div className="text-center space-y-1">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-3">
              <User className="w-7 h-7 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">My Account</h1>
            <p className="text-muted-foreground text-sm">
              View your loyalty points, vouchers, and wash history
            </p>
          </div>

          {/* Phone lookup */}
          {!data && (
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <Phone className="w-4 h-4 text-primary" />
                  Look up your account
                </CardTitle>
                <CardDescription className="text-xs">
                  Enter the phone number you used when registering with us.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Mobile number</Label>
                  <Input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. 082 123 4567"
                    className="text-sm"
                    onKeyDown={(e) => e.key === "Enter" && handleLookup()}
                  />
                </div>
                <Button
                  className="w-full gap-2"
                  disabled={!phone.trim() || loading}
                  onClick={handleLookup}
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      Looking up...
                    </span>
                  ) : (
                    <>
                      <Search className="w-4 h-4" />
                      Find my account
                    </>
                  )}
                </Button>
                {searched && !data && !loading && (
                  <p className="text-xs text-muted-foreground text-center">
                    Not registered yet? Visit us and ask our staff to enrol you in the loyalty programme.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Account data */}
          <AnimatePresence>
            {data && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4"
              >
                {/* Identity card */}
                <Card className="border-primary/20 overflow-hidden">
                  <div className="h-1.5 bg-gradient-to-r from-primary to-primary/40" />
                  <CardContent className="pt-5 pb-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-lg font-bold text-primary">
                          {data.account.customerName?.[0]?.toUpperCase() || "?"}
                        </div>
                        <div>
                          <p className="font-bold text-lg leading-tight">{data.account.customerName || "Valued Customer"}</p>
                          <p className="text-xs text-muted-foreground font-mono mt-0.5">{data.account.membershipNumber}</p>
                          <div className="flex items-center gap-1.5 mt-1">
                            <Car className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-sm font-mono font-semibold">{data.account.plateDisplay}</span>
                          </div>
                        </div>
                      </div>
                      <Badge className="text-xs capitalize shrink-0">{data.account.tier}</Badge>
                    </div>

                    <Separator className="my-4" />

                    <div className="grid grid-cols-3 gap-3 text-center mb-4">
                      <div>
                        <p className="text-2xl font-bold text-primary">{data.account.pointsBalance.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">Points balance</p>
                      </div>
                      <div>
                        <p className="text-2xl font-bold">{data.account.totalWashes}</p>
                        <p className="text-xs text-muted-foreground">Total washes</p>
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-amber-500">{activeVouchers.length}</p>
                        <p className="text-xs text-muted-foreground">Active vouchers</p>
                      </div>
                    </div>

                    <PointsProgressBar balance={data.account.pointsBalance} />
                  </CardContent>
                </Card>

                {/* Tabs */}
                <Tabs defaultValue="vouchers">
                  <TabsList className="w-full">
                    <TabsTrigger value="vouchers" className="flex-1 text-xs gap-1.5">
                      <Ticket className="w-3.5 h-3.5" />
                      Vouchers
                      {activeVouchers.length > 0 && (
                        <Badge className="text-[10px] px-1.5 py-0 ml-1">{activeVouchers.length}</Badge>
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="history" className="flex-1 text-xs gap-1.5">
                      <TrendingUp className="w-3.5 h-3.5" />
                      Points history
                    </TabsTrigger>
                    <TabsTrigger value="bookings" className="flex-1 text-xs gap-1.5">
                      <CalendarDays className="w-3.5 h-3.5" />
                      Bookings
                    </TabsTrigger>
                  </TabsList>

                  {/* Vouchers tab */}
                  <TabsContent value="vouchers" className="mt-4 space-y-3">
                    {data.vouchers.length === 0 ? (
                      <div className="text-center py-10">
                        <Sparkles className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
                        <p className="text-sm text-muted-foreground">No vouchers yet. Keep washing to earn points!</p>
                      </div>
                    ) : (
                      <>
                        {activeVouchers.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Active</p>
                            {activeVouchers.map((v) => (
                              <Card key={v.id} className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
                                <CardContent className="py-3 flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-xl bg-green-100 dark:bg-green-900 flex items-center justify-center">
                                      <Ticket className="w-4 h-4 text-green-600 dark:text-green-400" />
                                    </div>
                                    <div>
                                      <p className="font-bold text-sm font-mono">{v.code}</p>
                                      <p className="text-xs text-muted-foreground">
                                        {v.forPackageCode ? `For ${v.forPackageCode.replace(/_/g, " ")}` : "Any wash"}
                                        {v.expiresAt && ` · Expires ${new Date(v.expiresAt).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}`}
                                      </p>
                                    </div>
                                  </div>
                                  <Badge variant="default" className="text-xs shrink-0">Active</Badge>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        )}
                        {usedVouchers.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Used / Expired</p>
                            {usedVouchers.map((v) => {
                              const s = voucherStatus(v);
                              return (
                                <Card key={v.id} className="opacity-60">
                                  <CardContent className="py-3 flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-3">
                                      <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center">
                                        {v.status === "used" ? (
                                          <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
                                        ) : (
                                          <XCircle className="w-4 h-4 text-muted-foreground" />
                                        )}
                                      </div>
                                      <div>
                                        <p className="font-mono text-sm">{v.code}</p>
                                        <p className="text-xs text-muted-foreground">
                                          {v.usedAt ? `Used ${new Date(v.usedAt).toLocaleDateString("en-ZA")}` : "Expired"}
                                        </p>
                                      </div>
                                    </div>
                                    <Badge variant={s.color} className="text-xs shrink-0">{s.label}</Badge>
                                  </CardContent>
                                </Card>
                              );
                            })}
                          </div>
                        )}
                      </>
                    )}
                  </TabsContent>

                  {/* Points history tab */}
                  <TabsContent value="history" className="mt-4 space-y-2">
                    {data.transactions.length === 0 ? (
                      <div className="text-center py-10">
                        <TrendingUp className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
                        <p className="text-sm text-muted-foreground">No transactions yet.</p>
                      </div>
                    ) : (
                      data.transactions.map((tx) => (
                        <Card key={tx.id}>
                          <CardContent className="py-3 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                                {transactionIcon(tx.type)}
                              </div>
                              <div>
                                <p className="text-sm font-medium">{tx.description || tx.type.replace(/_/g, " ")}</p>
                                <p className="text-xs text-muted-foreground">
                                  {new Date(tx.createdAt).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                                  {" · "}Balance: {tx.balanceAfter.toLocaleString()} pts
                                </p>
                              </div>
                            </div>
                            <span className={`font-bold text-sm shrink-0 ${tx.points > 0 ? "text-green-600" : "text-destructive"}`}>
                              {tx.points > 0 ? "+" : ""}{tx.points}
                            </span>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </TabsContent>

                  {/* Bookings tab */}
                  <TabsContent value="bookings" className="mt-4 space-y-2">
                    {data.bookings.length === 0 ? (
                      <div className="text-center py-8 space-y-3">
                        <CalendarDays className="w-8 h-8 mx-auto text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">No bookings on record.</p>
                        <Button variant="outline" size="sm" className="gap-2" onClick={() => {
                          const plate = encodeURIComponent(data.account.plateDisplay || "");
                          window.location.href = plate ? `/book?plate=${plate}` : "/book";
                        }}>
                          Book a wash
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ) : (
                      data.bookings.map((b) => (
                        <Card key={b.id}>
                          <CardContent className="py-3 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                                <CalendarDays className="w-4 h-4 text-primary" />
                              </div>
                              <div>
                                <p className="text-sm font-medium">{b.serviceName || "Wash"}</p>
                                <p className="text-xs text-muted-foreground">
                                  {b.bookingDate} at {b.timeSlot}
                                </p>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <Badge variant={bookingStatusBadge(b.status)} className="text-xs capitalize mb-1">
                                {b.status.replace(/_/g, " ")}
                              </Badge>
                              {b.totalAmount && (
                                <p className="text-xs text-muted-foreground">R {(b.totalAmount / 100).toFixed(2)}</p>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    )}
                    {data.bookings.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full gap-2 mt-2"
                        onClick={() => {
                          const plate = encodeURIComponent(data.account.plateDisplay || "");
                          window.location.href = plate ? `/book?plate=${plate}` : "/book";
                        }}
                      >
                        Book again
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </TabsContent>
                </Tabs>

                {/* Change account button */}
                <button
                  type="button"
                  onClick={() => { setData(null); setPhone(""); setSearched(false); }}
                  className="text-xs text-muted-foreground underline text-center w-full"
                >
                  Look up a different account
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </main>

      <AppFooter />
    </div>
  );
}
