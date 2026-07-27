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
