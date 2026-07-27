"use client";

/**
 * Verification Page for Admin
 * 
 * Provides a dedicated interface for verifying student QR codes
 * and payment receipts - matches driver's bus pass scanner UI exactly.
 */

import ReceiptVerificationModal from '@/components/ReceiptVerificationModal';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/auth-context';
import { auth } from '@/lib/firebase';
import { safeImageSrc } from '@/lib/security/url-sanitizer';
import { AnimatePresence,motion } from 'framer-motion';
import jsQR from 'jsqr';
import {
	AlertCircle,
	Bus,
	Camera,
	Check,
	CheckCircle,
	Copy,
	Layout,
	LayoutGrid,
	Loader2,
	RotateCcw,
	Scan,
	ShieldCheck,
	User,
	XCircle,
} from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback,useEffect,useRef,useState } from 'react';
import { toast } from 'sonner';

// Result interfaces
interface StudentData {
    uid: string;
    fullName: string;
    enrollmentId?: string;
    profilePhotoUrl?: string;
    assignedBus?: string;
    shift?: string;
    validUntil?: string;
    gender?: string;
    routeName?: string;
}

interface ReceiptData {
    studentName: string;
    enrollmentId: string;
    paymentMethod: string;
    amount: number;
    sessionValidity: string;
    approvalStatus: string;
    issuedDate: string;
    receiptId: string;
    verifiedAt: string;
    studentProfilePic?: string;
    studentUid?: string;
}

interface ScanResult {
    scanId: string;
    type: 'student' | 'receipt';
    valid: boolean;
    message: string;
    studentData?: StudentData;
    receiptData?: ReceiptData;
    sessionActive?: boolean;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Verification failed';
}

export default function AdminVerificationPage() {
    const { userData, currentUser, loading: authLoading } = useAuth();
    const router = useRouter();
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationRef = useRef<number | null>(null);
    const isScanningRef = useRef<boolean>(false);

    const [isScanning, setIsScanning] = useState(false);
    const [scannedResults, setScannedResults] = useState<ScanResult[]>([]);
    const [isVerifying, setIsVerifying] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
    const cameraStreamRef = useRef<MediaStream | null>(null);
    const [copied, setCopied] = useState(false);
    const [isVertical, setIsVertical] = useState(false);

    // Modal States
    const [scannerModalOpen, setScannerModalOpen] = useState(false);
    const [receiptModalOpen, setReceiptModalOpen] = useState(false);
    const [activeReceiptData, setActiveReceiptData] = useState<ReceiptData | null>(null);
    const [isReceiptValid, setIsReceiptValid] = useState(false);

    // Redirect if not admin
    useEffect(() => {
        if (!authLoading && (!currentUser || !userData || userData.role !== 'admin')) {
            router.push('/login');
        }
    }, [authLoading, currentUser, userData, router]);

    // Detect scan type from data
    const detectScanType = (data: string): 'student' | 'receipt' | 'unknown' => {
        // Check for receipt formats (both legacy ADTU-R1- and new RSA-2048 ADTU-R2-)
        if (data.startsWith('ADTU-R1-') || data.startsWith('ADTU-R2-')) return 'receipt';
        if (data.length > 60 && /^[A-Za-z0-9_-]+$/.test(data)) return 'student';
        if (data.length > 20 && data.length <= 40) return 'student';
        return 'unknown';
    };

    // Stop scanning function
    const stopScanning = useCallback(() => {
        isScanningRef.current = false;
        const stream = cameraStreamRef.current;
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            cameraStreamRef.current = null;
        }
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
            setCameraStream(null);
        }
        if (videoRef.current) videoRef.current.srcObject = null;
        if (animationRef.current) {
            cancelAnimationFrame(animationRef.current);
            animationRef.current = null;
        }
        setIsScanning(false);
    }, [cameraStream]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            const stream = cameraStreamRef.current;
            if (stream) stream.getTracks().forEach(track => track.stop());
            if (animationRef.current) cancelAnimationFrame(animationRef.current);
        };
    }, []);

    // Start camera
    const startScanning = async () => {
        setError(null);
        setCameraError(null);
        setIsScanning(true);
        isScanningRef.current = true;

        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Camera not supported.');
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false
            }).catch(async () => {
                return navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
            });

            if (!stream) throw new Error('Unable to access camera.');

            setCameraStream(stream);
            cameraStreamRef.current = stream;

            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.muted = true;
                videoRef.current.playsInline = true;
                const videoTrack = stream.getVideoTracks()[0];
                const settings = videoTrack.getSettings();
                videoRef.current.style.transform = settings.facingMode === 'user' ? 'scaleX(-1)' : 'scaleX(1)';
                await new Promise(resolve => {
                    if (videoRef.current) videoRef.current.onloadedmetadata = () => resolve(null);
                });
                await videoRef.current.play();
                requestAnimationFrame(scanQRCode);
            }
        } catch (err: unknown) {
            setCameraError(getErrorMessage(err));
            setIsScanning(false);
        }
    };

    // QR scanning loop - throttled for performance
    const scanQRCode = async () => {
        if (!isScanningRef.current) return;
        if (!videoRef.current || !canvasRef.current) {
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

        // Native BarcodeDetector (fastest)
        if ('BarcodeDetector' in window) {
            try {
                // @ts-expect-error Browser BarcodeDetector types are not available in all TS DOM libs.
                const barcodeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
                const barcodes = await barcodeDetector.detect(video);
                if (barcodes.length > 0) {
                    handleScanSuccess(barcodes[0].rawValue);
                    return;
                }
            } catch { }
        }

        // Fallback: jsQR with proper dimension handling
        const scanWidth = Math.min(480, video.videoWidth);
        const scanHeight = Math.floor(video.videoHeight * (scanWidth / video.videoWidth));

        // Validate dimensions
        if (scanWidth <= 0 || scanHeight <= 0 || !Number.isFinite(scanWidth) || !Number.isFinite(scanHeight)) {
            setTimeout(scanQRCode, 100);
            return;
        }

        if (canvas.width !== scanWidth || canvas.height !== scanHeight) {
            canvas.width = scanWidth;
            canvas.height = scanHeight;
        }

        context.drawImage(video, 0, 0, scanWidth, scanHeight);

        try {
            const imageData = context.getImageData(0, 0, scanWidth, scanHeight);
            const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
            if (code && code.data) {
                handleScanSuccess(code.data);
                return;
            }
        } catch {
            // Canvas error - skip this frame
        }

        // Throttled: 10 FPS instead of 60 FPS
        setTimeout(scanQRCode, 100);
    };

    const handleScanSuccess = (data: string) => {
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        stopScanning();
        setScannerModalOpen(false);
        const type = detectScanType(data);
        if (type === 'receipt') verifyReceipt(data);
        else if (type === 'student') verifyStudent(data);
        else setError('Unrecognized QR code format.');
    };

    // Verify student
    const verifyStudent = async (scannedData: string) => {
        setIsVerifying(true);
        try {
            const token = await auth.currentUser?.getIdToken();
            if (!token) throw new Error('Not authenticated');

            const isEncrypted = scannedData.length > 60 && /^[A-Za-z0-9_-]+$/.test(scannedData);
            const endpoint = isEncrypted ? '/api/bus-pass/verify-secure-qr' : '/api/bus-pass/verify-student';
            const body = isEncrypted ? { secureToken: scannedData } : { studentUid: scannedData };

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(body),
            });

            const result = await response.json();

            let studentData = result.studentData;
            // Fetch profile photo from API if missing
            if (studentData?.uid && (!studentData.profilePhotoUrl || studentData.profilePhotoUrl === '')) {
                try {
                    const studentRes = await fetch(`/api/students/${studentData.uid}`);
                    if (studentRes.ok) {
                        const studentDoc = await studentRes.json();
                        studentData = {
                            ...studentData,
                            profilePhotoUrl: studentDoc.profilePhotoUrl || studentDoc.profileImage || studentDoc.photoURL
                        };
                    }
                } catch (e) {
                    console.error('Student image fetch error:', e);
                }
            }

            const scanResult: ScanResult = {
                scanId: crypto.randomUUID(),
                type: 'student',
                valid: result.status === 'success',
                message: result.message,
                studentData: studentData,
                sessionActive: result.sessionActive
            };
            setScannedResults(prev => [scanResult, ...prev]);
            if (scanResult.valid) toast.success('Student verified!');
            else toast.error(result.message || 'Verification failed');
        } catch (err: unknown) {
            setError(getErrorMessage(err));
            toast.error('Verification failed');
        } finally {
            setIsVerifying(false);
        }
    };

    // Verify receipt
    const verifyReceipt = async (scannedData: string) => {
        setIsVerifying(true);
        try {
            const token = await auth.currentUser?.getIdToken();
            if (!token) throw new Error('Not authenticated');

            const response = await fetch('/api/receipt/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ receiptToken: scannedData }),
            });

            const result = await response.json();
            const rData = result.receiptData;

            const scanResult: ScanResult = {
                scanId: crypto.randomUUID(),
                type: 'receipt',
                valid: result.valid,
                message: result.message,
                receiptData: rData
            };

            setScannedResults(prev => [scanResult, ...prev]);

            // Trigger Modal
            setActiveReceiptData(rData || null);
            setIsReceiptValid(result.valid);
            setReceiptModalOpen(true);

            if (scanResult.valid) toast.success('Receipt verified!');
            else toast.error(result.message || 'Verification failed');
        } catch (err: unknown) {
            setError(getErrorMessage(err));
            toast.error('Verification failed');
        } finally {
            setIsVerifying(false);
        }
    };

    const handleCopyId = async (id: string | undefined) => {
        if (id) {
            await navigator.clipboard.writeText(id);
            setCopied(true);
            toast.success('Copied!');
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const getValidUntilDisplay = (validUntil?: string) => {
        if (!validUntil) return 'N/A';
        return new Date(validUntil).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    };

    const formatGender = (gender?: string) => {
        if (!gender) return 'N/A';
        return gender.charAt(0).toUpperCase() + gender.slice(1).toLowerCase();
    };

    const scanAnother = () => {
        setError(null);
        setCameraError(null);
        setScannerModalOpen(true);
        startScanning();
    };

    const closeScannerModal = () => {
        stopScanning();
        setScannerModalOpen(false);
        setError(null);
        setCameraError(null);
    };

    const resetScan = () => {
        stopScanning();
        setScannedResults([]);
        setError(null);
        setCameraError(null);
    };

    if (authLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="h-12 w-12 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-transparent relative flex flex-col items-center justify-start sm:justify-center p-4 md:pt-10 sm:pt-0 overflow-hidden">

            <div className="w-full max-w-[500px] relative z-10 flex flex-col items-center mt-16 sm:mt-0 md:mt-2">
                {/* Header Section */}
                {scannedResults.length === 0 && (
                    <div className="w-full flex items-center justify-between mb-6 px-1">
                        <div className="text-left">
                            <h1 className="text-xl font-black text-white tracking-tight leading-none">Verification Scanner</h1>
                            <p className="text-[9px] text-white/40 font-bold uppercase tracking-[0.15em] mt-1">Verify students & receipts</p>
                        </div>
                        <button
                            onClick={resetScan}
                            className="p-2 rounded-xl bg-white text-[#020617] hover:bg-white/90 transition-all shadow-lg hover:scale-102 hover:cursor-pointer"
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
                    {scannedResults.length === 0 ? (
                        <motion.div
                            key="scanner"
                            initial={{ opacity: 0, scale: 0.9, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: -20 }}
                            className="w-full"
                        >
                            {/* Ready / Scanner Card */}
                            <div className="relative w-full aspect-[3/4.8] sm:aspect-[3/3.9] bg-white/5 backdrop-blur-md border border-white/10 rounded-[40px] overflow-hidden flex flex-col shadow-2xl">
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
                                        >
                                            <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" style={{ backgroundColor: '#000' }} />
                                            <canvas ref={canvasRef} className="hidden" />

                                            <div className="absolute inset-0 pointer-events-none z-10">
                                                <div className="absolute inset-8 sm:inset-10">
                                                    <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-blue-400 rounded-tl-2xl" />
                                                    <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-blue-400 rounded-tr-2xl" />
                                                    <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-blue-400 rounded-bl-2xl" />
                                                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-blue-400 rounded-br-2xl" />
                                                </div>
                                                <motion.div
                                                    className="absolute left-8 right-8 sm:left-10 sm:right-10 h-0.5 bg-gradient-to-r from-transparent via-blue-400 to-transparent shadow-[0_0_20px_rgba(96,165,250,0.8)]"
                                                    animate={{ top: ['18%', '72%'] }}
                                                    transition={{ duration: 2.5, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' }}
                                                />
                                                <motion.div className="absolute bottom-24 left-1/2 -translate-x-1/2 px-5 py-2.5 bg-black/70 backdrop-blur-md border border-white/20 rounded-full shadow-xl">
                                                    <div className="text-white text-[11px] font-bold uppercase tracking-wider flex items-center gap-2">
                                                        <Scan className="w-4 h-4 text-blue-400" />
                                                        Align QR Code
                                                    </div>
                                                </motion.div>
                                            </div>

                                            <motion.button
                                                onClick={stopScanning}
                                                className="absolute bottom-6 left-1/2 -translate-x-1/2 px-6 py-2.5 bg-red-600/90 hover:bg-red-500 border border-red-400/30 text-white rounded-full text-xs font-black transition-colors shadow-lg"
                                                whileTap={{ scale: 0.95 }}
                                            >
                                                STOP SCANNER
                                            </motion.button>
                                        </motion.div>
                                    ) : (
                                        <motion.div className="flex flex-col items-center text-center">
                                            <motion.div className="relative mb-8">
                                                <div className="w-28 h-28 bg-blue-500/10 rounded-full flex items-center justify-center border border-blue-500/20 shadow-[0_0_50px_rgba(59,130,246,0.1)]">
                                                    <Camera className="h-12 w-12 text-blue-400" />
                                                </div>
                                                <motion.div
                                                    className="absolute inset-0 rounded-full bg-blue-500/20"
                                                    animate={{ scale: [1, 1.4, 1], opacity: [0.3, 0, 0.3] }}
                                                    transition={{ duration: 3, repeat: Infinity }}
                                                />
                                            </motion.div>

                                            <h2 className="text-2xl font-black text-white mb-2 tracking-tight">Ready to Scan QR Code</h2>
                                            <p className="text-white/40 text-sm font-medium px-6 leading-relaxed mb-10">
                                                Click below to start camera scanning and verify student bus passes or receipts
                                            </p>

                                            {isVerifying ? (
                                                <div className="flex flex-col items-center gap-4">
                                                    <Loader2 className="h-10 w-10 text-blue-500 animate-spin" />
                                                    <span className="text-xs font-bold text-white/40 uppercase tracking-widest">Processing...</span>
                                                </div>
                                            ) : (
                                                <motion.button
                                                    onClick={startScanning}
                                                    className="w-full max-w-[280px] py-5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black rounded-2xl shadow-xl transition-all flex items-center justify-center gap-3"
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
                                        <div className="absolute inset-0 bg-[#020617]/95 flex flex-col items-center justify-center p-8 text-center">
                                            <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mb-6 border border-red-500/20">
                                                <AlertCircle className="h-8 w-8 text-red-500" />
                                            </div>
                                            <h3 className="text-xl font-bold text-white mb-2">Camera Error</h3>
                                            <p className="text-red-400/70 text-sm mb-8">{cameraError}</p>
                                            <Button onClick={startScanning} className="w-full bg-white/10 hover:bg-white/20 text-white rounded-xl border border-white/10">Retry</Button>
                                        </div>
                                    )}

                                    {error && !isVerifying && (
                                        <div className="absolute inset-0 bg-[#020617]/95 flex flex-col items-center justify-center p-8 text-center">
                                            <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mb-6 border border-red-500/20">
                                                <XCircle className="h-8 w-8 text-red-500" />
                                            </div>
                                            <h3 className="text-xl font-bold text-white mb-2">Error</h3>
                                            <p className="text-red-400/70 text-sm mb-8">{error}</p>
                                            <Button onClick={scanAnother} className="w-full bg-white/10 hover:bg-white/20 text-white rounded-xl border border-white/10">Try Again</Button>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <p className="text-center text-white/40 text-[10px] font-black tracking-[0.2em] mt-8">
                                Scan the QR code to verify student&apos;s bus pass or payment receipt
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
                            {/* Orientation OSwitch (Matching Driver's Sticky Layout) */}
                            <div className="flex bg-[#1a1b2e] p-1 rounded-2xl border border-white/10 sticky top-0 z-20">
                                <button
                                    onClick={() => setIsVertical(false)}
                                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all ${!isVertical ? 'bg-blue-600 text-white' : 'text-white/50 hover:text-white/70'}`}
                                >
                                    <Layout className="w-4 h-4" /> Horizontal
                                </button>
                                <button
                                    onClick={() => setIsVertical(true)}
                                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all ${isVertical ? 'bg-blue-600 text-white' : 'text-white/50 hover:text-white/70'}`}
                                >
                                    <LayoutGrid className="w-4 h-4" /> Vertical
                                </button>
                            </div>

                            {/* Cards List */}
                            <div className="w-full space-y-4">
                                {scannedResults.map((scanResult, index) => (
                                    <div key={scanResult.scanId || index} className={`relative w-full ${isVertical ? 'max-w-[380px]' : 'max-w-[600px]'} mx-auto bg-[#0f1019] rounded-[28px] overflow-hidden shadow-2xl border border-white/10`}>

                                        {/* Header with Logo */}
                                        <div className="w-full px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-center border-b border-white/5 bg-gradient-to-r from-[#1a1b2e] to-[#0f1019] relative">
                                            <div className="flex items-center gap-2">
                                                <Image src="/adtu-new-logo.svg" alt="AdtU" width={96} height={24} className="h-5 sm:h-7 w-auto flex-shrink-0" style={{ width: 'auto', height: 'auto' }} />
                                                <span className="text-[9px] sm:text-xs font-bold text-white/70 tracking-wider">Assam down town University</span>
                                            </div>
                                        </div>

                                        {/* Result Content */}
                                        <div className="p-2.5 sm:p-5">
                                            {scanResult.type === 'receipt' && scanResult.receiptData ? (
                                                /* ========== RECEIPT RESULT CARD ========== */
                                                <>
                                                    {!isVertical ? (
                                                        /* ========== HORIZONTAL RECEIPT LAYOUT ========== */
                                                        <div className="flex flex-col gap-2.5">
                                                            {/* Header Badge - Slimmer */}
                                                            <div className="flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500/20 to-green-500/20 border border-emerald-500/30 rounded-lg py-1.5 px-4">
                                                                <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                                                                <span className="text-[10px] sm:text-xs font-black text-emerald-400 uppercase tracking-widest">Payment Receipt Verified</span>
                                                            </div>

                                                            <div className="flex gap-3">
                                                                {/* Left Side: Student Info */}
                                                                <div className="flex flex-col items-center gap-2 flex-shrink-0 w-[110px] sm:w-[140px]">
                                                                    <div className="w-14 h-14 sm:w-20 sm:h-20 rounded-full bg-gradient-to-br from-blue-500/20 to-indigo-500/20 border-2 border-blue-500/30 flex items-center justify-center flex-shrink-0 overflow-hidden shadow-lg">
                                                                        {scanResult.receiptData.studentProfilePic ? (
                                                                            <Image src={safeImageSrc(scanResult.receiptData.studentProfilePic)} width={80} height={80} className="w-full h-full object-cover" alt="Profile" />
                                                                        ) : (
                                                                            <User className="w-7 h-7 text-blue-400" />
                                                                        )}
                                                                    </div>
                                                                    <div className="text-center w-full">
                                                                        <h4 className="text-xs sm:text-sm font-black text-white truncate px-1">{scanResult.receiptData.studentName}</h4>
                                                                        <p className="text-[9px] sm:text-[10px] font-mono text-white/50 truncate tracking-tighter">{scanResult.receiptData.enrollmentId}</p>
                                                                    </div>
                                                                </div>

                                                                {/* Right Side: Details Grid */}
                                                                <div className="flex-1 grid grid-cols-2 gap-2">
                                                                    <div className="bg-[#1a1b2e] rounded-lg p-2 border border-white/5">
                                                                        <span className="text-[7px] sm:text-[9px] font-bold text-white/40 uppercase tracking-widest block mb-0.5">Method</span>
                                                                        <span className="text-[10px] sm:text-xs font-bold text-white truncate block">{scanResult.receiptData.paymentMethod}</span>
                                                                    </div>
                                                                    <div className="bg-gradient-to-br from-emerald-500/10 to-green-500/10 rounded-lg p-2 border border-emerald-500/20">
                                                                        <span className="text-[7px] sm:text-[9px] font-bold text-emerald-400/60 uppercase tracking-widest block mb-0.5">Paid</span>
                                                                        <span className="text-xs sm:text-sm font-black text-emerald-400">₹{scanResult.receiptData.amount.toLocaleString('en-IN')}</span>
                                                                    </div>
                                                                    <div className="bg-[#1a1b2e] rounded-lg p-2 border border-white/5">
                                                                        <span className="text-[7px] sm:text-[9px] font-bold text-white/40 uppercase tracking-widest block mb-0.5">Session</span>
                                                                        <span className="text-[10px] sm:text-xs font-bold text-white truncate block">{scanResult.receiptData.sessionValidity}</span>
                                                                    </div>
                                                                    <div className="bg-[#1a1b2e] rounded-lg p-2 border border-white/5">
                                                                        <span className="text-[7px] sm:text-[9px] font-bold text-white/40 uppercase tracking-widest block mb-0.5">Receipt ID</span>
                                                                        <span className="text-[9px] sm:text-[10px] font-mono font-bold text-white/70 truncate block">{scanResult.receiptData.receiptId.slice(-8)}</span>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Footer Status - Slim */}
                                                            <div className="flex items-center justify-between bg-[#1a1b2e] rounded-lg px-3 py-1.5 border border-white/5">
                                                                <div className="flex items-center gap-1.5">
                                                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                                                    <span className="text-[8px] sm:text-[10px] font-black text-emerald-400 uppercase tracking-wider">{scanResult.receiptData.approvalStatus}</span>
                                                                </div>
                                                                <span className="text-[8px] sm:text-[9px] text-white/30 font-medium whitespace-nowrap">
                                                                    Verified at {new Date(scanResult.receiptData.verifiedAt).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="flex flex-col gap-4">
                                                            {/* Student Info Card - Unified Container */}
                                                            <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                                                                <div className="flex items-center gap-4">
                                                                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-br from-blue-500/20 to-indigo-500/20 border-2 border-blue-500/30 flex items-center justify-center flex-shrink-0 overflow-hidden shadow-lg">
                                                                        {scanResult.receiptData.studentProfilePic ? (
                                                                            <Image src={safeImageSrc(scanResult.receiptData.studentProfilePic)} width={80} height={80} className="w-full h-full object-cover" alt="Profile" />
                                                                        ) : (
                                                                            <User className="w-8 h-8 sm:w-10 sm:h-10 text-blue-400" />
                                                                        )}
                                                                    </div>
                                                                    <div className="flex-1 min-w-0">
                                                                        <span className="text-[9px] font-black text-white/30 uppercase tracking-[0.15em] mb-1 block">Student Information</span>
                                                                        <h4 className="text-lg font-black text-white truncate">{scanResult.receiptData.studentName}</h4>
                                                                        <p className="text-xs font-mono font-bold text-blue-400/70">{scanResult.receiptData.enrollmentId}</p>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Details Section - Unified Container */}
                                                            <div className="bg-white/5 rounded-2xl border border-white/10 overflow-hidden">
                                                                <div className="p-4 grid grid-cols-2 gap-y-4 gap-x-6">
                                                                    <div>
                                                                        <span className="text-[9px] font-black text-white/30 uppercase tracking-widest block mb-1">Payment Method</span>
                                                                        <span className="text-sm font-bold text-white">{scanResult.receiptData.paymentMethod}</span>
                                                                    </div>
                                                                    <div>
                                                                        <span className="text-[9px] font-black text-emerald-400/40 uppercase tracking-widest block mb-1">Amount Paid</span>
                                                                        <span className="text-lg font-black text-emerald-400">₹{scanResult.receiptData.amount.toLocaleString('en-IN')}</span>
                                                                    </div>
                                                                    <div>
                                                                        <span className="text-[9px] font-black text-white/30 uppercase tracking-widest block mb-1">Session</span>
                                                                        <span className="text-sm font-bold text-white/90">{scanResult.receiptData.sessionValidity}</span>
                                                                    </div>
                                                                    <div>
                                                                        <span className="text-[9px] font-black text-white/30 uppercase tracking-widest block mb-1">Issued On</span>
                                                                        <span className="text-sm font-bold text-white/90">{scanResult.receiptData.issuedDate}</span>
                                                                    </div>
                                                                </div>

                                                                {/* Receipt ID - Integrated at bottom of details */}
                                                                <div className="bg-black/20 px-4 py-3 border-t border-white/5 flex items-center justify-between gap-4">
                                                                    <div className="min-w-0">
                                                                        <span className="text-[8px] font-black text-white/30 uppercase tracking-widest block mb-0.5">Receipt ID</span>
                                                                        <span className="text-[10px] font-mono font-bold text-white/60 truncate block">{scanResult.receiptData.receiptId}</span>
                                                                    </div>
                                                                    <div className="px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg shrink-0">
                                                                        <span className="text-[10px] font-black text-emerald-400 uppercase">{scanResult.receiptData.approvalStatus}</span>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Verification Timestamp */}
                                                            <div className="text-center pb-2">
                                                                <span className="text-[10px] text-white/20 font-bold uppercase tracking-[0.2em]">
                                                                    Verified at {new Date(scanResult.receiptData.verifiedAt).toLocaleString('en-IN')}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    )}
                                                </>
                                            ) : scanResult.studentData ? (
                                                <>
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
                                                                                <ShieldCheck className="h-7 w-7 text-blue-400/40" />
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
                                                                        <span className="text-[10px] sm:text-xs font-bold text-white capitalize">{scanResult.studentData.shift || 'Morning'}</span>
                                                                    </div>
                                                                    <div className="bg-[#161726] rounded-xl p-2 border border-white/5">
                                                                        <span className="text-[7px] font-bold text-white/40 uppercase tracking-widest block mb-0.5 whitespace-nowrap">Valid Until</span>
                                                                        <span className="text-[10px] sm:text-xs font-bold text-white truncate block">{getValidUntilDisplay(scanResult.studentData.validUntil)}</span>
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
                                                                        <ShieldCheck className="h-10 w-10 text-blue-400/40" />
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
                                                                    <span className="text-sm font-black text-white capitalize">{scanResult.studentData.shift || 'Morning'}</span>
                                                                </div>
                                                                <div className="bg-[#161726] rounded-2xl p-3 border border-white/5">
                                                                    <span className="text-[8px] font-bold text-white/40 uppercase tracking-widest block mb-1">Valid Until</span>
                                                                    <span className="text-xs font-black text-white">{getValidUntilDisplay(scanResult.studentData.validUntil)}</span>
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
                                                /* Error/Invalid Card */
                                                <div className="flex flex-col items-center justify-center text-center py-10">
                                                    <div className="w-20 h-20 bg-red-500/10 rounded-2xl flex items-center justify-center border border-red-500/20 mb-6">
                                                        <XCircle className="h-10 w-10 text-red-500" />
                                                    </div>
                                                    <h3 className="text-xl font-black text-white mb-2 uppercase tracking-tight">Verification Failed</h3>
                                                    <p className="text-white/40 text-sm font-medium leading-relaxed px-6">
                                                        {scanResult.message || 'Unable to verify this QR code.'}
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Action Buttons (Matching Driver's Page) */}
                            <div className="w-full max-w-[500px] grid grid-cols-2 gap-4 mt-6">
                                <button onClick={scanAnother} className="py-4 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-2xl shadow-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2">
                                    <Scan className="h-4 w-4" /> Scan Another
                                </button>
                                <button onClick={resetScan} className="py-4 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-2xl shadow-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2">
                                    <CheckCircle className="h-4 w-4" /> Done
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Receipt Verification Modal */}
            <ReceiptVerificationModal
                isOpen={receiptModalOpen}
                onClose={() => setReceiptModalOpen(false)}
                receiptData={activeReceiptData}
                isValid={isReceiptValid}
                message={scannedResults[0]?.type === 'receipt' ? scannedResults[0].message : undefined}
            />

            {/* Scanner Modal Overlay - Shows when scanning another */}
            <AnimatePresence>
                {scannerModalOpen && scannedResults.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[9999] bg-[#020617]/95 flex flex-col items-center justify-center p-4"
                    >
                        <div className="w-full max-w-[400px]">
                            {/* Scanner Card */}
                            <div className="relative w-full aspect-[3/4.2] bg-white/5 backdrop-blur-md border border-white/10 rounded-[40px] overflow-hidden flex flex-col shadow-2xl">
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
                                                        className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-blue-400 to-transparent shadow-[0_0_15px_rgba(96,165,250,0.5)]"
                                                        animate={{ top: ['10%', '90%', '10%'] }}
                                                        transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                                                    />
                                                </div>
                                            </div>

                                            {/* Instruction pill */}
                                            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-max">
                                                <div className="bg-black/60 backdrop-blur-md px-5 py-2.5 rounded-full border border-white/10 shadow-xl">
                                                    <div className="text-white text-[11px] font-bold uppercase tracking-wider flex items-center gap-2">
                                                        <Scan className="w-4 h-4 text-blue-400" />
                                                        Align QR Code
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ) : isVerifying ? (
                                        <div className="flex flex-col items-center gap-4">
                                            <Loader2 className="h-12 w-12 text-blue-500 animate-spin" />
                                            <span className="text-xs font-bold text-white/40 uppercase tracking-widest">Verifying Pass...</span>
                                        </div>
                                    ) : cameraError ? (
                                        <div className="text-center p-6">
                                            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                                            <h3 className="text-lg font-bold text-white mb-2 tracking-tight">Camera Error</h3>
                                            <p className="text-red-400 text-sm mb-6 leading-relaxed">{cameraError}</p>
                                            <Button onClick={() => startScanning()} className="w-full bg-blue-600 hover:bg-blue-500 text-white rounded-xl py-6 font-bold shadow-lg">
                                                Retry Access
                                            </Button>
                                        </div>
                                    ) : error ? (
                                        <div className="text-center p-6">
                                            <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                                            <h3 className="text-lg font-bold text-white mb-2 tracking-tight">System Error</h3>
                                            <p className="text-red-400 text-sm mb-6 leading-relaxed">{error}</p>
                                            <Button onClick={() => { setError(null); startScanning(); }} className="w-full bg-blue-600 hover:bg-blue-500 text-white rounded-xl py-6 font-bold shadow-lg">
                                                Try Again
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className="text-center">
                                            <div className="w-20 h-20 bg-blue-500/10 rounded-full flex items-center justify-center border border-blue-500/20 mx-auto mb-6">
                                                <Camera className="h-10 w-10 text-blue-400" />
                                            </div>
                                            <p className="text-white/50 text-xs font-bold uppercase tracking-widest">Waking up camera...</p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Cancel Button */}
                            <button
                                onClick={closeScannerModal}
                                className="w-full mt-5 py-4 bg-white/5 hover:bg-white/10 text-white font-bold rounded-2xl border border-white/10 transition-all backdrop-blur-md"
                            >
                                Cancel Verification
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
