'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ReassignmentService } from '@/lib/services/reassignment-service';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { Clock,RotateCcw } from 'lucide-react';
import { useEffect,useState } from 'react';

interface UndoPanelProps {
  reassignmentService: ReassignmentService;
  onUndo: () => void;
}

export default function UndoPanel({ reassignmentService, onUndo }: UndoPanelProps) {
  const [undoHistory, setUndoHistory] = useState<any[]>([]);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    // Load undo history from service
    const loadHistory = () => {
      const history = reassignmentService.getUndoHistory();
      setUndoHistory(history);
    };

    loadHistory();
    
    // Refresh every 10 seconds to update time labels
    const interval = setInterval(loadHistory, 10000);
    
    return () => clearInterval(interval);
  }, [reassignmentService]);

  const handleUndo = async (actionId: string) => {
    setProcessing(true);
    
    try {
      await reassignmentService.undoReassignment(actionId);
      
      // Refresh history
      setUndoHistory(reassignmentService.getUndoHistory());
      
      onUndo();
    } catch (error: any) {
      console.error('Undo failed:', error);
    } finally {
      setProcessing(false);
    }
  };

  const isUndoable = (timestamp: number) => {
    const elapsed = Date.now() - timestamp;
    return elapsed < 5 * 60 * 1000; // 5 minutes
  };

  const activeUndos = undoHistory.filter(action => isUndoable(action.timestamp));

  if (activeUndos.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="border-amber-500/30 hover:bg-amber-500/10 relative"
        >
          <RotateCcw className="w-4 h-4 mr-2" />
          Undo
          {activeUndos.length > 0 && (
            <Badge 
              className="absolute -top-2 -right-2 h-5 w-5 p-0 flex items-center justify-center bg-amber-500 text-white"
            >
              {activeUndos.length}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      
      <DropdownMenuContent 
        align="end" 
        className="w-80 bg-zinc-950 border-zinc-800"
      >
        <DropdownMenuLabel className="text-gray-100">
          Recent Actions (Undo Window: 5 min)
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-zinc-800" />
        
        <div className="max-h-64 overflow-y-auto">
          {activeUndos.map(action => {
            const timeLeft = 5 * 60 * 1000 - (Date.now() - action.timestamp);
            const minutes = Math.floor(timeLeft / 60000);
            const seconds = Math.floor((timeLeft % 60000) / 1000);
            
            return (
              <DropdownMenuItem
                key={action.id}
                className="flex flex-col gap-2 p-3 cursor-pointer hover:bg-zinc-900"
                onClick={() => handleUndo(action.id)}
                disabled={processing}
              >
                <div className="flex items-start justify-between w-full">
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-gray-100">
                      {action.plans.length} student{action.plans.length !== 1 ? 's' : ''} moved
                    </p>
                    <p className="text-xs text-gray-400">
                      {formatDistanceToNow(action.timestamp, { addSuffix: true })}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      By {action.actor} • {action.reason}
                    </p>
                  </div>
                  
                  <div className="flex flex-col items-end gap-1">
                    <Badge 
                      className={cn(
                        "text-xs",
                        minutes < 1 
                          ? "bg-red-500/20 text-red-400 border-red-500/30"
                          : "bg-amber-500/20 text-amber-400 border-amber-500/30"
                      )}
                    >
                      <Clock className="w-3 h-3 mr-1" />
                      {minutes}:{seconds.toString().padStart(2, '0')}
                    </Badge>
                  </div>
                </div>
                
                {/* Student details */}
                <div className="text-xs text-gray-500 space-y-0.5">
                  {action.plans.slice(0, 3).map((plan: any, i: number) => (
                    <div key={i}>
                      • {plan.studentName} → {plan.toBusNumber}
                    </div>
                  ))}
                  {action.plans.length > 3 && (
                    <div>... and {action.plans.length - 3} more</div>
                  )}
                </div>
              </DropdownMenuItem>
            );
          })}
        </div>
        
        {processing && (
          <div className="p-3 border-t border-zinc-800">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
              Processing undo...
            </div>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
