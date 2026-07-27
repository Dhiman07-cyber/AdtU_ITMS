import type { QRContract } from './qr-contract';
import { parseQRPayload,validateQRContract } from './qr-contract';

export interface InitiationInput {
  busId: string;
  shift: 'Morning' | 'Evening';
}

export type InitiationResult = {
  success: true;
  data: InitiationInput;
} | {
  success: false;
  error: string;
};

export interface TripInitiationStrategy {
  readonly name: string;
  resolve(input: unknown): Promise<InitiationResult>;
}

export class ManualTripInitiationStrategy implements TripInitiationStrategy {
  readonly name = 'manual';

  async resolve(input: { busId: string; shift: 'Morning' | 'Evening' }): Promise<InitiationResult> {
    if (!input.busId) return { success: false, error: 'busId is required' };
    if (!input.shift) return { success: false, error: 'shift is required' };
    return { success: true, data: { busId: input.busId, shift: input.shift } };
  }
}

export class QRCodeTripInitiationStrategy implements TripInitiationStrategy {
  readonly name = 'qr';

  async resolve(input: { rawQR: string; shift: 'Morning' | 'Evening' }): Promise<InitiationResult> {
    if (!input.rawQR) return { success: false, error: 'QR payload is required' };
    if (!input.shift) return { success: false, error: 'shift is required' };

    let contract: QRContract;
    try {
      contract = parseQRPayload(input.rawQR);
    } catch {
      return { success: false, error: 'Failed to parse QR payload' };
    }

    const validation = validateQRContract(contract);
    if (!validation.valid) {
      return { success: false, error: validation.error! };
    }

    return { success: true, data: { busId: contract.busId, shift: input.shift } };
  }
}

export function getInitiationStrategy(mode: 'manual' | 'qr'): TripInitiationStrategy {
  if (mode === 'qr') return new QRCodeTripInitiationStrategy();
  return new ManualTripInitiationStrategy();
}
