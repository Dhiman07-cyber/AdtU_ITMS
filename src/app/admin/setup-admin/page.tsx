"use client";

import { Alert,AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/auth-context';
import { CheckCircle,Loader2,UserPlus,XCircle } from 'lucide-react';
import { useState } from 'react';

export default function SetupAdminPage() {
  const { currentUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSetup = async () => {
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      if (!currentUser) {
        setError('No user logged in. Please login first.');
        setLoading(false);
        return;
      }

      // Get the ID token
      const token = await currentUser.getIdToken();

      // Call the API
      const response = await fetch('/api/setup-admin-document', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setResult(data);
      } else {
        setError(data.error || 'Failed to create admin document');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-12 container mx-auto p-6 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-6 w-6" />
            Setup Admin Document
          </CardTitle>
          <CardDescription>
            Create your admin document in Firestore to enable full admin access
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Current User Info */}
          {currentUser && (
            <Alert>
              <AlertDescription>
                <strong>Current User:</strong> {currentUser.email}
              </AlertDescription>
            </Alert>
          )}

          {/* Setup Button */}
          <Button
            onClick={handleSetup}
            disabled={loading || !currentUser}
            className="w-full"
            size="lg"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating Admin Document...
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4 mr-2" />
                Create Admin Document
              </>
            )}
          </Button>

          {/* Success Result */}
          {result && (
            <Alert className="border-green-500 bg-green-50 dark:bg-green-900/20">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800 dark:text-green-200">
                <div className="space-y-2">
                  <p className="font-semibold">✅ Success! Admin document created!</p>
                  <div className="text-sm">
                    <p><strong>Admin ID:</strong> {result.adminId}</p>
                    <p><strong>Message:</strong> {result.message}</p>
                  </div>
                  <div className="mt-4 p-3 bg-white dark:bg-gray-800 rounded border">
                    <p className="font-semibold mb-2">Next Steps:</p>
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li>Logout from your account</li>
                      <li>Login again</li>
                      <li>Visit <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">/admin/feedback</code></li>
                      <li>You should now have full access! 🎉</li>
                    </ol>
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Error Result */}
          {error && (
            <Alert className="border-red-500 bg-red-50 dark:bg-red-900/20">
              <XCircle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-800 dark:text-red-200">
                <div className="space-y-2">
                  <p className="font-semibold">❌ Error</p>
                  <p className="text-sm">{error}</p>
                  
                  {error.includes('User document not found') && (
                    <div className="mt-3 p-3 bg-white dark:bg-gray-800 rounded border text-sm">
                      <p className="font-semibold mb-1">Solution:</p>
                      <p>Make sure you have a document in the <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">users</code> collection with:</p>
                      <ul className="list-disc list-inside mt-2 space-y-1">
                        <li>Document ID = your Firebase UID</li>
                        <li>Field: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">role</code> = "admin"</li>
                      </ul>
                    </div>
                  )}

                  {error.includes('not "admin"') && (
                    <div className="mt-3 p-3 bg-white dark:bg-gray-800 rounded border text-sm">
                      <p className="font-semibold mb-1">Solution:</p>
                      <p>Update your role to "admin" in the <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">users</code> collection in Firestore.</p>
                    </div>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Instructions */}
          <div className="text-sm text-gray-600 dark:text-gray-400 space-y-2 border-t pt-4">
            <p className="font-semibold">What does this do?</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Creates an admin document in the <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">admins</code> collection</li>
              <li>Uses your existing data from the <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">users</code> collection</li>
              <li>Enables access to admin-only pages like feedback</li>
              <li>Only works if you have role="admin" in users collection</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
