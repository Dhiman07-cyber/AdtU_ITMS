/**
 * Location Validation Service - Anti-Spoofing & Security
 * 
 * Validates location updates for:
 * - Impossible movements (teleportation)
 * - Excessive speed
 * - Suspicious patterns
 * - Geofence violations
 * - Replay attacks
 */

interface LocationData {
  lat: number;
  lng: number;
  timestamp: string;
  accuracy?: number;
  speed?: number;
  heading?: number;
  altitude?: number;
  source?: 'gps' | 'network' | 'unknown';
}

interface ValidationResult {
  valid: boolean;
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
  suspicious: boolean;
  recommendation: 'accept' | 'review' | 'reject';
}

interface ValidationConfig {
  maxSpeedKmh: number;           // Default: 120
  maxJumpMeters: number;         // Default: 500
  maxAccuracyMeters: number;     // Default: 50
  minTimeBetweenUpdates: number; // Default: 500ms
  maxTimeBetweenUpdates: number; // Default: 30000ms (30s)
  geofenceBounds?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  enableHistoryValidation: boolean; // Default: true
  historySize: number;              // Default: 20
}

export class LocationValidationService {
  private config: ValidationConfig;
  private locationHistory: Map<string, LocationData[]> = new Map();
  private suspiciousPatterns: Map<string, number> = new Map();
  private blacklist: Set<string> = new Set();

  constructor(config?: Partial<ValidationConfig>) {
    this.config = {
      maxSpeedKmh: 120,
      maxJumpMeters: 500,
      maxAccuracyMeters: 50,
      minTimeBetweenUpdates: 500,
      maxTimeBetweenUpdates: 30000,
      geofenceBounds: {
        north: 26.3,  // Guwahati region
        south: 25.9,
        east: 92.1,
        west: 91.4
      },
      enableHistoryValidation: true,
      historySize: 20,
      ...config
    };
  }

  /**
   * Validate a location update
   */
  public validateLocation(
    userId: string,
    location: LocationData
  ): ValidationResult {
    const result: ValidationResult = {
      valid: true,
      confidence: 'high',
      reasons: [],
      suspicious: false,
      recommendation: 'accept'
    };

    // Check if user is blacklisted
    if (this.blacklist.has(userId)) {
      return {
        valid: false,
        confidence: 'low',
        reasons: ['User is blacklisted for suspicious activity'],
        suspicious: true,
        recommendation: 'reject'
      };
    }

    // Basic validation
    if (!this.validateBasicConstraints(location, result)) {
      return result;
    }

    // Accuracy check
    this.validateAccuracy(location, result);

    // Geofence check
    this.validateGeofence(location, result);

    // History-based validation
    if (this.config.enableHistoryValidation) {
      const history = this.locationHistory.get(userId) || [];
      
      if (history.length > 0) {
        const lastLocation = history[history.length - 1];
        
        // Timing validation
        this.validateTiming(lastLocation, location, result);
        
        // Movement validation
        this.validateMovement(lastLocation, location, result);
        
        // Pattern detection
        this.detectSuspiciousPatterns(userId, history, location, result);
      }
      
      // Update history
      this.updateHistory(userId, location);
    }

    // Calculate final confidence and recommendation
    this.calculateFinalAssessment(userId, result);

    return result;
  }

  /**
   * Validate basic constraints
   */
  private validateBasicConstraints(
    location: LocationData,
    result: ValidationResult
  ): boolean {
    // Check valid coordinate range
    if (location.lat < -90 || location.lat > 90) {
      result.valid = false;
      result.reasons.push(`Invalid latitude: ${location.lat}`);
      return false;
    }

    if (location.lng < -180 || location.lng > 180) {
      result.valid = false;
      result.reasons.push(`Invalid longitude: ${location.lng}`);
      return false;
    }

    // Check for null island (0,0)
    if (location.lat === 0 && location.lng === 0) {
      result.valid = false;
      result.reasons.push('Null island coordinates detected');
      result.suspicious = true;
      return false;
    }

    return true;
  }

  /**
   * Validate accuracy
   */
  private validateAccuracy(
    location: LocationData,
    result: ValidationResult
  ): void {
    if (!location.accuracy) return;

    if (location.accuracy > this.config.maxAccuracyMeters) {
      result.confidence = 'low';
      result.reasons.push(`Low accuracy: ${location.accuracy.toFixed(0)}m`);
    } else if (location.accuracy > this.config.maxAccuracyMeters * 0.5) {
      result.confidence = 'medium';
      result.reasons.push(`Medium accuracy: ${location.accuracy.toFixed(0)}m`);
    }

    // Suspiciously perfect accuracy might indicate spoofing
    if (location.accuracy < 1) {
      result.suspicious = true;
      result.reasons.push('Suspiciously perfect accuracy');
    }
  }

  /**
   * Validate geofence
   */
  private validateGeofence(
    location: LocationData,
    result: ValidationResult
  ): void {
    if (!this.config.geofenceBounds) return;

    const bounds = this.config.geofenceBounds;
    
    if (location.lat < bounds.south || location.lat > bounds.north ||
        location.lng < bounds.west || location.lng > bounds.east) {
      result.confidence = 'low';
      result.reasons.push('Location outside operational area');
      result.suspicious = true;
    }
  }

  /**
   * Validate timing between updates
   */
  private validateTiming(
    lastLocation: LocationData,
    currentLocation: LocationData,
    result: ValidationResult
  ): void {
    const timeDiff = new Date(currentLocation.timestamp).getTime() - 
                     new Date(lastLocation.timestamp).getTime();

    if (timeDiff < this.config.minTimeBetweenUpdates) {
      result.suspicious = true;
      result.reasons.push(`Update too frequent: ${timeDiff}ms`);
    }

    if (timeDiff > this.config.maxTimeBetweenUpdates) {
      result.confidence = result.confidence === 'high' ? 'medium' : result.confidence;
      result.reasons.push(`Large time gap: ${(timeDiff / 1000).toFixed(0)}s`);
    }

    // Check for time travel (timestamp going backwards)
    if (timeDiff < 0) {
      result.valid = false;
      result.suspicious = true;
      result.reasons.push('Timestamp regression detected');
    }
  }

  /**
   * Validate movement between updates
   */
  private validateMovement(
    lastLocation: LocationData,
    currentLocation: LocationData,
    result: ValidationResult
  ): void {
    const distance = this.calculateDistance(
      lastLocation.lat,
      lastLocation.lng,
      currentLocation.lat,
      currentLocation.lng
    );

    const timeDiff = new Date(currentLocation.timestamp).getTime() - 
                     new Date(lastLocation.timestamp).getTime();

    // Check for teleportation
    if (distance > this.config.maxJumpMeters && timeDiff < 1000) {
      result.valid = false;
      result.suspicious = true;
      result.reasons.push(`Impossible jump: ${distance.toFixed(0)}m in ${timeDiff}ms`);
      return;
    }

    // Calculate speed
    const speedKmh = (distance / 1000) / (timeDiff / 3600000);

    if (speedKmh > this.config.maxSpeedKmh) {
      result.valid = false;
      result.suspicious = true;
      result.reasons.push(`Impossible speed: ${speedKmh.toFixed(0)} km/h`);
    } else if (speedKmh > this.config.maxSpeedKmh * 0.8) {
      result.confidence = 'medium';
      result.reasons.push(`High speed: ${speedKmh.toFixed(0)} km/h`);
    }

    // Check speed consistency if provided
    if (currentLocation.speed !== undefined) {
      const reportedSpeedKmh = (currentLocation.speed || 0) * 3.6;
      const speedDiscrepancy = Math.abs(speedKmh - reportedSpeedKmh);
      
      if (speedDiscrepancy > 20) {
        result.suspicious = true;
        result.reasons.push(`Speed mismatch: calculated ${speedKmh.toFixed(0)} vs reported ${reportedSpeedKmh.toFixed(0)} km/h`);
      }
    }
  }

  /**
   * Detect suspicious patterns
   */
  private detectSuspiciousPatterns(
    userId: string,
    history: LocationData[],
    current: LocationData,
    result: ValidationResult
  ): void {
    // Pattern 1: Zigzag movement (possible GPS spoofing)
    if (this.detectZigzag(history, current)) {
      result.suspicious = true;
      result.reasons.push('Zigzag pattern detected');
    }

    // Pattern 2: Perfect circle (possible mock location)
    if (this.detectCircularPattern(history, current)) {
      result.suspicious = true;
      result.reasons.push('Circular pattern detected');
    }

    // Pattern 3: Repeated exact coordinates
    if (this.detectRepeatedCoordinates(history, current)) {
      result.suspicious = true;
      result.reasons.push('Repeated exact coordinates');
    }

    // Pattern 4: Sudden change in accuracy pattern
    if (this.detectAccuracyAnomaly(history, current)) {
      result.suspicious = true;
      result.reasons.push('Accuracy pattern anomaly');
    }
  }

  /**
   * Detect zigzag movement pattern
   */
  private detectZigzag(history: LocationData[], current: LocationData): boolean {
    if (history.length < 3) return false;

    const recent = history.slice(-3);
    const bearings: number[] = [];

    for (let i = 0; i < recent.length - 1; i++) {
      bearings.push(this.calculateBearing(
        recent[i].lat,
        recent[i].lng,
        recent[i + 1].lat,
        recent[i + 1].lng
      ));
    }

    // Add current bearing
    bearings.push(this.calculateBearing(
      recent[recent.length - 1].lat,
      recent[recent.length - 1].lng,
      current.lat,
      current.lng
    ));

    // Check for alternating bearings (zigzag)
    let reversals = 0;
    for (let i = 0; i < bearings.length - 1; i++) {
      const diff = Math.abs(bearings[i] - bearings[i + 1]);
      if (diff > 150 && diff < 210) {
        reversals++;
      }
    }

    return reversals >= 2;
  }

  /**
   * Detect circular movement pattern
   */
  private detectCircularPattern(history: LocationData[], current: LocationData): boolean {
    if (history.length < 8) return false;

    // Calculate center point
    const points = [...history.slice(-8), current];
    let centerLat = 0;
    let centerLng = 0;
    
    points.forEach(p => {
      centerLat += p.lat;
      centerLng += p.lng;
    });
    
    centerLat /= points.length;
    centerLng /= points.length;

    // Check if all points are roughly equidistant from center
    const distances = points.map(p => 
      this.calculateDistance(centerLat, centerLng, p.lat, p.lng)
    );

    const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
    const variance = distances.reduce((sum, d) => 
      sum + Math.pow(d - avgDistance, 2), 0
    ) / distances.length;

    // Low variance suggests circular pattern
    return variance < (avgDistance * 0.1);
  }

  /**
   * Detect repeated exact coordinates
   */
  private detectRepeatedCoordinates(history: LocationData[], current: LocationData): boolean {
    const precision = 7; // Decimal places
    const roundCoord = (n: number) => Math.round(n * Math.pow(10, precision)) / Math.pow(10, precision);
    
    const currentKey = `${roundCoord(current.lat)},${roundCoord(current.lng)}`;
    let repeatCount = 0;
    
    history.slice(-10).forEach(loc => {
      const key = `${roundCoord(loc.lat)},${roundCoord(loc.lng)}`;
      if (key === currentKey) repeatCount++;
    });

    return repeatCount > 2;
  }

  /**
   * Detect accuracy anomalies
   */
  private detectAccuracyAnomaly(history: LocationData[], current: LocationData): boolean {
    if (!current.accuracy) return false;
    
    const recentAccuracies = history.slice(-5)
      .map(l => l.accuracy)
      .filter(a => a !== undefined) as number[];
    
    if (recentAccuracies.length < 3) return false;

    const avgAccuracy = recentAccuracies.reduce((a, b) => a + b, 0) / recentAccuracies.length;
    const deviation = Math.abs(current.accuracy - avgAccuracy);

    // Sudden improvement in accuracy might indicate spoofing
    return deviation > avgAccuracy * 0.7 && current.accuracy < avgAccuracy;
  }

  /**
   * Calculate final assessment
   */
  private calculateFinalAssessment(userId: string, result: ValidationResult): void {
    // Track suspicious activity
    if (result.suspicious) {
      const count = (this.suspiciousPatterns.get(userId) || 0) + 1;
      this.suspiciousPatterns.set(userId, count);

      // Bound suspiciousPatterns to prevent memory growth at scale
      if (this.suspiciousPatterns.size > 10000) {
        const firstKey = this.suspiciousPatterns.keys().next().value;
        if (firstKey !== undefined) this.suspiciousPatterns.delete(firstKey);
      }

      if (count > 10) {
        this.blacklist.add(userId);
        // Bound blacklist to prevent memory growth at scale
        if (this.blacklist.size > 10000) {
          const firstKey = this.blacklist.values().next().value;
          if (firstKey !== undefined) this.blacklist.delete(firstKey);
        }
        result.valid = false;
        result.recommendation = 'reject';
        // Note: structured logger not injected here — this class is used both
        // server-side and in tests. Callers should log the rejection result.
        return;
      }
    }

    // Determine recommendation
    if (!result.valid) {
      result.recommendation = 'reject';
    } else if (result.suspicious || result.confidence === 'low') {
      result.recommendation = 'review';
    } else {
      result.recommendation = 'accept';
    }
  }

  /**
   * Update location history
   */
  private updateHistory(userId: string, location: LocationData): void {
    let history = this.locationHistory.get(userId) || [];
    history.push(location);

    // Limit history size
    if (history.length > this.config.historySize) {
      history = history.slice(-this.config.historySize);
    }

    this.locationHistory.set(userId, history);
  }

  /**
   * Calculate distance between two points
   */
  private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Calculate bearing between two points
   */
  private calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;

    const y = Math.sin(dLng) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
              Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);

    const bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360;
  }

  /**
   * Clear history for a user
   */
  public clearHistory(userId: string): void {
    this.locationHistory.delete(userId);
    this.suspiciousPatterns.delete(userId);
  }

  /**
   * Remove from blacklist
   */
  public removeFromBlacklist(userId: string): void {
    this.blacklist.delete(userId);
  }

  /**
   * Get suspicious users
   */
  public getSuspiciousUsers(): string[] {
    return Array.from(this.suspiciousPatterns.keys());
  }

  /**
   * Get blacklisted users
   */
  public getBlacklistedUsers(): string[] {
    return Array.from(this.blacklist);
  }
}

export default LocationValidationService;
