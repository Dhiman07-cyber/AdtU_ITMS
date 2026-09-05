"use client";

/**
 * StudentQRDisplay - Modal Version
 * Used by profile pages for modal-based QR display.
 */

import { Button } from '@/components/ui/button';
import { Dialog,DialogContent,DialogTitle } from '@/components/ui/dialog';
import { AnimatePresence,motion } from "motion/react";
import { CheckCircle,Copy,Download,Share2,ShieldCheck,X } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { useEffect,useRef,useState } from 'react';
import { toast } from 'sonner';

interface StudentQRDisplayProps {
    isOpen: boolean;
    onClose: () => void;
    studentUid: string;
    studentName: string;
    enrollmentId?: string;
    busNumber?: string;
    routeName?: string;
    validUntil?: Date | string;
    isActive: boolean;
}

export default function StudentQRDisplay({
    isOpen,
    onClose,
    studentUid,
    studentName,
    enrollmentId,
    isActive
}: StudentQRDisplayProps) {
    const [copied, setCopied] = useState(false);
    const qrRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) setCopied(false);
    }, [isOpen]);

    const handleCopyId = async () => {
        if (enrollmentId) {
            try {
                await navigator.clipboard.writeText(enrollmentId);
                setCopied(true);
                toast.success('Copied!');
                setTimeout(() => setCopied(false), 2000);
            } catch {
                toast.error('Failed');
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
            // Load Logo
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

            // Corner decorations
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

            // === FOOTER ===
            const footerY = cardHeight - 35;

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
            const text = `Bus Pass - ${studentName}\nID: ${enrollmentId || 'N/A'}`;
            if (navigator.share) {
                await navigator.share({ title: 'AdtU Digital Bus Pass', text });
            } else {
                await navigator.clipboard.writeText(text);
                toast.success('Copied!');
            }
        } catch (e) {
            if ((e as Error).name !== 'AbortError') toast.error('Failed');
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="p-0 border-none shadow-none bg-transparent sm:max-w-fit w-full outline-none overflow-visible">
                <DialogTitle className="sr-only">Bus Pass QR</DialogTitle>

                <div className="relative flex flex-col items-center">
                    {/* Close Button */}
                    <button
                        onClick={onClose}
                        className="absolute -top-12 right-0 p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-all backdrop-blur-md border border-white/10"
                    >
                        <X className="h-5 w-5" />
                    </button>

                    <AnimatePresence mode="wait">
                        {isActive ? (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                className="flex flex-col items-center w-full max-w-[340px]"
                            >
                                {/* The Digital Card */}
                                <div className="relative w-full aspect-[3/4.8] bg-[#020617] rounded-[28px] overflow-hidden flex flex-col shadow-2xl border border-white/10 mb-8">
                                    {/* Pattern Overlay */}
                                    <div className="absolute inset-0 opacity-5 pointer-events-none">
                                        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] mix-blend-overlay" />
                                    </div>

                                    {/* Empty Header Area */}
                                    <div className="px-6 pt-7 flex items-center justify-end relative z-10 min-h-[44px]">
                                    </div>

                                    {/* Student Info */}
                                    <div className="px-6 mt-6 relative z-10">
                                        <div className="flex items-start justify-between">
                                            <div className="flex flex-col">
                                                <span className="text-[10px] text-white/40 font-medium uppercase tracking-wider mb-1">Student</span>
                                                <h3 className="text-2xl font-black text-white tracking-tight">
                                                    {studentName}
                                                </h3>
                                            </div>
                                            <div className="flex flex-col items-center gap-1">
                                                <div className="w-12 h-12 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shadow-inner">
                                                    <ShieldCheck className="h-7 w-7 text-blue-400" />
                                                </div>
                                                <span className="text-[8px] font-black text-blue-400 uppercase tracking-tighter">Verified ID</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* QR Display */}
                                    <div className="flex-1 flex items-center justify-center relative z-10">
                                        <div className="relative p-4 bg-white rounded-[20px] shadow-2xl">
                                            <div ref={qrRef}>
                                                <QRCodeCanvas value={studentUid} size={180} level="H" includeMargin={false} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* ID Bar */}
                                    <div className="px-6 pb-8 relative z-10">
                                        <div className="bg-white/5 backdrop-blur-md rounded-2xl p-4 flex flex-col items-center border border-white/10">
                                            <span className="text-[9px] font-bold text-white/30 uppercase tracking-[0.2em] mb-1.5">Enrollment ID</span>
                                            <div className="flex items-center gap-3">
                                                <span className="text-base font-bold text-white tracking-widest font-mono">
                                                    {enrollmentId || 'N/A'}
                                                </span>
                                                <button onClick={handleCopyId} className="text-white/20 hover:text-blue-400 transition-colors">
                                                    {copied ? <CheckCircle className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Actions Group */}
                                <div className="flex gap-4 w-full">
                                    <Button onClick={handleShareQR} className="flex-1 h-12 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-2xl shadow-lg backdrop-blur-md transition-all">
                                        <Share2 className="h-4 w-4 mr-2" /> Share
                                    </Button>
                                    <Button onClick={handleDownloadQR} className="flex-1 h-12 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-2xl shadow-lg backdrop-blur-md transition-all">
                                        <Download className="h-4 w-4 mr-2" /> Save
                                    </Button>
                                </div>
                                <Button onClick={onClose} className="mt-4 w-full h-14 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-2xl shadow-xl transition-all">
                                    Close Pass
                                </Button>
                            </motion.div>
                        ) : (
                            <div className="bg-[#020617] p-10 rounded-[28px] text-center border border-white/10 shadow-3xl max-w-[340px]">
                                <div className="mx-auto w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center border border-red-500/20 mb-6">
                                    <X className="h-8 w-8 text-red-500" />
                                </div>
                                <h3 className="text-xl font-black text-white mb-2 uppercase tracking-wide">Inactive Token</h3>
                                <p className="text-sm text-slate-400 mb-8 leading-relaxed">Identity verification required. Please consult with the system administrator.</p>
                                <Button onClick={onClose} className="w-full h-12 bg-white/10 hover:bg-white/20 text-white rounded-xl border border-white/10 transition-all">Terminate</Button>
                            </div>
                        )}
                    </AnimatePresence>
                </div>
            </DialogContent>
        </Dialog>
    );
}
