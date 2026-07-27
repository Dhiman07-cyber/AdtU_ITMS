"use client";

import { Alert,AlertDescription,AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card,CardContent,CardDescription,CardFooter,CardHeader,CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/auth-context';
import { AlertCircle,CheckCircle,Info } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect,useState } from 'react';

export default function SetupAdminPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; error?: string; message?: string; instructions?: any } | null>(null);
  const { currentUser, signInWithGoogle, userData } = useAuth();
  const router = useRouter();

  // If user is already authenticated and is an admin, redirect to admin dashboard
  // Also redirect if this is not the first user (first admin already created)
  useEffect(() => {
    if (currentUser && userData && userData.role === "admin") {
      router.push("/admin");
      return;
    }
    
    // Check if first admin already exists
    const checkIfFirstUser = async () => {
      try {
        const response = await fetch("/api/check-first-user");
        if (response.ok) {
          const data = await response.json();
          // If not the first user and no admin is logged in, redirect to login
          if (!data.isFirstUser && !userData) {
            router.push("/login");
          }
        }
      } catch (error) {
        console.error("Error checking if first user:", error);
      }
    };
    
    checkIfFirstUser();
  }, [currentUser, userData, router]);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setResult(null);
    
    try {
      const response = await signInWithGoogle();
      
      if (response.success && response.user) {
        // Check if this is the first user (no users exist in the system)
        try {
          const checkResponse = await fetch("/api/check-first-user");
          
          if (checkResponse.ok) {
            const data = await checkResponse.json();
            
            if (data.isFirstUser) {
              // This is the first user, make them admin
              const adminResponse = await fetch("/api/create-first-admin", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ 
                  uid: response.user.uid,
                  email: response.user.email,
                  name: response.user.displayName || "Admin User"
                }),
              });
              
              const adminData = await adminResponse.json();
              
              if (adminData.success) {
                setResult({ 
                  success: true, 
                  message: "First admin account created successfully! Redirecting to admin dashboard..." 
                });
                
                // Redirect to admin dashboard after a short delay
                setTimeout(() => {
                  router.push("/admin");
                }, 3000);
              } else {
                setResult({ 
                  success: false, 
                  error: adminData.error || "Failed to create admin account",
                  instructions: adminData.instructions
                });
              }
            } else {
              // Not the first user, check if they're already an admin
              setResult({ 
                success: true, 
                message: "Signed in successfully! Redirecting to your dashboard..." 
              });
              
              // Redirect based on their role
              setTimeout(() => {
                // For now, we'll redirect to admin, but in a real app you'd check their actual role
                router.push("/admin");
              }, 3000);
            }
          } else {
            const errorText = await checkResponse.text();
            setResult({ success: false, error: `Failed to check if this is the first user: ${errorText}` });
          }
        } catch (checkError: any) {
          console.error("Error checking first user:", checkError);
          setResult({ success: false, error: `Failed to check if this is the first user: ${checkError.message}` });
        }
      } else {
        setResult({ success: false, error: response.error || "Failed to sign in with Google" });
      }
    } catch (error: any) {
      console.error("Sign in error:", error);
      setResult({ success: false, error: `Sign in failed: ${error.message}` });
    } finally {
      setLoading(false);
    }
  };

  // Verify Firestore rules directly
  const verifyFirestoreRules = async () => {
    setLoading(true);
    setResult(null);
    
    try {
      const response = await fetch("/api/test-rules");
      const data = await response.json();
      
      if (data.success) {
        setResult({ 
          success: true, 
          message: "Firestore rules verification successful! The firstAdmin field is working correctly." 
        });
      } else {
        setResult({ 
          success: false, 
          error: data.error || "Firestore rules verification failed" 
        });
      }
    } catch (error: any) {
      setResult({ 
        success: false, 
        error: `Verification failed: ${error.message}` 
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50 dark:bg-gray-900">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Setup First Admin</CardTitle>
          <CardDescription>
            Sign in with Google to create your first administrator account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-blue-50 dark:bg-blue-900 p-4 rounded-lg mb-6">
            <p className="text-sm">
              <strong>Important:</strong> This is for creating your first admin user using Google authentication. 
              After that, admins can invite other users through the admin dashboard.
            </p>
          </div>
          
          <Button 
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full mb-4"
          >
            {loading ? "Creating Admin..." : "Sign in with Google to Create Admin"}
          </Button>
          
          <Button 
            onClick={verifyFirestoreRules}
            disabled={loading}
            variant="outline"
            className="w-full mb-6"
          >
            {loading ? "Verifying Rules..." : "Verify Firestore Rules"}
          </Button>
          
          {result && (
            <Alert className={`mt-4 ${result.success ? "bg-green-100 dark:bg-green-900 border-green-500" : "bg-red-100 dark:bg-red-900 border-red-500"}`}>
              {result.success ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <AlertCircle className="h-4 w-4 text-red-500" />
              )}
              <AlertTitle>{result.success ? "Success" : "Error"}</AlertTitle>
              <AlertDescription>
                {result.success ? result.message : result.error}
              </AlertDescription>
            </Alert>
          )}
          
          {result && result.instructions && (
            <Alert className="mt-4 bg-yellow-100 dark:bg-yellow-900 border-yellow-500">
              <Info className="h-4 w-4 text-yellow-500" />
              <AlertTitle>Firestore Security Rules Update Required</AlertTitle>
              <AlertDescription>
                <ol className="list-decimal pl-5 space-y-2 mt-2">
                  <li>{result.instructions.step1}</li>
                  <li>{result.instructions.step2}</li>
                  <li>{result.instructions.step3}</li>
                  <li>{result.instructions.step4}</li>
                  <li>{result.instructions.step5}</li>
                </ol>
              </AlertDescription>
            </Alert>
          )}
          
          {!result?.success && !result?.instructions && (
            <Alert className="mt-4 bg-yellow-100 dark:bg-yellow-900 border-yellow-500">
              <Info className="h-4 w-4 text-yellow-500" />
              <AlertTitle>Security Rules Notice</AlertTitle>
              <AlertDescription>
                If you're getting permission errors, you may need to update your Firestore security rules 
                to allow the first admin creation. Check the documentation for initial setup instructions.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
        <CardFooter className="flex flex-col items-center">
          <Link href="/diagnose-rules" className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 mb-2">
            Diagnose Rules Issues
          </Link>
          <Link href="/" className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
            ← Back to Home
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
