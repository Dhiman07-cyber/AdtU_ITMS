export {
  startTrip,
  endTrip,
  heartbeat,
  canOperate,
  getActiveTrip,
  type StartTripParams,
  type StartTripOutput,
  type EndTripParams,
  type EndTripOutput,
  type HeartbeatParams,
} from './trip-orchestrator';
export type { CanOperateResult, StartTripResult, EndTripResult, HeartbeatResult } from '@/lib/services/trip-lock-service';
