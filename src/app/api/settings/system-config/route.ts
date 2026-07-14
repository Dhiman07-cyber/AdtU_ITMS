import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { pgInsertNotification } from '@/domains/notification/repositories/notification.repository.pg';
import { getSystemConfig, updateSystemConfig } from '@/domains/admin';

// GET: Retrieve system config from Firestore (public — no sensitive data)
export async function GET(req: NextRequest) {
    try {
        const config = await getSystemConfig();
        return NextResponse.json({ config });
    } catch (error: any) {
        console.error('Error fetching system config:', error);
        return NextResponse.json(
            { 
                message: 'Unstable network detected, please try again later',
                error: 'An unexpected error occurred' },
            { status: 503 }
        );
    }
}

// POST: Update system config (Admin only)
export async function POST(req: NextRequest) {
    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return NextResponse.json(
                { message: 'Unauthorized' },
                { status: 401 }
            );
        }

        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await adminAuth.verifyIdToken(token);
        const uid = decodedToken.uid;

        // Check if user is admin
        const userDoc = await adminDb.collection('users').doc(uid).get();
        if (!userDoc.exists || userDoc.data()?.role !== 'admin') {
            return NextResponse.json(
                { message: 'Access denied. Admin only.' },
                { status: 403 }
            );
        }

        const { config: rawConfig } = await req.json();

        if (!rawConfig) {
            return NextResponse.json(
                { message: 'Invalid configuration data' },
                { status: 400 }
            );
        }

        // Force mapProvider to 'guwahati'
        rawConfig.mapProvider = 'guwahati';

        const config = rawConfig;

        // Read current config to compare changes
        const oldConfig = await getSystemConfig();

        // Prepare updated config object
        const updatedConfig = {
            ...oldConfig,
            ...config,
            lastUpdated: new Date().toISOString(),
        };

        // Special handling for bus fee updates (history, notifications)
        if (config.busFee && config.busFee.amount !== oldConfig.busFee?.amount) {
            // Update metadata for bus fee
            updatedConfig.busFee = {
                ...updatedConfig.busFee,
                updatedAt: new Date().toISOString(),
                version: (oldConfig.busFee?.version || 0) + 1,
                history: [
                    ...(oldConfig.busFee?.history || []),
                    {
                        amount: oldConfig.busFee?.amount || 0,
                        updatedAt: oldConfig.busFee?.updatedAt || new Date().toISOString(),
                    }
                ]
            };

            // Notify users about bus fee change
            try {
                const adminDoc = await adminDb.collection('admins').doc(uid).get();
                const adminData = adminDoc.exists ? adminDoc.data() : {};
                const adminName = adminData?.name || adminData?.fullName || 'Admin';

                const oldAmount = oldConfig.busFee?.amount || 0;
                const newAmount = config.busFee.amount;

                const notificationContent = `The bus fee for the upcoming session has been revised from ₹${oldAmount.toLocaleString('en-IN')} to ₹${newAmount.toLocaleString('en-IN')}. ` +
                    `Please update your payment plans accordingly. For any queries, contact the administration office.`;

                await pgInsertNotification({
                    title: '💰 Bus Fee Update - Important Notice',
                    content: notificationContent,
                    type: 'announcement',
                    sender: {
                        userId: uid,
                        userName: adminName,
                        userRole: 'admin'
                    },
                    target: {
                        type: 'all_users',
                    },
                    recipientIds: [],
                    readByUserIds: [],
                });
            } catch (error) {
                console.error('Failed to send notification:', error);
            }
        }

        // Sync with Firestore via service (handles cleaning and history limiting)
        const savedConfig = await updateSystemConfig(updatedConfig, uid);

        return NextResponse.json({
            message: 'System configuration updated successfully',
            config: savedConfig
        });

    } catch (error) {
        console.error('Error updating system config:', error);
        return NextResponse.json(
            { message: 'Failed to update system configuration' },
            { status: 500 }
        );
    }
}
