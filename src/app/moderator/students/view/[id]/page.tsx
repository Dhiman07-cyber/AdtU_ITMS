"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { use } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  User,
  Mail,
  Phone,
  Calendar,
  Hash,
  Users,
  Building,
  Edit,
  Trash2,
  Loader2,
  MapPin,
  Bus,
  Clock,
  Shield,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  Heart,
  Home,
  School,
  Download,
  QrCode,
  Share2
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getAuth } from "firebase/auth";
import Link from "next/link";
import { useToast } from '@/contexts/toast-context';
import { QRCodeCanvas } from 'qrcode.react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getStudentById, getBusById, getRouteById, deleteStudent, getPaymentsByStudentUid } from "@/lib/dataService";
import { PremiumPageLoader } from "@/components/LoadingSpinner";
import { isDateExpired, formatDateFlexible } from '@/lib/utils/date-utils';
import { safeImageSrc } from "@/lib/security/url-sanitizer";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const formatDate = formatDateFlexible;

const calculateAgeFromDob = (dobValue: any): string => {
  if (!dobValue) return 'N/A';
  try {
    let date: Date;
    if (typeof dobValue === 'object' && dobValue !== null && 'seconds' in dobValue) {
      date = new Date(dobValue.seconds * 1000);
    } else if (dobValue && dobValue.toDate && typeof dobValue.toDate === 'function') {
      date = dobValue.toDate();
    } else {
      date = new Date(dobValue);
    }
    if (isNaN(date.getTime())) return 'N/A';
    const currentYear = new Date().getFullYear();
    const birthYear = date.getFullYear();
    return (currentYear - birthYear).toString();
  } catch (error) {
    return 'N/A';
  }
};

const formatId = (id: string | undefined) => {
  if (!id) return 'Not Assigned';
  // Convert bus_6 to Bus-6, route_6 to Route-6, etc.
  return id.replace(/^(\w+)_(\d+)$/i, (match, prefix, number) => {
    return `${prefix.charAt(0).toUpperCase() + prefix.slice(1)}-${number}`;
  });
};

const StatusBadge = ({ status }: { status: string }) => {
  const statusConfig: Record<string, { bg: string; text: string; dot: string }> = {
    active: { bg: 'bg-emerald-500/10 border-emerald-500/30', text: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' },
    inactive: { bg: 'bg-gray-500/10 border-gray-500/30', text: 'text-gray-600 dark:text-gray-400', dot: 'bg-gray-500' },
    expired: { bg: 'bg-red-500/10 border-red-500/30', text: 'text-red-600 dark:text-red-400', dot: 'bg-red-500' },
  };

  const config = statusConfig[status?.toLowerCase()] || statusConfig.inactive;

  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${config.bg} ${config.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot} animate-pulse`}></span>
      <span className="text-xs font-medium capitalize">{status || 'Unknown'}</span>
    </div>
  );
};

const InfoCard = ({ icon: Icon, label, value, gradient }: any) => (
  <div className="group relative overflow-hidden rounded-xl bg-white dark:bg-gray-800/50 p-3 shadow-md hover:shadow-lg transition-all duration-300 border border-gray-100 dark:border-gray-700/50">
    <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-300`}></div>
    <div className="relative">
      <div className="flex items-center justify-between mb-2">
        <div className={`p-1.5 rounded-lg bg-gradient-to-br ${gradient} shadow-md`}>
          <Icon className="w-3.5 h-3.5 text-white" />
        </div>
      </div>
      <p className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 break-words leading-tight">{value}</p>
    </div>
  </div>
);

import { useModeratorPermissions } from "@/hooks/useModeratorPermissions";
import { PermissionDeniedCard } from "@/components/PermissionDeniedCard";

export default function ViewStudentPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { addToast } = useToast();
  const { canStudentView, loading: permsLoading } = useModeratorPermissions();
  const { id } = use(params);
  const [student, setStudent] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPayments, setLoadingPayments] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [downloadingReceiptId, setDownloadingReceiptId] = useState<string | null>(null);
  const qrRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchStudentAndPayments = async () => {
      try {
        // Fetch student first to get enrollment ID for better payment lookup
        const foundStudent = await getStudentById(id);

        if (foundStudent) {
          setStudent(foundStudent);
          // Fetch payments using both UID and Enrollment ID (if available)
          const foundPayments = await getPaymentsByStudentUid(id, foundStudent.enrollmentId);
          setPayments(foundPayments || []);
        } else {
          // If student not found, try fetching payments by UID anyway
          const foundPayments = await getPaymentsByStudentUid(id);
          setPayments(foundPayments || []);
        }
      } catch (error) {
        console.error('Error fetching student or payments:', error);
        addToast('Error fetching data', 'error');
      } finally {
        setLoading(false);
        setLoadingPayments(false);
      }
    };

    fetchStudentAndPayments();
  }, [id, addToast]);

  const handleEdit = () => {
    router.push(`/moderator/students/edit/${id}`);
  };

  const handleDelete = () => {
    setIsDialogOpen(true);
  };

  const confirmDelete = async () => {
    try {
      const success = await deleteStudent(id);

      if (success) {
        addToast('Student deleted successfully!', 'success');
        setIsDialogOpen(false);
        router.push("/moderator/students");
      } else {
        addToast('Failed to delete student', 'error');
      }
    } catch (error) {
      console.error('Error deleting student:', error);
      addToast('Failed to delete student', 'error');
    }
  };

  const handleDownloadReceipt = async (paymentId: string) => {
    setDownloadingReceiptId(paymentId);
    try {
      const auth = getAuth();
      const currentUser = auth.currentUser;
      if (!currentUser) {
        addToast('Authentication required', 'error');
        setDownloadingReceiptId(null);
        return;
      }

      addToast('Generating receipt...', 'info');
      const token = await currentUser.getIdToken();
      const response = await fetch(`/api/payment/receipt/${paymentId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) throw new Error('Failed to generate receipt');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Receipt_${paymentId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      addToast('Receipt downloaded successfully', 'success');
    } catch (error) {
      console.error('Error downloading receipt:', error);
      addToast('Failed to download receipt', 'error');
    } finally {
      setDownloadingReceiptId(null);
    }
  };

  // QR Code Download Handler
  const handleDownloadQR = useCallback(async () => {
    if (!student) return;

    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const scale = 4;
      const cardWidth = 400;
      const cardHeight = 600;
      const cornerRadius = 32;
      canvas.width = cardWidth * scale;
      canvas.height = cardHeight * scale;
      ctx.scale(scale, scale);

      // Clip to rounded rectangle
      ctx.beginPath();
      ctx.roundRect(0, 0, cardWidth, cardHeight, cornerRadius);
      ctx.clip();

      // Dark background
      ctx.fillStyle = '#020817';
      ctx.fillRect(0, 0, cardWidth, cardHeight);

      // Header
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(0, 0, cardWidth, 80);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 18px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('Assam down town University', 30, 42);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = '600 11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillText('Digital Bus Pass', 30, 58);

      // Student Name
      const infoY = 110;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = '700 10px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillText('STUDENT NAME', 30, infoY);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 24px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillText(student.fullName || student.name || 'Student', 30, infoY + 28);

      // Status Badge
      const badgeX = cardWidth - 110;
      const badgeY = infoY + 8;
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.roundRect(badgeX, badgeY, 80, 28, 14);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('ACTIVE', badgeX + 40, badgeY + 18);

      // QR Code Section
      ctx.textAlign = 'left';
      const qrContainerY = 190;
      const qrSize = 220;
      const qrX = (cardWidth - qrSize) / 2;
      const qrY = qrContainerY + 40;

      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = '700 10px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('SCAN TO VERIFY', cardWidth / 2, qrContainerY + 15);

      // QR Container
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(qrX - 15, qrY - 15, qrSize + 30, qrSize + 30, 20);
      ctx.fill();

      // Draw QR Code
      const existingQR = qrRef.current?.querySelector('canvas');
      if (existingQR) {
        ctx.drawImage(existingQR, qrX, qrY, qrSize, qrSize);
      }

      // Corner decorations
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      const cornerLen = 20;
      const cornerPad = 8;

      [[qrX - cornerPad, qrY - cornerPad, 1, 1], [qrX + qrSize + cornerPad, qrY - cornerPad, -1, 1],
      [qrX - cornerPad, qrY + qrSize + cornerPad, 1, -1], [qrX + qrSize + cornerPad, qrY + qrSize + cornerPad, -1, -1]]
        .forEach(([x, y, dx, dy]) => {
          ctx.beginPath();
          ctx.moveTo(x, y + cornerLen * (dy as number));
          ctx.lineTo(x, y);
          ctx.lineTo(x + cornerLen * (dx as number), y);
          ctx.stroke();
        });

      // Enrollment ID Section
      const enrollY = qrY + qrSize + 60;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.beginPath();
      ctx.roundRect(30, enrollY, cardWidth - 60, 60, 16);
      ctx.fill();

      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = '700 9px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillText('ENROLLMENT ID', cardWidth / 2, enrollY + 20);

      ctx.fillStyle = '#60a5fa';
      ctx.font = 'bold 16px monospace';
      ctx.fillText(student.enrollmentId || 'N/A', cardWidth / 2, enrollY + 42);

      // Footer
      const footerY = cardHeight - 40;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(30, footerY - 10);
      ctx.lineTo(cardWidth - 30, footerY - 10);
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.font = '600 9px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillText('Official Digital Authorization • Keep this pass with you', cardWidth / 2, footerY + 8);

      // Download
      const link = document.createElement('a');
      link.download = `BusPass_${(student.fullName || student.name)?.replace(/\s+/g, '_')}.png`;
      link.href = canvas.toDataURL('image/png', 1.0);
      link.click();
      addToast('Bus pass saved successfully!', 'success');
    } catch (e) {
      console.error(e);
      addToast('Failed to save bus pass', 'error');
    }
  }, [student]);

  // QR Code Share Handler
  const handleShareQR = useCallback(async () => {
    if (!student) return;

    try {
      const text = `Bus Pass - ${student.fullName || student.name}\nEnrollment ID: ${student.enrollmentId || 'N/A'}\nStatus: ${student.status?.toUpperCase() || 'ACTIVE'}`;
      if (navigator.share) {
        await navigator.share({ title: 'AdtU Digital Bus Pass', text });
      } else {
        await navigator.clipboard.writeText(text);
        addToast('Details copied!', 'success');
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') addToast('Sharing failed', 'error');
    }
  }, [student]);

  if (loading) {
    return <PremiumPageLoader message="Loading student profile..." subMessage="Fetching details..." />;
  }

  if (!student) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-transparent">
        <div className="text-center max-w-md mx-auto px-4">
          <div className="mb-8 inline-flex items-center justify-center w-24 h-24 rounded-full bg-gradient-to-br from-red-500 to-pink-500 shadow-2xl">
            <AlertCircle className="w-12 h-12 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-3">Student Not Found</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-8">The student profile you're looking for doesn't exist or has been removed from the system.</p>
          <Link href="/moderator/students">
            <Button className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white shadow-xl hover:shadow-2xl transition-all duration-300 px-8 py-6 text-base rounded-2xl">
              <ArrowLeft className="w-5 h-5 mr-2" />
              Back to Students
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!permsLoading && !canStudentView) {
    return <PermissionDeniedCard title="Student Profile Restricted" actionName="Viewing Student Details" />;
  }

  return (
    <div className="min-h-screen pb-12 mt-8 bg-gradient-to-br from-background via-background to-muted/20">
      {/* Header */}
      <div className="bg-gradient-to-r from-card via-card to-card/95 border-b border-border shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div>
                <h1 className="text-lg md:text-3xl font-black text-foreground tracking-tight">Student Profile</h1>
                <p className="text-xs md:text-base text-muted-foreground mt-0.5 hidden md:block">View and manage student information</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Link href="/moderator/students">
                <Button variant="outline" className="h-7 px-2.5 py-1.5 rounded-lg text-xs shadow-sm bg-white text-black md:bg-transparent md:text-inherit">
                  &lt;- Back
                </Button>
              </Link>
              <Button
                onClick={handleEdit}
                className="hidden md:inline-flex bg-white hover:bg-gray-100 text-black border border-gray-200 px-2.5 py-1.5 rounded-lg text-xs shadow-sm h-7">
                <Edit className="w-3 h-3 mr-1" />
                Edit Profile
              </Button>
              <Button
                onClick={handleDelete}
                className="hidden md:inline-flex bg-red-600 hover:bg-red-700 text-white px-2.5 py-1.5 rounded-lg text-xs shadow-sm h-7">
                <Trash2 className="w-3 h-3 mr-1" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-4">
        {/* Hero Section - Magazine Style */}
        <div className="mb-5 grid md:grid-cols-[180px_1fr] gap-4 items-start">
          {/* Large Avatar Section */}
          <div className="relative w-32 md:w-full md:h-auto mx-auto md:mx-0">
            <div className="md:sticky md:top-6">
              <div className="relative group">
                {student.profilePhotoUrl ? (
                  <div className="relative w-full aspect-square rounded-full overflow-hidden shadow-2xl border-2 border-border bg-gradient-to-br from-card to-card/80">
                    <img
                      src={safeImageSrc(student.profilePhotoUrl)}
                      alt={student.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <Avatar className="relative w-full aspect-square shadow-xl border-2 border-primary/20 rounded-full">
                    <AvatarFallback className="text-4xl md:text-6xl font-bold bg-gradient-to-br from-primary via-primary to-primary/80 text-primary-foreground rounded-full">
                      {student.name?.charAt(0) || 'S'}
                    </AvatarFallback>
                  </Avatar>
                )}
              </div>

              {/* Mobile: Name & Status below image */}
              <div className="md:hidden mt-6 flex justify-center">
                {(() => {
                  const isExpired = student.validUntil ? isDateExpired(new Date(student.validUntil)) : false;
                  const displayStatus = isExpired ? 'expired' : (student.status || 'active');
                  return <StatusBadge status={displayStatus} />;
                })()}
              </div>
              <div className="md:hidden mt-2 text-center">
                <h2 className="text-2xl font-black bg-gradient-to-r from-blue-400 to-pink-500 bg-clip-text text-transparent mb-1 leading-tight break-words">{student.fullName || student.name}</h2>
                <div className="mt-2 flex flex-col gap-1.5 items-center">
                  <div className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-primary/20 bg-gradient-to-r from-primary/5 to-primary/10 shadow-sm w-fit">
                    <Mail className="w-3 h-3 text-primary" />
                    <span className="text-[10px] font-medium text-foreground">{student.email || 'Not provided'}</span>
                  </div>
                  <div className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-green-200/50 dark:border-green-800/50 bg-gradient-to-r from-green-50/50 to-green-100/50 dark:from-green-950/20 dark:to-green-900/30 shadow-sm w-fit">
                    <Phone className="w-3 h-3 text-green-600 dark:text-green-400" />
                    <span className="text-[10px] font-medium text-foreground">{student.phoneNumber}</span>
                  </div>
                </div>
              </div>

              {/* Desktop: Quick Stats */}
              <div className="hidden md:block mt-3 space-y-1.5">
                <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-2xl bg-gradient-to-r from-emerald-100 via-emerald-50 to-teal-50 dark:from-emerald-900/40 dark:via-emerald-950/30 dark:to-teal-950/20 border border-emerald-200/60 dark:border-emerald-700/40 shadow-sm hover:shadow-md transition-all">
                  <Hash className="w-3 h-3 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[9px] text-muted-foreground">Enrollment</p>
                    <p className="font-bold truncate text-[10px] text-foreground">{student.enrollmentId || 'N/A'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-2xl bg-gradient-to-r from-violet-100 via-violet-50 to-fuchsia-50 dark:from-violet-900/40 dark:via-violet-950/30 dark:to-fuchsia-950/20 border border-violet-200/60 dark:border-violet-700/40 shadow-sm hover:shadow-md transition-all">
                  <Users className="w-3 h-3 flex-shrink-0 text-violet-600 dark:text-violet-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[9px] text-muted-foreground">Gender</p>
                    <p className="font-bold capitalize text-[10px] text-foreground">{student.gender || 'N/A'}</p>
                  </div>
                </div>
                {(() => {
                  const isExpired = student.validUntil ? isDateExpired(new Date(student.validUntil)) : false;
                  const displayStatus = isExpired ? 'expired' : (student.status || 'active');
                  return <StatusBadge status={displayStatus} />;
                })()}
              </div>
            </div>
          </div>

          {/* Main Info Section - Desktop only */}
          <div className="hidden md:block space-y-4">
            {/* Name & Title */}
            <div>
              <h2 className="text-2xl font-black bg-gradient-to-r from-blue-400 to-pink-500 bg-clip-text text-transparent mb-1 leading-tight">{student.fullName || student.name}</h2>
              <p className="text-sm text-primary font-medium mb-0.5">{student.department || 'Department'}</p>
              {student.faculty && (
                <p className="text-xs text-muted-foreground">{student.faculty}</p>
              )}
              <div className="mt-2 flex flex-col gap-1.5">
                <div className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-primary/20 bg-gradient-to-r from-primary/5 to-primary/10 shadow-sm w-fit">
                  <Mail className="w-3 h-3 text-primary" />
                  <span className="text-[10px] font-medium text-foreground">{student.email || 'Not provided'}</span>
                </div>

                <div className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-green-200/50 dark:border-green-800/50 bg-gradient-to-r from-green-50/50 to-green-100/50 dark:from-green-950/20 dark:to-green-900/30 shadow-sm w-fit">
                  <Phone className="w-3 h-3 text-green-600 dark:text-green-400" />
                  <span className="text-[10px] font-medium text-foreground">{student.phoneNumber}</span>
                </div>

              </div>
            </div>


            {/* Quick Stats Grid - Simple Gradients */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 pt-2">
              <div className="text-center p-2 rounded-3xl border border-purple-200/50 dark:border-purple-800/50 bg-gradient-to-br from-purple-50/50 to-purple-100/30 dark:from-purple-950/20 dark:to-purple-900/30 hover:shadow-md transition-all">
                <Calendar className="w-3.5 h-3.5 mx-auto mb-1 text-purple-600 dark:text-purple-400" />
                <p className="text-sm font-bold text-foreground mb-0">{calculateAgeFromDob(student.dob)}</p>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">Age</p>
              </div>
              <div className="text-center p-2 rounded-3xl border border-blue-200/50 dark:border-blue-800/50 bg-gradient-to-br from-blue-50/50 to-blue-100/30 dark:from-blue-950/20 dark:to-blue-900/30 hover:shadow-md transition-all">
                <Hash className="w-3.5 h-3.5 mx-auto mb-1 text-blue-600 dark:text-blue-400" />
                <p className="text-sm font-bold text-foreground mb-0">{student.semester || 'N/A'}</p>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">Semester</p>
              </div>
              <div className="text-center p-2 rounded-3xl border border-rose-200/50 dark:border-rose-800/50 bg-gradient-to-br from-rose-50/50 to-rose-100/30 dark:from-rose-950/20 dark:to-rose-900/30 hover:shadow-md transition-all">
                <Heart className="w-3.5 h-3.5 mx-auto mb-1 text-rose-600 dark:text-rose-400" />
                <p className="text-sm font-bold text-foreground mb-0">{student.bloodGroup || 'N/A'}</p>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">Blood</p>
              </div>
              <div className="text-center p-2 rounded-3xl border border-amber-200/50 dark:border-amber-800/50 bg-gradient-to-br from-amber-50/50 to-amber-100/30 dark:from-amber-950/20 dark:to-amber-900/30 hover:shadow-md transition-all">
                <Bus className="w-3.5 h-3.5 mx-auto mb-1 text-amber-600 dark:text-amber-400" />
                <p className="text-sm font-bold text-foreground mb-0">{formatId(student.busId)}</p>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">Bus</p>
              </div>
            </div>
          </div>

          {/* Mobile: Quick Stats Grid */}
          <div className="md:hidden grid grid-cols-2 gap-2 pt-2">
            <div className="text-center p-2 rounded-3xl border border-purple-200/50 dark:border-purple-800/50 bg-gradient-to-br from-purple-50/50 to-purple-100/30 dark:from-purple-950/20 dark:to-purple-900/30 hover:shadow-md transition-all">
              <Calendar className="w-3.5 h-3.5 mx-auto mb-1 text-purple-600 dark:text-purple-400" />
              <p className="text-sm font-bold text-foreground mb-0">{calculateAgeFromDob(student.dob)}</p>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">Age</p>
            </div>
            <div className="text-center p-2 rounded-3xl border border-blue-200/50 dark:border-blue-800/50 bg-gradient-to-br from-blue-50/50 to-blue-100/30 dark:from-blue-950/20 dark:to-blue-900/30 hover:shadow-md transition-all">
              <Hash className="w-3.5 h-3.5 mx-auto mb-1 text-blue-600 dark:text-blue-400" />
              <p className="text-sm font-bold text-foreground mb-0">{student.semester || 'N/A'}</p>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">Semester</p>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="my-8 flex items-center justify-center">
          <div className="relative inline-flex items-center gap-4">
            <div className="w-16 h-[2px] bg-gradient-to-r from-transparent to-primary/40"></div>
            <div className="px-6 py-2.5 rounded-xl bg-blue-500/5 dark:bg-blue-500/10 border border-blue-500/20">
              <span className="text-sm font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 dark:from-blue-400 dark:via-purple-400 dark:to-pink-400 bg-clip-text text-transparent">Detailed Information</span>
            </div>
            <div className="w-16 h-[2px] bg-gradient-to-l from-transparent to-primary/40"></div>
          </div>
        </div>

        {/* Personal Details */}
        <div className="mb-6 overflow-hidden rounded-xl border border-purple-200/40 dark:border-purple-800/30 bg-gradient-to-br from-card via-purple-50/10 to-card dark:from-card dark:via-purple-950/10 dark:to-card shadow-lg hover:shadow-xl transition-shadow">
          <div className="bg-gradient-to-r from-purple-100/60 via-purple-200/40 to-purple-100/60 dark:from-purple-900/30 dark:via-purple-800/20 dark:to-purple-900/30 px-6 py-4 border-b border-border/50">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/50">
                <User className="w-5 h-5 text-purple-700 dark:text-purple-400" />
              </div>
              <h3 className="text-xl font-bold text-foreground">Personal Details</h3>
            </div>
          </div>
          <div className="p-6">
            <div className="grid md:grid-cols-2 gap-x-8 gap-y-3">
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted-foreground font-medium">Full Name</span>
                <span className="text-foreground font-semibold">{student.fullName || student.name}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted-foreground font-medium">Date of Birth</span>
                <span className="text-foreground font-semibold">{formatDate(student.dob)}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted-foreground font-medium">Email</span>
                <span className="text-foreground font-semibold truncate max-w-xs">{student.email}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted-foreground font-medium">Phone</span>
                <span className="text-foreground font-semibold">{student.phoneNumber || 'Not Available'}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted-foreground font-medium">Alternate Phone</span>
                <span className="text-foreground font-semibold">{student.alternatePhone || 'Not Available'}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted-foreground font-medium">Address</span>
                <span className="text-foreground font-semibold text-right">{student.address || 'Not Available'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Academic - Table Style */}
        <div className="mb-6 overflow-hidden rounded-xl border border-blue-200/40 dark:border-blue-800/30 bg-gradient-to-br from-card via-blue-50/10 to-card dark:from-card dark:via-blue-950/10 dark:to-card shadow-lg hover:shadow-xl transition-shadow">
          <div className="bg-gradient-to-r from-blue-100/60 via-blue-200/40 to-blue-100/60 dark:from-blue-900/30 dark:via-blue-800/20 dark:to-blue-900/30 px-6 py-4 border-b border-border/50">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/50">
                <School className="w-5 h-5 text-blue-700 dark:text-blue-400" />
              </div>
              <h3 className="text-xl font-bold text-foreground">Academic Profile</h3>
            </div>
          </div>
          <div>
            <div className="divide-y divide-border">
              <div className="grid md:grid-cols-3 gap-4 px-8 py-4 hover:bg-muted/30 transition-colors">
                <span className="text-muted-foreground font-medium">Enrollment ID</span>
                <span className="md:col-span-2 text-foreground font-semibold">{student.enrollmentId || 'Not provided'}</span>
              </div>
              <div className="grid md:grid-cols-3 gap-4 px-8 py-4 hover:bg-muted/30 transition-colors">
                <span className="text-muted-foreground font-medium">Faculty</span>
                <span className="md:col-span-2 text-foreground font-semibold">{student.faculty || 'Not provided'}</span>
              </div>
              <div className="grid md:grid-cols-3 gap-4 px-8 py-4 hover:bg-muted/30 transition-colors">
                <span className="text-muted-foreground font-medium">Department</span>
                <span className="md:col-span-2 text-foreground font-semibold">{student.department || 'Not provided'}</span>
              </div>
              <div className="grid md:grid-cols-3 gap-4 px-8 py-4 hover:bg-muted/30 transition-colors">
                <span className="text-muted-foreground font-medium">Semester</span>
                <span className="md:col-span-2 text-foreground font-semibold">{student.semester || 'Not provided'}</span>
              </div>
              <div className="grid md:grid-cols-3 gap-4 px-8 py-4 hover:bg-muted/30 transition-colors">
                <span className="text-muted-foreground font-medium">Session Period</span>
                <span className="md:col-span-2 text-foreground font-semibold">
                  {student.sessionStartYear && student.sessionEndYear ? `${student.sessionStartYear} - ${student.sessionEndYear}` : 'Not provided'}
                </span>
              </div>
              <div className="grid md:grid-cols-3 gap-4 px-8 py-4 hover:bg-muted/30 transition-colors">
                <span className="text-muted-foreground font-medium">Valid Until</span>
                <span className="md:col-span-2 text-foreground font-semibold">
                  {student.validUntil ? formatDate(student.validUntil) : 'Not provided'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Split Layout - Guardian & Transportation */}
        <div className="mb-8 grid lg:grid-cols-2 gap-6">
          {/* Guardian - Compact List */}
          <div className="overflow-hidden rounded-xl bg-gradient-to-br from-card via-orange-50/10 to-card dark:from-card dark:via-orange-950/10 dark:to-card border border-orange-200/40 dark:border-orange-800/30 shadow-md hover:shadow-xl transition-all">
            <div className="bg-gradient-to-r from-orange-100/60 via-orange-200/40 to-orange-100/60 dark:from-orange-900/30 dark:via-orange-800/20 dark:to-orange-900/30 px-4 py-3 border-b border-border/50">
              <div className="flex items-center gap-3">
                <div className="p-1.5 rounded-lg bg-orange-100 dark:bg-orange-900/50">
                  <Heart className="w-4 h-4 text-orange-700 dark:text-orange-400" />
                </div>
                <h3 className="text-base font-bold text-foreground">Guardian Contact</h3>
              </div>
            </div>
            <div className="p-4">
              <div className="space-y-2">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Parent Name</p>
                  <p className="text-sm font-bold text-foreground">{student.parentName || 'Not provided'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Parent Phone</p>
                  <p className="text-sm font-bold text-foreground">{student.parentPhone || 'Not provided'}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Transportation - Compact List */}
          <div className="overflow-hidden rounded-xl bg-gradient-to-br from-card via-green-50/10 to-card dark:from-card dark:via-green-950/10 dark:to-card border border-green-200/40 dark:border-green-800/30 shadow-md hover:shadow-xl transition-all">
            <div className="bg-gradient-to-r from-green-100/60 via-green-200/40 to-green-100/60 dark:from-green-900/30 dark:via-green-800/20 dark:to-green-900/30 px-4 py-3 border-b border-border/50">
              <div className="flex items-center gap-3">
                <div className="p-1.5 rounded-lg bg-green-100 dark:bg-green-900/50">
                  <Bus className="w-4 h-4 text-green-700 dark:text-green-400" />
                </div>
                <h3 className="text-base font-bold text-foreground">Transportation</h3>
              </div>
            </div>
            <div className="p-4">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Route</span>
                  <span className="text-sm font-bold text-foreground">{formatId(student.routeId)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Bus</span>
                  <span className="text-sm font-bold text-foreground">{formatId(student.busId)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Shift</span>
                  <span className="text-sm font-bold text-foreground capitalize">
                    {student.shift ? student.shift.charAt(0).toUpperCase() + student.shift.slice(1) : 'Not Assigned'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Pickup Point</span>
                  <span className="text-sm font-bold text-foreground text-right">{student.stopId.replace(student.stopId, student.stopId.charAt(0).toUpperCase() + student.stopId.slice(1)) || 'Not Assigned'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Student QR Code Section */}
        <div className="mb-6 w-full max-w-[calc(100vw-4rem)] md:max-w-full overflow-hidden rounded-xl border border-blue-500/20 dark:border-blue-500/10 bg-[#020817] shadow-2xl transition-all duration-300 mx-auto">
          <div className="bg-gradient-to-r from-blue-900/40 via-blue-800/20 to-blue-900/40 px-6 py-4 border-b border-blue-500/20">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/20 border border-blue-500/30">
                <QrCode className="w-5 h-5 text-blue-400" />
              </div>
              <h3 className="text-xl font-bold text-white">Student QR Code</h3>
            </div>
          </div>
          <div className="p-6">
            <div className="flex flex-col md:flex-row items-center gap-6">
              {/* QR Code Display */}
              <div className="relative">
                <div ref={qrRef} className="relative bg-white p-4 rounded-xl shadow-lg">
                  <QRCodeCanvas
                    value={id}
                    size={160}
                    level="H"
                    includeMargin={false}
                  />
                </div>
                {/* Corner decorations */}
                <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-blue-400 rounded-tl-lg"></div>
                <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-purple-400 rounded-tr-lg"></div>
                <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-purple-400 rounded-bl-lg"></div>
                <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-blue-400 rounded-br-lg"></div>
              </div>

              {/* QR Info & Actions */}
              <div className="flex-1 text-center md:text-left">
                <h4 className="text-lg font-bold text-white mb-1">{student.fullName || student.name}</h4>
                <p className="text-sm text-blue-400 font-mono mb-4">{student.enrollmentId || 'N/A'}</p>
                <p className="text-xs text-gray-400 mb-4">This QR code can be scanned to verify the student's bus pass.</p>

                <div className="flex flex-wrap gap-3 justify-center md:justify-start">
                  <Button
                    onClick={handleShareQR}
                    variant="outline"
                    className="h-9 gap-2 text-xs font-bold text-white/80 hover:text-white bg-white/5 hover:bg-white/10 border-white/10 rounded-xl transition-all"
                  >
                    <Share2 className="h-4 w-4" />
                    Share
                  </Button>
                  <Button
                    onClick={handleDownloadQR}
                    variant="outline"
                    className="h-9 gap-2 text-xs font-bold text-white/80 hover:text-white bg-white/5 hover:bg-white/10 border-white/10 rounded-xl transition-all"
                  >
                    <Download className="h-4 w-4" />
                    Download Pass
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Payment History Table */}
        <div className="mb-6 w-full max-w-[calc(100vw-4rem)] md:max-w-full overflow-hidden rounded-xl border border-emerald-500/20 dark:border-emerald-500/10 bg-[#020817] shadow-2xl transition-all duration-300 mx-auto">
          <div className="bg-gradient-to-r from-emerald-900/40 via-emerald-800/20 to-emerald-900/40 px-6 py-4 border-b border-emerald-500/20">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30">
                <Shield className="w-5 h-5 text-emerald-400" />
              </div>
              <h3 className="text-xl font-bold text-white">Payment History</h3>
            </div>
          </div>
          <div className="p-0 students-scroll-wrapper">
            {loadingPayments ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
              </div>
            ) : payments.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow className="h-10 bg-muted/30 hover:bg-muted/30 border-b border-border/50">
                    <TableHead className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider w-12 text-center whitespace-nowrap px-4 md:px-6 py-2">Sl. No</TableHead>
                    <TableHead className="text-xs font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap px-4 md:px-6 py-2">Session</TableHead>
                    <TableHead className="text-xs font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap px-4 md:px-6 py-2">Type</TableHead>
                    <TableHead className="text-xs font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap px-4 md:px-6 py-2">Amount</TableHead>
                    <TableHead className="text-xs font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap px-4 md:px-6 py-2">Date</TableHead>
                    <TableHead className="text-xs font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap px-4 md:px-6 py-2">Approved By</TableHead>
                    <TableHead className="text-xs font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap px-4 md:px-6 py-2">Status</TableHead>
                    <TableHead className="text-xs font-bold text-muted-foreground uppercase tracking-wider text-right whitespace-nowrap px-4 md:px-6 py-2">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((payment, idx) => (
                    <TableRow key={payment.id || idx} className="border-b border-border/50 hover:bg-emerald-500/5 transition-colors h-auto">
                      <TableCell className="text-center text-xs font-bold text-muted-foreground px-4 md:px-6 py-1.5">
                        {String(idx + 1).padStart(2, '0')}
                      </TableCell>
                      <TableCell className="px-4 md:px-6 py-1.5 whitespace-nowrap">
                        <div className="text-xs font-semibold text-foreground">
                          {payment.sessionStartYear} - {payment.sessionEndYear}
                        </div>
                        <div className="text-[10px] text-muted-foreground">Valid untill: {formatDate(payment.validUntil)}</div>
                      </TableCell>
                      <TableCell className="px-4 md:px-6 py-1.5 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold capitalize ${(payment.paymentMethod || payment.method)?.toLowerCase() === 'online'
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
                          }`}>
                          {payment.paymentMethod || payment.method || 'Unknown'}
                        </span>
                      </TableCell>
                      <TableCell className="px-4 md:px-6 py-1.5 whitespace-nowrap">
                        <div className="text-xs font-black text-foreground">₹{payment.amount}</div>
                      </TableCell>
                      <TableCell className="px-4 md:px-6 py-1.5 whitespace-nowrap">
                        <div className="text-xs text-foreground font-medium">{formatDate(payment.timestamp || payment.createdAt || payment.paid_on)}</div>
                      </TableCell>
                      <TableCell className="px-4 md:px-6 py-1.5 whitespace-nowrap">
                        <div className="text-xs font-semibold text-foreground">
                          {(payment.paymentMethod || payment.method)?.toLowerCase() === 'online'
                            ? 'ADTU Integrated ITMS'
                            : (payment.approvedBy?.name || payment.approvedBy || 'Manual')}
                        </div>

                      </TableCell>
                      <TableCell className="px-4 md:px-6 py-1.5 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                          <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 capitalize">{payment.status || 'Completed'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="px-4 md:px-6 py-1.5 whitespace-nowrap text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDownloadReceipt && handleDownloadReceipt(payment.paymentId || payment.id)}
                          disabled={downloadingReceiptId === (payment.paymentId || payment.id)}
                          className="h-8 gap-1.5 text-[10px] font-bold text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 px-3 transition-all w-auto disabled:opacity-70"
                        >
                          {downloadingReceiptId === (payment.paymentId || payment.id) ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Processing
                            </>
                          ) : (
                            <>
                              <Download className="h-3.5 w-3.5" />
                              Receipt
                            </>
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-10">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-muted mb-3">
                  <AlertCircle className="w-6 h-6 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">No payment history found for this student.</p>
              </div>
            )}
          </div>
        </div>

        {/* Admin Info - Minimal Footer Style */}
        <div className="relative overflow-hidden p-4 rounded-xl bg-gradient-to-r from-slate-100/50 via-slate-50 to-slate-100/50 dark:from-slate-900/30 dark:via-slate-950/20 dark:to-slate-900/30 border border-slate-200/50 dark:border-slate-700/40 shadow-md">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5"></div>
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Approved By</p>
              <p className="text-sm font-semibold text-foreground">{student.approvedBy || 'System'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Approved At</p>
              <p className="text-sm font-semibold text-foreground">{formatDate(student.approvedAt)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Created At</p>
              <p className="text-sm font-semibold text-foreground">{formatDate(student.createdAt)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Duration</p>
              <p className="text-sm font-semibold text-foreground">
                {student.sessionDuration ? `${student.sessionDuration} year(s)` : (student.sessionStartYear && student.sessionEndYear ? `${student.sessionEndYear - student.sessionStartYear} year(s)` : 'Not Set')}
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Delete Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md border-0 shadow-2xl rounded-3xl">
          <DialogHeader className="text-center">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-pink-500 shadow-2xl">
              <AlertCircle className="h-10 w-10 text-white" />
            </div>
            <DialogTitle className="text-2xl font-bold">Delete Student?</DialogTitle>
            <DialogDescription className="text-base mt-3">
              This will permanently delete <span className="font-semibold text-gray-900 dark:text-white">{student.name}</span> from the system. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-center gap-3 mt-4">
            <Button
              className="rounded-2xl px-6 bg-gray-100 hover:bg-gray-200 text-gray-900 dark:bg-gray-800 dark:hover:bg-gray-700"
              onClick={() => setIsDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="rounded-2xl px-6 bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600 text-white shadow-lg"
              onClick={confirmDelete}
            >
              Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
