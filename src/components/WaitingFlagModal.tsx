"use client";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { AlertCircle,Flag } from "lucide-react";
import { useState } from "react";

interface RouteStop {
  stop_name: string;
  name: string;
  lat: number;
  lng: number;
  sequence: number;
  time?: string;
}

interface WaitingFlagModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (stop_name: string) => void;
  stops: RouteStop[];
  loading?: boolean;
}

export default function WaitingFlagModal({
  isOpen,
  onClose,
  onConfirm,
  stops,
  loading = false
}: WaitingFlagModalProps) {
  const [selected_stop_name, setSelectedStopId] = useState<string>("");

  const handleConfirm = () => {
    if (!selected_stop_name) return;
    
    const selectedStop = stops.find(s => s.stop_name === selected_stop_name);
    if (selectedStop) {
      onConfirm(selected_stop_name);
      setSelectedStopId(""); // Reset
    }
  };

  const handleClose = () => {
    setSelectedStopId("");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
            <Flag className="h-6 w-6 text-blue-600" />
          </div>
          <DialogTitle className="text-center">
            Raise Waiting Flag
          </DialogTitle>
          <DialogDescription className="text-center">
            Let the driver know you're waiting at a specific stop.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-3">
            <div className="flex gap-2">
              <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-yellow-800">
                  Your flag will be visible to the driver for 20 minutes. 
                  Make sure you're actually at the stop before raising the flag.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              Select your stop
            </label>
            <Select
              value={selected_stop_name}
              onValueChange={setSelectedStopId}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a stop..." />
              </SelectTrigger>
              <SelectContent>
                {stops.map((stop) => (
                  <SelectItem key={stop.stop_name} value={stop.stop_name}>
                    {stop.name} {stop.time && `(${stop.time})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-col gap-2">
          <Button 
            onClick={handleConfirm} 
            className="w-full"
            disabled={!selected_stop_name || loading}
          >
            {loading ? (
              <>
                <span className="animate-spin mr-2">⏳</span>
                Raising Flag...
              </>
            ) : (
              <>
                <Flag className="h-4 w-4 mr-2" />
                Confirm & Raise Flag
              </>
            )}
          </Button>
          <Button 
            onClick={handleClose} 
            variant="outline"
            className="w-full"
            disabled={loading}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}



