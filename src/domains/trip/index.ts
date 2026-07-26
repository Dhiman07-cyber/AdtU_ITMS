export {
  canOperate,
  startTrip,
  endTrip,
  heartbeat,
  getActiveTrip,
} from './services/trip.service';
export type {
  CanOperateResult,
  StartTripResult,
  EndTripResult,
  HeartbeatResult,
  StartTripParams,
  StartTripOutput,
  EndTripParams,
  EndTripOutput,
  HeartbeatParams,
} from './services/trip-orchestrator';
export { TripState, TripEvent, transition, canTransition } from './trip-state-machine';
export { parseQRPayload, encodeQRContract, validateQRContract } from './qr-contract';
export type { QRContract } from './qr-contract';
export { ManualTripInitiationStrategy, QRCodeTripInitiationStrategy, getInitiationStrategy } from './initiation-strategies';
export type { InitiationInput, InitiationResult, TripInitiationStrategy } from './initiation-strategies';
export { broadcastTripEvent } from './services/trip-broadcast.service';
export { dispatchTripNotification } from './services/trip-notification.service';
export { cleanupTrip } from './services/trip-cleanup.service';
export { verifyDriverBusAssignment, checkNoConflict, resolveRouteId, resolveRouteName } from './services/trip-validation.service';
