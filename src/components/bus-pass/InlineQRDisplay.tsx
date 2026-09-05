"use client";

/**
 * InlineQRDisplay Component - Clean & Simple
 * Shows QR skeleton initially, reveals actual QR on button click.
 */

import { Button } from '@/components/ui/button';
import { AnimatePresence,motion } from "motion/react";
import { CheckCircle,Copy,Download,QrCode,Share2,ShieldCheck } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { useRef,useState } from 'react';
import { toast } from 'sonner';

interface InlineQRDisplayProps {
    studentUid: string;
    studentName: string;
    enrollmentId?: string;
    isActive: boolean;
}

export default function InlineQRDisplay({
    studentUid,
    studentName,
    enrollmentId,
    isActive
}: InlineQRDisplayProps) {
    const [showQR, setShowQR] = useState(false);
    const [copied, setCopied] = useState(false);
    const qrRef = useRef<HTMLDivElement>(null);

    const handleCopyId = async () => {
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

    const handleDownloadQR = async () => {
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            const scale = 4; // High quality
            const cardWidth = 400;
            const cardHeight = 600;
            const cornerRadius = 32;
            canvas.width = cardWidth * scale;
            canvas.height = cardHeight * scale;
            ctx.scale(scale, scale);

            // === CLIP TO ROUNDED RECTANGLE (removes sharp edges) ===
            ctx.beginPath();
            ctx.roundRect(0, 0, cardWidth, cardHeight, cornerRadius);
            ctx.clip();

            // === DARK CHARCOAL BACKGROUND ===
            ctx.fillStyle = '#01000044';
            ctx.fillRect(0, 0, cardWidth, cardHeight);

            // === HEADER SECTION WITH LOGO ===
            const logoImg = new Image();
            logoImg.src = '/adtu-new-logo.svg';
            await new Promise((resolve) => {
                logoImg.onload = resolve;
                logoImg.onerror = resolve;
            });

            // Header background
            ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
            ctx.fillRect(0, 0, cardWidth, 80);

            // Logo
            let logoStartX = 30;
            if (logoImg.complete && logoImg.naturalWidth !== 0) {
                const logoH = 36;
                const logoW = (logoImg.naturalWidth / logoImg.naturalHeight) * logoH;
                ctx.drawImage(logoImg, 30, 22, logoW, logoH);
                logoStartX = 30 + logoW + 15;
            }

            // University Name - exact case as requested
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 18px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('Assam down town University', logoStartX, 42);

            // Subtitle
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.font = '600 11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.fillText('Digital Bus Pass', logoStartX, 58);

            // === STUDENT INFO SECTION ===
            const infoY = 110;

            // Student Name Label
            ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.font = '700 10px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.letterSpacing = '1.5px';
            ctx.fillText('STUDENT NAME', 30, infoY);
            ctx.letterSpacing = '0px';

            // Student Name Value
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 24px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.fillText(studentName || 'Student', 30, infoY + 28);

            // Status Badge
            const badgeX = cardWidth - 110;
            const badgeY = infoY + 8;
            const badgeGradient = ctx.createLinearGradient(badgeX, badgeY, badgeX + 80, badgeY + 28);
            badgeGradient.addColorStop(0, '#10b981');
            badgeGradient.addColorStop(1, '#059669');
            ctx.fillStyle = badgeGradient;
            ctx.beginPath();
            ctx.roundRect(badgeX, badgeY, 80, 28, 14);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('ACTIVE', badgeX + 40, badgeY + 18);

            // === QR CODE SECTION ===
            ctx.textAlign = 'left';
            const qrContainerY = 190;
            const qrSize = 220;
            const qrX = (cardWidth - qrSize) / 2;
            const qrY = qrContainerY + 40;

            // QR Code Label
            ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.font = '700 10px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.letterSpacing = '1.5px';
            ctx.fillText('SCAN TO VERIFY', cardWidth / 2, qrContainerY + 15);
            ctx.letterSpacing = '0px';

            // QR Container with subtle frame
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.roundRect(qrX - 15, qrY - 15, qrSize + 30, qrSize + 30, 20);
            ctx.fill();

            // Inner shadow effect
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Actual QR Code
            const existingQR = qrRef.current?.querySelector('canvas');
            if (existingQR) {
                ctx.drawImage(existingQR, qrX, qrY, qrSize, qrSize);
            }

            // ALL FOUR Corner decorations
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            const cornerLen = 20;
            const cornerPad = 8;

            // Top-left corner
            ctx.beginPath();
            ctx.moveTo(qrX - cornerPad, qrY - cornerPad + cornerLen);
            ctx.lineTo(qrX - cornerPad, qrY - cornerPad);
            ctx.lineTo(qrX - cornerPad + cornerLen, qrY - cornerPad);
            ctx.stroke();

            // Top-right corner
            ctx.beginPath();
            ctx.moveTo(qrX + qrSize + cornerPad - cornerLen, qrY - cornerPad);
            ctx.lineTo(qrX + qrSize + cornerPad, qrY - cornerPad);
            ctx.lineTo(qrX + qrSize + cornerPad, qrY - cornerPad + cornerLen);
            ctx.stroke();

            // Bottom-left corner
            ctx.beginPath();
            ctx.moveTo(qrX - cornerPad, qrY + qrSize + cornerPad - cornerLen);
            ctx.lineTo(qrX - cornerPad, qrY + qrSize + cornerPad);
            ctx.lineTo(qrX - cornerPad + cornerLen, qrY + qrSize + cornerPad);
            ctx.stroke();

            // Bottom-right corner
            ctx.beginPath();
            ctx.moveTo(qrX + qrSize + cornerPad - cornerLen, qrY + qrSize + cornerPad);
            ctx.lineTo(qrX + qrSize + cornerPad, qrY + qrSize + cornerPad);
            ctx.lineTo(qrX + qrSize + cornerPad, qrY + qrSize + cornerPad - cornerLen);
            ctx.stroke();

            // === ENROLLMENT ID SECTION ===
            const enrollY = qrY + qrSize + 60;

            // Enrollment ID container
            ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.beginPath();
            ctx.roundRect(30, enrollY, cardWidth - 60, 60, 16);
            ctx.fill();

            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.font = '700 9px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.letterSpacing = '1.5px';
            ctx.fillText('ENROLLMENT ID', cardWidth / 2, enrollY + 20);
            ctx.letterSpacing = '0px';

            ctx.fillStyle = '#60a5fa';
            ctx.font = 'bold 16px monospace';
            ctx.fillText(enrollmentId || 'N/A', cardWidth / 2, enrollY + 42);

            // === FOOTER WITH ENCRYPTED AUTHORIZATION ===
            const footerY = cardHeight - 40;

            // Divider line
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(30, footerY - 10);
            ctx.lineTo(cardWidth - 30, footerY - 10);
            ctx.stroke();

            // Footer text - centered
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.font = '600 9px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.fillText('Official Digital Authorization • Keep this pass with you', cardWidth / 2, footerY + 8);

            // Save to file
            const link = document.createElement('a');
            link.download = `BusPass_${studentName?.replace(/\s+/g, '_')}.png`;
            link.href = canvas.toDataURL('image/png', 1.0);
            link.click();
            toast.success('Bus pass saved to gallery!');
        } catch (e) {
            console.error(e);
            toast.error('Failed to save bus pass');
        }
    };

    const handleShareQR = async () => {
        try {
            const text = `Bus Pass - ${studentName}\nID: ${enrollmentId || 'N/A'}\nStatus: ${isActive ? 'ACTIVE' : 'INACTIVE'}`;
            if (navigator.share) {
                await navigator.share({ title: 'AdtU Digital Bus Pass', text });
            } else {
                await navigator.clipboard.writeText(text);
                toast.success('Details copied!');
            }
        } catch (e) {
            if ((e as Error).name !== 'AbortError') toast.error('Sharing failed');
        }
    };

    const revealQR = () => {
        if (!isActive) {
            toast.error('Account inactive. Contact admin.');
            return;
        }
        setShowQR(true);
    };

    return (
        <div className="w-full flex flex-col items-center">
            {/* QR Card - Premium Glassmorphic Design */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative max-w-[320px] w-full aspect-[3/4.5] sm:aspect-[3/4.8]"
            >
                {/* Dynamic Border Glow */}
                <div className="absolute -inset-[1px] bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 rounded-[24px] opacity-40 blur-[1px]" />
                <div className="absolute -inset-[1px] bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 rounded-[24px] opacity-20 blur-[10px]" />

                <div className="relative h-full bg-[#020617] rounded-[22px] overflow-hidden flex flex-col shadow-2xl border border-white/10">
                    {/* Background Pattern */}
                    <div className="absolute inset-0 opacity-15 pointer-events-none">
                        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_20%_20%,#3b82f6_0%,transparent_50%)]" />
                        <div className="absolute bottom-0 right-0 w-full h-full bg-[radial-gradient(circle_at_80%_80%,#ec4899_0%,transparent_50%)]" />
                        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] mix-blend-overlay" />
                    </div>

                    {/* Empty Header Area */}
                    <div className="px-5 pt-6 pb-2 flex items-center justify-end relative z-10 min-h-[40px]">
                    </div>

                    {/* Student Name & Chip */}
                    <div className="px-5 relative z-10">
                        <div className="flex items-start justify-between">
                            <div className="flex flex-col">
                                <span className="text-[10px] text-white/40 font-medium uppercase tracking-wider mb-1">Student</span>
                                <h3 className="text-xl font-bold text-white tracking-tight leading-none truncate max-w-[180px]">
                                    {studentName}
                                </h3>
                            </div>
                            {/* Meaningful Replacement for the chip: Verified Identity Shield */}
                            <div className="flex flex-col items-center gap-1">
                                <div className="w-10 h-10 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shadow-inner group-hover:scale-110 transition-transform">
                                    <ShieldCheck className="h-6 w-6 text-blue-400" />
                                </div>
                                <span className="text-[7px] font-black text-blue-400 uppercase tracking-tighter">Verified</span>
                            </div>
                        </div>
                    </div>

                    {/* QR Area - The Core Component */}
                    <div className="flex-1 flex flex-col items-center justify-center py-4 relative z-10">
                        <AnimatePresence mode="wait">
                            {showQR ? (
                                <motion.div
                                    key="qr"
                                    initial={{ opacity: 0, scale: 0.8, rotateY: 180 }}
                                    animate={{ opacity: 1, scale: 1, rotateY: 0 }}
                                    transition={{ type: "spring", damping: 15, stiffness: 100 }}
                                    className="relative group cursor-pointer"
                                    onClick={() => setShowQR(false)}
                                >
                                    <div className="absolute -inset-4 bg-white/5 rounded-2xl blur-xl opacity-50 group-hover:opacity-80 transition-opacity" />

                                    {/* QR Frame Corners */}
                                    <div className="absolute -top-3 -left-3 w-6 h-6 border-t-[3px] border-l-[3px] border-blue-400 rounded-tl-lg" />
                                    <div className="absolute -top-3 -right-3 w-6 h-6 border-t-[3px] border-r-[3px] border-purple-400 rounded-tr-lg" />
                                    <div className="absolute -bottom-3 -left-3 w-6 h-6 border-b-[3px] border-l-[3px] border-purple-400 rounded-bl-lg" />
                                    <div className="absolute -bottom-3 -right-3 w-6 h-6 border-b-[3px] border-r-[3px] border-pink-400 rounded-br-lg" />

                                    <div ref={qrRef} className="bg-white p-3.5 rounded-xl shadow-[0_0_30px_rgba(255,255,255,0.1)]">
                                        <QRCodeCanvas
                                            value={studentUid}
                                            size={160}
                                            level="H"
                                            includeMargin={false}
                                            imageSettings={{
                                                src: "/logo.png", // Attempt to include logo if exists
                                                x: undefined,
                                                y: undefined,
                                                height: 30,
                                                width: 30,
                                                excavate: true,
                                            }}
                                        />
                                    </div>
                                </motion.div>
                            ) : (
                                <motion.div
                                    key="skeleton"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0, scale: 0.9 }}
                                    onClick={revealQR}
                                    className="relative w-[180px] h-[180px] bg-white/5 rounded-2xl flex flex-col items-center justify-center border border-white/10 cursor-pointer group hover:bg-white/10 transition-all duration-300"
                                >
                                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl" />

                                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl" />

                                    <motion.div
                                        animate={{
                                            scale: [1, 1.05, 1],
                                            opacity: [0.2, 0.4, 0.2]
                                        }}
                                        transition={{
                                            repeat: Infinity,
                                            duration: 2,
                                            ease: "easeInOut"
                                        }}
                                        className="relative w-24 h-24 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-500"
                                    >
                                        <QrCode className="h-16 w-16 text-white group-hover:text-blue-400 transition-colors" />
                                    </motion.div>

                                    <div className="flex flex-col items-center gap-1.5 relative z-10">
                                        <div className="flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse shadow-[0_0_8px_#60a5fa]" />
                                            <span className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em]">Secure Entry</span>
                                        </div>
                                        <span className="text-[9px] font-medium text-white/20 uppercase tracking-widest mt-1">Tap to verify</span>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* Bottom Info - Enrollment ID */}
                    <div className="px-5 pb-6 pt-2 relative z-10">
                        <div className="bg-white/[0.03] backdrop-blur-md border border-white/5 rounded-xl p-3 flex flex-col items-center group/id hover:bg-white/[0.05] transition-colors">
                            <span className="text-[9px] font-bold text-white/30 uppercase tracking-[0.2em] mb-1">Enrollment ID</span>
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-white/90 tracking-wider font-mono uppercase">
                                    {enrollmentId || 'N/A'}
                                </span>
                                {enrollmentId && (
                                    <button
                                        onClick={handleCopyId}
                                        className="p-1 rounded-md text-white/20 hover:text-blue-400 hover:bg-blue-400/10 transition-all"
                                    >
                                        {copied ? <CheckCircle className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>


            </motion.div>

            {/* Premium Action Controls */}
            <div className="mt-8 flex flex-col items-center gap-4 w-full">
                {!showQR ? (
                    <motion.div
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className="w-full max-w-[280px]"
                    >
                        <Button
                            onClick={revealQR}
                            disabled={!isActive}
                            className="w-full h-12 text-sm font-bold uppercase tracking-widest rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:via-indigo-500 hover:to-purple-500 text-white shadow-[0_10px_20px_-10px_rgba(79,70,229,0.5)] border-t border-white/20 disabled:opacity-50 disabled:cursor-not-allowed group relative overflow-hidden"
                        >
                            <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                            <span className="relative flex items-center justify-center">
                                <QrCode className="mr-2.5 h-4.5 w-4.5" />
                                Generate Secure QR
                            </span>
                        </Button>
                    </motion.div>
                ) : (
                    <div className="flex flex-col gap-3 w-full max-w-[280px]">
                        <div className="grid grid-cols-2 gap-3">
                            <Button
                                onClick={handleShareQR}
                                variant="outline"
                                className="h-11 bg-white/5 hover:bg-white/10 border-white/10 text-xs font-bold text-white/80 rounded-xl hover:text-white transition-all group"
                            >
                                <Share2 className="h-4 w-4 mr-2 group-hover:scale-110 transition-transform" /> Share
                            </Button>
                            <Button
                                onClick={handleDownloadQR}
                                variant="outline"
                                className="h-11 bg-white/5 hover:bg-white/10 border-white/10 text-xs font-bold text-white/80 rounded-xl hover:text-white transition-all group"
                            >
                                <Download className="h-4 w-4 mr-2 group-hover:translate-y-0.5 transition-transform" /> Save
                            </Button>
                        </div>
                        <Button
                            onClick={() => setShowQR(false)}
                            className="h-10 text-[10px] font-bold uppercase tracking-widest bg-white text-slate-900 hover:bg-slate-100 rounded-xl transition-all shadow-md"
                        >
                            Security Hide Code
                        </Button>
                    </div>
                )}


            </div>
        </div>
    );
}
