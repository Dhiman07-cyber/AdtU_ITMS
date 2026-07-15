// D11 Admin — public surface. Only this file may be imported by other domains.
//
// Admin is an orchestration domain — it coordinates other domains but never
// owns their business logic. Only admin-specific orchestration capabilities
// are exposed here.
export {
  sendStudentAddedEmail,
  sendApplicationRejectedEmail,
  sendApplicationApprovedEmail,
  reconcileBusLoads,
  detectIntegrityIssues,
  activateUpcomingApplications,
  activateApplication,
} from './services/admin.service';
export type {
  SessionActivationSummary,
  IntegrityReport,
  IntegrityFinding,
  ReconcileSummary,
  ReconcileOptions,
} from './services/admin.service';

// D11 Config — system configuration and operational markers
export {
  getSystemConfig,
  updateSystemConfig,
  getLandingConfig,
  updateLandingConfig,
  getUiConfig,
  updateUiConfig,
  getLegalConfig,
  updateLegalConfig,
  findMarker,
  upsertMarker,
} from './services/config.service';
export type {
  ConfigResult,
  SystemConfig,
  LandingConfig,
  UiConfig,
  LegalConfig,
  LegalConfigSection,
} from './services/config.service';
