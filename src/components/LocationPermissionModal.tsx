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
import { AlertCircle,MapPin,Settings } from "lucide-react";
import { useEffect,useState } from "react";

interface LocationPermissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRetry: () => void;
  errorMessage?: string;
}

export default function LocationPermissionModal({
  isOpen,
  onClose,
  onRetry,
  errorMessage
}: LocationPermissionModalProps) {
  const [browserName, setBrowserName] = useState<string>('');

  useEffect(() => {
    // Detect browser for specific instructions
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes('chrome')) setBrowserName('Chrome');
    else if (userAgent.includes('firefox')) setBrowserName('Firefox');
    else if (userAgent.includes('safari')) setBrowserName('Safari');
    else if (userAgent.includes('edge')) setBrowserName('Edge');
    else setBrowserName('your browser');
  }, []);

  const getInstructions = () => {
    switch (browserName) {
      case 'Chrome':
        return [
          'Click the lock icon 🔒 in the address bar',
          'Find "Location" and set it to "Allow"',
          'Refresh the page and try again'
        ];
      case 'Firefox':
        return [
          'Click the padlock icon in the address bar',
          'Click "Connection secure" > "More information"',
          'Go to "Permissions" and enable "Location"',
          'Refresh the page and try again'
        ];
      case 'Safari':
        return [
          'Go to Safari > Settings > Websites > Location Services',
          'Find this website and select "Allow"',
          'Refresh the page and try again'
        ];
      default:
        return [
          'Click the location icon in your browser\'s address bar',
          'Allow location access for this website',
          'Refresh the page and try again'
        ];
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
            <AlertCircle className="h-6 w-6 text-red-600" />
          </div>
          <DialogTitle className="text-center">
            Location Access Required
          </DialogTitle>
          <DialogDescription className="text-center">
            ADTU BUS XQ needs access to your location to provide real-time bus tracking.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {errorMessage && (
            <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-3">
              <p className="text-sm text-yellow-800">{errorMessage}</p>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <Settings className="h-5 w-5 text-blue-600 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-sm mb-2">
                  To enable location on {browserName}:
                </p>
                <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside">
                  {getInstructions().map((instruction, index) => (
                    <li key={index}>{instruction}</li>
                  ))}
                </ol>
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-blue-50 border border-blue-200 p-3">
            <div className="flex gap-2">
              <MapPin className="h-5 w-5 text-blue-600 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-blue-900">
                  Why do we need this?
                </p>
                <p className="text-xs text-blue-700 mt-1">
                  Location access allows drivers to share their real-time position and 
                  students to track their bus accurately.
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-col gap-2">
          <Button 
            onClick={onRetry} 
            className="w-full"
          >
            <MapPin className="h-4 w-4 mr-2" />
            Try Again
          </Button>
          <Button 
            onClick={onClose} 
            variant="outline"
            className="w-full"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


