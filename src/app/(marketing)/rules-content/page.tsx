import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyRulesButton } from "@/components/CopyRulesButton";
import { AlertCircle } from "lucide-react";
import { promises as fs } from 'fs';
import Link from "next/link";
import path from 'path';

export default async function RulesContentPage() {
  let rulesContent: string | null = null;
  let error: string | null = null;

  try {
    const rulesPath = path.join(process.cwd(), 'firestore.rules');
    rulesContent = await fs.readFile(rulesPath, 'utf8');
  } catch (err: any) {
    console.error('Error reading firestore.rules on server:', err);
    error = 'Failed to read firestore.rules file';
  }

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
            {error ? (
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
                  <CopyRulesButton content={rulesContent} />
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

