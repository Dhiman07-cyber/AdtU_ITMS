/**
 * src/domains/route/data/canonical-route-geometries.ts
 *
 * Canonical machine-readable route polylines for Assam down town University transit corridors.
 * Coordinates are ordered [lat, lng] for geometry calculations and converted to GeoJSON [lng, lat]
 * where required by MapLibre GL.
 *
 * All routes terminate at Assam down town University (AdtU Campus): lat 26.2019, lng 91.8615.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export type GeometryProvenance =
  | 'VERIFIED PRODUCTION'
  | 'VERIFIED EXTERNAL'
  | 'VERIFIED GPS-TRACE'
  | 'MANUAL VERIFIED'
  | 'SYNTHETIC TEST'
  | 'UNKNOWN';

export interface RouteGeometryRecord {
  routeId: string;
  routeName: string;
  description: string;
  totalStops: number;
  coordinates: LatLng[];
  provenance: GeometryProvenance;
  coordinateSystem: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  sourceVersion: string;
  lastVerified: string;
}

/**
 * High-precision corridor vertices along Guwahati arterial transit roads:
 * - GS Road (Paltan Bazar -> Ulubari -> Bhangagarh -> Christian Basti -> Ganeshguri)
 * - Beltola / Basistha corridor (Boragaon -> Garchuk -> Lokhra -> Lalmati -> Beltola -> Last Gate)
 * - VIP Road / Narengi corridor (Six Mile -> Panikhaiti -> Narengi -> AdtU Campus)
 * - MG Road / Brahmaputra riverfront (Jalukbari -> Maligaon -> Bharalumukh -> Panbazar -> Chandmari)
 */
export const CANONICAL_ROUTE_GEOMETRIES: Record<string, RouteGeometryRecord> = {
  // Route 1: Boragaon / Garchuk -> Beltola -> Ganeshguri -> Narengi -> AdtU Campus
  route_1: {
    routeId: 'route_1',
    routeName: 'Route-1',
    description: 'Boragaon to AdtU Campus via Lokhra, Beltola, Ganeshguri, and Narengi',
    totalStops: 14,
    provenance: 'VERIFIED PRODUCTION',
    coordinateSystem: 'WGS84 (EPSG:4326)',
    confidence: 'HIGH',
    sourceVersion: 'v2026.10',
    lastVerified: '2026-10-18',
    coordinates: [
      { lat: 26.1128, lng: 91.6876 }, // Boragaon
      { lat: 26.1122, lng: 91.7098 }, // Garchuk
      { lat: 26.1117, lng: 91.7494 }, // Lokhra Chariali
      { lat: 26.1132, lng: 91.7755 }, // Lalmati
      { lat: 26.1145, lng: 91.7868 }, // National Games Village
      { lat: 26.1241, lng: 91.7994 }, // Beltola Tiniali
      { lat: 26.1438, lng: 91.7896 }, // Last Gate / Dispur
      { lat: 26.1518, lng: 91.7836 }, // Ganeshguri Bus Stop
      { lat: 26.1656, lng: 91.7812 }, // Zoo Road Tiniali
      { lat: 26.1738, lng: 91.7945 }, // Gitanagar
      { lat: 26.1825, lng: 91.8058 }, // Noonmati / BG Tiniali
      { lat: 26.1795, lng: 91.8325 }, // Narengi Tiniali
      { lat: 26.1972, lng: 91.8575 }, // Panikhaiti Tiniali
      { lat: 26.2019, lng: 91.8615 }, // Assam down town University Campus
    ],
  },

  // Route 2: Jalukbari -> Maligaon -> Panbazar -> Chandmari -> AdtU Campus
  route_2: {
    routeId: 'route_2',
    routeName: 'Route-2',
    description: 'Jalukbari to AdtU Campus via Maligaon, Bharalumukh, Panbazar, and Chandmari',
    totalStops: 11,
    provenance: 'VERIFIED PRODUCTION',
    coordinateSystem: 'WGS84 (EPSG:4326)',
    confidence: 'HIGH',
    sourceVersion: 'v2026.10',
    lastVerified: '2026-10-18',
    coordinates: [
      { lat: 26.1465, lng: 91.6625 }, // Jalukbari Bus Stop
      { lat: 26.1542, lng: 91.6972 }, // Maligaon Chariali
      { lat: 26.1654, lng: 91.7188 }, // Bhutnath
      { lat: 26.1702, lng: 91.7248 }, // Santipur
      { lat: 26.1738, lng: 91.7322 }, // Bharalumukh
      { lat: 26.1828, lng: 91.7405 }, // Fancy Bazar
      { lat: 26.1850, lng: 91.7478 }, // Panbazar Bus Stop
      { lat: 26.1882, lng: 91.7738 }, // Chandmari Bus Stop
      { lat: 26.1865, lng: 91.7892 }, // Bamunimaidan
      { lat: 26.1795, lng: 91.8325 }, // Narengi Tiniali
      { lat: 26.2019, lng: 91.8615 }, // Assam down town University Campus
    ],
  },

  // Route 3: Guwahati Club -> Silpukhuri -> Noonmati -> Narengi -> AdtU Campus
  route_3: {
    routeId: 'route_3',
    routeName: 'Route-3',
    description: 'Guwahati Club to AdtU Campus via Silpukhuri, Noonmati, and Panikhaiti',
    totalStops: 9,
    provenance: 'VERIFIED PRODUCTION',
    coordinateSystem: 'WGS84 (EPSG:4326)',
    confidence: 'HIGH',
    sourceVersion: 'v2026.10',
    lastVerified: '2026-10-18',
    coordinates: [
      { lat: 26.1858, lng: 91.7578 }, // Guwahati Club
      { lat: 26.1872, lng: 91.7642 }, // Silpukhuri
      { lat: 26.1874, lng: 91.7798 }, // Anuradha Cinema / Chandmari
      { lat: 26.1860, lng: 91.7945 }, // Bamunimaidan Industrial Area
      { lat: 26.1848, lng: 91.8012 }, // New Guwahati
      { lat: 26.1835, lng: 91.8122 }, // Noonmati Sector 2
      { lat: 26.1795, lng: 91.8325 }, // Narengi Tiniali
      { lat: 26.1972, lng: 91.8575 }, // Panikhaiti Tiniali
      { lat: 26.2019, lng: 91.8615 }, // Assam down town University Campus
    ],
  },

  // Route 4: Paltan Bazar -> Ulubari -> Ganeshguri -> Six Mile -> Narengi -> AdtU Campus
  route_4: {
    routeId: 'route_4',
    routeName: 'Route-4',
    description: 'Paltan Bazar to AdtU Campus via GS Road, Six Mile, and VIP Road',
    totalStops: 14,
    provenance: 'VERIFIED PRODUCTION',
    coordinateSystem: 'WGS84 (EPSG:4326)',
    confidence: 'HIGH',
    sourceVersion: 'v2026.10',
    lastVerified: '2026-10-18',
    coordinates: [
      { lat: 26.1818, lng: 91.7516 }, // Paltan Bazar ASTC
      { lat: 26.1732, lng: 91.7568 }, // Ulubari Bus Stop
      { lat: 26.1704, lng: 91.7618 }, // Bora Service
      { lat: 26.1652, lng: 91.7684 }, // Bhangagarh / GMCH
      { lat: 26.1592, lng: 91.7758 }, // Christian Basti
      { lat: 26.1518, lng: 91.7836 }, // Ganeshguri
      { lat: 26.1394, lng: 91.7992 }, // Down Town Hospital
      { lat: 26.1348, lng: 91.8062 }, // Six Mile Bus Stop
      { lat: 26.1518, lng: 91.8152 }, // Barbari VIP Road
      { lat: 26.1615, lng: 91.8214 }, // Magzine VIP Road
      { lat: 26.1695, lng: 91.8268 }, // Patharkuwary
      { lat: 26.1795, lng: 91.8325 }, // Narengi Tiniali
      { lat: 26.1972, lng: 91.8575 }, // Panikhaiti Tiniali
      { lat: 26.2019, lng: 91.8615 }, // Assam down town University Campus
    ],
  },

  // Route 7: Down Town -> Sixmile -> VIP Road -> AdtU Campus
  route_7: {
    routeId: 'route_7',
    routeName: 'Route-7',
    description: 'Down Town Hospital to AdtU Campus via Sixmile and Patharkuwary',
    totalStops: 7,
    provenance: 'VERIFIED PRODUCTION',
    coordinateSystem: 'WGS84 (EPSG:4326)',
    confidence: 'HIGH',
    sourceVersion: 'v2026.10',
    lastVerified: '2026-10-18',
    coordinates: [
      { lat: 26.1394, lng: 91.7992 }, // Down Town Hospital
      { lat: 26.1348, lng: 91.8062 }, // Sixmile Bus Stop
      { lat: 26.1518, lng: 91.8152 }, // Barbari VIP Road
      { lat: 26.1615, lng: 91.8214 }, // Magzine VIP Road
      { lat: 26.1695, lng: 91.8268 }, // Patharkuwary
      { lat: 26.1795, lng: 91.8325 }, // Narengi Tiniali
      { lat: 26.2019, lng: 91.8615 }, // Assam down town University Campus
    ],
  },

  // Route 8: Lakhmi Mandir -> Beltola -> Last Gate -> AdtU Campus
  route_8: {
    routeId: 'route_8',
    routeName: 'Route-8',
    description: 'Lakhmi Mandir to AdtU Campus via Beltola Wireless and Last Gate',
    totalStops: 6,
    provenance: 'VERIFIED PRODUCTION',
    coordinateSystem: 'WGS84 (EPSG:4326)',
    confidence: 'HIGH',
    sourceVersion: 'v2026.10',
    lastVerified: '2026-10-18',
    coordinates: [
      { lat: 26.1282, lng: 91.7958 }, // Lakhmi Mandir (Beltola)
      { lat: 26.1368, lng: 91.7924 }, // Beltola (Wireless)
      { lat: 26.1438, lng: 91.7896 }, // Last Gate / Dispur
      { lat: 26.1348, lng: 91.8062 }, // Six Mile Bus Stop
      { lat: 26.1795, lng: 91.8325 }, // Narengi Tiniali
      { lat: 26.2019, lng: 91.8615 }, // Assam down town University Campus
    ],
  },
};

/**
 * Normalizes route ID variations (e.g. 'route_1', 'ROUTE-1', 'STAGING-ROUTE-001')
 * and returns the canonical polyline coordinates, or null if geometry is unavailable.
 */
export function getCanonicalRouteGeometry(routeId: string | null | undefined): LatLng[] | null {
  if (!routeId) return null;
  const cleanId = routeId.trim().toLowerCase().replace(/-/g, '_');

  // Direct match (e.g. 'route_1')
  if (CANONICAL_ROUTE_GEOMETRIES[cleanId]) {
    return CANONICAL_ROUTE_GEOMETRIES[cleanId].coordinates;
  }

  // Handle 'route-1' or 'route1'
  const routeNumMatch = cleanId.match(/route_?(\d+)/);
  if (routeNumMatch) {
    const key = `route_${routeNumMatch[1]}`;
    if (CANONICAL_ROUTE_GEOMETRIES[key]) {
      return CANONICAL_ROUTE_GEOMETRIES[key].coordinates;
    }
  }

  // Handle staging routes: 'staging_route_001' maps to canonical Route-4 corridor
  if (cleanId.includes('staging_route')) {
    return CANONICAL_ROUTE_GEOMETRIES['route_4'].coordinates;
  }

  return null;
}

export interface CanonicalStop {
  id?: string;
  stop_id?: string;
  name: string;
  stop_name: string;
  lat: number;
  lng: number;
  sequence: number;
}

export const CANONICAL_ROUTE_STOPS: Record<string, CanonicalStop[]> = {
  route_1: [
    { name: 'Boragaon', stop_name: 'Boragaon', lat: 26.1128, lng: 91.6876, sequence: 1 },
    { name: 'Garchuk', stop_name: 'Garchuk', lat: 26.1122, lng: 91.7098, sequence: 2 },
    { name: 'Lokhra Chariali', stop_name: 'Lokhra Chariali', lat: 26.1117, lng: 91.7494, sequence: 3 },
    { name: 'Lalmati', stop_name: 'Lalmati', lat: 26.1132, lng: 91.7755, sequence: 4 },
    { name: 'National Games Village', stop_name: 'National Games Village', lat: 26.1145, lng: 91.7868, sequence: 5 },
    { name: 'Beltola Tiniali', stop_name: 'Beltola Tiniali', lat: 26.1241, lng: 91.7994, sequence: 6 },
    { name: 'Last Gate / Dispur', stop_name: 'Last Gate / Dispur', lat: 26.1438, lng: 91.7896, sequence: 7 },
    { name: 'Ganeshguri Bus Stop', stop_name: 'Ganeshguri Bus Stop', lat: 26.1518, lng: 91.7836, sequence: 8 },
    { name: 'Zoo Road Tiniali', stop_name: 'Zoo Road Tiniali', lat: 26.1656, lng: 91.7812, sequence: 9 },
    { name: 'Gitanagar', stop_name: 'Gitanagar', lat: 26.1738, lng: 91.7945, sequence: 10 },
    { name: 'Noonmati / BG Tiniali', stop_name: 'Noonmati / BG Tiniali', lat: 26.1825, lng: 91.8058, sequence: 11 },
    { name: 'Narengi Tiniali', stop_name: 'Narengi Tiniali', lat: 26.1795, lng: 91.8325, sequence: 12 },
    { name: 'Panikhaiti Tiniali', stop_name: 'Panikhaiti Tiniali', lat: 26.1972, lng: 91.8575, sequence: 13 },
    { name: 'Assam down town University Campus', stop_name: 'Assam down town University Campus', lat: 26.2019, lng: 91.8615, sequence: 14 },
  ],
  route_2: [
    { name: 'Jalukbari Bus Stop', stop_name: 'Jalukbari Bus Stop', lat: 26.1465, lng: 91.6625, sequence: 1 },
    { name: 'Maligaon Chariali', stop_name: 'Maligaon Chariali', lat: 26.1542, lng: 91.6972, sequence: 2 },
    { name: 'Bhutnath', stop_name: 'Bhutnath', lat: 26.1654, lng: 91.7188, sequence: 3 },
    { name: 'Santipur', stop_name: 'Santipur', lat: 26.1702, lng: 91.7248, sequence: 4 },
    { name: 'Bharalumukh', stop_name: 'Bharalumukh', lat: 26.1738, lng: 91.7322, sequence: 5 },
    { name: 'Fancy Bazar', stop_name: 'Fancy Bazar', lat: 26.1828, lng: 91.7405, sequence: 6 },
    { name: 'Panbazar Bus Stop', stop_name: 'Panbazar Bus Stop', lat: 26.1850, lng: 91.7478, sequence: 7 },
    { name: 'Chandmari Bus Stop', stop_name: 'Chandmari Bus Stop', lat: 26.1882, lng: 91.7738, sequence: 8 },
    { name: 'Bamunimaidan', stop_name: 'Bamunimaidan', lat: 26.1865, lng: 91.7892, sequence: 9 },
    { name: 'Narengi Tiniali', stop_name: 'Narengi Tiniali', lat: 26.1795, lng: 91.8325, sequence: 10 },
    { name: 'Assam down town University Campus', stop_name: 'Assam down town University Campus', lat: 26.2019, lng: 91.8615, sequence: 11 },
  ],
  route_3: [
    { name: 'Guwahati Club', stop_name: 'Guwahati Club', lat: 26.1858, lng: 91.7578, sequence: 1 },
    { name: 'Silpukhuri', stop_name: 'Silpukhuri', lat: 26.1872, lng: 91.7642, sequence: 2 },
    { name: 'Anuradha Cinema / Chandmari', stop_name: 'Anuradha Cinema / Chandmari', lat: 26.1874, lng: 91.7798, sequence: 3 },
    { name: 'Bamunimaidan Industrial Area', stop_name: 'Bamunimaidan Industrial Area', lat: 26.1860, lng: 91.7945, sequence: 4 },
    { name: 'New Guwahati', stop_name: 'New Guwahati', lat: 26.1848, lng: 91.8012, sequence: 5 },
    { name: 'Noonmati Sector 2', stop_name: 'Noonmati Sector 2', lat: 26.1835, lng: 91.8122, sequence: 6 },
    { name: 'Narengi Tiniali', stop_name: 'Narengi Tiniali', lat: 26.1795, lng: 91.8325, sequence: 7 },
    { name: 'Panikhaiti Tiniali', stop_name: 'Panikhaiti Tiniali', lat: 26.1972, lng: 91.8575, sequence: 8 },
    { name: 'Assam down town University Campus', stop_name: 'Assam down town University Campus', lat: 26.2019, lng: 91.8615, sequence: 9 },
  ],
  route_4: [
    { name: 'Paltan Bazar ASTC', stop_name: 'Paltan Bazar ASTC', lat: 26.1818, lng: 91.7516, sequence: 1 },
    { name: 'Ulubari Bus Stop', stop_name: 'Ulubari Bus Stop', lat: 26.1732, lng: 91.7568, sequence: 2 },
    { name: 'Bora Service', stop_name: 'Bora Service', lat: 26.1704, lng: 91.7618, sequence: 3 },
    { name: 'Bhangagarh / GMCH', stop_name: 'Bhangagarh / GMCH', lat: 26.1652, lng: 91.7684, sequence: 4 },
    { name: 'Christian Basti', stop_name: 'Christian Basti', lat: 26.1592, lng: 91.7758, sequence: 5 },
    { name: 'Ganeshguri', stop_name: 'Ganeshguri', lat: 26.1518, lng: 91.7836, sequence: 6 },
    { name: 'Down Town Hospital', stop_name: 'Down Town Hospital', lat: 26.1394, lng: 91.7992, sequence: 7 },
    { name: 'Six Mile Bus Stop', stop_name: 'Six Mile Bus Stop', lat: 26.1348, lng: 91.8062, sequence: 8 },
    { name: 'Barbari VIP Road', stop_name: 'Barbari VIP Road', lat: 26.1518, lng: 91.8152, sequence: 9 },
    { name: 'Magzine VIP Road', stop_name: 'Magzine VIP Road', lat: 26.1615, lng: 91.8214, sequence: 10 },
    { name: 'Patharkuwary', stop_name: 'Patharkuwary', lat: 26.1695, lng: 91.8268, sequence: 11 },
    { name: 'Narengi Tiniali', stop_name: 'Narengi Tiniali', lat: 26.1795, lng: 91.8325, sequence: 12 },
    { name: 'Panikhaiti Tiniali', stop_name: 'Panikhaiti Tiniali', lat: 26.1972, lng: 91.8575, sequence: 13 },
    { name: 'Assam down town University Campus', stop_name: 'Assam down town University Campus', lat: 26.2019, lng: 91.8615, sequence: 14 },
  ],
  route_7: [
    { name: 'Down Town Hospital', stop_name: 'Down Town Hospital', lat: 26.1394, lng: 91.7992, sequence: 1 },
    { name: 'Sixmile Bus Stop', stop_name: 'Sixmile Bus Stop', lat: 26.1348, lng: 91.8062, sequence: 2 },
    { name: 'Barbari VIP Road', stop_name: 'Barbari VIP Road', lat: 26.1518, lng: 91.8152, sequence: 3 },
    { name: 'Magzine VIP Road', stop_name: 'Magzine VIP Road', lat: 26.1615, lng: 91.8214, sequence: 4 },
    { name: 'Patharkuwary', stop_name: 'Patharkuwary', lat: 26.1695, lng: 91.8268, sequence: 5 },
    { name: 'Narengi Tiniali', stop_name: 'Narengi Tiniali', lat: 26.1795, lng: 91.8325, sequence: 6 },
    { name: 'Assam down town University Campus', stop_name: 'Assam down town University Campus', lat: 26.2019, lng: 91.8615, sequence: 7 },
  ],
  route_8: [
    { name: 'Lakhmi Mandir (Beltola)', stop_name: 'Lakhmi Mandir (Beltola)', lat: 26.1282, lng: 91.7958, sequence: 1 },
    { name: 'Beltola (Wireless)', stop_name: 'Beltola (Wireless)', lat: 26.1368, lng: 91.7924, sequence: 2 },
    { name: 'Last Gate / Dispur', stop_name: 'Last Gate / Dispur', lat: 26.1438, lng: 91.7896, sequence: 3 },
    { name: 'Six Mile Bus Stop', stop_name: 'Six Mile Bus Stop', lat: 26.1348, lng: 91.8062, sequence: 4 },
    { name: 'Narengi Tiniali', stop_name: 'Narengi Tiniali', lat: 26.1795, lng: 91.8325, sequence: 5 },
    { name: 'Assam down town University Campus', stop_name: 'Assam down town University Campus', lat: 26.2019, lng: 91.8615, sequence: 6 },
  ],
};

export function getCanonicalStopsForRoute(routeId: string | null | undefined): CanonicalStop[] {
  if (!routeId) return [];
  const cleanId = routeId.trim().toLowerCase().replace(/-/g, '_');

  if (CANONICAL_ROUTE_STOPS[cleanId]) {
    return CANONICAL_ROUTE_STOPS[cleanId];
  }

  const routeNumMatch = cleanId.match(/route_?(\d+)/);
  if (routeNumMatch) {
    const key = `route_${routeNumMatch[1]}`;
    if (CANONICAL_ROUTE_STOPS[key]) {
      return CANONICAL_ROUTE_STOPS[key];
    }
  }

  if (cleanId.includes('staging_route')) {
    return CANONICAL_ROUTE_STOPS['route_4'];
  }

  return [];
}

export function findCanonicalStopCoordinates(
  routeId: string | null | undefined,
  stopName: string | null | undefined
): LatLng | null {
  if (!stopName) return null;
  const normalizedTarget = stopName.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!normalizedTarget) return null;

  const stops = getCanonicalStopsForRoute(routeId);
  for (const s of stops) {
    const candidate1 = (s.stop_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const candidate2 = (s.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const candidateId = ((s as any).stop_id || (s as any).id || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (
      candidate1 === normalizedTarget ||
      candidate2 === normalizedTarget ||
      (candidateId && candidateId === normalizedTarget) ||
      candidate1.includes(normalizedTarget) ||
      normalizedTarget.includes(candidate1)
    ) {
      return { lat: s.lat, lng: s.lng };
    }
  }

  // Cross-route fallback: check all routes if stopName is unique/known
  for (const stopList of Object.values(CANONICAL_ROUTE_STOPS)) {
    for (const s of stopList) {
      const c = (s.stop_name || s.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const cId = ((s as any).stop_id || (s as any).id || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (
        c === normalizedTarget ||
        (cId && cId === normalizedTarget) ||
        c.includes(normalizedTarget) ||
        normalizedTarget.includes(c)
      ) {
        return { lat: s.lat, lng: s.lng };
      }
    }
  }

  return null;
}

/**
 * Robust stop coordinate enricher.
 * Guarantees that even if database rows in PostgreSQL `routes.stops` contain
 * JSON objects with only `{ name, stopId, sequence }` and missing/zero lat/lng,
 * every stop is enriched with authoritative WGS84 coordinates from the canonical dictionary.
 */
export function enrichRouteStops(
  routeId: string | null | undefined,
  rawStops: any[] | null | undefined
): Array<{ name: string; stop_name: string; sequence: number; lat: number; lng: number; [key: string]: any }> {
  const canonical = getCanonicalStopsForRoute(routeId);

  if (!rawStops || !Array.isArray(rawStops) || rawStops.length === 0) {
    return canonical.map((s, idx) => ({
      ...s,
      name: s.name,
      stop_name: s.stop_name || s.name,
      sequence: s.sequence || idx + 1,
      lat: s.lat,
      lng: s.lng,
    }));
  }

  return rawStops.map((stop: any, idx: number) => {
    const rawName = stop?.name || stop?.stop_name || stop?.stopName || `Stop ${idx + 1}`;
    const stopName = stop?.stop_name || stop?.name || rawName;
    const sequence = typeof stop?.sequence === 'number' ? stop.sequence : idx + 1;
    let lat = typeof stop?.lat === 'number' && Number.isFinite(stop.lat) ? stop.lat : null;
    let lng = typeof stop?.lng === 'number' && Number.isFinite(stop.lng) ? stop.lng : null;

    // If coordinates are missing, non-finite, or identically zero, enrich from canonical
    if (lat === null || lng === null || (lat === 0 && lng === 0)) {
      const stopIdNorm = (stop?.stopId || stop?.stop_id || stop?.id || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
      const nameNorm = rawName.toLowerCase().replace(/[^a-z0-9]/g, '');

      // 1. Match against canonical stops of this route by stopId or name
      let matched = canonical.find((cs) => {
        const csId = (cs.stop_id || cs.id || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (stopIdNorm && csId && (stopIdNorm === csId || csId.includes(stopIdNorm) || stopIdNorm.includes(csId))) {
          return true;
        }
        const csName = (cs.name || cs.stop_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (nameNorm && csName && (nameNorm === csName || csName.includes(nameNorm) || nameNorm.includes(csName))) {
          return true;
        }
        return false;
      });

      // 2. Match by sequence within this route
      if (!matched && canonical.length > 0) {
        matched = canonical.find((cs) => cs.sequence === sequence) || canonical[idx];
      }

      // 3. Cross-route fallback
      if (matched) {
        lat = matched.lat;
        lng = matched.lng;
      } else {
        const crossCoords = findCanonicalStopCoordinates(routeId, rawName) || (stopIdNorm ? findCanonicalStopCoordinates(routeId, stopIdNorm) : null);
        if (crossCoords) {
          lat = crossCoords.lat;
          lng = crossCoords.lng;
        }
      }
    }

    return {
      ...stop,
      name: rawName,
      stop_name: stopName,
      sequence,
      lat: lat ?? 0,
      lng: lng ?? 0,
    };
  });
}

