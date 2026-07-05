"use client";

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft } from "lucide-react";
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { PremiumPageLoader } from "@/components/LoadingSpinner";
import Link from 'next/link';

export default function ModeratorViewNotification() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [notification, setNotification] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchNotification = async () => {
      try {
        const docRef = doc(db, 'notifications', id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setNotification({ id: docSnap.id, ...docSnap.data() });
        }
      } catch (error) {
        console.error("Error fetching notification:", error);
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchNotification();
    }
  }, [id]);

  if (loading) {
    return <PremiumPageLoader message="Loading notification..." subMessage="Fetching content..." />;
  }

  if (!notification) {
    return (
      <div className="mt-15 text-center py-12">
        <p className="text-gray-500">Notification not found</p>
        <Link href="/moderator/notifications">
          <Button className="mt-4">Back to Notifications</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-3xl font-bold">Notification Details</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{notification.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm text-gray-500 mb-2">Type</p>
            <p className="font-medium capitalize">{notification.type || 'Notice'}</p>
          </div>

          <div>
            <p className="text-sm text-gray-500 mb-2">Message</p>
            <p className="whitespace-pre-wrap">{notification.content || notification.message}</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">Created By</p>
              <p className="font-medium">{notification.sender?.userName || notification.createdBy || 'N/A'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Status</p>
              <p className="font-medium">{notification.isDeletedGlobally ? 'Deleted' : 'Sent'}</p>
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <Link href={`/moderator/notifications/edit/${id}`}>
              <Button>Edit Notification</Button>
            </Link>
            <Link href="/moderator/notifications">
              <Button variant="outline">Back to List</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
