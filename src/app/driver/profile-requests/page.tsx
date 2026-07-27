"use client";

import { PremiumPageLoader } from "@/components/LoadingSpinner";
import { Avatar,AvatarFallback,AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/auth-context";
import { getDriverById } from "@/lib/dataService";
import {
	AlertCircle,
	CheckCircle,
	Clock,
	Image as ImageIcon,
	User,
	XCircle
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect,useState } from "react";

interface ProfileUpdateRequest {
  requestId: string;
  studentUid: string;
  studentName: string;
  currentImageUrl: string;
  newImageUrl: string;
  currentName: string;
  newName: string;
  status: string;
  createdAt: any;
  approvedAt?: any;
  rejectedAt?: any;
}

export default function DriverProfileRequestsPage() {
  const { currentUser, userData } = useAuth();
  const router = useRouter();
  const [driver, setDriver] = useState<any>(null);
  const [requests, setRequests] = useState<ProfileUpdateRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchData = async () => {
      if (!currentUser?.uid || userData?.role !== "driver") {
        // Save current URL for redirect after login
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('returnUrl', window.location.pathname);
        }
        router.push("/login");
        return;
      }

      try {
        const driverData = await getDriverById(currentUser.uid);
        if (!driverData) {
          setError("Driver profile not found");
          return;
        }

        setDriver(driverData);
        await fetchPendingRequests();
      } catch (err) {
        console.error("Error fetching data:", err);
        setError("Failed to load data");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [currentUser, userData, router]);

  const fetchPendingRequests = async () => {
    try {
      const response = await fetch("/api/driver/get-pending-profile-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          idToken: await currentUser?.getIdToken(),
        }),
      });

      const result = await response.json();
      
      if (response.ok) {
        setRequests(result.requests || []);
      } else {
        setError(result.error || "Failed to fetch profile requests");
      }
    } catch (err) {
      console.error("Error fetching requests:", err);
      setError("Failed to fetch profile requests");
    }
  };

  const handleRequest = async (requestId: string, action: "approve" | "reject") => {
    setProcessing(requestId);
    setError("");

    try {
      const response = await fetch("/api/driver/handle-profile-update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          idToken: await currentUser?.getIdToken(),
          requestId,
          action,
        }),
      });

      const result = await response.json();

      if (response.ok) {
        // Remove the processed request from the list
        setRequests(prev => prev.filter(req => req.requestId !== requestId));
      } else {
        setError(result.error || `Failed to ${action} request`);
      }
    } catch (err) {
      console.error(`Error ${action}ing request:`, err);
      setError(`Failed to ${action} request`);
    } finally {
      setProcessing(null);
    }
  };

  if (loading) {
    return <PremiumPageLoader message="Loading profile requests..." subMessage="Fetching requests..." />;
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>Error</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2 text-red-600">
              <AlertCircle className="h-5 w-5" />
              <p>{error}</p>
            </div>
            <Button onClick={() => setError("")} className="mt-4">Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Profile Update Requests</h1>
          <p className="text-gray-500">Review and approve student profile updates</p>
        </div>
      </div>

      {requests.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Clock className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No pending requests</h3>
            <p className="text-gray-500">
              There are no pending profile update requests from your students.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6">
          {requests.map((request) => (
            <Card key={request.requestId}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <Avatar className="h-12 w-12">
                      {request.currentImageUrl ? (
                        <AvatarImage src={request.currentImageUrl} alt={request.studentName} />
                      ) : (
                        <AvatarFallback>
                          <User className="h-6 w-6" />
                        </AvatarFallback>
                      )}
                    </Avatar>
                    <div>
                      <CardTitle className="text-lg">{request.studentName}</CardTitle>
                      <CardDescription>Requested profile update</CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2 text-yellow-600 bg-yellow-100 px-3 py-1 rounded-full">
                    <Clock className="h-4 w-4" />
                    <span className="text-sm font-medium">Pending</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-medium mb-2 flex items-center">
                      <ImageIcon className="h-4 w-4 mr-2" />
                      Current Profile
                    </h4>
                    <div className="border rounded-lg p-4">
                      {request.currentImageUrl ? (
                        <Image 
                          src={request.currentImageUrl} 
                          alt="Current profile" 
                          width={128}
                          height={128}
                          className="w-32 h-32 rounded-full mx-auto object-cover"
                        />
                      ) : (
                        <div className="w-32 h-32 rounded-full bg-gray-200 flex items-center justify-center mx-auto">
                          <User className="h-12 w-12 text-gray-500" />
                        </div>
                      )}
                      <p className="text-center mt-2 font-medium">{request.currentName}</p>
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="font-medium mb-2 flex items-center">
                      <ImageIcon className="h-4 w-4 mr-2" />
                      New Profile
                    </h4>
                    <div className="border rounded-lg p-4">
                      {request.newImageUrl ? (
                        <Image 
                          src={request.newImageUrl} 
                          alt="New profile" 
                          width={128}
                          height={128}
                          className="w-32 h-32 rounded-full mx-auto object-cover"
                        />
                      ) : (
                        <div className="w-32 h-32 rounded-full bg-gray-200 flex items-center justify-center mx-auto">
                          <User className="h-12 w-12 text-gray-500" />
                        </div>
                      )}
                      <p className="text-center mt-2 font-medium">{request.newName}</p>
                    </div>
                  </div>
                </div>
                
                <div className="flex justify-end space-x-3 mt-6">
                  <Button
                    variant="outline"
                    onClick={() => handleRequest(request.requestId, "reject")}
                    disabled={processing === request.requestId}
                  >
                    {processing === request.requestId ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-900 mr-2"></div>
                        Rejecting...
                      </>
                    ) : (
                      <>
                        <XCircle className="h-4 w-4 mr-2" />
                        Reject
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={() => handleRequest(request.requestId, "approve")}
                    disabled={processing === request.requestId}
                  >
                    {processing === request.requestId ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        Approving...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Approve
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
