import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Car, Clock, Calendar, CheckCircle2, User, MapPin, Play } from "lucide-react";
import { CompactFooter } from "@/components/app-footer";
import type { WashJob, WashStatus } from "@shared/schema";
import { formatDistanceToNow, format } from "date-fns";

// CRM Booking type from external database
interface CRMBooking {
  id: string;
  status: "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "NO_SHOW" | "READY_FOR_PICKUP";
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

const CRM_STATUS_COLORS: Record<CRMBooking["status"], string> = {
  CONFIRMED: "bg-blue-500",
  IN_PROGRESS: "bg-amber-500",
  COMPLETED: "bg-green-500",
  CANCELLED: "bg-red-500",
  NO_SHOW: "bg-gray-500",
  READY_FOR_PICKUP: "bg-purple-500",
};

export default function MyJobs() {
  const [, setLocation] = useLocation();

  // Fetch my jobs from local database
  const { data: myJobs, isLoading: myLoading } = useQuery<WashJob[]>({
    queryKey: ["/api/wash-jobs?my=true"],
  });

  // Fetch CRM bookings from external database
  const { data: crmBookings, isLoading: crmLoading } = useQuery<CRMBooking[]>({
    queryKey: ["/api/crm/bookings"],
  });

  const isLoading = myLoading || crmLoading;

  // CRM bookings that are confirmed (upcoming)
  const upcomingCrmBookings = crmBookings?.filter(b =>
    b.status === "CONFIRMED"
  ) || [];

  // CRM bookings in progress
  const inProgressCrmBookings = crmBookings?.filter(b =>
    b.status === "IN_PROGRESS"
  ) || [];

  // Current: my active jobs (in progress)
  const currentJobs = myJobs?.filter(j =>
    j.status !== "complete" && j.status !== "received"
  ) || [];

  // Received by me but not started
  const myReceivedJobs = myJobs?.filter(j => j.status === "received") || [];

  // Past: my completed jobs
  const pastJobs = myJobs?.filter(j => j.status === "complete").slice(0, 5) || [];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b border-border">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/")} data-testid="button-back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="font-semibold">My Jobs</h1>
        </div>
      </header>

      <main className="flex-1 max-w-lg mx-auto px-4 py-6 w-full">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : (
          <div className="space-y-8">
            {/* Upcoming CRM Bookings */}
            {upcomingCrmBookings.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-blue-500" />
                  Upcoming Bookings
                  <Badge variant="secondary">{upcomingCrmBookings.length}</Badge>
                </h2>
                <div className="space-y-3">
                  {upcomingCrmBookings.map((booking, index) => (
                    <motion.div
                      key={booking.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                    >
                      <Card
                        className="p-4 border-blue-200 dark:border-blue-900"
                        data-testid={`card-crm-${booking.id}`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <p className="font-mono font-semibold text-lg">
                            {booking.licensePlate}
                          </p>
                          <Badge className={`${CRM_STATUS_COLORS[booking.status]} text-white`}>
                            {booking.timeSlot}
                          </Badge>
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-primary">
                            {booking.serviceName}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {booking.vehicleColor} {booking.vehicleMake} {booking.vehicleModel}
                          </p>
                          {booking.customerName && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <User className="w-3 h-3" />
                              {booking.customerName}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {format(new Date(booking.bookingDate + "T00:00:00"), "EEE, MMM d")}
                          </p>
                        </div>
                        <Button
                          className="w-full mt-3"
                          size="sm"
                          onClick={() => setLocation(
                            `/scan/carwash?plate=${encodeURIComponent(booking.licensePlate)}&bookingId=${encodeURIComponent(booking.id)}`
                          )}
                          data-testid={`button-start-wash-${booking.id}`}
                        >
                          <Play className="w-4 h-4 mr-2" />
                          Start Wash
                        </Button>
                      </Card>
                    </motion.div>
                  ))}
                </div>
              </section>
            )}

            {/* CRM Bookings In Progress */}
            {inProgressCrmBookings.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-amber-500" />
                  CRM In Progress
                  <Badge variant="secondary">{inProgressCrmBookings.length}</Badge>
                </h2>
                <div className="space-y-3">
                  {inProgressCrmBookings.map((booking, index) => (
                    <motion.div
                      key={booking.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                    >
                      <Card
                        className="p-4 border-amber-200 dark:border-amber-900"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <p className="font-mono font-semibold text-lg">
                            {booking.licensePlate}
                          </p>
                          <Badge className="bg-amber-500 text-white">
                            In Progress
                          </Badge>
                        </div>
                        <p className="text-sm font-medium text-primary">
                          {booking.serviceName}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {booking.vehicleColor} {booking.vehicleMake} {booking.vehicleModel}
                        </p>
                      </Card>
                    </motion.div>
                  ))}
                </div>
              </section>
            )}

            {/* My Received Jobs (not yet started) */}
            {myReceivedJobs.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Car className="w-5 h-5 text-cyan-500" />
                  Ready to Start
                  <Badge variant="secondary">{myReceivedJobs.length}</Badge>
                </h2>
                <div className="space-y-3">
                  {myReceivedJobs.map((job, index) => (
                    <motion.div
                      key={job.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                    >
                      <Card
                        className="p-4 hover-elevate active-elevate-2 cursor-pointer border-cyan-200 dark:border-cyan-900"
                        onClick={() => setLocation(`/wash-job/${job.id}`)}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-mono font-semibold text-lg">
                              {job.plateDisplay}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              Created {job.startAt ? formatDistanceToNow(new Date(job.startAt), { addSuffix: true }) : "N/A"}
                            </p>
                          </div>
                          <Badge className="bg-cyan-500 text-white">
                            Ready
                          </Badge>
                        </div>
                      </Card>
                    </motion.div>
                  ))}
                </div>
              </section>
            )}

            {/* Current Jobs (In Progress) */}
            <section>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                In Progress
                {currentJobs.length > 0 && (
                  <Badge variant="secondary">{currentJobs.length}</Badge>
                )}
              </h2>

              {currentJobs.length === 0 ? (
                <Card className="p-6 text-center">
                  <Clock className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-muted-foreground">No jobs in progress</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Start a wash to see it here
                  </p>
                </Card>
              ) : (
                <div className="space-y-3">
                  {currentJobs.map((job, index) => (
                    <motion.div
                      key={job.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                    >
                      <Card
                        className="p-4 hover-elevate active-elevate-2 cursor-pointer"
                        onClick={() => setLocation(`/wash-job/${job.id}`)}
                        data-testid={`card-job-${job.id}`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-mono font-semibold text-lg">
                              {job.plateDisplay}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              Started {job.startAt ? formatDistanceToNow(new Date(job.startAt), { addSuffix: true }) : "N/A"}
                            </p>
                          </div>
                          <Badge className={`${STATUS_COLORS[job.status as WashStatus]} text-white`}>
                            {STATUS_LABELS[job.status as WashStatus]}
                          </Badge>
                        </div>
                      </Card>
                    </motion.div>
                  ))}
                </div>
              )}
            </section>

            {/* Past Jobs */}
            {pastJobs.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-muted-foreground">
                  <CheckCircle2 className="w-5 h-5" />
                  Recently Completed
                </h2>
                <div className="space-y-2">
                  {pastJobs.map((job) => (
                    <Card
                      key={job.id}
                      className="p-3 opacity-70 hover:opacity-100 cursor-pointer transition-opacity"
                      onClick={() => setLocation(`/wash-job/${job.id}`)}
                      data-testid={`card-complete-${job.id}`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-mono font-medium">{job.plateDisplay}</p>
                          <p className="text-xs text-muted-foreground">
                            {job.endAt ? format(new Date(job.endAt), "MMM d, h:mm a") : "Completed"}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-green-600 border-green-500/30">
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          Complete
                        </Badge>
                      </div>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {/* Empty state when no CRM bookings and no local jobs */}
            {upcomingCrmBookings.length === 0 &&
             inProgressCrmBookings.length === 0 &&
             myReceivedJobs.length === 0 &&
             currentJobs.length === 0 &&
             pastJobs.length === 0 && (
              <Card className="p-8 text-center">
                <Calendar className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="font-semibold mb-2">No Jobs Yet</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Bookings from your CRM system and wash jobs you create will appear here.
                </p>
                <Button onClick={() => setLocation("/scan/carwash")}>
                  Start New Wash
                </Button>
              </Card>
            )}
          </div>
        )}
      </main>

      <CompactFooter />
    </div>
  );
}
