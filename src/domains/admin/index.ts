// D11 Config — system configuration and operational markers
export {
	findMarker,getLandingConfig,getLegalConfig,getSystemConfig,getUiConfig,invalidateConfigCache,updateLandingConfig,updateLegalConfig,updateSystemConfig,updateUiConfig,upsertMarker
} from './services/config.service';
export type {
	ConfigResult,LandingConfig,LegalConfig,
	LegalConfigSection,SystemConfig,UiConfig
} from './services/config.service';
