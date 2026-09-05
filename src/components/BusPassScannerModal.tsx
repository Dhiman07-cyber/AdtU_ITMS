"use client";

import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle
} from '@/components/ui/dialog';
import { APP_NAME } from '@/config/runtime'; // Import APP_NAME
import { useAuth } from '@/contexts/auth-context';
import { getUserProfile } from '@/lib/profile-service';
import { safeImageSrc } from '@/lib/security/url-sanitizer';
import { BusPassVerificationResult } from '@/lib/types';
import { motion } from "motion/react";
import jsQR from 'jsqr';
import {
	AlertCircle,
	Bus,
	Camera,
	Loader2,
	Scan,
	ShieldCheck,
	X,
	XCircle
} from 'lucide-react';
import Image from 'next/image';
import { useEffect,useRef,useState } from 'react';

interface BusPassScannerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onScanSuccess?: (result: BusPassVerificationResult) => void;
}

export default function BusPassScannerModal({ isOpen, onClose, onScanSuccess }: BusPassScannerModalProps) {
    const { currentUser, userData } = useAuth();
    const appName = APP_NAME;
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationRef = useRef<number | null>(null);
    const isScanningRef = useRef<boolean>(false);

    const [isScanning, setIsScanning] = useState(false);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
    const [scanResult, setScanResult] = useState<BusPassVerificationResult | null>(null);
    const [isVerifying, setIsVerifying] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Auto-start logic moved to bottom

    const stopScanning = () => {
        isScanningRef.current = false;

        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
            setCameraStream(null);
        }

        if (animationRef.current) {
            cancelAnimationFrame(animationRef.current);
            animationRef.current = null;
        }

        setIsScanning(false);
    };

    const startScanning = async () => {
        setError(null);
        setCameraError(null);
        setScanResult(null);
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

            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.setAttribute('playsinline', 'true');
                videoRef.current.setAttribute('autoplay', 'true');
                videoRef.current.setAttribute('muted', 'true');

                // Detect actual facing mode to fix mirroring
                const videoTrack = stream.getVideoTracks()[0];
                const settings = videoTrack.getSettings();
                const facingMode = settings.facingMode;

                // Mirror ONLY if using front/user camera
                if (facingMode === 'user') {
                    videoRef.current.style.transform = 'scaleX(-1)';
                } else {
                    videoRef.current.style.transform = 'scaleX(1)';
                }

                await new Promise<void>((resolve) => {
                    if (videoRef.current) {
                        videoRef.current.oncanplay = () => resolve();
                    } else {
                        resolve();
                    }
                });

                if (videoRef.current) await videoRef.current.play();
                requestAnimationFrame(scanQRCode);
            }
        } catch (err: any) {
            console.error('Camera error:', err);
            setCameraError(err.message || 'Failed to access camera');
            setIsScanning(false);
        }
    };

    const scanQRCode = async () => {
        if (!isScanningRef.current) return;

        if (!videoRef.current || !canvasRef.current) {
            animationRef.current = requestAnimationFrame(scanQRCode);
            return;
        }

        const video = videoRef.current;
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d', { willReadFrequently: true });

        if (!context || video.readyState !== video.HAVE_ENOUGH_DATA) {
            animationRef.current = requestAnimationFrame(scanQRCode);
            return;
        }

        // 1. Try Native BarcodeDetector (Fastest)
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

        // 2. Fallback: Optimized jsQR
        // Downscale for performance (Scan at 480px width max)
        const scanWidth = 480;
        const scale = scanWidth / video.videoWidth;
        const scanHeight = video.videoHeight * scale;

        if (canvas.width !== scanWidth || canvas.height !== scanHeight) {
            canvas.width = scanWidth;
            canvas.height = scanHeight;
        }

        context.drawImage(video, 0, 0, scanWidth, scanHeight);

        const imageData = context.getImageData(0, 0, scanWidth, scanHeight);
        // Robust scanning including inversion attempts (white on black QR)
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth'
        });

        if (code && code.data) {
            handleScanSuccess(code.data);
            return;
        }

        // Continue scanning
        animationRef.current = requestAnimationFrame(scanQRCode);
    };

    const handleScanSuccess = (data: string) => {
        stopScanning();
        verifyStudent(data);
    };

    const verifyStudent = async (scannedData: string) => {
        setIsVerifying(true);
        try {
            if (!currentUser?.uid) throw new Error('Not authenticated');

            // Get auth token for secure API call
            const { auth } = await import('@/lib/firebase');
            const token = await auth.currentUser?.getIdToken();
            if (!token) throw new Error('Unable to get authentication token');

            // Get driver info for bus ID assignment
            const scannerBusId = (userData as any)?.busIds?.[0] || (userData as any)?.busId || 'driver_bus';

            // Detect if the scanned data is an encrypted token or a plain UID
            // Encrypted tokens are base64url encoded and typically > 100 chars
            // Plain UIDs are Firebase UIDs (28 chars, alphanumeric with possible dashes)
            const isEncryptedToken = scannedData.length > 60 && /^[A-Za-z0-9_-]+$/.test(scannedData);

            let response;

            if (isEncryptedToken) {
                // Use secure QR verification endpoint for encrypted tokens
                console.log('🔐 Detected encrypted QR token, using secure verification...');
                response = await fetch('/api/bus-pass/verify-secure-qr', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        secureToken: scannedData,
                        scannerBusId
                    }),
                });
            } else {
                // Use standard verification for plain UIDs (backward compatibility)
                console.log('🆔 Detected plain UID, using standard verification...');
                response = await fetch('/api/bus-pass/verify-student', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        studentUid: scannedData,
                        scannerBusId
                    }),
                });
            }

            const result = await response.json();
            setScanResult(result);
            if (onScanSuccess) onScanSuccess(result);

        } catch (err: any) {
            setError(err.message || 'Verification failed');
        } finally {
            setIsVerifying(false);
        }
    };

    const getStudentStatus = () => {
        if (!scanResult?.studentData?.validUntil) {
            return { status: 'ACTIVE', color: 'text-green-400', bgColor: 'bg-green-500/20' };
        }
        const validUntilDate = new Date(scanResult.studentData.validUntil);
        const currentDate = new Date();
        if (validUntilDate >= currentDate) {
            return { status: 'ACTIVE', color: 'text-green-400', bgColor: 'bg-green-500/20' };
        } else {
            return { status: 'EXPIRED', color: 'text-red-400', bgColor: 'bg-red-500/20' };
        }
    };

    const getValidUntilDisplay = () => {
        if (!scanResult?.studentData?.validUntil) return 'N/A';
        return new Date(scanResult.studentData.validUntil).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    };

    const resetScan = () => {
        setScanResult(null);
        setError(null);
        startScanning();
    };

    // Auto-start scanning when opened
    useEffect(() => {
        if (isOpen) {
            startScanning();
        } else {
            stopScanning();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent showCloseButton={false} className="sm:max-w-[420px] p-0 overflow-visible bg-transparent border-none shadow-none z-[10005]">
                {/* Scanner View - Visible when scanning or idle */}
                {!scanResult && (
                    <div className="bg-black/95 border border-zinc-700/50 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-xl relative">
                        {/* Close button */}
                        <button
                            onClick={onClose}
                            className="absolute top-4 right-4 z-50 w-8 h-8 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white/60 hover:text-white transition-all"
                        >
                            <X className="w-4 h-4" />
                        </button>

                        <DialogHeader className="p-5 bg-gradient-to-r from-zinc-900 to-zinc-800 border-b border-zinc-700/50">
                            <DialogTitle className="flex items-center gap-3 text-white">
                                <div className="p-2 bg-blue-500/20 rounded-lg">
                                    <Scan className="w-5 h-5 text-blue-400" />
                                </div>
                                Bus Pass Scanner
                            </DialogTitle>
                            <DialogDescription className="text-zinc-400 mt-1">
                                Scan student QR code to verify
                            </DialogDescription>
                        </DialogHeader>

                        <div className="relative aspect-[3/4] sm:aspect-video bg-black flex flex-col items-center justify-center p-4 overflow-hidden">
                            {!isScanning && !isVerifying && !error && (
                                <div className="text-center space-y-4 p-4">
                                    <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center mx-auto">
                                        <Camera className="w-8 h-8 text-blue-400" />
                                    </div>
                                    <Button onClick={startScanning} className="bg-blue-600 hover:bg-blue-700">
                                        Start Camera
                                    </Button>
                                </div>
                            )}

                            {isScanning && (
                                <div className="relative w-full h-full bg-black rounded-xl overflow-hidden m-2">
                                    <video
                                        ref={videoRef}
                                        className="w-full h-full object-cover rounded-xl"
                                    />
                                    <canvas ref={canvasRef} className="hidden" />

                                    {/* Scanning Overlay & Animation */}
                                    <div className="absolute inset-0 pointer-events-none">
                                        {/* Scanner frame with padding */}
                                        <div className="absolute inset-6 border-2 border-blue-500/40 rounded-2xl">
                                            {/* Corner brackets - positioned relative to the scanner frame */}
                                            <div className="absolute -top-1 -left-1 w-10 h-10 border-t-4 border-l-4 border-blue-400 rounded-tl-lg"></div>
                                            <div className="absolute -top-1 -right-1 w-10 h-10 border-t-4 border-r-4 border-blue-400 rounded-tr-lg"></div>
                                            <div className="absolute -bottom-1 -left-1 w-10 h-10 border-b-4 border-l-4 border-blue-400 rounded-bl-lg"></div>
                                            <div className="absolute -bottom-1 -right-1 w-10 h-10 border-b-4 border-r-4 border-blue-400 rounded-br-lg"></div>
                                        </div>

                                        {/* Moving Scan Line */}
                                        <motion.div
                                            className="absolute left-6 right-6 h-1 bg-gradient-to-r from-transparent via-blue-400 to-transparent shadow-[0_0_20px_rgba(59,130,246,0.8)]"
                                            animate={{ top: ['15%', '85%', '15%'] }}
                                            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                                        />

                                        {/* Instruction pill */}
                                        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-md px-5 py-2.5 rounded-full border border-white/20 shadow-lg">
                                            <p className="text-white text-sm font-semibold flex items-center gap-2">
                                                <Scan className="w-4 h-4 text-blue-400" />
                                                Align QR code within frame
                                            </p>
                                        </div>
                                    </div>

                                    {/* Stop button with better styling */}
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-red-500/80 hover:bg-red-600 text-white backdrop-blur-sm z-10 px-6 py-2 rounded-full font-semibold shadow-lg border border-red-400/30"
                                        onClick={stopScanning}
                                    >
                                        Stop Scanning
                                    </Button>
                                </div>
                            )}

                            {isVerifying && (
                                <div className="flex flex-col items-center gap-3 p-4">
                                    <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
                                    <p className="text-zinc-300">Verifying...</p>
                                </div>
                            )}

                            {error && (
                                <div className="absolute inset-0 z-40 bg-black/80 flex items-center justify-center p-4">
                                    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-center max-w-xs shadow-2xl">
                                        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
                                        <h3 className="text-lg font-bold text-white mb-2">Scanner Error</h3>
                                        <p className="text-red-400 mb-4 text-sm">{error}</p>
                                        <Button onClick={resetScan} variant="outline" className="border-red-500/50 text-red-400 hover:bg-red-500/10 w-full">
                                            Try Again
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Result Card - EXACT match to scan-pass page design */}
                {scanResult && (
                    <div className="w-full max-w-[380px] mx-auto bg-[#0f1019] rounded-[28px] overflow-hidden shadow-2xl border border-white/10 animate-in fade-in zoom-in-95 duration-200">
                        {/* Header with Logo - matching scan-pass page */}
                        <div className="w-full px-4 py-3 flex items-center justify-center border-b border-white/5 bg-gradient-to-r from-[#1a1b2e] to-[#0f1019] relative">
                            <div className="flex items-center gap-2">
                                <Image src="/adtu-new-logo.svg" alt="AdtU" width={96} height={24} className="h-6 w-auto flex-shrink-0" style={{ width: 'auto', height: 'auto' }} />
                                <span className="text-[10px] font-bold text-white/70 tracking-wider">Assam down town University</span>
                            </div>
                            <div className={`absolute right-4 w-2.5 h-2.5 rounded-full flex-shrink-0 ${getStudentStatus().status === 'ACTIVE' ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.6)]' : 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.6)]'}`} />
                        </div>

                        {/* Result Content */}
                        <div className="p-4">
                            {scanResult.studentData ? (
                                <div className="flex flex-col items-center">
                                    {/* Bus & Route Info Bar */}
                                    <div className="w-full flex items-center justify-between bg-[#1a1b2e] rounded-xl px-4 py-2 border border-white/5 mb-5">
                                        <div className="flex items-center gap-2">
                                            <Bus className="w-4 h-4 text-blue-400" />
                                            <span className="text-sm font-black text-white">Bus-{(scanResult.studentData.assignedBus || 'N/A').replace('bus_', '')}</span>
                                            <span className="text-white/30 text-xs font-medium">(AS-01-SC-1392)</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest">Route</span>
                                            <span className="text-sm font-black text-blue-400">{(scanResult.studentData.assignedBus || 'N/A').replace('bus_', '')}</span>
                                        </div>
                                    </div>

                                    {/* Profile Photo */}
                                    <div className="w-28 h-28 rounded-full bg-gradient-to-br from-blue-500/20 to-indigo-500/20 border-4 border-blue-500/30 overflow-hidden shadow-2xl mb-4">
                                        {scanResult.studentData.profilePhotoUrl ? (
                                            <Image src={safeImageSrc(scanResult.studentData.profilePhotoUrl)} width={112} height={112} className="w-full h-full object-cover" alt="Profile" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center">
                                                <ShieldCheck className="h-12 w-12 text-blue-400" />
                                            </div>
                                        )}
                                    </div>

                                    {/* Name */}
                                    <h3 className="text-xl font-black text-white tracking-tight text-center mb-2 max-w-[280px] truncate">{scanResult.studentData.fullName}</h3>

                                    {/* Enrollment ID */}
                                    <div className="bg-[#1a1b2e] px-4 py-1.5 rounded-xl border border-white/5 text-xs font-bold text-white/50 tracking-widest font-mono mb-5 flex items-center gap-1.5">
                                        {scanResult.studentData.enrollmentId || 'N/A'}
                                    </div>

                                    {/* Info Grid - 2x2 */}
                                    <div className="w-full grid grid-cols-2 gap-2.5">
                                        <div className="bg-[#1a1b2e] rounded-xl p-3 border border-white/5">
                                            <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest block mb-1">Gender</span>
                                            <span className="text-base font-bold text-white">{scanResult.studentData.gender === 'male' ? 'Male' : scanResult.studentData.gender === 'female' ? 'Female' : 'N/A'}</span>
                                        </div>
                                        <div className="bg-[#1a1b2e] rounded-xl p-3 border border-white/5">
                                            <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest block mb-1">Shift</span>
                                            <span className="text-base font-bold text-white capitalize">{scanResult.studentData.shift || 'Morning'}</span>
                                        </div>
                                        <div className="bg-[#1a1b2e] rounded-xl p-3 border border-white/5">
                                            <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest block mb-1">Valid Until</span>
                                            <span className="text-sm font-bold text-white">{getValidUntilDisplay()}</span>
                                        </div>
                                        <div className="bg-[#1a1b2e] rounded-xl p-3 border border-white/5">
                                            <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest block mb-1">Status</span>
                                            <span className={`text-base font-black ${getStudentStatus().status === 'ACTIVE' ? 'text-green-400' : 'text-red-400'}`}>
                                                {getStudentStatus().status}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                /* ACCESS DENIED STATE */
                                <div className="flex flex-col items-center justify-center text-center py-10">
                                    <div className="w-20 h-20 bg-red-500/10 rounded-2xl flex items-center justify-center border border-red-500/20 mb-6">
                                        <XCircle className="h-10 w-10 text-red-500" />
                                    </div>
                                    <h3 className="text-xl font-black text-white mb-2 uppercase tracking-tight">Access Denied</h3>
                                    <p className="text-white/40 text-sm font-medium leading-relaxed px-6">
                                        {scanResult.message || 'Unable to verify this passenger ID.'}
                                    </p>
                                </div>
                            )}

                            {/* Footer Actions */}
                            <div className="flex gap-2 mt-5">
                                <Button onClick={resetScan} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white border-0 shadow-lg h-11 text-sm font-bold rounded-xl">
                                    Scan Next
                                </Button>
                                <Button onClick={onClose} variant="ghost" className="flex-1 bg-white/5 hover:bg-white/10 text-white border border-white/10 h-11 text-sm font-medium rounded-xl">
                                    Done
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
