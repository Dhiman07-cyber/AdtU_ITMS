"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo, ReactNode } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { db } from '@/lib/firebase';
import {
    collection,
    query,
    where,
    orderBy,
    onSnapshot,
    getDocs,
    limit,
    or,
    Unsubscribe
} from 'firebase/firestore';
import { notificationService } from '@/lib/notifications/NotificationService';
import { UserNotificationView, SYSTEM_SENDER } from '@/lib/notifications/types';
import { useVisibilityAwareListener } from '@/utils/useVisibilityAwareListener';
import {
    ENABLE_FIRESTORE_REALTIME,
    NOTIFICATION_POLLING_INTERVAL_MS
} from '@/config/runtime';
import { getSigningOutState } from '@/lib/firestore-error-handler';

// ============================================================================
// CONSTANTS
// ============================================================================

const ADMIN_NOTIFICATION_LIMIT = 50;
const USER_NOTIFICATION_LIMIT = 50;

// ============================================================================
// TYPES
// ============================================================================

interface NotificationContextType {
    notifications: UserNotificationView[];
    unreadCount: number;
    loading: boolean;
    error: Error | null;
    markAsRead: (notificationId: string) => Promise<void>;
    markAllAsRead: (notificationIds: string[]) => Promise<void>;
    deleteGlobally: (notificationId: string) => Promise<void>;
    editNotification: (notificationId: string, updates: { title?: string, content: string, metadata?: any }) => Promise<void>;
    refresh: () => void;
    isRealtime: boolean;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

// ============================================================================
// PROVIDER
// ============================================================================

export function NotificationProvider({ children }: { children: ReactNode }) {
    const { currentUser, userData } = useAuth();
    const [notifications, setNotifications] = useState<UserNotificationView[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    // Visibility-aware listener management
    const { shouldMountListener, isVisible, isOnline } = useVisibilityAwareListener();

    // Refs
    const isMountedRef = useRef(true);
    const unsubscribeRef = useRef<Unsubscribe | null>(null);

    // Determine if we should use realtime
    const isPrivilegedUser = userData?.role === 'admin' || userData?.role === 'moderator';
    const useRealtime = ENABLE_FIRESTORE_REALTIME && shouldMountListener && !isPrivilegedUser;

    // Process notification snapshot/docs into UserNotificationView[]
    const processNotifications = useCallback(async (docs: any[]): Promise<{ notifications: UserNotificationView[], unread: number }> => {
        if (!currentUser || !userData) {
            return { notifications: [], unread: 0 };
        }

        const userNotifications: UserNotificationView[] = [];
        let unread = 0;
        const currentUserId = currentUser.uid;
        const currentUserRole = userData.role;
        const userRouteId = userData.routeId || userData.assignedRouteId || null;
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        for (const docData of docs) {
            const data = docData.data ? docData.data() : docData;
            const notificationId = docData.id;

            let sender = data.sender;
            if (!sender || !sender.userId || !sender.userName || !sender.userRole) {
                sender = SYSTEM_SENDER;
            }

            let target = data.target;
            let content = data.content;
            let recipientIds = data.recipientIds;

            if (!target && data.audience) {
                target = {
                    type: 'specific_users',
                    specificUserIds: data.audience || []
                };
                content = data.message || data.content || '';
                recipientIds = data.audience || [];

                if (data.createdBy === 'system' && (!sender || sender.userId !== 'system')) {
                    sender = SYSTEM_SENDER;
                }
            }

            if (!target || !target.type) continue;
            if (!data.title || !content || typeof content !== 'string') continue;

            const normalizedData = {
                ...data,
                sender,
                target,
                content,
                recipientIds: recipientIds || data.recipientIds || []
            };

            let visibility;
            try {
                visibility = notificationService.isNotificationVisibleToUser(
                    normalizedData,
                    currentUserId,
                    currentUserRole,
                    userRouteId
                );
            } catch (e) {
                continue;
            }

            if (visibility.visible) {
                const isRead = data.readByUserIds?.includes(currentUserId) || false;

                const canEdit = sender.userId !== 'system' &&
                    (currentUserRole === 'admin' || currentUserRole === 'moderator')
                    ? sender.userId === currentUserId
                    : false;

                const canDeleteGlobally = sender.userId !== 'system' &&
                    (currentUserRole === 'admin' ||
                        (currentUserRole === 'moderator' && sender.userId === currentUserId));

                const userNotificationView: UserNotificationView = {
                    id: notificationId,
                    title: data.isDeletedGlobally ? 'Deleted Message' : data.title,
                    content: data.isDeletedGlobally ? 'This message was deleted.' : content,
                    type: data.type || 'announcement',
                    sender,
                    target,
                    isRead,
                    isEdited: data.isEdited || false,
                    isDeletedGlobally: data.isDeletedGlobally || false,
                    createdAt: data.createdAt,
                    updatedAt: data.updatedAt,
                    canEdit: canEdit && !data.isDeletedGlobally,
                    canDeleteGlobally,
                    metadata: data.metadata,
                };

                userNotifications.push(userNotificationView);

                const isSender = sender.userId === currentUserId;
                if (!isRead && !data.isDeletedGlobally && !isSender) {
                    unread++;
                }
            }
        }

        const recentNotifications = userNotifications.filter(n => {
            const createdAt = n.createdAt?.toDate ? n.createdAt.toDate() : new Date(n.createdAt);
            return createdAt >= thirtyDaysAgo;
        });

        return { notifications: recentNotifications, unread };
    }, [currentUser?.uid, userData?.role, userData?.routeId, userData?.assignedRouteId]);

    const fetchNotifications = useCallback(async () => {
        if (!currentUser || !userData) {
            setNotifications([]);
            setUnreadCount(0);
            setLoading(false);
            return;
        }

        try {
            const notificationsRef = collection(db, 'notifications');
            const queryLimit = (userData.role === 'admin' || userData.role === 'moderator')
                ? ADMIN_NOTIFICATION_LIMIT
                : USER_NOTIFICATION_LIMIT;

            const q = query(
                notificationsRef,
                or(
                    where('recipientIds', 'array-contains', currentUser.uid),
                    where('sender.userId', '==', currentUser.uid)
                ),
                orderBy('createdAt', 'desc'),
                limit(queryLimit)
            );

            const snapshot = await getDocs(q);
            if (!isMountedRef.current) return;

            const result = await processNotifications(snapshot.docs);
            setNotifications(result.notifications);
            setUnreadCount(result.unread);
            setError(null);
        } catch (err) {
            console.error('[NotificationContext] Fetch error:', err);
            if (isMountedRef.current) setError(err as Error);
        } finally {
            if (isMountedRef.current) setLoading(false);
        }
    }, [currentUser?.uid, userData?.role, processNotifications]);

    useEffect(() => {
        isMountedRef.current = true;
        if (!currentUser || !userData) {
            setNotifications([]);
            setUnreadCount(0);
            setLoading(false);
            return;
        }

        // Only show global loading on the very first load or if explicitly reset
        if (notifications.length === 0 && !error) {
            setLoading(true);
        }
        setError(null);

        if (unsubscribeRef.current) {
            unsubscribeRef.current();
            unsubscribeRef.current = null;
        }

        if (useRealtime) {
            const notificationsRef = collection(db, 'notifications');
            const queryLimit = (userData.role === 'admin' || userData.role === 'moderator')
                ? ADMIN_NOTIFICATION_LIMIT
                : USER_NOTIFICATION_LIMIT;

            const q = query(
                notificationsRef,
                or(
                    where('recipientIds', 'array-contains', currentUser.uid),
                    where('sender.userId', '==', currentUser.uid)
                ),
                orderBy('createdAt', 'desc'),
                limit(queryLimit)
            );

            unsubscribeRef.current = onSnapshot(
                q,
                async (snapshot) => {
                    if (!isMountedRef.current) return;
                    try {
                        const result = await processNotifications(snapshot.docs);
                        setNotifications(result.notifications);
                        setUnreadCount(result.unread);
                        setLoading(false);
                        setError(null);
                    } catch (err) {
                        console.error('[NotificationContext] Listener processing error:', err);
                        setError(err as Error);
                        setLoading(false);
                    }
                },
                (err) => {
                    // Suppress errors during sign-out
                    if (getSigningOutState()) return;

                    console.error('[NotificationContext] Listener error:', err);
                    if (isMountedRef.current) {
                        setError(err as Error);
                        setLoading(false);
                    }
                }
            );

            return () => {
                if (unsubscribeRef.current) {
                    unsubscribeRef.current();
                    unsubscribeRef.current = null;
                }
            };
        } else {
            fetchNotifications();
            const pollIntervalId = setInterval(() => {
                if (isVisible && isOnline && isMountedRef.current) {
                    fetchNotifications();
                }
            }, NOTIFICATION_POLLING_INTERVAL_MS);

            return () => clearInterval(pollIntervalId);
        }
    }, [currentUser?.uid, userData?.role, refreshTrigger, useRealtime, processNotifications, fetchNotifications, isVisible, isOnline]);

    useEffect(() => {
        return () => { isMountedRef.current = false; };
    }, []);

    const markAsRead = useCallback(async (notificationId: string) => {
        if (!currentUser) return;
        try {
            await notificationService.markAsRead(currentUser.uid, notificationId);
            setNotifications(prev =>
                prev.map(n => n.id === notificationId ? { ...n, isRead: true } : n)
            );
            setUnreadCount(prev => Math.max(0, prev - 1));
        } catch (error) {
            console.error('Error marking as read:', error);
            throw error;
        }
    }, [currentUser]);

    const markAllAsRead = useCallback(async (notificationIds: string[]) => {
        if (!currentUser || notificationIds.length === 0) return;
        try {
            // Optimistic update
            setNotifications(prev =>
                prev.map(n => notificationIds.includes(n.id) ? { ...n, isRead: true } : n)
            );

            // Use a local copy to calculate unread adjustment before the state potentially refreshes
            const affectedNotifications = notifications.filter(n => notificationIds.includes(n.id) && !n.isRead);
            const adjustment = affectedNotifications.length;

            // Mark all in Firestore
            const promises = notificationIds.map(id => notificationService.markAsRead(currentUser.uid, id));
            await Promise.all(promises);

            // Final count adjustment
            setUnreadCount(prev => Math.max(0, prev - adjustment));
        } catch (error) {
            console.error('Error marking all as read:', error);
            throw error;
        }
    }, [currentUser, notifications]);

    const deleteGlobally = useCallback(async (notificationId: string) => {
        if (!currentUser || !userData) return;
        try {
            await notificationService.deleteNotificationGlobally(currentUser.uid, userData.role, notificationId);
            // Wait for sink or trigger refresh
            setRefreshTrigger(prev => prev + 1);
        } catch (error) {
            console.error('Error deleting globally:', error);
            throw error;
        }
    }, [currentUser, userData]);

    const editNotification = useCallback(async (notificationId: string, updates: { title?: string, content: string, metadata?: any }) => {
        if (!currentUser || !userData) return;
        try {
            await notificationService.editNotification(currentUser.uid, userData.role, notificationId, updates);
            setRefreshTrigger(prev => prev + 1);
        } catch (error) {
            console.error('Error editing notification:', error);
            throw error;
        }
    }, [currentUser, userData]);

    const refresh = useCallback(() => {
        setRefreshTrigger(prev => prev + 1);
    }, []);

    const value = useMemo<NotificationContextType>(() => ({
        notifications,
        unreadCount,
        loading,
        error,
        markAsRead,
        markAllAsRead,
        deleteGlobally,
        editNotification,
        refresh,
        isRealtime: useRealtime
    }), [
        notifications,
        unreadCount,
        loading,
        error,
        markAsRead,
        markAllAsRead,
        deleteGlobally,
        editNotification,
        refresh,
        useRealtime
    ]);

    return (
        <NotificationContext.Provider value={value}>
            {children}
        </NotificationContext.Provider>
    );
}

// ============================================================================
// HOOK
// ============================================================================

export function useNotifications() {
    const context = useContext(NotificationContext);
    if (context === undefined) {
        throw new Error('useNotifications must be used within a NotificationProvider');
    }
    return context;
}
