"use client";

import { Button } from "@/components/ui/button";
import { Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { uploadImage } from "@/lib/upload";
import { AlertCircle,Camera,Check,Loader2,RotateCcw,Upload,X,ZoomIn,ZoomOut } from "lucide-react";
import { useEffect,useRef,useState } from "react";

interface ProfileImageUpdateModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentImageUrl?: string;
    onConfirm: (newImageUrl: string) => Promise<void>;
    requiresApproval?: boolean;
    maxSizeMB?: number;
}

export default function ProfileImageUpdateModal({
    isOpen,
    onClose,
    currentImageUrl,
    onConfirm,
    requiresApproval = false,
    maxSizeMB = 5,
}: ProfileImageUpdateModalProps) {
    const [step, setStep] = useState<'select' | 'crop' | 'confirm' | 'uploading' | 'success' | 'error'>('select');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [zoom, setZoom] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [error, setError] = useState<string | null>(null);
    const [croppedImageUrl, setCroppedImageUrl] = useState<string | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imageRef = useRef<HTMLImageElement | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Reset state when modal closes
    useEffect(() => {
        if (!isOpen) {
            setStep('select');
            setSelectedFile(null);
            setPreviewUrl(null);
            setZoom(1);
            setPosition({ x: 0, y: 0 });
            setError(null);
            setCroppedImageUrl(null);
        }
    }, [isOpen]);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate file type
        if (!file.type.startsWith('image/')) {
            setError('Please select an image file');
            return;
        }

        // Validate file size
        if (file.size > maxSizeMB * 1024 * 1024) {
            setError(`Image must be less than ${maxSizeMB}MB`);
            return;
        }

        setError(null);
        setSelectedFile(file);

        // Create preview URL
        const reader = new FileReader();
        reader.onload = () => {
            setPreviewUrl(reader.result as string);
            setStep('crop');
        };
        reader.readAsDataURL(file);
    };

    const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
        // Only prevent default for mouse events, touch events are passive
        if ('touches' in e === false) {
            e.preventDefault();
        }
        setIsDragging(true);
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        setDragStart({ x: clientX - position.x, y: clientY - position.y });
    };

    const handleDragMove = (e: MouseEvent | TouchEvent) => {
        if (!isDragging) return;
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        setPosition({
            x: clientX - dragStart.x,
            y: clientY - dragStart.y,
        });
    };

    const handleDragEnd = () => {
        setIsDragging(false);
    };

    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mousemove', handleDragMove);
            window.addEventListener('mouseup', handleDragEnd);
            window.addEventListener('touchmove', handleDragMove);
            window.addEventListener('touchend', handleDragEnd);
        }
        return () => {
            window.removeEventListener('mousemove', handleDragMove);
            window.removeEventListener('mouseup', handleDragEnd);
            window.removeEventListener('touchmove', handleDragMove);
            window.removeEventListener('touchend', handleDragEnd);
        };
    }, [isDragging]);

    const cropImage = (): string | null => {
        if (!canvasRef.current || !imageRef.current || !previewUrl) return null;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        const outputSize = 400; // Output size for profile photo
        const containerSize = 256; // Match the CSS container size (w-64 h-64 = 256px)
        const outputScale = outputSize / containerSize; // Scale up to output resolution

        canvas.width = outputSize;
        canvas.height = outputSize;

        const img = imageRef.current;
        const natWidth = img.naturalWidth;
        const natHeight = img.naturalHeight;

        // Calculate how object-fit: cover displays the image
        // It scales the image to cover the container while maintaining aspect ratio
        const containerAspect = 1; // Square container
        const imgAspect = natWidth / natHeight;

        let drawWidth: number, drawHeight: number;

        if (imgAspect > containerAspect) {
            // Image is wider - height matches container, width extends beyond
            drawHeight = containerSize;
            drawWidth = containerSize * imgAspect;
        } else {
            // Image is taller - width matches container, height extends beyond
            drawWidth = containerSize;
            drawHeight = containerSize / imgAspect;
        }

        // Center position of image within container (object-fit: cover centers the image)
        const baseX = (containerSize - drawWidth) / 2;
        const baseY = (containerSize - drawHeight) / 2;

        // Clear canvas
        ctx.clearRect(0, 0, outputSize, outputSize);
        ctx.save();

        // Set up circular clipping path (scaled to output size)
        ctx.beginPath();
        ctx.arc(outputSize / 2, outputSize / 2, outputSize / 2, 0, Math.PI * 2);
        ctx.clip();

        // Fill background
        ctx.fillStyle = '#1f2937';
        ctx.fillRect(0, 0, outputSize, outputSize);

        // CSS transform is: translate(position.x, position.y) scale(zoom)
        // with transformOrigin: center
        // 
        // This means:
        // 1. Move origin to image center
        // 2. Apply transforms (translate then scale)
        // 3. Move origin back
        //
        // The image center is at (containerSize/2, containerSize/2) before transform
        // After translate, it's at (containerSize/2 + position.x, containerSize/2 + position.y)
        // Then scale is applied from this new center

        // Scale everything to output size
        ctx.translate(outputSize / 2, outputSize / 2);
        ctx.scale(outputScale, outputScale);
        ctx.translate(-containerSize / 2, -containerSize / 2);

        // Now apply the CSS transforms
        // translateOrigin is center of container (128, 128 for 256px container)
        const originX = containerSize / 2;
        const originY = containerSize / 2;

        // Move to origin
        ctx.translate(originX, originY);

        // Apply the transform: translate then scale
        ctx.translate(position.x, position.y);
        ctx.scale(zoom, zoom);

        // Move back from origin
        ctx.translate(-originX, -originY);

        // Draw the image at its base position (centered for object-fit: cover)
        ctx.drawImage(
            img,
            baseX,
            baseY,
            drawWidth,
            drawHeight
        );

        ctx.restore();
        return canvas.toDataURL('image/jpeg', 0.92);
    };

    const handleCropConfirm = () => {
        const croppedUrl = cropImage();
        if (croppedUrl) {
            setCroppedImageUrl(croppedUrl);
            setStep('confirm');
        } else {
            setError('Failed to crop image');
        }
    };

    const handleFinalConfirm = async () => {
        if (!croppedImageUrl || !selectedFile) return;

        setStep('uploading');
        setError(null);

        try {
            // Convert base64 to Blob without using fetch (CSP-safe)
            const base64Data = croppedImageUrl.split(',')[1];
            const byteCharacters = atob(base64Data);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: 'image/jpeg' });
            const croppedFile = new File([blob], selectedFile.name.replace(/\.[^/.]+$/, '.jpg'), { type: 'image/jpeg' });

            // Upload to Cloudinary
            const uploadedUrl = await uploadImage(croppedFile);

            if (!uploadedUrl) {
                throw new Error('Failed to upload image');
            }

            // Call the confirm callback with the new URL
            await onConfirm(uploadedUrl);

            setStep('success');
            setTimeout(() => {
                onClose();
            }, 1500);
        } catch (err: any) {
            console.error('Error uploading image:', err);
            setError(err.message || 'Failed to upload image');
            setStep('error');
        }
    };

    const resetCrop = () => {
        setZoom(1);
        setPosition({ x: 0, y: 0 });
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto bg-gray-900 border-gray-800">
                <DialogHeader>
                    <DialogTitle className="text-white flex items-center gap-2">
                        <Camera className="h-5 w-5 text-blue-400" />
                        {step === 'select' && 'Update Profile Photo'}
                        {step === 'crop' && 'Adjust Photo'}
                        {step === 'confirm' && 'Confirm Changes'}
                        {step === 'uploading' && 'Uploading...'}
                        {step === 'success' && 'Success!'}
                        {step === 'error' && 'Upload Failed'}
                    </DialogTitle>
                    <DialogDescription className="text-gray-400">
                        {step === 'select' && 'Select a new profile photo (max 5MB)'}
                        {step === 'crop' && 'Drag to position and zoom to fit'}
                        {step === 'confirm' && (requiresApproval
                            ? 'Your request will be sent to the driver for approval'
                            : 'Review your new profile photo')}
                        {step === 'uploading' && 'Please wait while we upload your photo...'}
                        {step === 'success' && (requiresApproval
                            ? 'Your request has been sent for approval'
                            : 'Your profile photo has been updated')}
                        {step === 'error' && 'Something went wrong. Please try again.'}
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4">
                    {/* Step: Select Image */}
                    {step === 'select' && (
                        <div className="space-y-4">
                            {currentImageUrl && (
                                <div className="flex justify-center">
                                    <div className="relative">
                                        <img
                                            src={currentImageUrl}
                                            alt="Current profile"
                                            className="w-32 h-32 rounded-full object-cover border-4 border-gray-700"
                                        />
                                        <p className="text-center text-xs text-gray-500 mt-2">Current Photo</p>
                                    </div>
                                </div>
                            )}

                            <div
                                onClick={() => fileInputRef.current?.click()}
                                className="border-2 border-dashed border-gray-600 rounded-xl p-8 text-center cursor-pointer hover:cursor-pointer hover:border-blue-500 hover:bg-blue-500/5 transition-all"
                            >
                                <Upload className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                                <p className="text-gray-300 font-medium">Click to select image</p>
                                <p className="text-gray-500 text-sm mt-1">PNG, JPG, WEBP up to {maxSizeMB}MB</p>
                            </div>

                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                onChange={handleFileSelect}
                                className="hidden"
                            />

                            {error && (
                                <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 p-3 rounded-lg">
                                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                                    <span>{error}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Step: Crop Image */}
                    {step === 'crop' && previewUrl && (
                        <div className="space-y-4">
                            <div
                                ref={containerRef}
                                className="relative w-64 h-64 mx-auto rounded-full overflow-hidden bg-gray-800 border-4 border-gray-700 cursor-move"
                                onMouseDown={handleDragStart}
                                onTouchStart={handleDragStart}
                            >
                                <img
                                    ref={imageRef}
                                    src={previewUrl}
                                    alt="Preview"
                                    className="absolute"
                                    style={{
                                        transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
                                        transformOrigin: 'center',
                                        maxWidth: 'none',
                                        width: '100%',
                                        height: '100%',
                                        objectFit: 'cover',
                                        pointerEvents: 'none',
                                    }}
                                    draggable={false}
                                />
                                {/* Circular overlay guide */}
                                <div className="absolute inset-0 pointer-events-none">
                                    <div className="w-full h-full rounded-full border-4 border-white/20" />
                                </div>
                            </div>

                            {/* Zoom Controls */}
                            <div className="flex items-center gap-3 px-4">
                                <ZoomOut className="h-4 w-4 text-gray-400" />
                                <Slider
                                    value={[zoom]}
                                    min={0.5}
                                    max={3}
                                    step={0.1}
                                    onValueChange={(value) => setZoom(value[0])}
                                    className="flex-1"
                                />
                                <ZoomIn className="h-4 w-4 text-gray-400" />
                            </div>

                            <div className="flex justify-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={resetCrop}
                                    className="border-gray-600 text-gray-300 hover:bg-gray-800"
                                >
                                    <RotateCcw className="h-4 w-4 mr-1" />
                                    Reset
                                </Button>
                            </div>

                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    onClick={() => setStep('select')}
                                    className="flex-1 border-gray-600 text-gray-300 hover:bg-gray-800"
                                >
                                    Back
                                </Button>
                                <Button
                                    onClick={handleCropConfirm}
                                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                                >
                                    Continue
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Step: Confirm */}
                    {step === 'confirm' && croppedImageUrl && (
                        <div className="space-y-4">
                            <div className="flex justify-center items-center gap-6">
                                {currentImageUrl && (
                                    <div className="text-center">
                                        <img
                                            src={currentImageUrl}
                                            alt="Current"
                                            className="w-24 h-24 rounded-full object-cover border-2 border-gray-600"
                                        />
                                        <p className="text-xs text-gray-500 mt-1">Current</p>
                                    </div>
                                )}
                                {currentImageUrl && <div className="text-gray-400 text-2xl">→</div>}
                                <div className="text-center">
                                    <img
                                        src={croppedImageUrl}
                                        alt="New"
                                        className="w-24 h-24 rounded-full object-cover border-2 border-blue-500"
                                    />
                                    <p className="text-xs text-gray-400 mt-1">New</p>
                                </div>
                            </div>

                            {requiresApproval && (
                                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-center">
                                    <p className="text-yellow-400 text-sm">
                                        ⚠️ Your profile photo change will require approval from your driver
                                    </p>
                                </div>
                            )}

                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    onClick={() => setStep('crop')}
                                    className="flex-1 border-gray-600 text-gray-300 hover:bg-gray-800"
                                >
                                    Back
                                </Button>
                                <Button
                                    onClick={handleFinalConfirm}
                                    className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                                >
                                    <Check className="h-4 w-4 mr-1" />
                                    {requiresApproval ? 'Send Request' : 'Confirm'}
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Step: Uploading */}
                    {step === 'uploading' && (
                        <div className="flex flex-col items-center justify-center py-8">
                            <Loader2 className="h-12 w-12 text-blue-400 animate-spin mb-4" />
                            <p className="text-gray-300">Uploading your photo...</p>
                        </div>
                    )}

                    {/* Step: Success */}
                    {step === 'success' && (
                        <div className="flex flex-col items-center justify-center py-8">
                            <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mb-4">
                                <Check className="h-8 w-8 text-white" />
                            </div>
                            <p className="text-green-400 font-medium">
                                {requiresApproval ? 'Request Sent!' : 'Photo Updated!'}
                            </p>
                        </div>
                    )}

                    {/* Step: Error */}
                    {step === 'error' && (
                        <div className="space-y-4">
                            <div className="flex flex-col items-center justify-center py-4">
                                <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mb-4">
                                    <X className="h-8 w-8 text-red-400" />
                                </div>
                                <p className="text-red-400 font-medium">Upload Failed</p>
                                <p className="text-gray-500 text-sm text-center mt-1">{error}</p>
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    onClick={onClose}
                                    className="flex-1 border-gray-600 text-gray-300 hover:bg-gray-800"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    onClick={() => setStep('confirm')}
                                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                                >
                                    Try Again
                                </Button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Hidden canvas for cropping */}
                <canvas ref={canvasRef} className="hidden" />
            </DialogContent>
        </Dialog>
    );
}
