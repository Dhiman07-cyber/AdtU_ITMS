import { getSystemConfig,updateSystemConfig } from '@/domains/admin';
import { getAdminById,getUserById } from '@/domains/identity';
import { pgInsertNotification } from '@/domains/notification/repositories/notification.repository.pg';
import { adminAuth } from '@/lib/firebase-admin';
import { NextRequest,NextResponse } from 'next/server';

// GET: Retrieve bus fees from system config (Firestore settings/config)
export async function GET(req: NextRequest) {
  try {
    const systemConfigResult = await getSystemConfig();
    const busFeeAmount = systemConfigResult.data?.busFee?.amount;
    if (typeof busFeeAmount !== 'number') {
      return NextResponse.json(
        { message: 'Bus fee configuration is missing in Firestore settings. Please try again later.' },
        { status: 503 }
      );
    }

    return NextResponse.json({
      amount: busFeeAmount,
      fees: busFeeAmount
    });
  } catch (error: any) {
    console.error('Error fetching bus fees:', error);
    return NextResponse.json(
      { message: error?.message || 'Unstable network detected, please try again later' },
      { status: 503 }
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

    // Check if user is admin via PostgreSQL (canonical source of truth)
    const user = await getUserById(uid);
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ message: 'Access denied. Admin only.' }, { status: 403 });
    }

    const { amount } = await req.json();

    if (!amount || amount <= 0) {
      return NextResponse.json({ message: 'Invalid amount' }, { status: 400 });
    }

    // Get current config
    const systemConfigResult = await getSystemConfig();
    const oldAmount = systemConfigResult.data?.busFee?.amount || 0;

    // Prepare updated bus fee data
    // Note: The service will handle truncation of history
    const existingHistory = systemConfigResult.data?.busFee?.history || [];
    const newHistoryEntry = {
      amount: oldAmount,
      updatedAt: systemConfigResult.data?.busFee?.updatedAt || new Date().toISOString(),
    };
    const combinedHistory = [...existingHistory, newHistoryEntry].slice(-3);

    // Construct new config object
    // We clone the existing config to preserve other fields
    const updatedConfig = {
      ...systemConfigResult.data,
      busFee: {
        amount: amount,
        updatedAt: new Date().toISOString(),
        version: (systemConfigResult.data?.busFee?.version || 0) + 1,
        history: combinedHistory
      }
    };

    // Save via service (which handles cleaning/truncation)
    await updateSystemConfig(updatedConfig, uid);

    console.log(`✅ Bus fee updated by admin ${uid}: ${oldAmount} -> ${amount}`);

    // --- Notification Logic ---
    // Get admin user details for notification sender
    const adminData = await getAdminById(uid);
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
    } catch (error) {
      console.error('Failed to send announcement notification:', error);
    }

    return NextResponse.json({
      message: 'Bus fee updated successfully',
      fees: amount,
      notificationSent
    });

  } catch (error) {
    console.error('Error updating bus fees:', error);
    return NextResponse.json(
      { message: 'Failed to update bus fees' },
      { status: 500 }
    );
  }
}
