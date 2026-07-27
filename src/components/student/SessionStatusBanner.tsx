"use client";

import { Alert,AlertDescription,AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertTriangle,Clock,Info } from 'lucide-react';

interface SessionStatusBannerProps {
  validUntil?: string | Date | any;
  onRenewClick?: () => void;
}

export default function SessionStatusBanner({ validUntil, onRenewClick }: SessionStatusBannerProps) {
  if (!validUntil) return null;

  const expiryDate = validUntil?.toDate ? validUntil.toDate() : new Date(validUntil);
  const now = new Date();
  const daysRemaining = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  
  // Session expired
  if (daysRemaining < 0) {
    return (
      <Alert variant="destructive" className="border-2 border-red-500 bg-red-50 dark:bg-red-950/50">
        <AlertTriangle className="h-5 w-5" />
        <AlertTitle className="text-lg font-bold">Session Expired</AlertTitle>
        <AlertDescription className="mt-2">
          <p className="mb-3">
            Your bus service session expired on {expiryDate.toLocaleDateString()}. 
            You cannot generate bus passes until you renew your service.
          </p>
          {onRenewClick && (
            <Button onClick={onRenewClick} size="sm" className="bg-red-600 hover:bg-red-700">
              Renew Service
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  }
  
  // Expiring soon (within 7 days)
  if (daysRemaining <= 7) {
    return (
      <Alert className="border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/50">
        <Clock className="h-5 w-5 text-amber-600" />
        <AlertTitle className="text-lg font-bold text-amber-800 dark:text-amber-200">
          Session Expiring Soon
        </AlertTitle>
        <AlertDescription className="mt-2 text-amber-700 dark:text-amber-300">
          <p className="mb-3">
            Your bus service session will expire in {daysRemaining} day{daysRemaining !== 1 ? 's' : ''} 
            ({expiryDate.toLocaleDateString()}). Please renew your service to avoid interruption.
          </p>
          {onRenewClick && (
            <Button onClick={onRenewClick} size="sm" variant="outline" className="border-amber-600 text-amber-700 hover:bg-amber-100">
              Renew Now
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  }
  
  // Expiring in 30 days - info only
  if (daysRemaining <= 30) {
    return (
      <Alert className="border-2 border-blue-300 bg-blue-50 dark:bg-blue-950/50">
        <Info className="h-5 w-5 text-blue-600" />
        <AlertTitle className="text-lg font-bold text-blue-800 dark:text-blue-200">
          Session Active
        </AlertTitle>
        <AlertDescription className="mt-2 text-blue-700 dark:text-blue-300">
          Your bus service is active until {expiryDate.toLocaleDateString()} ({daysRemaining} days remaining).
        </AlertDescription>
      </Alert>
    );
  }

  // Session is fine, no banner needed
  return null;
}
