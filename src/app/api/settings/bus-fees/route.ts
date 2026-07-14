import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { pgInsertNotification } from '@/domains/notification/repositories/notification.repository.pg';
import { getSystemConfig, updateSystemConfig } from '@/lib/system-config-service';
import { DEFAULT_BUS_FEE } from '@/config/runtime';

// GET: Retrieve bus fees from system config (Firestore)
export async function GET(req: NextRequest) {
  try {
    const systemConfig = await getSystemConfig();
    // Access busFee from system config
    const busFeeData = systemConfig?.busFee || { amount: DEFAULT_BUS_FEE };

    return NextResponse.json({
      amount: busFeeData.amount,
      fees: busFeeData.amount
    });
  } catch (error) {
    console.error('Error fetching bus fees:', error);
    return NextResponse.json(
      { message: 'Failed to fetch bus fees' },
      { status: 500 }
    );
  }
}

// POST: Update bus fees (Admin only)
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;

    // Check if user is admin
    const userDoc = await adminDb.collection('users').doc(uid).get();
    if (!userDoc.exists || userDoc.data()?.role !== 'admin') {
      return NextResponse.json({ message: 'Access denied. Admin only.' }, { status: 403 });
    }

    const { amount } = await req.json();

    if (!amount || amount <= 0) {
      return NextResponse.json({ message: 'Invalid amount' }, { status: 400 });
    }

    // Get current config
    const systemConfig = await getSystemConfig();
    const oldAmount = systemConfig?.busFee?.amount || DEFAULT_BUS_FEE;

    // Prepare updated bus fee data
    // Note: The service will handle truncation of history
    const existingHistory = systemConfig?.busFee?.history || [];
    const newHistoryEntry = {
      amount: oldAmount,
      updatedAt: systemConfig?.busFee?.updatedAt || new Date().toISOString(),
    };

    // Construct new config object
    // We clone the existing config to preserve other fields
    const updatedConfig = {
      ...systemConfig,
      busFee: {
        amount: amount,
        updatedAt: new Date().toISOString(),
        version: (systemConfig?.busFee?.version || 0) + 1,
        history: [...existingHistory, newHistoryEntry]
      }
    };

    // Save to Firestore using service (which handles cleaning/truncation)
    await updateSystemConfig(updatedConfig, uid);

    console.log(`✅ Bus fee updated by admin ${uid}: ${oldAmount} -> ${amount}`);

    // --- Notification Logic ---
    // Get admin user details for notification sender
    const adminDoc = await adminDb.collection('admins').doc(uid).get();
    const adminData = adminDoc.exists ? adminDoc.data() : {};
    const adminName = adminData?.name || adminData?.fullName || 'Admin';

    let notificationSent = false;
    try {
      const notificationContent = `The bus fee for the upcoming session has been revised from ₹${oldAmount.toLocaleString('en-IN')} to ₹${amount.toLocaleString('en-IN')}. ` +
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
      notificationSent = true;
      console.log('✅ Notification sent to all users');
    } catch (notificationError: any) {
      console.error('Failed to send notification (non-critical):', notificationError);
    }

    return NextResponse.json({
      message: notificationSent
        ? 'Bus fees updated successfully. Notification sent to all users.'
        : 'Bus fees updated successfully.',
      amount: amount,
      oldAmount: oldAmount
    });
  } catch (error) {
    console.error('Error updating bus fees:', error);
    return NextResponse.json({ message: 'Failed to update bus fees' }, { status: 500 });
  }
}
