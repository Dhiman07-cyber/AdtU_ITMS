/** Live tracking map engines (UI implementation). */
export type LiveMapEngine = "guwahati";

/** Stored in Firestore system config. */
export type MapProviderId = "guwahati";

export function engineFromMapProvider(provider: MapProviderId | undefined | null): LiveMapEngine {
    return "guwahati";
}
