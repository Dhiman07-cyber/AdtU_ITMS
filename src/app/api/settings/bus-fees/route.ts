import { getSystemConfig,updateSystemConfig } from '@/domains/admin';
import { notifyBusFeeChange } from '@/lib/bus-fee-service';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { BusFeeUpdateSchema } from '@/lib/security/validation-schemas';
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
export const POST = withSecurity(
  async (request, { auth, body }) => {
    try {
      const uid = auth.uid;
      const { amount } = body as { amount: number };

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

    // Notify all users about bus fee change via shared service
    const notificationSent = await notifyBusFeeChange(uid, oldAmount, amount);

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
},
{
  requiredRoles: ['admin'],
  schema: BusFeeUpdateSchema,
  rateLimit: RateLimits.UPDATE,
});

