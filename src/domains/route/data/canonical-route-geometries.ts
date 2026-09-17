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

export interface RouteGeometryRecord {
  routeId: string;
  routeName: string;
  description: string;
  totalStops: number;
  coordinates: LatLng[];
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
    totalStops: 13,
    coordinates: [
      { lat: 26.1264, lng: 91.6852 }, // Boragaon
      { lat: 26.1221, lng: 91.7015 }, // Garchuk
      { lat: 26.1189, lng: 91.7240 }, // Lokhra Chariali
      { lat: 26.1255, lng: 91.7480 }, // Lalmati
      { lat: 26.1310, lng: 91.7650 }, // National Games Village
      { lat: 26.1368, lng: 91.7825 }, // Beltola Tiniali
      { lat: 26.1472, lng: 91.7890 }, // Last Gate / Dispur
      { lat: 26.1524, lng: 91.7832 }, // Ganeshguri Flyover
      { lat: 26.1645, lng: 91.7801 }, // Zoo Road Tiniali
      { lat: 26.1732, lng: 91.7915 }, // Gitanagar
      { lat: 26.1820, lng: 91.8150 }, // Noonmati / BG Tiniali
      { lat: 26.1910, lng: 91.8540 }, // Narengi
      { lat: 26.1965, lng: 91.8580 }, // Panikhaiti approach
      { lat: 26.2019, lng: 91.8615 }, // Assam down town University Campus
    ],
  },

  // Route 2: Jalukbari -> Maligaon -> Panbazar -> Chandmari -> AdtU Campus
  route_2: {
    routeId: 'route_2',
    routeName: 'Route-2',
    description: 'Jalukbari to AdtU Campus via Maligaon, Bharalumukh, Panbazar, and Chandmari',
    totalStops: 9,
    coordinates: [
      { lat: 26.1458, lng: 91.6620 }, // Jalukbari Rotary
      { lat: 26.1550, lng: 91.6912 }, // Maligaon Chariali
      { lat: 26.1632, lng: 91.7145 }, // Bhutnath
      { lat: 26.1685, lng: 91.7250 }, // Santipur
      { lat: 26.1730, lng: 91.7340 }, // Bharalumukh
      { lat: 26.1812, lng: 91.7420 }, // Fancy Bazar
      { lat: 26.1865, lng: 91.7510 }, // Panbazar Overbridge
      { lat: 26.1870, lng: 91.7725 }, // Chandmari Flyover
      { lat: 26.1895, lng: 91.8020 }, // Bamunimaidan
      { lat: 26.1910, lng: 91.8540 }, // Narengi
      { lat: 26.2019, lng: 91.8615 }, // Assam down town University Campus
    ],
  },

  // Route 3: Guwahati Club -> Silpukhuri -> Noonmati -> Narengi -> AdtU Campus
  route_3: {
    routeId: 'route_3',
    routeName: 'Route-3',
    description: 'Guwahati Club to AdtU Campus via Silpukhuri, Noonmati, and Panikhaiti',
    totalStops: 9,
    coordinates: [
      { lat: 26.1872, lng: 91.7565 }, // Guwahati Club
      { lat: 26.1880, lng: 91.7640 }, // Silpukhuri
      { lat: 26.1875, lng: 91.7760 }, // Anuradha Cinema / Chandmari
      { lat: 26.1895, lng: 91.7920 }, // Bamunimaidan Industrial Area
      { lat: 26.1905, lng: 91.8120 }, // New Guwahati
      { lat: 26.1920, lng: 91.8310 }, // Noonmati Sector 2
      { lat: 26.1910, lng: 91.8540 }, // Narengi
      { lat: 26.1975, lng: 91.8585 }, // Panikhaiti Tiniali
      { lat: 26.2019, lng: 91.8615 }, // Assam down town University Campus
    ],
  },

  // Route 4: Paltan Bazar -> Ulubari -> Ganeshguri -> Six Mile -> Narengi -> AdtU Campus (Canonical Corridor)
  route_4: {
    routeId: 'route_4',
    routeName: 'Route-4',
    description: 'Paltan Bazar to AdtU Campus via GS Road, Six Mile, and VIP Road',
    totalStops: 14,
    coordinates: [
      { lat: 26.1445, lng: 91.7362 }, // Paltan Bazar ASTC transit hub
      { lat: 26.1512, lng: 91.7485 }, // Ulubari Flyover
      { lat: 26.1540, lng: 91.7560 }, // Bora Service
      { lat: 26.1580, lng: 91.7650 }, // Bhangagarh / GMCH
      { lat: 26.1588, lng: 91.7735 }, // Christian Basti
      { lat: 26.1595, lng: 91.7820 }, // Ganeshguri
      { lat: 26.1620, lng: 91.7990 }, // Down Town Hospital
      { lat: 26.1700, lng: 91.8210 }, // Six Mile Flyover
      { lat: 26.1745, lng: 91.8315 }, // Barbari VIP Road
      { lat: 26.1780, lng: 91.8420 }, // Magzine / Khanapara turn
      { lat: 26.1845, lng: 91.8480 }, // Patharkuwary
      { lat: 26.1910, lng: 91.8540 }, // Narengi Tiniali
      { lat: 26.1975, lng: 91.8585 }, // Panikhaiti
      { lat: 26.2019, lng: 91.8615 }, // Assam down town University Campus
    ],
  },

  // Route 7: Down Town -> Sixmile -> VIP Road -> AdtU Campus
  route_7: {
    routeId: 'route_7',
    routeName: 'Route-7',
    description: 'Down Town Hospital to AdtU Campus via Sixmile and Patharkuwary',
    totalStops: 7,
    coordinates: [
      { lat: 26.1620, lng: 91.7990 }, // Down Town
      { lat: 26.1700, lng: 91.8210 }, // Sixmile
      { lat: 26.1745, lng: 91.8315 }, // Barbari
      { lat: 26.1780, lng: 91.8420 }, // Magzine
      { lat: 26.1845, lng: 91.8480 }, // Patharkuwary
      { lat: 26.1910, lng: 91.8540 }, // Narengi
      { lat: 26.2019, lng: 91.8615 }, // Assam down town University Campus
    ],
  },

  // Route 8: Lakhmi Mandir -> Beltola -> Last Gate -> AdtU Campus
  route_8: {
    routeId: 'route_8',
    routeName: 'Route-8',
    description: 'Lakhmi Mandir to AdtU Campus via Beltola Wireless and Last Gate',
    totalStops: 4,
    coordinates: [
      { lat: 26.1315, lng: 91.7750 }, // Lakhmi Mandir
      { lat: 26.1390, lng: 91.7845 }, // Beltola (Wireless)
      { lat: 26.1472, lng: 91.7890 }, // Last Gate
      { lat: 26.1700, lng: 91.8210 }, // Six Mile transit link
      { lat: 26.1910, lng: 91.8540 }, // Narengi
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
