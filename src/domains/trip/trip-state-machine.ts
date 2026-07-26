export enum TripState {
  Idle = 'IDLE',
  Starting = 'STARTING',
  Active = 'ACTIVE',
  Ending = 'ENDING',
  Ended = 'ENDED',
  Expired = 'EXPIRED',
}

export enum TripEvent {
  Initiate = 'INITIATE',
  LockAcquired = 'LOCK_ACQUIRED',
  LockFailed = 'LOCK_FAILED',
  EndRequested = 'END_REQUESTED',
  EndCompleted = 'END_COMPLETED',
  HeartbeatExpired = 'HEARTBEAT_EXPIRED',
}

type TransitionMap = Partial<Record<TripState, Partial<Record<TripEvent, TripState>>>>;

const transitions: TransitionMap = {
  [TripState.Idle]: {
    [TripEvent.Initiate]: TripState.Starting,
  },
  [TripState.Starting]: {
    [TripEvent.LockAcquired]: TripState.Active,
    [TripEvent.LockFailed]: TripState.Idle,
  },
  [TripState.Active]: {
    [TripEvent.EndRequested]: TripState.Ending,
    [TripEvent.HeartbeatExpired]: TripState.Expired,
  },
  [TripState.Ending]: {
    [TripEvent.EndCompleted]: TripState.Ended,
  },
  [TripState.Ended]: {},
  [TripState.Expired]: {},
};

export function transition(current: TripState, event: TripEvent): TripState {
  const next = transitions[current]?.[event];
  if (!next) throw new Error(`Invalid transition: ${current} -> ${event}`);
  return next;
}

export function canTransition(current: TripState, event: TripEvent): boolean {
  return !!transitions[current]?.[event];
}
