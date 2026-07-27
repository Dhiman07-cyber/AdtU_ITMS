/**
 * Bus Fee Management Service
 * Handles bus fee storage in Firestore settings/config collection
 */

import { getSystemConfig, updateSystemConfig } from '@/domains/admin';

export interface BusFeeData {
  amount: number;
  updatedAt: string;
  updatedBy: string;
  version: number;
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
    const systemConfigResult = await getSystemConfig();
    const config = systemConfigResult.data;

    console.log('🔍 Fetching bus fee from system config...');
    const amount = config.busFee?.amount;

    if (typeof amount !== 'number' || amount <= 0) {
      throw new Error('Bus fee configuration is missing in settings database. Please configure settings and try again later.');
    }

    console.log('📊 Bus fee data from config:', {
      amount: amount,
      updatedAt: systemConfigResult.updatedAt,
      updatedByUid: systemConfigResult.updatedByUid,
      version: config.version
    });

    return {
      amount: amount,
      updatedAt: systemConfigResult.updatedAt || new Date().toISOString(),
      updatedBy: systemConfigResult.updatedByUid || 'system',
      version: 1
    };
  } catch (error: any) {
    console.error('Error getting current bus fee:', error);
    throw new Error(error.message || 'Unstable network detected, please try again later');
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
    const systemConfigResult = await getSystemConfig();
    const currentConfig = systemConfigResult.data;

    // Ensure busFee object exists
    if (!currentConfig.busFee) {
      currentConfig.busFee = { amount: 0 };
    }

    const previousAmount = currentConfig.busFee.amount;

    // Add current state to history before updating
    if (!currentConfig.busFee.history) {
      currentConfig.busFee.history = [];
    }

    // Push the previous state to history and retain only latest 3 entries
    currentConfig.busFee.history.push({
      amount: previousAmount,
      updatedAt: systemConfigResult.updatedAt || new Date().toISOString(),
      updatedBy: adminUid,
      version: 1
    });
    if (currentConfig.busFee.history.length > 3) {
      currentConfig.busFee.history = currentConfig.busFee.history.slice(-3);
    }

    // Update with new values
    currentConfig.busFee.amount = newAmount;

    // Save via service
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
    const systemConfigResult = await getSystemConfig();
    return systemConfigResult.data.busFee?.history || [];
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
  try {
    await getSystemConfig();
  } catch {
    const defaultConfig = {
      appName: "AdtU Bus Services",
      busFee: {
        amount: defaultAmount,
        history: []
      },
      version: "v1.0.0",
    };
    await updateSystemConfig(defaultConfig, 'system');
    console.log(`✅ Initialized system config with bus fee: ${defaultAmount}`);
  }
}
