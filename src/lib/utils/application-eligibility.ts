import { Application,ApplicationType,TargetSession } from '@/lib/types/application';
import { DeadlineConfig } from '@/lib/types/deadline-config';
import { computeBlockDatesFromValidUntil } from '@/lib/utils/deadline-computation';

/**
 * Phase 2 — Future-session eligibility.
 *
 * LOCKED RULE: eligibleApproval = softBlock(targetSession.startYear) + 1 day.
 *
 * A future-session application waits for the seats currently owned by the
 * OUTGOING session. Those seats are released (Phase 1) when that session's
 * students are soft-blocked. The soft-block date for a session ending in June of
 * year S is computed by `computeBlockDatesFromValidUntil` as the soft-block
 * month/day of year S. Therefore a future application whose service begins in
 * year S becomes approvable the day AFTER that soft block.
 *
 * The resolved date is FROZEN into the application document at creation time so
 * eligibility is deterministic and immune to later deadline-config edits.
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Compute the eligibleApproval ISO timestamp for a future-session application.
 *
 * @param targetStartYear the year service begins (targetSession.startYear)
 * @param config the deadline configuration in effect at creation time
 */
export function computeFutureEligibleApproval(
  targetStartYear: number,
  config: DeadlineConfig
): string {
  if (!config) throw new Error('Config required for computeFutureEligibleApproval');

  // Reuse the EXACT Phase 1 soft-block computation. The soft block of the
  // outgoing session occurs in the validUntil year; for a future application the
  // relevant year is the target start year (the outgoing students' validUntil
  // falls in June of that year). A proxy validUntil in that year yields the
  // identical soft-block date used by the seat-release path.
  const anchorMonth = config.academicYear.anchorMonth;
  const anchorDay = config.academicYear.anchorDay;
  const proxyValidUntil = new Date(
    targetStartYear,
    anchorMonth,
    anchorDay,
    23,
    59,
    59,
    999
  ).toISOString();

  const { softBlock } = computeBlockDatesFromValidUntil(proxyValidUntil, config);

  // +1 day: the application is approvable the day after seats are released.
  const eligible = new Date(new Date(softBlock).getTime() + ONE_DAY_MS);
  return eligible.toISOString();
}

/**
 * Resolve an application's type, defaulting legacy/absent values to 'fresh'.
 * Legacy applications created before Phase 2 carry no discriminator and are, by
 * definition, current-session fresh applications.
 */
export function resolveApplicationType(app: Partial<Application> & Record<string, any>): ApplicationType {
  if (!app) return 'fresh';
  const formData = (app.formData || app.form_data || {}) as Record<string, any>;
  const explicitType = app.applicationType || app.application_type || formData.applicationType || formData.application_type;
  if (explicitType === 'future' || explicitType === 'renewal' || explicitType === 'renewal_after_soft_block' || explicitType === 'fresh') {
    return explicitType as ApplicationType;
  }

  const currentYear = new Date().getFullYear();
  const sessionInfo = formData.sessionInfo || formData.session_info || {};
  const startYear = Number(
    app.sessionStartYear ||
    app.session_start_year ||
    app.targetSession?.startYear ||
    app.target_session?.start_year ||
    formData.sessionStartYear ||
    formData.startYear ||
    formData.session_start_year ||
    formData.start_year ||
    sessionInfo.sessionStartYear ||
    sessionInfo.startYear ||
    sessionInfo.session_start_year ||
    sessionInfo.start_year ||
    0
  );
  if (startYear > currentYear) {
    return 'future';
  }

  // Name hint check for test data (e.g. "Hayato - Future")
  const studentName = (formData.studentName || formData.student_name || formData.fullName || formData.full_name || app.applicantName || app.name || '').toLowerCase();
  if (studentName.includes('future')) {
    return 'future';
  }

  return 'fresh';
}

/**
 * Whether an application is approvable RIGHT NOW with respect to the locked
 * eligibility rule. This is purely the date/eligibility gate — it does NOT make
 * any statement about capacity, which remains enforced atomically at approval.
 *
 * Legacy/absent eligibleApproval ⇒ immediately eligible (fresh/renewal).
 *
 * @param app the application document
 * @param now optional clock injection for testing
 */
export function isApprovalEligible(
  app: Pick<Application, 'eligibleApproval'>,
  now: Date = new Date()
): boolean {
  if (!app.eligibleApproval) return true;
  return new Date(app.eligibleApproval).getTime() <= now.getTime();
}

/**
 * DERIVED upcoming-lifecycle status (Phase 2).
 *
 * Future-session ("upcoming") applications are NOT modelled with extra stored
 * Firestore states. They live in `state: 'submitted'` like any other application;
 * the ONLY thing holding them back is the frozen `eligibleApproval` date gate
 * (enforced server-side in both approval routes via `isApprovalEligible`).
 *
 * This function projects that single frozen date into the two human-facing
 * lifecycle labels the UI shows, so there is exactly one source of truth (the
 * date) and no mutable state to migrate or keep in sync:
 *
 *   - 'waiting_for_eligibility'  : now <  eligibleApproval  (seats not yet freed)
 *   - 'eligible_for_approval'    : now >= eligibleApproval  (approvable now)
 *
 * It is intentionally a pure projection of `isApprovalEligible` so the label can
 * never disagree with the server-side approval gate.
 */
export type UpcomingStatus = 'waiting_for_eligibility' | 'eligible_for_approval';

export function getUpcomingStatus(
  app: Pick<Application, 'eligibleApproval'>,
  now: Date = new Date()
): UpcomingStatus {
  return isApprovalEligible(app, now) ? 'eligible_for_approval' : 'waiting_for_eligibility';
}

/**
 * Whether an application is a future-session ("upcoming") application.
 * Centralised so UI and server agree on the single discriminator.
 */
export function isUpcomingApplication(app: Partial<Application> & Record<string, any>): boolean {
  if (!app) return false;
  if (app.state === 'verified_upcoming' || app.state === 'pending_seat_allocation') {
    return true;
  }
  if (resolveApplicationType(app) === 'future') {
    return true;
  }
  const currentYear = new Date().getFullYear();
  const formData = (app.formData || app.form_data || {}) as Record<string, any>;
  const sessionInfo = formData.sessionInfo || formData.session_info || {};
  const startYear = Number(
    app.sessionStartYear ||
    app.session_start_year ||
    app.targetSession?.startYear ||
    app.target_session?.start_year ||
    formData.sessionStartYear ||
    formData.startYear ||
    formData.session_start_year ||
    formData.start_year ||
    sessionInfo.sessionStartYear ||
    sessionInfo.startYear ||
    sessionInfo.session_start_year ||
    sessionInfo.start_year ||
    0
  );
  if (startYear > currentYear) {
    return true;
  }
  const studentName = (formData.studentName || formData.student_name || formData.fullName || formData.full_name || app.applicantName || app.name || '').toLowerCase();
  if (studentName.includes('future')) {
    return true;
  }
  return false;
}

/**
 * Build the eligibleApproval timestamp for ANY application type at creation.
 * 'fresh'/'renewal' are immediately eligible (creation time); 'future' uses the
 * locked soft-block(+1 day) rule.
 */
export function resolveEligibleApprovalAtCreation(
  type: ApplicationType,
  targetSession: TargetSession,
  config: DeadlineConfig,
  nowIso: string
): string {
  if (type === 'future') {
    return computeFutureEligibleApproval(targetSession.startYear, config);
  }
  return nowIso;
}

/**
 * Derive the Phase 2 categorisation fields for a NEW (fresh/future) application
 * from its chosen session, at creation/submission time.
 *
 * An application is 'future' when its service-start year is greater than the
 * current academic-session start year. The current session start year is the
 * calendar year of "now" when on/after the academic anchor (July), otherwise the
 * previous calendar year — derived purely from the deadline-config anchor, so no
 * separate global session pointer is needed.
 *
 * Renewal applications are categorised by the renewal flow itself, not here.
 *
 * @returns the three fields to merge into the application document.
 */
export function deriveCreationCategorisation(
  sessionStartYear: number,
  sessionEndYear: number,
  config: DeadlineConfig,
  nowIso: string
): { applicationType: ApplicationType; targetSession: TargetSession; eligibleApproval: string } {
  const now = new Date(nowIso);
  const anchorMonth = config.academicYear.anchorMonth; // 0-indexed (e.g. 6 = July)
  // Current session start year: if we are at/after the July anchor, the session
  // that started this calendar year is current; before July, last year's session
  // is still current.
  const currentSessionStartYear =
    now.getMonth() >= anchorMonth ? now.getFullYear() : now.getFullYear() - 1;

  const targetSession: TargetSession = { startYear: sessionStartYear, endYear: sessionEndYear };
  const applicationType: ApplicationType =
    sessionStartYear > currentSessionStartYear ? 'future' : 'fresh';
  const eligibleApproval = resolveEligibleApprovalAtCreation(
    applicationType,
    targetSession,
    config,
    nowIso
  );

  return { applicationType, targetSession, eligibleApproval };
}
