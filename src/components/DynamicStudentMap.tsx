"use client";

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card,CardContent,CardHeader,CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/auth-context';
import { WebSocketClient } from '@/domains/realtime/ws-client';
import { supabase } from '@/lib/supabase-client';
import { AlertCircle,Bus,Clock,MapPin,Navigation } from 'lucide-react';
import dynamic from 'next/dynamic';
import React,{ useEffect,useMemo,useRef,useState } from 'react';

// Dynamic import for vector PMTiles map
const GuwahatiMap = dynamic(() => import('@/components/maps/GuwahatiMap'), {
  ssr: false,
  loading: () => <div className="w-full h-[500px] bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900 rounded-3xl animate-pulse flex items-center justify-center text-slate-500 font-bold">Loading Guwahati Vector Map...</div>,
});

// Using shared Supabase client from @/lib/supabase-client

interface BusLocation {
  bus_id: string;
  route_id: string;
  driver_uid: string;
  lat: number;
  lng: number;
  speed?: number;
  heading?: number;
  accuracy?: number;
  updated_at: string;
  timestamp: number;
}

interface WaitingFlag {
  id: string;
  student_uid: string;
  student_name: string;
  bus_id: string;
  lat: number;
  lng: number;
  accuracy?: number;
  message: string;
  status: string;
  created_at: string;
  timestamp: number;
}

interface DynamicStudentMapProps {
  busId: string;
  routeId: string;
  journeyActive?: boolean;
  studentLocation?: { lat: number; lng: number; accuracy: number };
  onWaitingFlagCreate?: (flagId: string) => void;
  onWaitingFlagRemove?: (flagId: string) => void;
  onTripStateChange?: (active: boolean) => void;
}

function DynamicStudentMap({ 
  busId, 
  routeId,
  journeyActive = false,
  studentLocation,
  onWaitingFlagCreate,
  onWaitingFlagRemove,
  onTripStateChange
}: DynamicStudentMapProps) {
  const { currentUser } = useAuth();
  const wsRef = useRef<WebSocketClient | null>(null);
  const [busLocation, setBusLocation] = useState<BusLocation | null>(null);
  const [waitingFlags, setWaitingFlags] = useState<WaitingFlag[]>([]);
  const [isWaiting, setIsWaiting] = useState(false);
  const [currentFlagId, setCurrentFlagId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Memoized points for Guwahati PMTiles Map
  const points = useMemo(() => {
    const list: any[] = [];
    
    // Student's Own Location
    if (studentLocation && studentLocation.lat && studentLocation.lng) {
      list.push({
        id: 'student',
        lat: studentLocation.lat,
        lng: studentLocation.lng,
        kind: 'student' as const,
        label: 'Me',
      });
    }

    // Other Students' Waiting Flags
    if (journeyActive) {
      waitingFlags.forEach((flag) => {
        list.push({
          id: flag.id,
          lat: flag.lat,
          lng: flag.lng,
          kind: 'waiting' as const,
          label: flag.student_uid === currentUser?.uid ? 'Me (Waiting)' : flag.student_name,
        });
      });
    }
    
    return list;
  }, [studentLocation, waitingFlags, journeyActive, currentUser?.uid]);

  const busPosition = useMemo(() => {
    if (journeyActive && busLocation && busLocation.lat && busLocation.lng) {
      return { lat: busLocation.lat, lng: busLocation.lng };
    }
    return null;
  }, [journeyActive, busLocation]);

  // Subscribe to real-time bus location updates via WebSocket
  useEffect(() => {
    if (!busId || !routeId || !currentUser) {
      setBusLocation(null);
      setLoading(false);
      return;
    }

    const initWs = async () => {
      const token = await currentUser.getIdToken();
      const url = process.env.NEXT_PUBLIC_WS_URL || `ws://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:3001`;
      const client = new WebSocketClient({ url, token });
      wsRef.current = client;
      client.connect();

      client.subscribe(`bus_location_${busId}`, (payload: any) => {
        setBusLocation(payload.payload || payload);
      });

      client.subscribe(`trip-status-${busId}`, (payload: any) => {
        const isStarted = payload.event === 'trip_started' || payload.payload?.event === 'trip_started';
        const isEnded = payload.event === 'trip_ended' || payload.payload?.event === 'trip_ended';
        if (isEnded) {
          setBusLocation(null);
          onTripStateChange?.(false);
        } else if (isStarted) {
          onTripStateChange?.(true);
        }
      });
    };

    initWs();

    return () => {
      if (wsRef.current) {
        wsRef.current.disconnect();
        wsRef.current = null;
      }
    };
  }, [busId, routeId, currentUser]);

  // Subscribe to real-time waiting flags via WebSocket
  useEffect(() => {
    if (!busId || !currentUser || !wsRef.current) return;

    const client = wsRef.current;

    const unsubCreated = client.subscribe(`waiting_flags_${busId}`, (payload: any) => {
      const data = payload.payload || payload;
      if (data.event === 'waiting_flag_removed' || data.flagId) {
        setWaitingFlags(prev => prev.filter(flag => flag.id !== data.flagId));
        if (data.studentUid === currentUser?.uid) {
          setIsWaiting(false);
          setCurrentFlagId(null);
          onWaitingFlagRemove?.(data.flagId);
        }
        return;
      }
      setWaitingFlags(prev => [...prev, data]);
      if (data.student_uid === currentUser?.uid) {
        setIsWaiting(true);
        setCurrentFlagId(data.id);
        onWaitingFlagCreate?.(data.id);
      }
    });

    return () => {
      unsubCreated();
    };
  }, [busId, currentUser?.uid, onWaitingFlagCreate, onWaitingFlagRemove]);

  // Get initial data
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        // Get current bus location (optional - table might not exist)
        try {
          const { data: busData, error: busError } = await supabase
            .from('bus_locations')
            .select('*')
            .eq('bus_id', busId)
            .maybeSingle(); // Use maybeSingle() instead of single() to avoid 406 errors

          if (busError && busError.code !== 'PGRST116') {
            console.warn('⚠️ Bus location table might not exist:', busError);
          } else if (busData) {
            setBusLocation(busData);
          }
        } catch (error) {
          console.warn('⚠️ Bus location query failed (table might not exist):', error);
        }

        // Get current waiting flags (optional - table might not exist)
        try {
          const { data: flagsData, error: flagsError } = await supabase
            .from('waiting_flags')
            .select('*')
            .eq('bus_id', busId)
            .eq('status', 'waiting');

          if (flagsError) {
            console.warn('⚠️ Waiting flags table might not exist:', flagsError);
          } else if (flagsData) {
            setWaitingFlags(flagsData);
            // Check if current student has a waiting flag
            const studentFlag = flagsData.find(flag => flag.student_uid === currentUser?.uid);
            if (studentFlag) {
              setIsWaiting(true);
              setCurrentFlagId(studentFlag.id);
            }
          }
        } catch (error) {
          console.warn('⚠️ Waiting flags query failed (table might not exist):', error);
        }

        setLoading(false);
      } catch (error) {
        console.error('Error fetching initial data:', error);
        setError('Failed to load map data');
        setLoading(false);
      }
    };

    fetchInitialData();
  }, [busId, currentUser?.uid]);

  const handleWaitingFlag = async () => {
    if (!currentUser || !studentLocation) {
      setError('Location not available');
      return;
    }

    try {
      if (isWaiting && currentFlagId) {
        // Remove waiting flag
        const token = await currentUser.getIdToken();
        const response = await fetch('/api/student/waiting-flag', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            flagId: currentFlagId,
            busId: busId
          })
        });

        if (response.ok) {
          setIsWaiting(false);
          setCurrentFlagId(null);
        } else {
          const error = await response.json();
          setError(error.error || 'Failed to remove waiting flag');
        }
      } else {
        // Create waiting flag
        const token = await currentUser.getIdToken();
        const response = await fetch('/api/student/waiting-flag', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            busId: busId,
            accuracy: studentLocation.accuracy,
            message: 'Waiting for bus',
            timestamp: Date.now()
          })
        });

        if (response.ok) {
          const result = await response.json();
          setIsWaiting(true);
          setCurrentFlagId(result.flagId);
        } else {
          const error = await response.json();
          setError(error.error || 'Failed to create waiting flag');
        }
      }
    } catch (error) {
      console.error('Error handling waiting flag:', error);
      setError('Failed to update waiting status');
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-96">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p>Loading live map data...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-96">
          <div className="text-center text-red-600">
            <p>{error}</p>
            <Button onClick={() => window.location.reload()} className="mt-4">
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Map */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Live Bus Tracking
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!journeyActive && (
            <div className="mb-4 bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5" />
                <div>
                  <p className="font-medium">Journey Not Started</p>
                  <p className="text-sm">The map is ready. Bus location will appear when the driver starts the trip.</p>
                </div>
              </div>
            </div>
          )}
          <div className="w-full h-[500px] rounded-3xl overflow-hidden relative">
            <GuwahatiMap
              theme="dark"
              busPosition={busPosition}
              points={points}
              restrictToGuwahati={true}
              className="w-full h-full"
            />
          </div>
        </CardContent>
      </Card>

      {/* Status and Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Bus Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bus className="h-5 w-5" />
              Bus Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {busLocation ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span>Status:</span>
                  <Badge variant="default" className="bg-green-500">
                    <div className="w-2 h-2 bg-white rounded-full mr-2 animate-pulse"></div>
                    Live
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span>Speed:</span>
                  <span className="font-medium">{busLocation.speed?.toFixed(1) || 0} km/h</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Last Update:</span>
                  <span className="text-sm text-gray-600">
                    {new Date(busLocation.updated_at).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-center text-gray-500">
                <Clock className="h-8 w-8 mx-auto mb-2" />
                <p>Bus location not available</p>
                <p className="text-sm">Driver may not have started the trip yet</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Waiting Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Navigation className="h-5 w-5" />
              Your Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span>Waiting Status:</span>
                <Badge variant={isWaiting ? "default" : "secondary"}>
                  {isWaiting ? "Waiting" : "Not Waiting"}
                </Badge>
              </div>
              
              <Button
                onClick={handleWaitingFlag}
                variant={isWaiting ? "destructive" : "default"}
                className="w-full"
                disabled={!studentLocation}
              >
                {isWaiting ? "Stop Waiting" : "I'm Waiting"}
              </Button>
              
              {!studentLocation && (
                <p className="text-sm text-gray-500 text-center">
                  Enable location to use waiting feature
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default React.memo(DynamicStudentMap);
