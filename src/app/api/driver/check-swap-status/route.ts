import { NextResponse } from 'next/server';
import { CleanupService } from '@/lib/cleanup-service';
import { withSecurity } from '@/lib/security/api-security';
import { EmptySchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getAllBuses } from '@/domains/fleet';

/**
 * Check driver's swap status and trigger cleanup
 * Called when driver logs in or accesses dashboard
 */
const checkSwapStatusHandler = async (request: Request, { auth }: { auth: any }) => {
  const driverUid = auth.uid;

  // Find driver's assigned bus(es) from PG
  const allBuses = await getAllBuses();
  const assignedBuses = allBuses.filter(b => (b as any).assignedDriverId === driverUid || (b as any).driverUID === driverUid);
  const activeBuses = allBuses.filter(b => (b as any).activeDriverId === driverUid);

  let swapsChecked = 0;
  let swapsReverted = 0;

  // Check each bus for expired swaps
  for (const bus of assignedBuses) {
    const busId = bus.busId || bus.id || '';
    const reverted = await CleanupService.checkAndRevertExpiredSwap(busId);
    swapsChecked++;
    if (reverted) swapsReverted++;
  }

  // Also check if driver is activeDriverId (temporary swap)
  for (const bus of activeBuses) {
    const busId = bus.busId || bus.id || '';
    const reverted = await CleanupService.checkAndRevertExpiredSwap(busId);
    swapsChecked++;
    if (reverted) swapsReverted++;
  }

  // Run general cleanup in background
  CleanupService.runOpportunisticCleanup().catch(err => {
    console.error('Background cleanup error:', err);
  });

  return NextResponse.json({
    success: true,
    swapsChecked,
    swapsReverted,
    message: swapsReverted > 0 ? 'Expired swaps reverted' : 'All swaps current'
  });
};

const secureHandler = withSecurity(
  checkSwapStatusHandler,
  {
    requiredRoles: ['driver'],
    schema: EmptySchema,
    rateLimit: RateLimits.DEFAULT
  }
);

export const POST = secureHandler;
export const GET = secureHandler;
