"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Bus, QrCode, Sun, Moon, ArrowLeft, ArrowRight, CheckCircle,
  Loader2, AlertCircle, Scan, Shield,
} from "lucide-react";
import { authApiFetch } from "@/lib/secure-api-client";
import { PremiumPageLoader } from "@/components/LoadingSpinner";
import { formatIdForDisplay } from "@/lib/utils";
import jsQR from "jsqr";

type TripMode = "dev" | "production";
type Step = "select-mode" | "select-bus" | "scan-qr" | "select-shift" | "confirming" | "done" | "error";

interface BusInfo {
  id: string;
  bus_number: string;
  status: string;
  route_id: string;
  route_name: string;
}

export default function StartTripPage() {
  const { currentUser, userData } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<TripMode>("dev");
  const [step, setStep] = useState<Step>("select-mode");
  const [buses, setBuses] = useState<BusInfo[]>([]);
  const [selectedBus, setSelectedBus] = useState<BusInfo | null>(null);
  const [selectedShift, setSelectedShift] = useState<"Morning" | "Evening" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ tripId: string } | null>(null);

  useEffect(() => {
    if (!currentUser?.uid) return;
    const fetchBuses = async () => {
      try {
        const res = await authApiFetch(currentUser, "/api/driver/available-buses");
        if (res.ok) {
          const data = await res.json();
          setBuses(data.buses || []);
        }
      } catch (e) {
        console.error("Failed to fetch available buses", e);
      } finally {
        setLoading(false);
      }
    };
    fetchBuses();
  }, [currentUser]);

  const chooseMode = (m: TripMode) => {
    setMode(m);
    setError(null);
    if (m === "dev") setStep("select-bus");
    else setStep("scan-qr");
  };

  const selectBus = (bus: BusInfo) => {
    setSelectedBus(bus);
    setStep("select-shift");
  };

  const handleQRResult = (busId: string) => {
    const bus = buses.find((b) => b.id === busId);
    if (bus) {
      setSelectedBus(bus);
      setStep("select-shift");
    } else {
      setError("QR code scanned, but bus not found in your assignments");
    }
  };

  const selectShift = (shift: "Morning" | "Evening") => {
    setSelectedShift(shift);
    setStep("confirming");
    startTrip(shift);
  };

  const startTrip = async (shift: "Morning" | "Evening") => {
    if (!currentUser || !selectedBus) return;
    setError(null);

    try {
      const res = await authApiFetch(currentUser, "/api/driver/initiate-trip", {
        method: "POST",
        body: JSON.stringify({ busId: selectedBus.id, shift }),
      });

      if (res.ok) {
        const data = await res.json();
        setResult({ tripId: data.tripId });
        setStep("done");
        setTimeout(() => router.push("/driver/live-tracking"), 1500);
      } else {
        const err = await res.json();
        setError(err.error || "Failed to start trip");
        setStep("error");
      }
    } catch (e) {
      setError("Network error. Please try again.");
      setStep("error");
    }
  };

  const goBack = () => {
    setError(null);
    if (step === "select-bus" || step === "scan-qr") {
      setStep("select-mode");
      setSelectedBus(null);
      setSelectedShift(null);
    } else if (step === "select-shift") {
      if (mode === "dev") setStep("select-bus");
      else setStep("scan-qr");
    } else {
      setStep("select-mode");
      setSelectedBus(null);
      setSelectedShift(null);
    }
  };

  const reset = () => {
    setStep("select-mode");
    setSelectedBus(null);
    setSelectedShift(null);
    setError(null);
    setResult(null);
  };

  if (loading) {
    return (
      <div className="flex-1 min-h-[calc(100dvh-120px)] flex items-center justify-center bg-gray-50 dark:bg-[#020817]">
        <PremiumPageLoader message="Loading..." subMessage="Checking available buses" />
      </div>
    );
  }

  if (step === "done" && result) {
    return (
      <div className="flex-1 min-h-[calc(100dvh-120px)] flex items-center justify-center bg-gray-50 dark:bg-[#020817]">
        <div className="text-center space-y-4">
          <div className="mx-auto w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
          <h2 className="text-xl font-bold">Trip Started!</h2>
          <p className="text-sm text-gray-500">Redirecting to live tracking...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-[calc(100dvh-120px)] bg-gradient-to-br from-gray-50 via-blue-50/30 to-purple-50/30 dark:from-gray-950 dark:via-slate-900 dark:to-gray-950">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          {step !== "select-mode" && (
            <button onClick={goBack} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div>
            <h1 className="text-xl font-bold">Start Trip</h1>
            <p className="text-sm text-gray-500">
              {mode === "dev" ? "Select a bus to operate" : "Scan the QR code on your bus"}
            </p>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-800 dark:text-red-200">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
              &times;
            </button>
          </div>
        )}

        {/* Step: Mode Selection */}
        {step === "select-mode" && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">Choose how to start your trip:</p>
            <button
              onClick={() => chooseMode("dev")}
              className="w-full p-5 rounded-2xl border-2 border-blue-200 dark:border-blue-800 bg-white dark:bg-gray-900 hover:border-blue-400 transition-all text-left"
            >
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-blue-100 dark:bg-blue-900/30">
                  <Bus className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <p className="font-semibold">Select Bus</p>
                  <p className="text-sm text-gray-500">Choose from your assigned buses</p>
                </div>
              </div>
            </button>
            <button
              onClick={() => chooseMode("production")}
              className="w-full p-5 rounded-2xl border-2 border-purple-200 dark:border-purple-800 bg-white dark:bg-gray-900 hover:border-purple-400 transition-all text-left"
            >
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-purple-100 dark:bg-purple-900/30">
                  <QrCode className="h-6 w-6 text-purple-600" />
                </div>
                <div>
                  <p className="font-semibold">Scan QR Code</p>
                  <p className="text-sm text-gray-500">Scan the QR code on your bus</p>
                </div>
              </div>
            </button>
          </div>
        )}

        {/* Step: Bus Selection (Dev Mode) */}
        {step === "select-bus" && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">Select a bus to start your trip:</p>
            {buses.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <Bus className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>No buses assigned to you</p>
              </div>
            ) : (
              buses.map((bus) => (
                <button
                  key={bus.id}
                  onClick={() => selectBus(bus)}
                  disabled={bus.status === "inactive"}
                  className="w-full p-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-blue-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-left"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600">
                        <Bus className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <p className="font-semibold">{formatIdForDisplay(bus.bus_number || bus.id)}</p>
                        <p className="text-xs text-gray-500">{bus.route_name || bus.route_id || "No route"}</p>
                      </div>
                    </div>
                    <Badge className={bus.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}>
                      {bus.status}
                    </Badge>
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        {/* Step: QR Scan (Production Mode) */}
        {step === "scan-qr" && (
          <QRScanner
            buses={buses}
            onResult={handleQRResult}
            onBack={goBack}
          />
        )}

        {/* Step: Shift Selection */}
        {step === "select-shift" && selectedBus && (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600">
                  <Bus className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="font-semibold">{formatIdForDisplay(selectedBus.bus_number || selectedBus.id)}</p>
                  <p className="text-xs text-gray-500">{selectedBus.route_name || selectedBus.route_id || "No route"}</p>
                </div>
              </div>
            </div>
            <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Select trip shift:</p>
            <button
              onClick={() => selectShift("Morning")}
              className="w-full p-5 rounded-2xl border-2 border-amber-200 dark:border-amber-800 bg-white dark:bg-gray-900 hover:border-amber-400 transition-all text-left"
            >
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-amber-100 dark:bg-amber-900/30">
                  <Sun className="h-6 w-6 text-amber-600" />
                </div>
                <div>
                  <p className="font-semibold">Morning Shift</p>
                  <p className="text-sm text-gray-500">Start morning route</p>
                </div>
              </div>
            </button>
            <button
              onClick={() => selectShift("Evening")}
              className="w-full p-5 rounded-2xl border-2 border-indigo-200 dark:border-indigo-800 bg-white dark:bg-gray-900 hover:border-indigo-400 transition-all text-left"
            >
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-indigo-100 dark:bg-indigo-900/30">
                  <Moon className="h-6 w-6 text-indigo-600" />
                </div>
                <div>
                  <p className="font-semibold">Evening Shift</p>
                  <p className="text-sm text-gray-500">Start evening route</p>
                </div>
              </div>
            </button>
          </div>
        )}

        {/* Step: Confirming */}
        {step === "confirming" && (
          <div className="p-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-blue-600" />
            <p className="text-sm text-gray-500">Starting your trip...</p>
          </div>
        )}

        {/* Step: Error */}
        {step === "error" && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
              <p className="text-sm text-red-800 dark:text-red-200">{error || "Something went wrong"}</p>
            </div>
            <Button onClick={reset} className="w-full" variant="outline">
              Try Again
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function QRScanner({
  buses,
  onResult,
  onBack,
}: {
  buses: BusInfo[];
  onResult: (busId: string) => void;
  onBack: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [manualInput, setManualInput] = useState("");

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setScanning(true);
        scanFrame();
      }
    } catch {
      setScanning(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (videoRef.current?.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach((t) => t.stop());
    }
  }, []);

  useEffect(() => {
    startCamera();
    return stopCamera;
  }, [startCamera, stopCamera]);

  const scanFrame = () => {
    if (!videoRef.current || !canvasRef.current) {
      animationRef.current = requestAnimationFrame(scanFrame);
      return;
    }
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
      animationRef.current = requestAnimationFrame(scanFrame);
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height);
    if (code) {
      const qrData = code.data.trim();
      const bus = findBusByQR(qrData, buses);
      if (bus) {
        stopCamera();
        onResult(bus.id);
        return;
      }
    }
    animationRef.current = requestAnimationFrame(scanFrame);
  };

  const handleManualSubmit = () => {
    const bus = findBusByQR(manualInput, buses);
    if (bus) {
      onResult(bus.id);
    }
  };

  return (
    <div className="space-y-4">
      <div className="relative rounded-2xl overflow-hidden bg-black aspect-[4/3]">
        <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />
        <canvas ref={canvasRef} className="hidden" />
        {!scanning && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
            <div className="text-center text-white">
              <Scan className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm opacity-70">Camera unavailable</p>
            </div>
          </div>
        )}
        <div className="absolute inset-0 border-[3px] border-transparent pointer-events-none">
          <div className="w-48 h-48 mx-auto mt-[15%] border-2 border-white/60 rounded-xl" />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-600 dark:text-gray-400">
          Or enter bus ID manually:
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            placeholder="Bus ID or QR data"
            className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          />
          <Button onClick={handleManualSubmit} size="sm" disabled={!manualInput.trim()}>
            Find
          </Button>
        </div>
      </div>
    </div>
  );
}

function findBusByQR(qrData: string, buses: BusInfo[]): BusInfo | null {
  const qr = qrData.trim();

  if (qr.startsWith("bus:")) {
    const id = qr.slice(4).trim();
    return buses.find((b) => b.id === id || b.bus_number === id) || null;
  }

  if (/^[a-zA-Z0-9_-]{1,64}$/.test(qr)) {
    return buses.find((b) => b.id === qr || b.bus_number === qr) || null;
  }

  return null;
}
