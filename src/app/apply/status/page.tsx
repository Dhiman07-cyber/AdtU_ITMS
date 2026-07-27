"use client";

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card,CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/contexts/toast-context';
import {
	AlertCircle,
	ArrowRight,
	CheckCircle,
	Clock,
	FileText,
	Loader2,
	XCircle
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect,useState } from 'react';

export default function ApplicationStatusPage() {
  const { currentUser, loading } = useAuth();
  const router = useRouter();
  const { showToast } = useToast();
  const [applicationStatus, setApplicationStatus] = useState<any | null>(null);
  const [loadingApp, setLoadingApp] = useState(true);

  useEffect(() => {
    if (!loading && !currentUser) {
      router.push('/login');
      return;
    }

    if (currentUser) {
      loadApplication();
    }
  }, [loading, currentUser, router]);

  const loadApplication = async () => {
    try {
      const token = await currentUser?.getIdToken();
      if (!token) return;

      // Automatically trigger payment recovery on status load (Phase 4)
      try {
        const recRes = await fetch('/api/payment/recover', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (recRes.ok) {
          const recData = await recRes.json();
          const { status } = recData;
          console.log(`[Status Page Recovery] status=${status}`);
          // Only log — UI state is managed by PaymentModeSelector
        }
      } catch (recErr) {
        console.error('Failed to run payment recovery on status load:', recErr);
      }

      const response = await fetch('/api/applications/my-status', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setApplicationStatus(data);
      }
    } catch (error) {
      console.error('Error loading application:', error);
    } finally {
      setLoadingApp(false);
    }
  };

  if (loading || loadingApp) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Navigation Header */}
        <div className="flex justify-center mb-6">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push('/apply/form')}
              disabled={applicationStatus?.status === 'pending' || applicationStatus?.status === 'approved'}
            >
              Apply for Bus Service
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="bg-blue-50 border-blue-200 text-blue-700"
            >
              Application Status
            </Button>
          </div>
        </div>

        {/* Status Cards */}
        {applicationStatus?.status === 'no_application' && (
          <Card className="bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <AlertCircle className="h-12 w-12 text-gray-600" />
                <div className="flex-1">
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                    No Application Found
                  </h2>
                  <p className="text-gray-600 dark:text-gray-400 mb-4">
                    You haven't submitted an application yet. Start your bus service application to track its status.
                  </p>
                  <Button 
                    onClick={() => router.push('/apply/form')}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    Start Application
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {applicationStatus?.status === 'pending' && (
          <Card className="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <Clock className="h-12 w-12 text-blue-600" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h2 className="text-2xl font-bold text-blue-900 dark:text-blue-100">
                      Application Pending
                    </h2>
                    <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-300">
                      Under Review
                    </Badge>
                  </div>
                  <p className="text-blue-700 dark:text-blue-300 mb-2 font-medium">
                    Application successfully submitted and under review by our administration team.
                  </p>
                  <p className="text-sm text-blue-600 dark:text-blue-400">
                    Submitted on: {applicationStatus.submittedAt ? new Date(applicationStatus.submittedAt).toLocaleString() : 'N/A'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {applicationStatus?.status === 'approved' && (
          <Card className="bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <CheckCircle className="h-12 w-12 text-green-600" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h2 className="text-2xl font-bold text-green-900 dark:text-green-100">
                      Application Approved! 🎉
                    </h2>
                    <Badge className="bg-green-600 text-white">
                      Approved
                    </Badge>
                  </div>
                  <p className="text-green-700 dark:text-green-300 mb-4 font-medium">
                    Congratulations! Your application has been approved. You now have full access to your student account.
                  </p>
                  <Button 
                    onClick={() => router.push('/student')}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    Go to Dashboard
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {applicationStatus?.status === 'rejected' && (
          <Card className="bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <XCircle className="h-12 w-12 text-red-600" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h2 className="text-2xl font-bold text-red-900 dark:text-red-100">
                      Application Rejected
                    </h2>
                    <Badge variant="destructive">
                      Rejected
                    </Badge>
                  </div>
                  <p className="text-red-700 dark:text-red-300 mb-2">
                    Unfortunately, your application has been rejected.
                  </p>
                  {applicationStatus.rejectionReason && (
                    <div className="bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg p-4 mb-4">
                      <p className="font-semibold text-red-900 dark:text-red-100 mb-1">Reason:</p>
                      <p className="text-red-800 dark:text-red-200">{applicationStatus.rejectionReason}</p>
                    </div>
                  )}
                  {applicationStatus.rejectedBy && (
                    <p className="text-sm text-red-600 dark:text-red-400 mb-4">
                      Rejected by: {applicationStatus.rejectedBy} on {new Date(applicationStatus.rejectedAt).toLocaleString()}
                    </p>
                  )}
                  <Button 
                    onClick={() => router.push('/apply/form')}
                    className="bg-red-600 hover:bg-red-700 text-white"
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    Apply Again
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}












