'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  MapPin,
  Clock,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Search,
  Bus,
  CheckCircle2,
  FileCheck2,
} from 'lucide-react';
import { toast } from 'sonner';

export interface StopDwellRecord {
  id: string;
  trip_id: string;
  bus_id: string;
  driver_id: string;
  route_id: string;
  stop_id: string;
  stop_name: string;
  arrived_at: string;
  departed_at: string | null;
  dwell_seconds: number;
  status: 'Verified Dwell' | 'Brief Pass-Through';
  created_at?: string;
}

interface StopDwellAuditProofProps {
  initialBusId?: string;
  initialTripId?: string;
  className?: string;
}

export function StopDwellAuditProof({
  initialBusId = '',
  initialTripId = '',
  className = '',
}: StopDwellAuditProofProps) {
  const [busId, setBusId] = useState(initialBusId);
  const [tripId, setTripId] = useState(initialTripId);
  const [logs, setLogs] = useState<StopDwellRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  const fetchDwellLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (busId.trim()) params.set('busId', busId.trim());
      if (tripId.trim()) params.set('tripId', tripId.trim());
      params.set('limit', '50');

      const res = await fetch(`/api/admin/trip-dwell-logs?${params.toString()}`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }

      const json = await res.json();
      if (json.success) {
        setLogs(json.logs || []);
        setTotalCount(json.total || 0);
      } else {
        throw new Error(json.error || 'Failed to fetch logs');
      }
    } catch (err: any) {
      toast.error(`Audit query failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [busId, tripId]);

  useEffect(() => {
    fetchDwellLogs();
  }, [fetchDwellLogs]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchDwellLogs();
  };

  const formatTimestamp = (iso: string | null) => {
    if (!iso) return 'In Progress';
    const date = new Date(iso);
    return date.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  };

  const formatDate = (iso: string) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-IN', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatDwellTime = (seconds: number) => {
    if (seconds <= 0) return '0s';
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const rem = seconds % 60;
    return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
  };

  const verifiedCount = logs.filter((l) => l.dwell_seconds >= 20).length;
  const passThroughCount = logs.filter((l) => l.dwell_seconds < 20).length;
  const avgDwell =
    logs.length > 0
      ? Math.round(logs.reduce((acc, l) => acc + l.dwell_seconds, 0) / logs.length)
      : 0;

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header & Filter Controls */}
      <Card className="border border-border/60 shadow-sm bg-card/60 backdrop-blur-md">
        <CardHeader className="pb-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-xl font-bold flex items-center gap-2 text-foreground">
                <FileCheck2 className="w-5 h-5 text-emerald-500" />
                Stop Dwell Audit Proof Engine
              </CardTitle>
              <CardDescription className="text-muted-foreground mt-1">
                Incontrovertible Transit Proof (INV-2) for student–driver dispute adjudication. Stop arrival,
                stationary dwell time, and departure are anchored by physical WGS84 GPS geofences.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchDwellLogs}
              disabled={loading}
              className="gap-2 shrink-0"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[180px]">
              <Bus className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Filter by Bus ID (e.g. bus_1)"
                value={busId}
                onChange={(e) => setBusId(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Filter by Trip ID"
                value={tripId}
                onChange={(e) => setTripId(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button type="submit" disabled={loading} className="gap-2">
              <Search className="w-4 h-4" />
              Filter
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Summary KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border border-border/50 bg-card/40">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-500">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Stops Recorded</p>
              <p className="text-2xl font-bold text-foreground">{totalCount}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-border/50 bg-card/40">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-500">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Verified Dwells (&gt;=20s)</p>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {verifiedCount}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-border/50 bg-card/40">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Pass-Throughs (&lt;20s)</p>
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                {passThroughCount}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-border/50 bg-card/40">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-500">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Avg Dwell Time</p>
              <p className="text-2xl font-bold text-foreground">{formatDwellTime(avgDwell)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Audit Log Table */}
      <Card className="border border-border/60 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="w-12 text-center">#</TableHead>
                <TableHead>Stop Name</TableHead>
                <TableHead>Bus / Route</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Arrival Time</TableHead>
                <TableHead>Departure Time</TableHead>
                <TableHead className="text-right">Dwell Duration</TableHead>
                <TableHead className="text-center">Adjudication Proof</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-center"><Skeleton className="h-4 w-4 mx-auto" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                    <TableCell className="text-center"><Skeleton className="h-6 w-24 mx-auto rounded-full" /></TableCell>
                  </TableRow>
                ))
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-48 text-center text-muted-foreground">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <MapPin className="w-8 h-8 text-muted-foreground/40" />
                      <p className="font-medium text-foreground">No stop dwell records found</p>
                      <p className="text-xs text-muted-foreground max-w-sm">
                        No stop dwell records match the current filter criteria. Dwell records are created
                        automatically when a bus enters a stop radius (&lt;=80m) and remains stationary.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log, index) => {
                  const isVerified = log.dwell_seconds >= 20;
                  return (
                    <TableRow key={log.id} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="text-center font-mono text-xs text-muted-foreground">
                        {index + 1}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 font-medium text-foreground">
                          <MapPin className="w-4 h-4 text-primary shrink-0" />
                          <span>{log.stop_name}</span>
                        </div>
                        <div className="text-xs text-muted-foreground font-mono mt-0.5">
                          ID: {log.stop_id}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-mono text-xs font-semibold text-foreground">
                          {log.bus_id}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Route: {log.route_id}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(log.arrived_at)}
                      </TableCell>
                      <TableCell className="text-xs font-mono font-medium text-foreground">
                        {formatTimestamp(log.arrived_at)}
                      </TableCell>
                      <TableCell className="text-xs font-mono font-medium text-foreground">
                        {formatTimestamp(log.departed_at)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        <span
                          className={
                            isVerified
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-amber-600 dark:text-amber-400'
                          }
                        >
                          {formatDwellTime(log.dwell_seconds)}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        {isVerified ? (
                          <Badge
                            variant="outline"
                            className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 gap-1 text-xs py-0.5 px-2.5 inline-flex items-center"
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            Verified Dwell
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 gap-1 text-xs py-0.5 px-2.5 inline-flex items-center"
                          >
                            <AlertTriangle className="w-3 h-3" />
                            Pass-Through
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
