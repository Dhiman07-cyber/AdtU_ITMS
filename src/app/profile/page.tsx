"use client";

import { useAuth } from "@/contexts/auth-context";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function ProfileRedirect() {
  const { currentUser, userData, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    if (!currentUser) {
      router.replace('/login');
      return;
    }

    if (userData?.role) {
      router.replace(`/${userData.role}/profile`);
    }
  }, [currentUser, userData, loading, router]);

  return (
    <div className="flex-1 min-h-[calc(100dvh-120px)] flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="text-center">
        <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto mb-4" />
        <p className="text-gray-600 dark:text-gray-400">Redirecting to your profile...</p>
      </div>
    </div>
  );
}
