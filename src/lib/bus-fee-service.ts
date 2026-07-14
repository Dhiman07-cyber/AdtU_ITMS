// @ts-nocheck
/**
 * Bus Fee Management Service
 * Handles bus fee storage in PostgreSQL (migrated from Firestore)
 */

import { getSystemConfig, updateSystemConfig } from '@/domains/admin';

export interface BusFeeData {
  amount: number;
  updatedAt: string;
  updatedBy: string;
  version: number; // For conflict resolution (kept for interface compatibility)
}

export interface BusFeeHistory {
  amount: number;
  updatedAt: string;
  updatedBy: string;
  version: number;
}

/**
 * Get current bus fee from system config
 * NO FALLBACK - throws error if config unavailable
 */
export async function getCurrentBusFee(): Promise<BusFeeData> {
  try {
    const config = await getSystemConfig();

    console.log('🔍 Fetching bus fee from system config...');
    const amount = config.busFee?.amount || 0;

    console.log('📊 Bus fee data from config:', {
      amount: amount,
      updatedAt: config.lastUpdated,
      updatedBy: config.updatedBy,
      version: config.version
    });

    return {
      amount: amount,
      updatedAt: config.lastUpdated || new Date().toISOString(),
      updatedBy: config.updatedBy || 'system',
      version: 1
    };
  } catch (error) {
    console.error('Error getting current bus fee:', error);
    // Re-throw to prevent fallback usage
    throw new Error('Unstable network detected, please try again later');
  }
}

/**
 * Update bus fee in system config
 * This updates the global bus fee for the system
 */
export async function updateBusFee(
  adminUid: string,
  newAmount: number
): Promise<{ success: boolean; error?: string; previousAmount?: number }> {
  try {
    // Get current config
    const currentConfig = await getSystemConfig();

    // Ensure busFee object exists
    if (!currentConfig.busFee) {
      currentConfig.busFee = { amount: 0 };
    }

    const previousAmount = currentConfig.busFee.amount;

    // Add current state to history before updating
    if (!currentConfig.busFee.history) {
      currentConfig.busFee.history = [];
    }

    // Push the previous state to history
    // Note: The service layer will truncate this history to prevent unbounded growth
    currentConfig.busFee.history.push({
      amount: previousAmount,
      updatedAt: currentConfig.lastUpdated || new Date().toISOString(),
      updatedBy: currentConfig.updatedBy || 'system',
      version: 1
    });

    // Update with new values
    currentConfig.busFee.amount = newAmount;
    currentConfig.lastUpdated = new Date().toISOString();
    currentConfig.updatedBy = adminUid;

    // Save to Firestore via service
    await updateSystemConfig(currentConfig, adminUid);

    console.log(`✅ Bus fee updated by admin ${adminUid}: ${previousAmount} → ${newAmount}`);

    return {
      success: true,
      previousAmount
    };
  } catch (error: any) {
    console.error('Error updating bus fee:', error);
    return {
      success: false,
      error: error.message || 'Unstable network detected, please try again later'
    };
  }
}

/**
 * Get bus fee update history
 */
export async function getBusFeeHistory(): Promise<BusFeeHistory[]> {
  try {
    const config = await getSystemConfig();
    return config.busFee?.history || [];
  } catch (error) {
    console.error('Error getting bus fee history:', error);
    throw new Error('Unstable network detected, please try again later');
  }
}

/**
 * Initialize bus fee config if not exists
 * (This is now largely handled by getSystemConfig fallback, but kept for compatibility)
 */
export async function initializeBusFee(defaultAmount: number = 0): Promise<void> {
  // With Firestore, initialization happens lazily or via migration.
  // We can explicitly set it if needed.
  const config = await getSystemConfig();
  if (!config) {
    const defaultConfig = {
      appName: "AdtU Bus Services",
      busFee: {
        amount: defaultAmount,
        history: []
      },
      version: "v1.0.0",
      lastUpdated: new Date().toISOString(),
      updatedBy: 'system'
    };
    await updateSystemConfig(defaultConfig, 'system');
    console.log(`✅ Initialized system config in Firestore with bus fee: ${defaultAmount}`);
  }
}

