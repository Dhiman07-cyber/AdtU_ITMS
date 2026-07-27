"use client";

import { Alert,AlertDescription,AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardFooter,CardHeader,CardTitle } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect,useState } from "react";

export default function RulesContentPage() {
  const [loading, setLoading] = useState(true);
  const [rulesContent, setRulesContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const fetchRulesContent = async () => {
      try {
        const response = await fetch("/api/get-rules-content");
        const data = await response.json();
        
        if (data.success) {
          setRulesContent(data.content);
        } else {
          setError(data.error || "Failed to fetch rules content");
        }
      } catch (err: any) {
        setError(err.message || "Failed to fetch rules content");
      } finally {
        setLoading(false);
      }
    };

    fetchRulesContent();
  }, []);

  const handleCopyToClipboard = () => {
    if (rulesContent) {
      navigator.clipboard.writeText(rulesContent);
    }
  };

  return (
    <div className="min-h-screen p-6 bg-gray-50 dark:bg-gray-900">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Firestore Rules Content</h1>
        
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Current Firestore Rules</CardTitle>
            <CardDescription>
              This is the exact content that should be deployed to Firebase
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center items-center h-32">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
              </div>
            ) : error ? (
              <Alert className="bg-red-100 dark:bg-red-900 border-red-500">
                <AlertCircle className="h-4 w-4 text-red-500" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>
                  {error}
                </AlertDescription>
              </Alert>
            ) : rulesContent ? (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <p>
                    Copy this exact content and paste it into the Firestore Rules editor in the Firebase Console.
                  </p>
                  <Button onClick={handleCopyToClipboard}>
                    Copy to Clipboard
                  </Button>
                </div>
                
                <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
                  <pre className="text-sm overflow-x-auto max-h-96">
                    {rulesContent}
                  </pre>
                </div>
              </div>
            ) : (
              <p>No rules content available</p>
            )}
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Deployment Instructions</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal pl-5 space-y-2">
              <li>Go to the <a href="https://console.firebase.google.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-300 underline">Firebase Console</a></li>
              <li>Select your project</li>
              <li>Navigate to Firestore Database → Rules tab</li>
              <li>Replace <strong>ALL</strong> the existing rules with the content above</li>
              <li>Click "Publish"</li>
              <li>Wait 1-2 minutes for the rules to propagate</li>
              <li>Verify the setup at <Link href="/setup-admin" className="text-blue-600 dark:text-blue-300 underline">Create First Admin</Link></li>
            </ol>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button variant="outline" asChild>
              <Link href="/">← Back to Home</Link>
            </Button>
            <Button asChild>
              <Link href="/diagnose-rules">Diagnose Rules</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
