"use client";

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, Mail, Phone, XCircle, LogOut } from 'lucide-react';

interface UniversalAccessBlockScreenProps {
  userData: any;
  onLogout?: () => void;
  reason?: string;
}

/**
 * Universal Access Block Screen
 * Rendered natively in normal page flow when access is revoked/suspended.
 * - Zero backdrop-blur filters (100% lag-free)
 * - Standard native theme background (bg-background)
 * - Clean, professional layout with exact typography and styling
 */
export default function UniversalAccessBlockScreen({
  userData,
  onLogout,
  reason,
}: UniversalAccessBlockScreenProps) {
  const userName = userData?.fullName || userData?.name || 'User';
  const roleName = (userData?.role || 'user').toUpperCase();
  const statusName = (userData?.status || 'suspended').toUpperCase();

  return (
    <div className="min-h-dvh w-full bg-background flex items-center justify-center p-4 sm:p-6">
      <Card className="max-w-lg w-full border border-red-800/50 shadow-lg flex flex-col bg-zinc-900 text-zinc-100 rounded-2xl overflow-hidden">
        {/* Header Bar */}
        <CardHeader className="bg-red-950/30 border-b border-red-800/40 py-4 px-5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-red-500 shrink-0">
              <XCircle className="h-6 w-6 text-white" />
            </div>
            <div>
              <CardTitle className="text-xl font-bold text-red-400 tracking-tight">
                Access Revoked
              </CardTitle>
              <CardDescription className="text-zinc-300 text-xs mt-0.5">
                {roleName} Account • Status: <span className="text-red-400 font-semibold">{statusName}</span>
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-5 space-y-4">
          {/* Main Notice Box */}
          <div className="p-4 rounded-lg border bg-amber-950/30 border-amber-800/40 text-amber-200">
            <div className="flex gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 text-xs sm:text-sm leading-relaxed">
                <p className="font-semibold text-zinc-100 mb-1.5">
                  Dear {userName},
                </p>
                <p className="text-zinc-300 text-xs sm:text-sm">
                  {reason ||
                    `Your ${userData?.role || 'user'} access to the AdtU Transit Management System has been temporarily revoked or suspended by the administrator. You are not authorized to view or access application features.`}
                </p>
              </div>
            </div>
          </div>

          {/* Contact Admin Office */}
          <div className="p-4 bg-blue-950/20 border border-blue-800/40 rounded-lg space-y-2.5">
            <h3 className="font-semibold text-xs text-blue-200">
              Contact Admin Office
            </h3>
            <p className="text-xs text-blue-300/80 leading-relaxed">
              If you believe this revocation is in error or require reinstatement, please contact the Central ITMS Administration Office:
            </p>
            <div className="pt-1 space-y-2 text-xs text-blue-300">
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-blue-400 shrink-0" />
                <span>Transport Cell: +91 361 289 5030</span>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-blue-400 shrink-0" />
                <span>Email: transport@adtu.in</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="pt-2">
            {onLogout && (
              <Button
                onClick={onLogout}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-2.5 rounded-xl shadow-md transition-colors flex items-center justify-center gap-2 cursor-pointer text-xs sm:text-sm"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out of Account</span>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
