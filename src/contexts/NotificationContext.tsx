"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo, ReactNode } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { UserNotificationView } from '@/lib/notifications/types';
import {
    NOTIFICATION_POLLING_INTERVAL_MS
} from '@/config/runtime';

// ============================================================================
// CONSTANTS
// ============================================================================

const NOTIFICATION_LIMIT = 50;

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

    // Refs
    const isMountedRef = useRef(true);
    const [isVisible, setIsVisible] = useState(true);

    // Track page visibility for polling efficiency
    useEffect(() => {
        const handler = () => setIsVisible(!document.hidden);
        document.addEventListener('visibilitychange', handler);
        return () => document.removeEventListener('visibilitychange', handler);
    }, []);

    const fetchNotifications = useCallback(async () => {
        if (!currentUser || !userData) {
            setNotifications([]);
            setUnreadCount(0);
            setLoading(false);
            return;
        }

        try {
            const res = await fetch(`/api/notifications?limit=${NOTIFICATION_LIMIT}`, {
                credentials: 'include',
            });

            if (!res.ok) {
                throw new Error(`Failed to fetch notifications: ${res.status}`);
            }

            const data = await res.json();
            if (!isMountedRef.current) return;

            setNotifications(data.notifications || []);
            setUnreadCount(data.unreadCount || 0);
            setError(null);
        } catch (err) {
            console.error('[NotificationContext] Fetch error:', err);
            if (isMountedRef.current) setError(err as Error);
        } finally {
            if (isMountedRef.current) setLoading(false);
        }
    }, [currentUser?.uid, userData?.role]);

    useEffect(() => {
        isMountedRef.current = true;
        if (!currentUser || !userData) {
            setNotifications([]);
            setUnreadCount(0);
            setLoading(false);
            return;
        }

        if (notifications.length === 0 && !error) {
            setLoading(true);
        }
        setError(null);

        fetchNotifications();
        const pollIntervalId = setInterval(() => {
            if (isVisible && isMountedRef.current) {
                fetchNotifications();
            }
        }, NOTIFICATION_POLLING_INTERVAL_MS);

        return () => clearInterval(pollIntervalId);
    }, [currentUser?.uid, userData?.role, refreshTrigger, fetchNotifications, isVisible]);

    useEffect(() => {
        return () => { isMountedRef.current = false; };
    }, []);

    const markAsRead = useCallback(async (notificationId: string) => {
        if (!currentUser) return;
        try {
            const res = await fetch(`/api/notifications/${notificationId}/read`, {
                method: 'POST',
                credentials: 'include',
            });
            if (!res.ok) throw new Error('Failed to mark as read');

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
            setNotifications(prev =>
                prev.map(n => notificationIds.includes(n.id) ? { ...n, isRead: true } : n)
            );

            const affectedNotifications = notifications.filter(n => notificationIds.includes(n.id) && !n.isRead);
            const adjustment = affectedNotifications.length;

            const promises = notificationIds.map(id =>
                fetch(`/api/notifications/${id}/read`, {
                    method: 'POST',
                    credentials: 'include',
                })
            );
            await Promise.all(promises);

            setUnreadCount(prev => Math.max(0, prev - adjustment));
        } catch (error) {
            console.error('Error marking all as read:', error);
            throw error;
        }
    }, [currentUser, notifications]);

    const deleteGlobally = useCallback(async (notificationId: string) => {
        if (!currentUser || !userData) return;
        try {
            const res = await fetch(`/api/notifications/${notificationId}`, {
                method: 'DELETE',
                credentials: 'include',
            });
            if (!res.ok) throw new Error('Failed to delete notification');

            setRefreshTrigger(prev => prev + 1);
        } catch (error) {
            console.error('Error deleting globally:', error);
            throw error;
        }
    }, [currentUser, userData]);

    const editNotification = useCallback(async (notificationId: string, updates: { title?: string, content: string, metadata?: any }) => {
        if (!currentUser || !userData) return;
        try {
            const res = await fetch(`/api/notifications/${notificationId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(updates),
            });
            if (!res.ok) throw new Error('Failed to edit notification');

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
        isRealtime: false
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
