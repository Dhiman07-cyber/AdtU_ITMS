"use client";

import { getFCMToken,requestNotificationPermission } from '@/lib/fcm-service';
import { useEffect,useRef,useState } from 'react';

export const useFCMToken = () => {
    const [fcmToken, setFcmToken] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const isMountedRef = useRef(true);

    const requestPermission = async () => {
        setLoading(true);
        setError(null);
        try {
            const granted = await requestNotificationPermission();
            if (granted) {
                const token = await getFCMToken();
                if (isMountedRef.current) setFcmToken(token);
                return token;
            } else {
                setError('Notification permission denied');
                return null;
            }
        } catch (err: any) {
            console.error('Error requesting notification permission:', err);
            setError(err.message || 'Failed to get notification permission');
            return null;
        } finally {
            if (isMountedRef.current) setLoading(false);
        }
    };

    useEffect(() => {
        isMountedRef.current = true;

        const fetchToken = async () => {
            try {
                const token = await getFCMToken();
                if (isMountedRef.current && token) {
                    setFcmToken(token);
                }
            } catch (err) {
                console.error('Error fetching initial FCM token:', err);
            } finally {
                if (isMountedRef.current) setLoading(false);
            }
        };

        fetchToken();

        return () => {
            isMountedRef.current = false;
        };
    }, []);

    return {
        fcmToken,
        loading,
        error,
        requestPermission
    };
};
