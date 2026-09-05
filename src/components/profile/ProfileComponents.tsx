"use client";

import { PremiumPageLoader } from '@/components/LoadingSpinner';
import { Avatar,AvatarFallback,AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { safeImageSrc } from '@/lib/security/url-sanitizer';
import { LucideIcon } from 'lucide-react';
import { ReactNode } from 'react';

/**
 * InfoRow - Display label and value in a consistent format
 */
interface InfoRowProps {
  label: string;
  value: string | number | ReactNode;
  icon?: LucideIcon;
  valueClassName?: string;
}

export function InfoRow({ label, value, icon: Icon, valueClassName }: InfoRowProps) {
  return (
    <div className="py-2 border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
      <div className="flex items-center gap-1.5 sm:gap-2 mb-1">
        {Icon && <Icon className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-blue-500 dark:text-blue-400" />}
        <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <div className={`text-xs sm:text-sm font-semibold text-gray-900 dark:text-gray-100 pl-4 sm:pl-5 ${valueClassName || ''}`}>
        {value || 'Not provided'}
      </div>
    </div>
  );
}

/**
 * ProfileSectionCard - Wrapper for profile sections
 */
interface ProfileSectionCardProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}

export function ProfileSectionCard({
  title,
  description,
  icon: Icon,
  children,
  className = ''
}: ProfileSectionCardProps) {
  return (
    <Card className={`shadow-sm hover:shadow-md transition-shadow overflow-hidden ${className}`}>
      <CardHeader className="pb-2 sm:pb-3 bg-gradient-to-r from-gray-50 to-blue-50 dark:from-gray-800 dark:to-blue-900/20 border-b border-gray-200 dark:border-gray-700 p-3 sm:p-4">
        <div className="flex items-center gap-1.5 sm:gap-2">
          {Icon && <Icon className="h-4 w-4 sm:h-4 sm:w-4 text-primary" />}
          <div>
            <CardTitle className="text-sm sm:text-base">{title}</CardTitle>
            {description && (
              <CardDescription className="text-[10px] sm:text-xs mt-0.5">{description}</CardDescription>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 sm:p-4 pt-3">
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * ProfileHeaderCard - Main profile header with avatar and quick stats
 */
interface QuickStat {
  label: string;
  value: string | ReactNode;
  icon?: LucideIcon;
}

interface ProfileHeaderCardProps {
  name: string;
  role: string;
  email: string;
  profilePhotoUrl?: string;
  roleBadgeColor?: string;
  quickStats?: QuickStat[];
  actions?: ReactNode;
  statusBadge?: ReactNode;
  employeeId?: string;
  shift?: string;
}

export function ProfileHeaderCard({
  name,
  role,
  email,
  profilePhotoUrl,
  roleBadgeColor = 'bg-blue-600',
  quickStats = [],
  actions,
  statusBadge,
  employeeId,
  shift,
}: ProfileHeaderCardProps) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <Card className="group relative overflow-hidden border-0 shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-[1.01] bg-white dark:bg-gray-900">
      {/* Mobile Layout */}
      <div className="md:hidden block">
        {/* Banner Gradient - Cover Style */}
        <div className="h-24 bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 relative -mx-6 -mt-6">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-700/90 via-purple-700/90 to-pink-700/90" />
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-white/5" />
        </div>

        {/* Profile Content - Overlapping Banner */}
        <div className="relative -mt-12 px-4 pb-6 flex flex-col items-center">
          {/* Avatar Area */}
          <div className="relative mb-3">
            {/* Glow effect */}
            <div className="absolute inset-0 bg-gradient-to-r from-blue-400/30 via-purple-400/30 to-pink-400/30 rounded-full blur-lg scale-110"></div>

            <Avatar className="relative h-24 w-24 border-4 border-white dark:border-gray-900 shadow-2xl">
              <AvatarImage
                src={safeImageSrc(profilePhotoUrl)}
                alt={name}
                className="object-cover"
                style={{ objectFit: 'cover' }}
              />
              <AvatarFallback className="text-2xl font-bold bg-gradient-to-br from-blue-600 to-purple-600 text-white">
                {initials}
              </AvatarFallback>
            </Avatar>

            {/* Role Badge - Centered below avatar */}
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 z-10 w-full flex justify-center">
              <Badge className="bg-purple-600 hover:bg-purple-700 text-white border-2 border-white dark:border-gray-900 shadow-md text-xs font-medium px-3 py-0.5 rounded-full whitespace-nowrap">
                {role.charAt(0).toUpperCase() + role.slice(1)}
              </Badge>
            </div>
          </div>

          {/* Name */}
          <h1 className="text-xl font-bold text-gray-900 dark:text-white mt-3 mb-5 text-center tracking-tight">
            {name}
          </h1>

          {/* Info Boxes: Employee ID & Shift */}
          <div className="grid grid-cols-2 gap-3 w-full">
            {/* Employee ID Card */}
            <div className="group/card relative overflow-hidden bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-900/20 dark:to-blue-950/10 rounded-xl p-3 border border-blue-100 dark:border-blue-900/40">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></div>
                <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">Employee ID</span>
              </div>
              <p className="text-sm font-bold text-gray-900 dark:text-gray-100 font-mono pl-3.5">
                {employeeId || 'N/A'}
              </p>
            </div>

            {/* Shift Card */}
            <div className="group/card relative overflow-hidden bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-900/20 dark:to-purple-950/10 rounded-xl p-3 border border-purple-100 dark:border-purple-900/40">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-pulse"></div>
                <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider">Shift</span>
              </div>
              <p className="text-sm font-bold text-gray-900 dark:text-gray-100 pl-3.5 truncate">
                {shift || 'N/A'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Desktop Layout - Horizontal (Preserved) */}
      <div className="hidden md:block bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 relative -m-6 mb-0">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-700/90 via-purple-700/90 to-pink-700/90" />
        <div className="relative p-6 pt-8 flex items-center gap-6">
          {/* Avatar */}
          <div className="relative ml-6">
            <Avatar className="h-24 w-24 border-4 border-white/30 shadow-xl">
              <AvatarImage
                src={safeImageSrc(profilePhotoUrl)}
                alt={name}
                className="object-cover"
                style={{ objectFit: 'cover' }}
              />
              <AvatarFallback className="text-2xl bg-gradient-to-br from-white/20 to-white/10 text-white">
                {initials}
              </AvatarFallback>
            </Avatar>
            {statusBadge && (
              <div className="absolute bottom-0 right-0">
                {statusBadge}
              </div>
            )}
          </div>

          {/* Name and Role */}
          <div className="flex-1 ml-4">
            <h1 className="text-3xl font-bold text-white">
              {name}
            </h1>
            <p className="text-base text-white/90 mt-1">{email}</p>
            <div className="flex gap-2 mt-2">
              <Badge className="bg-white/20 text-white border-white/30 backdrop-blur-sm">
                {role.charAt(0).toUpperCase() + role.slice(1)}
              </Badge>
            </div>
          </div>

          {/* Actions */}
          {actions && (
            <div className="flex gap-2 flex-wrap justify-end mr-6">
              {actions}
            </div>
          )}
        </div>
      </div>

      <CardContent className="p-4 sm:p-6 hidden md:block">
        {/* Quick Stats - Desktop Only */}
        {quickStats.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {quickStats.map((stat, index) => (
              <div key={index} className="text-center sm:text-left p-2 sm:p-3 bg-gradient-to-r from-gray-50 to-blue-50 dark:from-gray-800 dark:to-blue-900/20 rounded-lg border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow">
                <div className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm text-muted-foreground mb-1 justify-center sm:justify-start">
                  {stat.icon && <stat.icon className="h-3 w-3 sm:h-4 sm:w-4" />}
                  <span className="truncate">{stat.label}</span>
                </div>
                <div className="text-sm sm:text-base lg:text-lg font-semibold text-gray-900 dark:text-white truncate">
                  {stat.value}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * ProfileShell - Loading and error states
 */
interface ProfileShellProps {
  loading: boolean;
  error: string | null;
  notFound: boolean;
  children: ReactNode;
}

export function ProfileShell({ loading, error, notFound, children }: ProfileShellProps) {
  if (loading) {
    return <PremiumPageLoader message="Loading Profile..." subMessage="Fetching profile details..." />;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-red-600">Error Loading Profile</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => window.location.reload()}>
              Reload Page
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Profile Not Found</CardTitle>
            <CardDescription>
              The requested profile could not be found. Please check the URL or contact support.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => window.history.back()}>
              Go Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * ActionButtons - Permission-aware action buttons
 */
interface ActionButtonsProps {
  currentUserRole: 'admin' | 'moderator' | 'driver' | 'student';
  targetRole: 'admin' | 'moderator' | 'driver' | 'student';
  onEdit?: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  onAssignBus?: () => void;
  onGenerateQR?: () => void;
  onRevokeQR?: () => void;
  status?: string;
}

export function ActionButtons({
  currentUserRole,
  targetRole,
  onEdit,
  onApprove,
  onReject,
  onAssignBus,
  onGenerateQR,
  onRevokeQR,
  status,
}: ActionButtonsProps) {
  const canEdit = currentUserRole === 'admin' ||
    (currentUserRole === 'moderator' && targetRole !== 'admin' && targetRole !== 'moderator') ||
    currentUserRole === targetRole;

  const canApprove = (currentUserRole === 'admin' || currentUserRole === 'moderator') &&
    status === 'pending';

  const canAssignBus = (currentUserRole === 'admin' || currentUserRole === 'moderator') &&
    targetRole === 'student';

  const canGenerateQR = targetRole === 'student' && status === 'active';

  return (
    <div className="flex gap-2 flex-wrap">
      {canEdit && onEdit && (
        <Button onClick={onEdit} variant="outline" size="sm">
          Edit Profile
        </Button>
      )}
      {canApprove && onApprove && (
        <Button onClick={onApprove} size="sm" className="bg-green-600 hover:bg-green-700">
          Approve
        </Button>
      )}
      {canApprove && onReject && (
        <Button onClick={onReject} size="sm" variant="destructive">
          Reject
        </Button>
      )}
      {canAssignBus && onAssignBus && (
        <Button onClick={onAssignBus} size="sm" variant="secondary">
          Assign Bus
        </Button>
      )}
      {canGenerateQR && onGenerateQR && (
        <Button onClick={onGenerateQR} size="sm" className="bg-blue-600 hover:bg-blue-700">
          Generate QR
        </Button>
      )}
      {canGenerateQR && onRevokeQR && (
        <Button onClick={onRevokeQR} size="sm" variant="outline">
          Revoke QR
        </Button>
      )}
    </div>
  );
}
