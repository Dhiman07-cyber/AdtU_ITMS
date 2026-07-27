import type { MapConfig,MapProvider,MapTheme } from "./map-config";
import { sanitizeMapConfigInput } from "./map-config";
import type { MapProviderId } from "./map-provider-types";

const STORAGE_KEY = "adtu_map_config_v1";

function isBrowser() {
  return typeof window !== "undefined";
}

export function readMapPreferences(): MapConfig | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return sanitizeMapConfigInput(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeMapPreferences(next: MapConfig) {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota/private mode errors
  }
}

export function resolveThemePreference(explicit: MapTheme | undefined): MapTheme {
  if (explicit) return explicit;
  if (!isBrowser()) return "dark";
  const root = document.documentElement;
  return root.classList.contains("dark") ? "dark" : "light";
}

export function systemConfigProviderToUserProvider(p: MapProviderId | undefined | null): MapProvider {
  return "guwahati";
}

export function userProviderToSystemConfigProvider(p: MapProvider): MapProviderId {
  return "guwahati";
}

