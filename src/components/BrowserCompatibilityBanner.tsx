"use client";

import { Alert,AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Globe,X } from "lucide-react";
import { useEffect,useState } from "react";

export default function BrowserCompatibilityBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const [browserInfo, setBrowserInfo] = useState({ name: "", isRecommended: true });

  useEffect(() => {
    // Detect browser
    const userAgent = navigator.userAgent.toLowerCase();
    let name = "Unknown";
    let isRecommended = false;

    if (userAgent.includes("chrome") && !userAgent.includes("edg")) {
      name = "Chrome";
      isRecommended = true;
    } else if (userAgent.includes("firefox")) {
      name = "Firefox";
      isRecommended = true;
    } else if (userAgent.includes("safari") && !userAgent.includes("chrome")) {
      name = "Safari";
      isRecommended = true;
    } else if (userAgent.includes("edg")) {
      name = "Edge";
      isRecommended = true;
    } else if (userAgent.includes("brave")) {
      name = "Brave";
      isRecommended = false; // Brave sometimes blocks geolocation by default
    } else {
      name = "Unknown Browser";
      isRecommended = false;
    }

    setBrowserInfo({ name, isRecommended });

    // Check if user has dismissed the banner before
    const dismissed = localStorage.getItem("browser-banner-dismissed");
    if (!dismissed && !isRecommended) {
      setShowBanner(true);
    }
  }, []);

  const handleDismiss = () => {
    localStorage.setItem("browser-banner-dismissed", "true");
    setShowBanner(false);
  };

  if (!showBanner) return null;

  return (
    <Alert className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 max-w-lg mx-auto bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 shadow-lg">
      <div className="flex items-start gap-2">
        <Globe className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <AlertDescription className="text-yellow-800 dark:text-yellow-200">
            <strong className="block mb-1">📱 For Best Experience</strong>
            <p className="text-sm">
              You're using <strong>{browserInfo.name}</strong>. For optimal GPS tracking and notifications, we recommend:
            </p>
            <ul className="list-disc list-inside text-sm mt-2 space-y-1">
              <li><strong>Google Chrome</strong> (best GPS support)</li>
              <li>Enable location permissions when prompted</li>
              <li>Use on mobile device for accurate tracking</li>
            </ul>
            {browserInfo.name === "Brave" && (
              <p className="text-xs mt-2 bg-yellow-100 dark:bg-yellow-900/40 p-2 rounded">
                <strong>Brave Users:</strong> Brave Shield may block location. Click the shield icon and allow location access.
              </p>
            )}
          </AlertDescription>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDismiss}
          className="flex-shrink-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </Alert>
  );
}



