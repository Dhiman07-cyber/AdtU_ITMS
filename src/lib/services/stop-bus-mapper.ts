import type { BusData } from '@/app/admin/smart-allocation/page';

export class StopBusMapper {
  private stopToBuses: Map<string, Set<string>> = new Map();
  private busToStops: Map<string, Set<string>> = new Map();
  
  updateMappings(buses: BusData[]) {
    // Clear existing mappings
    this.stopToBuses.clear();
    this.busToStops.clear();
    
    // Build new mappings
    buses.forEach(bus => {
      const stopSet = new Set<string>();
      
      bus.stops.forEach(stop => {
        stopSet.add(stop.id);
        
        // Add bus to stop mapping
        if (!this.stopToBuses.has(stop.id)) {
          this.stopToBuses.set(stop.id, new Set());
        }
        this.stopToBuses.get(stop.id)!.add(bus.id);
      });
      
      this.busToStops.set(bus.id, stopSet);
    });
  }
  
  getBusesForStop(stop_name: string): string[] {
    return Array.from(this.stopToBuses.get(stop_name) || []);
  }
  
  getStopsForBus(busId: string): string[] {
    return Array.from(this.busToStops.get(busId) || []);
  }
  
  getBusesForMultipleStops(stopIds: string[]): string[] {
    const busSet = new Set<string>();
    
    stopIds.forEach(stop_name => {
      const buses = this.stopToBuses.get(stop_name);
      if (buses) {
        buses.forEach(busId => busSet.add(busId));
      }
    });
    
    return Array.from(busSet);
  }
  
  canBusServeStop(busId: string, stop_name: string): boolean {
    const stops = this.busToStops.get(busId);
    return stops ? stops.has(stop_name) : false;
  }
  
  canBusServeAllStops(busId: string, stopIds: string[]): boolean {
    const stops = this.busToStops.get(busId);
    if (!stops) return false;
    
    return stopIds.every(stop_name => stops.has(stop_name));
  }
  
  getCommonBuses(stopIds: string[]): string[] {
    if (stopIds.length === 0) return [];
    
    // Start with buses for first stop
    let commonBuses = new Set(this.getBusesForStop(stopIds[0]));
    
    // Intersect with buses for remaining stops
    for (let i = 1; i < stopIds.length; i++) {
      const buses = new Set(this.getBusesForStop(stopIds[i]));
      commonBuses = new Set([...commonBuses].filter(x => buses.has(x)));
    }
    
    return Array.from(commonBuses);
  }
}
