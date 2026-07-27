"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import {
  Camera,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  Phone,
  Calendar,
  Clock,
  Scan,
  Activity,
  ArrowLeft,
  X,
  ShieldCheck,
  Bus,
  Copy,
  RotateCcw,
  Layout,
  LayoutGrid,
  User,
  Check
} from 'lucide-react';
import jsQR from 'jsqr';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { APP_NAME } from '@/config/runtime';
import { auth } from '@/lib/firebase';
import { safeImageSrc } from '@/lib/security/url-sanitizer';

// Verified student data interface
interface VerifiedStudentData {
  uid: string;
  fullName: string;
  enrollmentId?: string;
  phone?: string;
  phoneNumber?: string;
  mobileNumber?: string;
  profilePhotoUrl?: string;
  assignedBus?: string;
  busId?: string;
  assignedShift?: string;
  shift?: string;
  validUntil?: string;
  status?: string;
  department?: string;
  gender?: string;
  routeName?: string;
}


interface ScanResult {
  scanId: string;
  scanType: 'student';
  status: 'success' | 'invalid' | 'session_expired' | 'rate_limited';
  message: string;
  studentData: VerifiedStudentData | null;
  isAssigned: boolean;
  sessionActive: boolean;
  verifiedAt?: string;
  verifiedBy?: string;
}

export default function DriverScanPassPage() {
  const { userData, currentUser } = useAuth();
  const appName = APP_NAME;
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const isScanningRef = useRef<boolean>(false);

  const [isScanning, setIsScanning] = useState(false);
  const [scannedStudents, setScannedStudents] = useState<ScanResult[]>([]);
  const [latestScanResult, setLatestScanResult] = useState<ScanResult | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const [copied, setCopied] = useState(false);
  const [isVertical, setIsVertical] = useState(false);
  const [scannerModalOpen, setScannerModalOpen] = useState(false);


  const lastBusIdRef = useRef<string | null>(null);

  // Sync bus ID to ref for stable access during frequent scans
  useEffect(() => {
    const busId = userData?.busId || userData?.busId ||
      (userData?.busIds && userData.busIds?.[0]);
    if (busId) {
      lastBusIdRef.current = busId as string;
    }
  }, [userData]);

  // Redirect if user is not a driver
  useEffect(() => {
    if (userData && userData.role !== 'driver') {
      router.push(`/${userData.role}`);
    }
  }, [userData, router]);

  // Stop scanning function with complete cleanup
  const stopScanning = useCallback(() => {
    isScanningRef.current = false;

    // Use ref to ensure we have the latest stream even if state is stale in closure
    const stream = cameraStreamRef.current;
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      cameraStreamRef.current = null;
    }

    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    setIsScanning(false);
  }, [cameraStream]);

  // Cleanup camera on unmount only
  useEffect(() => {
    return () => {
      const stream = cameraStreamRef.current;
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []); // Empty dependency array - only runs on mount/unmount

  // Start camera scanning
  const startScanning = async () => {
    setError(null);
    setCameraError(null);
    setLatestScanResult(null);
    setIsScanning(true);
    isScanningRef.current = true;

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera not supported.');
      }

      // Request camera (prefer environment/back camera)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 }
        },
        audio: false
      }).catch(async (err) => {
        console.log('Environment camera failed, trying user camera...', err);
        return navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280, min: 640 },
            height: { ideal: 720, min: 480 },
          },
          audio: false
        });
      });

      if (!stream) throw new Error('Unable to access camera.');

      setCameraStream(stream);
      cameraStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        videoRef.current.playsInline = true;

        // Mirror ONLY if using front/user camera
        const videoTrack = stream.getVideoTracks()[0];
        const settings = videoTrack.getSettings();

        if (settings.facingMode === 'user') {
          videoRef.current.style.transform = 'scaleX(-1)';
        } else {
          videoRef.current.style.transform = 'scaleX(1)';
        }

        // Wait for video metadata to load
        await new Promise((resolve) => {
          if (videoRef.current) {
            videoRef.current.onloadedmetadata = () => {
              resolve(null);
            };
          }
        });

        // Play the video
        try {
          await videoRef.current.play();
        } catch (playError) {
          console.error('Error playing video:', playError);
        }

        requestAnimationFrame(scanQRCode);
      }
    } catch (err: any) {
      console.error('Camera error:', err);
      setCameraError(err.message || 'Failed to access camera');
      setIsScanning(false);
    }
  };

  // QR code scanning loop - throttled for performance
  const scanQRCode = async () => {
    if (!isScanningRef.current) return;

    if (!videoRef.current || !canvasRef.current) {
      // Throttle: wait 100ms before retrying
      setTimeout(scanQRCode, 100);
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d', { willReadFrequently: true });

    // Ensure video has valid dimensions and is ready
    if (!context || video.readyState !== video.HAVE_ENOUGH_DATA || video.videoWidth === 0 || video.videoHeight === 0) {
      setTimeout(scanQRCode, 100);
      return;
    }

    // 1. Try Native BarcodeDetector (Fastest) - preferred method
    if ('BarcodeDetector' in window) {
      try {
        // @ts-ignore
        const barcodeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
        const barcodes = await barcodeDetector.detect(video);

        if (barcodes.length > 0) {
          handleScanSuccess(barcodes[0].rawValue);
          return;
        }
      } catch (e) {
        // Native failed, continue to fallback
      }
    }

    // 2. Fallback: Optimized jsQR with proper dimension handling
    const scanWidth = Math.min(480, video.videoWidth);
    const scanHeight = Math.floor(video.videoHeight * (scanWidth / video.videoWidth));

    // Validate dimensions
    if (scanWidth <= 0 || scanHeight <= 0 || !Number.isFinite(scanWidth) || !Number.isFinite(scanHeight)) {
      setTimeout(scanQRCode, 100);
      return;
    }

    // Only update canvas dimensions if changed
    if (canvas.width !== scanWidth || canvas.height !== scanHeight) {
      canvas.width = scanWidth;
      canvas.height = scanHeight;
    }

    context.drawImage(video, 0, 0, scanWidth, scanHeight);

    try {
      const imageData = context.getImageData(0, 0, scanWidth, scanHeight);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert' // Faster: only try non-inverted first
      });

      if (code && code.data) {
        handleScanSuccess(code.data);
        return;
      }
    } catch (err) {
      // Canvas error - skip this frame
    }

    // Continue scanning with throttled interval (10 FPS instead of 60 FPS)
    setTimeout(scanQRCode, 100);
  };

  // Handle successful QR code scan
  const handleScanSuccess = (data: string) => {
    // Haptic feedback on mobile
    if (navigator.vibrate) {
      navigator.vibrate([100, 50, 100]);
    }
    stopScanning();

    // Verify student identity
    verifyStudent(data);
  };


  // Verify student with the new API
  const verifyStudent = async (studentUid: string) => {
    setIsVerifying(true);
    setError(null);

    try {
      if (!currentUser?.uid) {
        throw new Error('Not authenticated');
      }

      // Get auth token for secure API call
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        throw new Error('Unable to get authentication token');
      }

      // Use reactive userData with ref fallback to handle intermittent context updates
      const scannerBusId = userData?.busId || userData?.busId ||
        (userData?.busIds && userData.busIds[0]) ||
        lastBusIdRef.current;

      if (!scannerBusId) {
        throw new Error('No bus assigned to driver');
      }

      // 1. Basic Client-side Validation
      const isEncryptedToken = studentUid.length > 60 && /^[A-Za-z0-9_-]+$/.test(studentUid);

      if (!isEncryptedToken && (studentUid.length < 5 || studentUid.length > 128 || studentUid.includes('http'))) {
        const errorMsg = studentUid.includes('http')
          ? 'This is a website link, not a student ID.'
          : 'Invalid QR code. Please scan a valid Student Bus Pass.';

        setLatestScanResult({
          scanId: crypto.randomUUID(),
          scanType: 'student',
          status: 'invalid',
          message: errorMsg,
          studentData: null,
          isAssigned: false,
          sessionActive: false
        });
        setError(errorMsg);
        toast.error(errorMsg);
        setIsVerifying(false);
        return;
      }

      let response;
      if (isEncryptedToken) {
        response = await fetch('/api/bus-pass/verify-secure-qr', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            secureToken: studentUid,
            scannerBusId
          }),
        });
      } else {
        response = await fetch('/api/bus-pass/verify-student', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            studentUid,
            scannerBusId
          }),
        });
      }

      const result = await response.json();
      let sData = result.studentData;

      // Fetch profile photo from API if missing from API
      if (sData?.uid && (!sData.profilePhotoUrl || sData.profilePhotoUrl === '')) {
        try {
          const studentRes = await fetch(`/api/students/${sData.uid}`);
          if (studentRes.ok) {
            const studentDoc = await studentRes.json();
            sData = {
              ...sData,
              profilePhotoUrl: studentDoc.profilePhotoUrl || studentDoc.profileImage || studentDoc.photoURL
            };
          }
        } catch (e) {
          console.error('Student image fetch error:', e);
        }
      }

      const resultWithId = {
        ...result,
        studentData: sData,
        scanId: crypto.randomUUID(),
        scanType: 'student' as const
      };

      if (!response.ok) {
        // Handle server-side errors gracefully
        const errorMsg = result.message || (response.status >= 500 ? 'Server connectivity issue' : 'Verification failed');
        setLatestScanResult(resultWithId);
        setError(errorMsg);
        toast.error(errorMsg);
        return;
      }

      // Use existing resultWithId for success case

      setLatestScanResult(resultWithId);

      // Add to scanned students list
      if (resultWithId.status === 'success' && resultWithId.studentData) {
        setScannedStudents(prev => [resultWithId, ...prev]);
        setScannerModalOpen(false); // Close modal on success
        stopScanning(); // Stop camera
        toast.success('Student verified successfully!');
      } else if (resultWithId.status === 'invalid' || resultWithId.status === 'session_expired') {
        const msg = resultWithId.message || 'Verification failed';
        setError(msg);
        toast.error(msg);
      } else {
        toast.warning(resultWithId.message || 'Verification issue');
      }
    } catch (err: any) {
      console.error('Verification error:', err);
      const errorMsg = 'Check your internet connection and try again.';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setIsVerifying(false);
    }
  };

  // Helper to properly capitalize gender
  const formatGender = (gender: string | undefined) => {
    if (!gender) return 'N/A';
    return gender.charAt(0).toUpperCase() + gender.slice(1).toLowerCase();
  };

  // Format valid until date
  const getValidUntilDisplay = (result: ScanResult) => {
    if (!result?.studentData?.validUntil) return 'N/A';
    return new Date(result.studentData.validUntil).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Scan another - open scanner modal without clearing cards
  const scanAnother = () => {
    setError(null);
    setCameraError(null);
    setLatestScanResult(null);
    setScannerModalOpen(true);
    startScanning();
  };

  // Close scanner modal
  const closeScannerModal = () => {
    stopScanning();
    setScannerModalOpen(false);
  };

  // Reset all scans and stop camera
  const resetScan = () => {
    stopScanning();
    setScannerModalOpen(false);
    setScannedStudents([]);
    setLatestScanResult(null);
    setError(null);
    setCameraError(null);
  };

  // Copy enrollment ID
  const handleCopyId = async (enrollmentId: string | undefined) => {
    if (enrollmentId) {
      try {
        await navigator.clipboard.writeText(enrollmentId);
        setCopied(true);
        toast.success('Copied!');
        setTimeout(() => setCopied(false), 2000);
      } catch {
        toast.error('Failed to copy');
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] relative flex flex-col items-center justify-start sm:justify-center p-4 pt-0 sm:pt-0 overflow-hidden">
      {/* Background Decorations */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[120px]" />
      </div>

      <div className="w-full max-w-[500px] relative z-10 flex flex-col items-center mt-8 sm:mt-0 md:mt-2">
        {/* Header Section */}
        {scannedStudents.length === 0 && (
          <div className="w-full flex items-center justify-between mb-6 px-1">
            <div className="text-left">
              <h1 className="text-xl font-black text-white tracking-tight leading-none pt-7">Bus Pass Scanner</h1>
              <p className="text-[9px] text-white/40 font-bold uppercase tracking-[0.15em] mt-1">Verify student boarding</p>
            </div>
            <button
              onClick={resetScan}
              className="p-2 rounded-xl bg-white text-[#020617] hover:bg-white/90 transition-all shadow-lg hover:scale-102 hover:cursor-pointer mt-4"
              title="Refresh"
            >
              <div className="flex items-center gap-2">
                <RotateCcw className="h-3 w-3" />
                <div className="text-[10px] text-gray-800 font-bold tracking-[0.15em]">Refresh</div>
              </div>
            </button>
          </div>
        )}

        <AnimatePresence mode="wait">
          {scannedStudents.length === 0 ? (
            <motion.div
              key="scanner"
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -20 }}
              className="w-full"
            >
              {/* Ready / Scanner Card */}
              <div className="relative w-full aspect-[3/4.8] sm:aspect-[3/3.9] bg-white/5 backdrop-blur-xl border border-white/10 rounded-[40px] overflow-hidden flex flex-col shadow-2xl">
                {/* Pattern Overlay */}
                <div className="absolute inset-0 opacity-5 pointer-events-none">
                  <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] mix-blend-overlay" />
                </div>

                <div className="flex-1 flex flex-col items-center justify-center p-8 relative z-10">
                  {isScanning && !cameraError ? (
                    <motion.div
                      className="absolute inset-0"
                      initial={{ opacity: 0, scale: 1.05 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.4, ease: 'easeOut' }}
                    >
                      <video
                        ref={videoRef}
                        className="absolute inset-0 w-full h-full object-cover"
                        style={{ backgroundColor: '#000' }}
                      />
                      <canvas ref={canvasRef} className="hidden" />

                      {/* Scanning Indicators */}
                      <div className="absolute inset-0 pointer-events-none z-10">
                        {/* Corner brackets for premium look */}
                        <div className="absolute inset-8 sm:inset-10">
                          <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-blue-400/60 rounded-tl-2xl" />
                          <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-blue-400/60 rounded-tr-2xl" />
                          <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-blue-400/60 rounded-bl-2xl" />
                          <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-blue-400/60 rounded-br-2xl" />
                        </div>

                        {/* Scanning line */}
                        <motion.div
                          className="absolute left-8 right-8 sm:left-10 sm:right-10 h-0.5 bg-gradient-to-r from-transparent via-blue-400 to-transparent shadow-[0_0_20px_rgba(96,165,250,0.8)]"
                          animate={{ top: ['18%', '72%'] }}
                          transition={{ duration: 2.5, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' }}
                        />

                        {/* Instruction pill */}
                        <motion.div
                          className="absolute bottom-24 left-1/2 -translate-x-1/2 px-5 py-2.5 bg-black/70 backdrop-blur-xl border border-white/20 rounded-full shadow-xl"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.3, duration: 0.4 }}
                        >
                          <div className="text-white text-[11px] font-bold uppercase tracking-wider flex items-center gap-2">
                            <motion.div
                              animate={{ scale: [1, 1.2, 1] }}
                              transition={{ duration: 1.5, repeat: Infinity }}
                            >
                              <Scan className="w-4 h-4 text-blue-400" />
                            </motion.div>
                            Align QR Code
                          </div>
                        </motion.div>
                      </div>

                      <motion.button
                        onClick={stopScanning}
                        className="absolute bottom-6 left-1/2 -translate-x-1/2 px-6 py-2.5 bg-red-600/90 hover:bg-red-500 border border-red-400/30 text-white rounded-full text-xs font-black transition-all backdrop-blur-md shadow-lg"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4, duration: 0.3 }}
                        whileTap={{ scale: 0.95 }}
                      >
                        STOP SCANNER
                      </motion.button>
                    </motion.div>
                  ) : (
                    <motion.div
                      className="flex flex-col items-center text-center"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                    >
                      <motion.div
                        className="relative mb-8"
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: 0.1, duration: 0.4, type: 'spring' }}
                      >
                        <div className="w-28 h-28 bg-blue-500/10 rounded-full flex items-center justify-center border border-blue-500/20 shadow-[0_0_50px_rgba(59,130,246,0.1)]">
                          <Camera className="h-12 w-12 text-blue-400" />
                        </div>
                        <motion.div
                          className="absolute inset-0 rounded-full bg-blue-500/20"
                          animate={{ scale: [1, 1.4, 1], opacity: [0.3, 0, 0.3] }}
                          transition={{ duration: 3, repeat: Infinity }}
                        />
                      </motion.div>

                      <motion.h2
                        className="text-2xl font-black text-white mb-2 tracking-tight"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.2 }}
                      >
                        Ready to Scan QR Code
                      </motion.h2>
                      <motion.p
                        className="text-white/40 text-sm font-medium px-6 leading-relaxed mb-10"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.3 }}
                      >
                        Click below to start camera scanning and verify student bus passes
                      </motion.p>

                      {isVerifying ? (
                        <motion.div
                          className="flex flex-col items-center gap-4"
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.3 }}
                        >
                          <Loader2 className="h-10 w-10 text-blue-500 animate-spin" />
                          <span className="text-xs font-bold text-white/40 uppercase tracking-widest">Processing Identity...</span>
                        </motion.div>
                      ) : (
                        <motion.button
                          onClick={startScanning}
                          className="w-full max-w-[280px] py-5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black rounded-2xl shadow-xl transition-all flex items-center justify-center gap-3"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.4, duration: 0.3 }}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                        >
                          <Scan className="h-5 w-5" />
                          Start Camera Scanner
                        </motion.button>
                      )}
                    </motion.div>
                  )}

                  {cameraError && (
                    <div className="absolute inset-0 bg-[#020617]/95 flex flex-col items-center justify-center p-8 text-center backdrop-blur-md">
                      <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mb-6 border border-red-500/20">
                        <AlertCircle className="h-8 w-8 text-red-500" />
                      </div>
                      <h3 className="text-xl font-bold text-white mb-2">Camera Error</h3>
                      <p className="text-red-400/70 text-sm mb-8 leading-relaxed">{cameraError}</p>
                      <Button onClick={startScanning} className="w-full bg-white/10 hover:bg-white/20 text-white rounded-xl border border-white/10">
                        Retry Access
                      </Button>
                    </div>
                  )}

                  {error && !isVerifying && (
                    <div className="absolute inset-0 bg-[#020617]/95 flex flex-col items-center justify-center p-8 text-center backdrop-blur-md">
                      <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mb-6 border border-red-500/20">
                        <XCircle className="h-8 w-8 text-red-500" />
                      </div>
                      <h3 className="text-xl font-bold text-white mb-2">Scanner Error</h3>
                      <p className="text-red-400/70 text-sm mb-8 leading-relaxed">{error}</p>
                      <Button onClick={scanAnother} className="w-full bg-white/10 hover:bg-white/20 text-white rounded-xl border border-white/10">
                        Try Again
                      </Button>
                    </div>
                  )}
                </div>
              </div>
              <p className="text-center text-white/40 text-[10px] font-black tracking-[0.2em] mt-8">
                Scan the QR code to verify student's bus pass validity
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 40, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="w-full flex flex-col items-center gap-5 pb-8"
            >
              {/* Orientation Switcher */}
              <div className="flex bg-[#1a1b2e] p-1 rounded-2xl border border-white/10 backdrop-blur-md sticky top-0 z-20">
                <button
                  onClick={() => setIsVertical(false)}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all ${!isVertical ? 'bg-blue-600 text-white' : 'text-white/50 hover:text-white/70'}`}
                >
                  <Layout className="w-4 h-4" />
                  Horizontal
                </button>
                <button
                  onClick={() => setIsVertical(true)}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all ${isVertical ? 'bg-blue-600 text-white' : 'text-white/50 hover:text-white/70'}`}
                >
                  <LayoutGrid className="w-4 h-4" />
                  Vertical
                </button>
              </div>

              {/* Cards List */}
              <div className="w-full space-y-4">
                {scannedStudents.map((scanResult, index) => (
                  <div key={scanResult.scanId || index} className={`relative w-full ${isVertical ? 'max-w-[380px]' : 'max-w-[600px]'} mx-auto bg-[#0f1019] rounded-[28px] overflow-hidden shadow-2xl border border-white/10`}>

                    {/* Header with Logo */}
                    <div className="w-full px-4 py-3 flex items-center justify-between border-b border-white/5 bg-gradient-to-r from-[#1a1b2e] to-[#0f1019] relative">
                      <div className="flex items-center gap-2.5">
                        <Image src="/adtu-new-logo.svg" alt="AdtU" width={96} height={24} className="h-6 w-auto flex-shrink-0" style={{ width: 'auto', height: 'auto' }} />
                        <span className="text-[10px] font-black text-white/90 uppercase tracking-wider">Assam down town University</span>
                      </div>
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                    </div>

                    {/* Result Content */}
                    <div className="p-3 sm:p-5">
                      {scanResult.studentData ? (<>
                        {!isVertical ? (
                          /* ========== HORIZONTAL LAYOUT (RESIZED & COMPACT) ========== */
                          <div className="flex flex-col gap-2.5">
                            {/* Bus & Route Info Bar - Slimmer */}
                            <div className="flex items-center justify-between bg-[#1a1b2e] rounded-lg px-3 py-1.5 border border-white/5">
                              <div className="flex items-center gap-2">
                                <Bus className="w-3.5 h-3.5 text-blue-400" />
                                <div className="flex items-baseline gap-1.5">
                                  <span className="text-[11px] sm:text-xs font-black text-white">Bus-{(scanResult.studentData.assignedBus || 'N/A').replace('bus_', '')}</span>
                                  <span className="text-white/30 text-[8px] font-medium tracking-tight uppercase">(AS-01-SC-1392)</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[7px] font-bold text-white/40 uppercase tracking-widest">Route</span>
                                <span className="text-[11px] sm:text-xs font-black text-blue-400">{scanResult.studentData.routeName || (scanResult.studentData.assignedBus || 'N/A').replace('bus_', '')}</span>
                              </div>
                            </div>

                            <div className="flex gap-3 items-center">
                              {/* Left: Profile & Basic Info */}
                              <div className="flex flex-col items-center flex-shrink-0 w-[110px] sm:w-[130px]">
                                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-br from-blue-500/20 to-indigo-500/20 border-2 border-blue-500/30 overflow-hidden shadow-lg mb-1.5">
                                  {scanResult.studentData.profilePhotoUrl ? (
                                    <Image src={safeImageSrc(scanResult.studentData.profilePhotoUrl)} width={64} height={64} className="w-full h-full object-cover" alt="Profile" />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                      <User className="h-7 w-7 text-blue-400/40" />
                                    </div>
                                  )}
                                </div>
                                <h4 className="text-[10px] sm:text-xs font-black text-white text-center truncate w-full mb-0.5">{scanResult.studentData.fullName || 'N/A'}</h4>
                                <div onClick={() => handleCopyId(scanResult.studentData?.enrollmentId)} className="flex items-center gap-1 bg-[#1a1b2e] px-1.5 py-0.5 rounded-md border border-white/5 cursor-pointer hover:bg-white/5 transition-all">
                                  <span className="text-[8px] font-bold text-white/30 font-mono tracking-tighter">{scanResult.studentData.enrollmentId || 'N/A'}</span>
                                  {copied ? <Check className="w-2 h-2 text-green-400" /> : <Copy className="w-2 h-2 text-white/10" />}
                                </div>
                              </div>

                              {/* Right: Details Grid */}
                              <div className="flex-1 grid grid-cols-2 gap-2">
                                <div className="bg-[#161726] rounded-xl p-2 border border-white/5">
                                  <span className="text-[7px] font-bold text-white/40 uppercase tracking-widest block mb-0.5">Gender</span>
                                  <span className="text-[10px] sm:text-xs font-bold text-white">{formatGender(scanResult.studentData.gender)}</span>
                                </div>
                                <div className="bg-[#161726] rounded-xl p-2 border border-white/5">
                                  <span className="text-[7px] font-bold text-white/40 uppercase tracking-widest block mb-0.5">Shift</span>
                                  <span className="text-[10px] sm:text-xs font-bold text-white capitalize">{scanResult.studentData.shift || scanResult.studentData.assignedShift || 'Morning'}</span>
                                </div>
                                <div className="bg-[#161726] rounded-xl p-2 border border-white/5">
                                  <span className="text-[7px] font-bold text-white/40 uppercase tracking-widest block mb-0.5 whitespace-nowrap">Valid Until</span>
                                  <span className="text-[10px] sm:text-xs font-bold text-white truncate block">{getValidUntilDisplay(scanResult)}</span>
                                </div>
                                <div className="bg-[#161726] rounded-xl p-2 border border-white/5">
                                  <span className="text-[7px] font-bold text-white/40 uppercase tracking-widest block mb-0.5">Status</span>
                                  <span className={`text-[10px] sm:text-xs font-black ${scanResult.sessionActive ? 'text-green-400' : 'text-red-400'}`}>
                                    {scanResult.sessionActive ? 'ACTIVE' : 'EXPIRED'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : (
                          /* ========== VERTICAL LAYOUT (RESIZED & COMPACT) ========== */
                          <div className="flex flex-col items-center">
                            {/* Profile Photo */}
                            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500/20 to-indigo-500/20 border-4 border-blue-500/30 overflow-hidden shadow-2xl mb-4">
                              {scanResult.studentData.profilePhotoUrl ? (
                                <Image src={safeImageSrc(scanResult.studentData.profilePhotoUrl)} width={80} height={80} className="w-full h-full object-cover" alt="Profile" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <User className="h-10 w-10 text-blue-400/40" />
                                </div>
                              )}
                            </div>

                            {/* Name & ID */}
                            <h3 className="text-lg font-black text-white tracking-tight text-center mb-1">{scanResult.studentData.fullName}</h3>
                            <div className="bg-[#1a1b2e] px-4 py-1.5 rounded-xl border border-white/5 text-[9px] font-bold text-white/40 tracking-widest font-mono mb-5">
                              {scanResult.studentData.enrollmentId || 'N/A'}
                            </div>

                            {/* Info Grid */}
                            <div className="w-full grid grid-cols-2 gap-2">
                              <div className="bg-[#161726] rounded-2xl p-3 border border-white/5">
                                <span className="text-[8px] font-bold text-white/40 uppercase tracking-widest block mb-1">Gender</span>
                                <span className="text-sm font-black text-white">{formatGender(scanResult.studentData.gender)}</span>
                              </div>
                              <div className="bg-[#161726] rounded-2xl p-3 border border-white/5">
                                <span className="text-[8px] font-bold text-white/40 uppercase tracking-widest block mb-1">Shift</span>
                                <span className="text-sm font-black text-white capitalize">{scanResult.studentData.shift || scanResult.studentData.assignedShift || 'Morning'}</span>
                              </div>
                              <div className="bg-[#161726] rounded-2xl p-3 border border-white/5">
                                <span className="text-[8px] font-bold text-white/40 uppercase tracking-widest block mb-1">Valid Until</span>
                                <span className="text-xs font-black text-white">{getValidUntilDisplay(scanResult)}</span>
                              </div>
                              <div className="bg-[#161726] rounded-2xl p-3 border border-white/5 flex flex-col items-start">
                                <span className="text-[8px] font-bold text-white/40 uppercase tracking-widest block mb-1 text-left w-full">Status</span>
                                <div className={`px-2 py-0.5 rounded-full text-[9px] font-black ${scanResult.sessionActive ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                                  {scanResult.sessionActive ? 'ACTIVE' : 'EXPIRED'}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                      ) : (
                        /* ========== ACCESS DENIED STATE ========== */
                        <div className="flex flex-col items-center justify-center text-center py-8">
                          <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center border border-red-500/20 mb-5">
                            <XCircle className="h-8 w-8 text-red-500" />
                          </div>
                          <h3 className="text-lg font-black text-white mb-2 uppercase tracking-tight">Access Denied</h3>
                          <p className="text-white/40 text-xs font-medium leading-relaxed px-6">
                            {scanResult.message || 'Unable to verify this passenger ID.'}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Action Buttons - Fixed at bottom */}
              <div className="w-full max-w-[500px] grid grid-cols-2 gap-4 mt-6">
                <button
                  onClick={scanAnother}
                  className="py-4 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-2xl shadow-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  <Scan className="h-4 w-4" />
                  Scan Another
                </button>
                <button
                  onClick={resetScan}
                  className="py-4 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-2xl shadow-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  <CheckCircle className="h-4 w-4" />
                  Done
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Scanner Modal Overlay - Shows when scanning another pass */}
        <AnimatePresence>
          {scannerModalOpen && scannedStudents.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[9999] bg-[#020617]/95 backdrop-blur-md flex flex-col items-center justify-center p-4"
            >

              <div className="w-full max-w-[400px]">
                {/* Scanner Card */}
                <div className="relative w-full aspect-[3/4] bg-white/5 backdrop-blur-xl border border-white/10 rounded-[32px] overflow-hidden flex flex-col shadow-2xl">
                  <div className="flex-1 flex flex-col items-center justify-center p-8 relative">
                    {isScanning && !cameraError ? (
                      <div className="absolute inset-0">
                        <video
                          ref={videoRef}
                          className="absolute inset-0 w-full h-full object-cover"
                          style={{ backgroundColor: '#000' }}
                        />
                        <canvas ref={canvasRef} className="hidden" />

                        {/* Scanning overlay */}
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="relative w-64 h-64">
                            {/* Corner brackets */}
                            <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-blue-400 rounded-tl-lg" />
                            <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-blue-400 rounded-tr-lg" />
                            <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-blue-400 rounded-bl-lg" />
                            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-blue-400 rounded-br-lg" />
                            {/* Scanning line */}
                            <motion.div
                              className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-blue-400 to-transparent"
                              animate={{ top: ['0%', '100%', '0%'] }}
                              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                            />
                          </div>
                        </div>

                        {/* Instruction pill */}
                        <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
                          <div className="bg-black/60 backdrop-blur-md px-4 py-2 rounded-full border border-white/10">
                            <div className="text-white text-xs font-bold flex items-center gap-2">
                              <Scan className="w-4 h-4 text-blue-400" />
                              Align QR Code
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : isVerifying ? (
                      <div className="flex flex-col items-center gap-4">
                        <Loader2 className="h-12 w-12 text-blue-500 animate-spin" />
                        <span className="text-sm font-bold text-white/60">Verifying...</span>
                      </div>
                    ) : cameraError ? (
                      <div className="text-center p-6">
                        <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                        <p className="text-red-400 text-sm mb-4">{cameraError}</p>
                        <Button onClick={() => startScanning()} className="bg-white/10 hover:bg-white/20 text-white">
                          Retry
                        </Button>
                      </div>
                    ) : error ? (
                      <div className="text-center p-6">
                        <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                        <p className="text-red-400 text-sm mb-4">{error}</p>
                        <Button onClick={() => { setError(null); startScanning(); }} className="bg-white/10 hover:bg-white/20 text-white">
                          Try Again
                        </Button>
                      </div>
                    ) : (
                      <div className="text-center">
                        <Camera className="h-16 w-16 text-white/30 mx-auto mb-4" />
                        <p className="text-white/50 text-sm">Starting camera...</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Cancel Button */}
                <button
                  onClick={closeScannerModal}
                  className="w-full mt-4 py-3 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl border border-white/10 transition-all"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

    </div>
  );
}
