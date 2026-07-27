import { clsx,type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
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
