"use client";

import { Button } from '@/components/ui/button';
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/contexts/toast-context';
import { IndianRupee,Loader2,Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect,useState } from 'react';

export default function AdminSettingsPage() {
  const { currentUser, userData, loading } = useAuth();
  const { showToast } = useToast();
  const router = useRouter();

  const [busFees, setBusFees] = useState<number>(0);
  const [loadingFees, setLoadingFees] = useState(true);
  const [savingFees, setSavingFees] = useState(false);

  useEffect(() => {
    if (!loading && !currentUser) {
      router.push('/login');
      return;
    }

    if (userData && userData.role !== 'admin') {
      router.push(`/${userData.role}`);
      return;
    }

    if (currentUser && userData?.role === 'admin') {
      loadBusFees();
    }
  }, [loading, currentUser, userData, router]);

  const loadBusFees = async () => {
    try {
      const response = await fetch('/api/settings/bus-fees');
      if (response.ok) {
        const data = await response.json();
        if (typeof data.fees === 'number' || typeof data.amount === 'number') {
          setBusFees(data.fees ?? data.amount);
        } else {
          showToast('Bus fee configuration missing in database', 'error');
        }
      }
    } catch (error) {
      console.error('Error loading bus fees:', error);
      showToast('Failed to load bus fees', 'error');
    } finally {
      setLoadingFees(false);
    }
  };

  const handleUpdateFees = async () => {
    if (busFees <= 0) {
      showToast('Please enter a valid amount', 'error');
      return;
    }

    setSavingFees(true);
    try {
      const token = await currentUser?.getIdToken();
      const response = await fetch('/api/settings/bus-fees', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ amount: busFees })
      });

      if (response.ok) {
        showToast('Bus fees updated successfully! All active users have been notified.', 'success');
      } else {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to update bus fees');
      }
    } catch (error: any) {
      console.error('Error updating bus fees:', error);
      showToast(error.message || 'Failed to update bus fees', 'error');
    } finally {
      setSavingFees(false);
    }
  };

  if (loading && !currentUser) {
    return (
      <div className="itms-admin-container space-y-6 animate-pulse">
        <div className="h-10 w-64 bg-slate-200 dark:bg-zinc-800 rounded-md" />
        <div className="h-64 bg-slate-100 dark:bg-zinc-900 rounded-xl border border-slate-200 dark:border-zinc-800" />
      </div>
    );
  }

  return (
    <div className="itms-admin-container space-y-6">
      <div className="itms-page-header-container mb-6">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-foreground leading-tight pb-1">System Settings</h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          Manage global system configurations
        </p>
      </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <IndianRupee className="h-5 w-5" />
              Bus Fees Configuration
            </CardTitle>
            <CardDescription>
              Set the default bus fees for all students. Changing this will notify all active users.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="busFees" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Bus Fees Amount (₹) *
              </Label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">₹</span>
                  <Input
                    id="busFees"
                    type="number"
                    value={busFees}
                    onChange={(e) => setBusFees(parseInt(e.target.value) || 0)}
                    min="0"
                    step="100"
                    className="pl-8"
                    placeholder="Enter bus fees amount"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                This is the base fee per year. Actual fees may vary based on shift selection.
              </p>
            </div>

            <div className="p-4 bg-amber-50 dark:bg-amber-950 rounded-lg">
              <p className="text-sm text-amber-900 dark:text-amber-100">
                <strong>Note:</strong> Updating the bus fees will:
              </p>
              <ul className="list-disc list-inside text-sm text-amber-800 dark:text-amber-200 mt-2 space-y-1">
                <li>Apply to all new applications immediately</li>
                <li>Send notifications to all active students, drivers, and moderators</li>
                <li>Update the default amount in application forms</li>
              </ul>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={handleUpdateFees}
                disabled={savingFees || busFees <= 0}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {savingFees ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Updating...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Update Bus Fees
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Additional Settings Can Be Added Here */}
        <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
          <p className="text-sm text-blue-900 dark:text-blue-100">
            <strong>Current Configuration:</strong>
          </p>
          <div className="mt-2 space-y-1 text-sm text-blue-800 dark:text-blue-200">
            <p>• Base Bus Fees: ₹{busFees.toLocaleString('en-IN')}</p>
            <p>• Morning/Evening Shift: ₹{busFees.toLocaleString('en-IN')}</p>
            <p>• Both Shifts: ₹{(busFees * 1.5).toLocaleString('en-IN')} (1.5x)</p>
          </div>
        </div>
    </div>
  );
}
