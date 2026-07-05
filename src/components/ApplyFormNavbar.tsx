"use client";

import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { User, Bus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/components/signout-button";
import { APP_NAME } from '@/config/runtime';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function ApplyFormNavbar() {
  const { currentUser, userData } = useAuth();
  const appName = APP_NAME;
  const router = useRouter();

  // Don't show navbar if user is not authenticated
  if (!currentUser) return null;

  const googleProvider = currentUser?.providerData?.find(p => p.providerId === 'google.com');
  const rawGoogleName = googleProvider?.displayName || currentUser?.displayName;
  const googleName = (rawGoogleName && !rawGoogleName.includes('@')) 
    ? rawGoogleName 
    : (userData?.name || "User");

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[#0c0e1a] border-b border-slate-800/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          {/* Logo and App Name - Left */}
          <div className="flex items-center space-x-2 sm:space-x-3">
            <Link href="/apply" className="flex items-center space-x-2 sm:space-x-3 hover:opacity-80 transition-opacity">
              <div className="bg-indigo-600 p-1.5 rounded-lg shadow-lg shadow-indigo-500/20">
                <Bus className="h-4 w-4 text-white" />
              </div>
              <span className="text-lg font-black tracking-tight bg-gradient-to-r from-white via-indigo-200 to-indigo-400 bg-clip-text text-transparent">
                {appName}
              </span>
            </Link>
          </div>

          {/* Right side - Profile */}
          <div className="flex items-center space-x-3 sm:space-x-4">
            {/* Profile Dropdown - Enhanced */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full hover:bg-accent transition-all duration-200 hover:scale-105"
                >
                  <User className="h-5 w-5 text-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel className="font-normal p-2">
                  <div className="flex items-center space-x-3">
                    <div className="w-9 h-9 bg-gradient-to-br from-orange-500 to-red-600 rounded-full flex items-center justify-center flex-shrink-0">
                      <User className="h-4 w-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                        {googleName}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {userData?.email || currentUser?.email}
                      </p>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 mt-1">
                        Applying for Bus Service
                      </span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="p-1">
                  <SignOutButton variant="ghost" size="sm" showText={true} />
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </nav>
  );
}
