// @ts-nocheck
"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from "@/contexts/toast-context";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { useAuth } from "@/contexts/auth-context";
import { PremiumPageLoader } from "@/components/LoadingSpinner";

export default function ViewNotificationPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { addToast } = useToast();
  const { currentUser } = useAuth();
  const { id } = use(params);
  const [notification, setNotification] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchNotification = async () => {
      try {
        const docRef = doc(db, 'notifications', id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setNotification({ id: docSnap.id, ...docSnap.data() });
        } else {
          addToast('Notification not found', 'error');
        }
      } catch (error) {
        console.error('Error fetching notification:', error);
        addToast('Failed to load notification', 'error');
      } finally {
        setLoading(false);
      }
    };

    if (id && currentUser) {
      fetchNotification();
    }
  }, [id, addToast, currentUser]);

  const getTypeBadge = (type: string) => {
    switch (type?.toLowerCase()) {
      case 'info':
        return <Badge variant="default">Information</Badge>;
      case 'alert':
        return <Badge variant="destructive">Alert</Badge>;
      case 'emergency':
        return <Badge variant="destructive">Emergency</Badge>;
      case 'verification_code':
        return <Badge variant="secondary">Verification Code</Badge>;
      default:
        return <Badge variant="secondary">{type || 'Notice'}</Badge>;
    }
  };

  const formatDate = (date: any) => {
    if (!date) return 'N/A';
    
    let dateObj: Date;
    if (date instanceof Date) {
      dateObj = date;
    } else if (typeof date === 'string') {
      dateObj = new Date(date);
    } else if (date?.toDate) {
      dateObj = date.toDate();
    } else {
      return 'N/A';
    }
    
    return format(dateObj, 'PPpp');
  };

  if (loading) {
    return <PremiumPageLoader message="Loading notification..." subMessage="Fetching content..." />;
  }

  if (!notification) {
    return (
      <div className="mt-15 min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Notification not found</h1>
          <Link href="/admin/notifications" className="text-blue-500 hover:text-blue-700 mt-4 inline-block">
            ← Back to Notifications
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">View Notification</h1>
          <p className="text-gray-500 dark:text-gray-400">
            Detailed view of notification
          </p>
        </div>
        <div className="flex space-x-2">
          <Button 
            variant="outline" 
            onClick={() => router.push(`/admin/notifications/edit/${notification.id}`)}
          >
            Edit
          </Button>
          <Link href="/admin/notifications">
            <Button>Back to Notifications</Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{notification.title}</CardTitle>
          <CardDescription>
            Notification details
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Title</h3>
              <p className="font-medium">{notification.title}</p>
            </div>
            
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Type</h3>
              <div>{getTypeBadge(notification.type)}</div>
            </div>
            
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Status</h3>
              <div>{notification.isDeletedGlobally ? (
                <Badge variant="destructive">Deleted</Badge>
              ) : (
                <Badge variant="default">Sent</Badge>
              )}</div>
            </div>
            
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Read Status</h3>
              <div>
                {notification.readByUserIds?.includes(currentUser?.uid) ? (
                  <Badge variant="default">Read</Badge>
                ) : (
                  <Badge variant="secondary">Unread</Badge>
                )}
              </div>
            </div>
            
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Created By</h3>
              <p className="font-medium">{notification.sender?.userName || 'Unknown'}</p>
            </div>
            
            <div className="space-y-2 md:col-span-2">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Target</h3>
              <div>{notification.target?.type || 'N/A'}</div>
            </div>
            
            <div className="space-y-2 md:col-span-2">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Created At</h3>
              <p className="font-medium">{formatDate(notification.createdAt)}</p>
            </div>
          </div>
          
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Message</h3>
            <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <p className="whitespace-pre-wrap">{notification.content}</p>
            </div>
          </div>
          
          {notification.metadata && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Metadata</h3>
              <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <pre className="text-sm overflow-x-auto">
                  {JSON.stringify(notification.metadata, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
