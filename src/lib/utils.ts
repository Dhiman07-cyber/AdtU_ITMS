import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { areShiftsCompatible } from "@/lib/utils/shift-utils";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats IDs like 'route_6' to 'Route-6' or 'bus_1' to 'Bus-1'
 */
export function formatIdForDisplay(id: string | undefined | null): string {
  if (!id) return '';
  return id
    .replace(/_/g, '-')
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('-');
}

export function isShiftCompatible(studentShift?: string | null, tripShift?: string | null): boolean {
  return areShiftsCompatible(studentShift, tripShift);
}

/**
 * Checks whether two bus identifiers match, tolerating canonical 'bus_' prefixes.
 * Examples: isMatchingBusId('bus_01', '01') => true, isMatchingBusId('04', 'bus_04') => true
 */
export function isMatchingBusId(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const normA = a.startsWith('bus_') ? a.slice(4) : a;
  const normB = b.startsWith('bus_') ? b.slice(4) : b;
  return normA === normB;
}

/**
 * Returns canonical variations of a bus ID (with and without 'bus_' prefix).
 */
export function getBusIdVariations(busId: string): string[] {
  if (!busId) return [];
  return busId.startsWith('bus_') ? [busId, busId.replace(/^bus_/, '')] : [busId, `bus_${busId}`];
}


