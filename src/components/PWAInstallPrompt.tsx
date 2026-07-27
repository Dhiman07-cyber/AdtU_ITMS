"use client";

import { Button } from "@/components/ui/button";
import { Download,Smartphone,Sparkles,X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect,useState } from "react";

export default function PWAInstallPrompt() {
  const pathname = usePathname();
  const [showPrompt, setShowPrompt] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isDevelopment, setIsDevelopment] = useState(false);

  useEffect(() => {
    // Check if we're in development mode
    setIsDevelopment(process.env.NODE_ENV === 'development' || window.location.hostname === 'localhost');

    // Only show on landing page ("/")
    if (pathname !== "/") {
      setShowPrompt(false);
      return;
    }

    // PWA Install Prompt Setup

    // Auto-show prompt on landing page load
    const timer = setTimeout(() => {
      const dismissed = localStorage.getItem("pwa-install-dismissed");
      if (!dismissed) {
        setShowPrompt(true);
      } else {
        console.log('📱 PWA Install Prompt: Already dismissed');
      }
    }, 1000); // Show after 1 second

    // Auto-hide after 10 seconds
    const hideTimer = setTimeout(() => {
      setShowPrompt(false);
    }, 11000); // Hide after 11 seconds total

    const handler = (e: Event) => {
      // beforeinstallprompt event fired
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Save the event so it can be triggered later
      setDeferredPrompt(e);
    };

    window.addEventListener("beforeinstallprompt", handler);

    // Check if already installed (but don't prevent showing in development)
    if (window.matchMedia("(display-mode: standalone)").matches && !isDevelopment) {
      // Already installed
      setShowPrompt(false);
    }

    return () => {
      clearTimeout(timer);
      clearTimeout(hideTimer);
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, [pathname, isDevelopment]);

  const handleInstall = async () => {
    // Install button clicked

    if (deferredPrompt) {
      // Show the install prompt (production mode)
      try {
        deferredPrompt.prompt();

        // Wait for the user to respond to the prompt
        const { outcome } = await deferredPrompt.userChoice;

        if (outcome === "accepted") {
          console.log("PWA Install Prompt: User accepted the install");
        } else {
          console.log("PWA Install Prompt: User dismissed the install");
        }

        // Clear the deferredPrompt
        setDeferredPrompt(null);
        setShowPrompt(false);
      } catch (error) {
        console.error('Error showing install prompt:', error);
      }
      // Development fallback handled silently
      setShowPrompt(false);
    } else {
      console.log('📱 PWA Install Prompt: No install prompt available');
      setShowPrompt(false);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem("pwa-install-dismissed", "true");
    setShowPrompt(false);
  };

  if (!showPrompt) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:bottom-6 z-[9999] md:max-w-sm animate-in slide-in-from-bottom-10 duration-700 fade-in-0">
      <div className="relative group">
        {/* Vibrant Glow Effect */}
        <div className="absolute -inset-1 bg-gradient-to-r from-blue-600/10 via-indigo-600/10 to-cyan-400/10 rounded-2xl blur opacity-10 group-hover:opacity-25 transition duration-1000 group-hover:duration-500"></div>

        {/* Main Card */}
        <div className="relative bg-slate-900/95 border border-white/10 rounded-2xl p-5 shadow-2xl ring-1 ring-white/10 dark:ring-white/5 overflow-hidden">

          {/* Decorative Background Elements */}
          <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 rounded-full blur-xl pointer-events-none"></div>
          <div className="absolute bottom-0 left-0 -mb-4 -ml-4 w-20 h-20 bg-gradient-to-tr from-cyan-500/20 to-blue-500/20 rounded-full blur-xl pointer-events-none"></div>

          <div className="flex items-start gap-5 relative z-10 mb-2">
            {/* App Icon Area */}
            <div className="relative shrink-0">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-gray-800 to-gray-950 flex items-center justify-center border border-white/10 shadow-inner group-hover:scale-105 transition-transform duration-300">
                <Smartphone className="h-7 w-7 text-white" />
              </div>
              <div className="absolute -top-1 -right-1 bg-gradient-to-r from-amber-300 to-orange-400 text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-lg flex items-center gap-0.5 animate-pulse">
                <Sparkles className="h-2.5 w-2.5" />
                <span>NEW</span>
              </div>
            </div>

            <div className="flex-1 min-w-[200px]">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-base font-bold text-white tracking-tight">
                    Install AdtU Bus App
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    Faster access & real-time tracking
                  </p>
                </div>
                <button
                  onClick={handleDismiss}
                  className="text-slate-400 hover:text-white transition-colors p-1 -mr-2 -mt-2 rounded-full hover:bg-white/10"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex items-center gap-3 mt-4">
                <Button
                  size="sm"
                  onClick={handleInstall}
                  className="flex-1 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white shadow-lg shadow-violet-500/25 border-0 rounded-lg h-9 font-medium text-xs transition-all duration-200 hover:scale-[1.02]"
                >
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  Install Now
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleDismiss}
                  className="px-3 text-xs text-slate-300 hover:text-white hover:bg-white/5 h-9 rounded-lg transition-colors border border-white/5"
                >
                  Later
                </Button>
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="absolute bottom-0 left-0 w-full h-[3px] bg-white/5">
            <div className="h-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-500 animate-[progress_10s_linear_forwards] origin-left"></div>
          </div>
        </div>
      </div>
    </div>
  );
}


