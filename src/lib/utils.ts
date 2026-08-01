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
