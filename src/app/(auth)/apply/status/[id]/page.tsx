"use client";

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/contexts/toast-context';
import { Application } from '@/lib/types/application';
import {
	AlertCircle,
	ArrowRight,
	CheckCircle,
	Clock,
	FileText,
	Loader2
} from 'lucide-react';
import Link from 'next/link';
import { useParams,usePathname,useRouter } from 'next/navigation';
import { useEffect,useState } from 'react';

export default function ApplicationStatusPage() {
  const { currentUser, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const { showToast } = useToast();
  const applicationId = params?.id as string;

  const [application, setApplication] = useState<Application | null>(null);
  const [loadingApp, setLoadingApp] = useState(true);

  useEffect(() => {
    if (!loading) {
      if (!currentUser) {
        router.push('/login');
        return;
      }
      loadApplication();
    }
  }, [loading, currentUser, router, applicationId]);

  const loadApplication = async () => {
    try {
      const token = await currentUser?.getIdToken();
      if (!token) return;

      // Automatically trigger payment recovery on status load (Phase 4)
      try {
        const recRes = await fetch(`/api/payment/recover?studentUid=${applicationId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (recRes.ok) {
          const recData = await recRes.json();
          const { status } = recData;
          console.log(`[Status[id] Recovery] status=${status}`);
          // Only log — UI state is managed by PaymentModeSelector
        }
      } catch (recErr) {
        console.error('Failed to run payment recovery on status load:', recErr);
      }

      const response = await fetch(`/api/applications/${applicationId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setApplication(data.application);
      } else {
        showToast('Application not found', 'error');
        router.push('/apply');
      }
    } catch (error) {
      console.error('Error loading application:', error);
      showToast('Failed to load application', 'error');
    } finally {
      setLoadingApp(false);
    }
  };

  const getStatusIcon = (state: string) => {
    switch (state) {
      case 'approved':
        return <CheckCircle className="h-8 w-8 text-green-600" />;
      case 'verified_upcoming':
        return <Clock className="h-8 w-8 text-indigo-600" />;
      case 'pending_seat_allocation':
        return <AlertCircle className="h-8 w-8 text-amber-600" />;
      case 'submitted':
        return <Clock className="h-8 w-8 text-blue-600" />;
      case 'verified':
        return <CheckCircle className="h-8 w-8 text-blue-600" />;
      case 'awaiting_verification':
        return <Clock className="h-8 w-8 text-amber-600" />;
      case 'draft':
        return <FileText className="h-8 w-8 text-gray-600" />;
      default:
        return <AlertCircle className="h-8 w-8 text-gray-600" />;
    }
  };

  const getStatusMessage = (state: string) => {
    switch (state) {
      case 'approved':
        return {
          title: 'Application Approved!',
          message: 'Congratulations! Your bus service application has been approved. You can now access your student dashboard.',
          color: 'green'
        };
      case 'verified_upcoming':
        return {
          title: 'Verified — Awaiting New Academic Session',
          message: 'Your application has been verified and will become active when the new academic session begins.',
          color: 'indigo'
        };
      case 'pending_seat_allocation':
        return {
          title: 'Awaiting Seat Assignment',
          message: 'Your application has been approved and payment is verified, but all seats are currently occupied. You are in the Seat Allocation Queue and will be notified as soon as a seat becomes available.',
          color: 'amber'
        };
      case 'submitted':
        return {
          title: 'Under Review',
          message: 'Your application is being reviewed by administrators. This typically takes 2-3 business days.',
          color: 'blue'
        };
      case 'verified':
        return {
          title: 'Direct Submission Active',
          message: 'Your application has been processed. Please check your dashboard for updates.',
          color: 'blue'
        };
      case 'awaiting_verification':
        return {
          title: 'Processing',
          message: 'Your application is currently being processed by our system.',
          color: 'amber'
        };
      case 'draft':
        return {
          title: 'Draft Saved',
          message: 'Your application is saved as a draft. Complete and submit it to proceed.',
          color: 'gray'
        };
      default:
        return {
          title: 'Application Status',
          message: 'Processing your application...',
          color: 'gray'
        };
    }
  };

  if (loading || loadingApp) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!application) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Application Not Found</CardTitle>
          </CardHeader>
          <CardContent>
            <Link href="/apply">
              <Button className="w-full">Back to Applications</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const statusInfo = getStatusMessage(application.state);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Navigation Header for Unauth Users */}
        <div className="flex justify-center mb-6">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push('/apply/form')}
              className={pathname === '/apply/form' ? 'bg-blue-50 border-blue-200 text-blue-700' : ''}
            >
              Apply for Bus Service
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push('/apply/status')}
              className={pathname.includes('/apply/status') ? 'bg-blue-50 border-blue-200 text-blue-700' : ''}
            >
              Application Status
            </Button>
          </div>
        </div>

        {/* Status Header */}
        <Card className={`bg-${statusInfo.color}-50 dark:bg-${statusInfo.color}-950 border-${statusInfo.color}-200 dark:border-${statusInfo.color}-800`}>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              {getStatusIcon(application.state)}
              <div className="flex-1">
                <h2 className={`text-2xl font-bold text-${statusInfo.color}-900 dark:text-${statusInfo.color}-100`}>
                  {statusInfo.title}
                </h2>
                <p className={`text-${statusInfo.color}-700 dark:text-${statusInfo.color}-300 mt-1`}>
                  {statusInfo.message}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Application Details */}
        <Card className="bg-white dark:bg-gray-900">
          <CardHeader>
            <CardTitle>Application Details</CardTitle>
            <CardDescription>Application ID: {application.applicationId}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Status</p>
                <Badge variant="outline" className="mt-1 capitalize">
                  {application.state.replace('_', ' ')}
                </Badge>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Submitted</p>
                <p className="font-medium">
                  {application.submittedAt
                    ? new Date(application.submittedAt).toLocaleString()
                    : application.createdAt
                      ? new Date(application.createdAt).toLocaleString()
                      : 'N/A'
                  }
                </p>
              </div>
              {application.verifiedBy && (
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Verified By</p>
                  <p className="font-medium">{application.verifiedBy}</p>
                </div>
              )}
              {application.approvedBy && (
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Approved By</p>
                  <p className="font-medium">{application.approvedBy}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Timeline */}
        <Card className="bg-white dark:bg-gray-900">
          <CardHeader>
            <CardTitle>Application Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {application.stateHistory?.map((entry, index) => (
                <div key={index} className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                    <div className="w-3 h-3 bg-blue-600 rounded-full"></div>
                  </div>
                  <div className="flex-1 pb-4 border-b border-gray-200 dark:border-gray-800 last:border-0">
                    <p className="font-medium capitalize">
                      {entry.state.replace('_', ' ')}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {new Date(entry.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <Card className="bg-white dark:bg-gray-900">
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row gap-4">
              {application.state === 'draft' && (
                <Link href="/apply/form" className="flex-1">
                  <Button className="w-full">
                    Continue Application
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </Link>
              )}
              {application.state === 'approved' && (
                <Link href="/student" className="flex-1">
                  <Button className="w-full bg-green-600 hover:bg-green-700">
                    Go to Dashboard
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </Link>
              )}

              <Link href="/contact" className="flex-1">
                <Button variant="outline" className="w-full">
                  Contact Bus Office
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

