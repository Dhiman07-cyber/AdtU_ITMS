"use client";

import { Button } from "@/components/ui/button";
import { AlertCircle,RefreshCw } from "lucide-react";

interface MapFallbackUIProps {
    onRetry?: () => void;
    message?: string;
    className?: string;
}

/**
 * Generic fallback UI for map errors.
 * Shows a calm message without revealing technical details.
 * Per requirement: "Internal server is under high load. Please wait and try again."
 */
export default function MapFallbackUI({
    onRetry,
    message,
    className = "",
}: MapFallbackUIProps) {
    return (
        <div
            className={`flex flex-col items-center justify-center h-full w-full min-h-[300px] bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 dark:from-gray-900 dark:via-blue-950/20 dark:to-indigo-950/10 rounded-3xl border border-white/10 ${className}`}
        >
            <div className="text-center space-y-5 max-w-sm px-6">
                {/* Animated icon */}
                <div className="relative mx-auto w-16 h-16">
                    <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 animate-pulse" />
                    <div className="relative flex items-center justify-center w-full h-full rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg">
                        <AlertCircle className="h-7 w-7 text-white" />
                    </div>
                </div>

                {/* Message */}
                <div className="space-y-2">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                        Map Temporarily Unavailable
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                        {message ||
                            "Internal server is under high load. Please wait and try again."}
                    </p>
                </div>

                {/* Retry button */}
                {onRetry && (
                    <Button
                        onClick={onRetry}
                        className="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-semibold px-6 py-2.5 rounded-xl shadow-lg hover:scale-[1.02] transition-all"
                    >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Try Again
                    </Button>
                )}
            </div>
        </div>
    );
}
