"use client";

import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import { useAuth } from '@/contexts/auth-context';
import { Loader2 } from "lucide-react";
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function VerifyApplicationPage() {
  const { currentUser, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !currentUser) {
      router.push('/login');
    }
  }, [currentUser, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Verify Application</CardTitle>
            <CardDescription>Enter your verification code to complete the application</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-12">
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                Verification system is being loaded...
              </p>
              <p className="text-sm text-gray-500">
                Contact a moderator to get your verification code
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
