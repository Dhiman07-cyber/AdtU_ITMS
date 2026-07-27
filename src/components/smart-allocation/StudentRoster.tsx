'use client';

import type { StudentData } from '@/app/admin/smart-allocation/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { safeImageSrc } from '@/lib/security/url-sanitizer';
import { cn } from '@/lib/utils';
import { ChevronRight,Filter,MapPin,Search,Users,Zap } from 'lucide-react';
import { useMemo,useState } from 'react';

interface StudentRosterProps {
  students: StudentData[];
  selectedStudents: Set<string>;
  onToggleSelection: (studentId: string) => void;
  onSelectByStop: (stop_name: string, limit?: number) => void;
}

export default function StudentRoster({
  students,
  selectedStudents,
  onToggleSelection,
  onSelectByStop
}: StudentRosterProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [stopFilter, setStopFilter] = useState<string>('all');

  // Group students by stop
  const stopGroups = useMemo(() => {
    const groups = new Map<string, StudentData[]>();

    students.forEach(student => {
      const existing = groups.get(student.stop_name) || [];
      existing.push(student);
      groups.set(student.stop_name, existing);
    });

    return groups;
  }, [students]);

  // Filter students
  const filteredStudents = useMemo(() => {
    let filtered = [...students];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(student =>
        student.fullName.toLowerCase().includes(query) ||
        student.enrollmentId.toLowerCase().includes(query) ||
        student.phone?.toLowerCase().includes(query)
      );
    }

    // Apply stop filter
    if (stopFilter !== 'all') {
      filtered = filtered.filter(student => student.stop_name === stopFilter);
    }

    return filtered;
  }, [students, searchQuery, stopFilter]);

  // Unique stops
  const uniqueStops = useMemo(() => {
    const stops = new Map<string, string>();
    students.forEach(student => {
      stops.set(student.stop_name, student.stop_name);
    });
    return Array.from(stops.entries()).map(([id, name]) => ({ id, name }));
  }, [students]);

  // Render student row
  const renderStudentRow = (student: StudentData) => {
    const isSelected = selectedStudents.has(student.id);
    const stopCount = stopGroups.get(student.stop_name)?.length || 0;

    return (
      <div
        key={student.id}
        onClick={() => onToggleSelection(student.id)}
        className={cn(
          "px-3 pr-5 py-2 flex items-center gap-2 sm:gap-3 border-b",
          "hover:bg-muted/50 transition-colors cursor-pointer",
          isSelected && "bg-purple-50 dark:bg-purple-950/30"
        )}
      >
        {/* Checkbox */}
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onToggleSelection(student.id)}
          onClick={(e) => e.stopPropagation()}
        />

        {/* Profile Picture */}
        <div className="w-8 h-8 rounded-full overflow-hidden bg-muted flex-shrink-0">
          {student.photoURL ? (
            <img
              src={safeImageSrc(student.photoURL)}
              alt={student.fullName}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
              <Users className="w-4 h-4" />
            </div>
          )}
        </div>

        {/* Student Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-medium text-xs sm:text-sm truncate max-w-[140px] sm:max-w-none">
              {student.fullName}
            </h4>
            {student.shift && (
              <Badge variant="outline" className="text-[10px] sm:text-xs px-1.5 py-0">
                {student.shift.charAt(0).toUpperCase() + student.shift.slice(1)}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 text-[10px] sm:text-xs text-muted-foreground">
            <span className="font-mono">{student.enrollmentId}</span>
            {student.semester && (
              <span>Sem {student.semester}</span>
            )}
          </div>
        </div>

        {/* Stop Info */}
        <div className="flex items-center gap-1.5 text-[10px] sm:text-xs min-w-[80px] sm:min-w-[100px]">
          <MapPin className="w-3 h-3 text-muted-foreground" />
          <span className="text-muted-foreground truncate">{student.stop_name}</span>
        </div>

        {/* Quick Actions */}
        <Button
          size="sm"
          variant="ghost"
          className="text-xs h-7 px-2"
          onClick={(e) => {
            e.stopPropagation();
            onSelectByStop(student.stop_name);
          }}
        >
          <ChevronRight className="w-3 h-3" />
        </Button>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col">
      {/* Filters - All in one line */}
      <div className="p-3 border-b">
        <div className="flex items-center gap-2">
          {/* Search - wider */}
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search students..."
              className="pl-9 h-9 text-xs"
            />
          </div>

          {/* Filter Tag */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-950/30 dark:to-pink-950/30 rounded-lg border border-purple-200 dark:border-purple-800">
            <Filter className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
            <span className="text-xs font-semibold text-purple-700 dark:text-purple-300">Filters</span>
          </div>

          {/* Stop Filter */}
          <select
            value={stopFilter}
            onChange={(e) => setStopFilter(e.target.value)}
            className="px-3 py-1.5 border-2 border-zinc-300 dark:border-zinc-700 rounded-lg text-xs h-9 bg-white dark:bg-zinc-900 text-gray-900 dark:text-gray-100 hover:border-purple-400 dark:hover:border-purple-600 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all font-medium shadow-sm min-w-[160px]"
          >
            <option value="all" className="bg-white dark:bg-zinc-900">📍 All Stops</option>
            {uniqueStops.map(stop => (
              <option key={stop.id} value={stop.id} className="bg-white dark:bg-zinc-900">
                📍 {stop.name} ({stopGroups.get(stop.id)?.length || 0})
              </option>
            ))}
          </select>
        </div>

        {/* Active Filters Badge */}
        {stopFilter !== 'all' && (
          <div className="flex items-center gap-2 mt-2 p-2 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
                <Filter className="w-3 h-3 text-white" />
              </div>
              <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">Active:</span>
            </div>
            <Badge
              className="text-xs cursor-pointer bg-blue-600 hover:bg-blue-700 text-white border-0 shadow-sm transition-all hover:scale-105 px-2.5 py-0.5"
              onClick={() => setStopFilter('all')}
            >
              📍 {uniqueStops.find(s => s.id === stopFilter)?.name} ✕
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 ml-auto"
              onClick={() => setStopFilter('all')}
            >
              Clear All
            </Button>
          </div>
        )}

        {/* Quick Select by Stop */}
        {stopFilter !== 'all' && stopGroups.get(stopFilter) && (
          <div className="flex items-center gap-2 p-2 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 rounded-lg border border-green-200 dark:border-green-800">
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
                <Zap className="w-3 h-3 text-white" />
              </div>
              <span className="text-xs font-semibold text-green-700 dark:text-green-300">Quick Select:</span>
            </div>
            <Button
              size="sm"
              className="text-xs h-7 bg-green-600 hover:bg-green-700 text-white shadow-sm px-3"
              onClick={() => onSelectByStop(stopFilter, 5)}
            >
              Top 5
            </Button>
            <Button
              size="sm"
              className="text-xs h-7 bg-green-600 hover:bg-green-700 text-white shadow-sm px-3"
              onClick={() => onSelectByStop(stopFilter, 10)}
            >
              Top 10
            </Button>
            <Button
              size="sm"
              className="text-xs h-7 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white shadow-sm px-3 font-semibold"
              onClick={() => onSelectByStop(stopFilter)}
            >
              Select All ({stopGroups.get(stopFilter)?.length || 0})
            </Button>
          </div>
        )}
      </div>

      {/* Student List */}
      <div className="flex-1">
        {filteredStudents.length > 0 ? (
          <ScrollArea className="h-full">
            <div>
              {filteredStudents.map(student => renderStudentRow(student))}
            </div>
          </ScrollArea>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Users className="w-10 h-10 mx-auto mb-2 text-muted-foreground opacity-50" />
              <p className="text-sm text-muted-foreground">No students found</p>
            </div>
          </div>
        )}
      </div>

      {/* Summary */}
      {filteredStudents.length > 0 && (
        <div className="p-2 border-t bg-muted/30">
          <div className="flex justify-between items-center text-xs">
            <span className="text-muted-foreground">
              {filteredStudents.length} of {students.length} students
            </span>
            <Badge variant="secondary" className="text-xs">
              {selectedStudents.size} selected
            </Badge>
          </div>
        </div>
      )}
    </div>
  );
}
