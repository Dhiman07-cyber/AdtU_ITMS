"use client";

import { Button } from "@/components/ui/button";
import { Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { uploadImage } from "@/lib/upload";
import { AlertCircle,Camera,Check,Loader2,Plus,RotateCcw,X,ZoomIn,ZoomOut } from "lucide-react";
import { useEffect,useRef,useState } from "react";

interface ProfileImageAddModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (newImageUrl: string, file?: File) => void | Promise<void>;
    maxSizeMB?: number;
    immediateUpload?: boolean;
}

const revokeObjectUrl = (url?: string | null) => {
    if (url?.startsWith('blob:')) {
        URL.revokeObjectURL(url);
    }
};

export default function ProfileImageAddModal({
    isOpen,
    onClose,
    onConfirm,
    maxSizeMB = 5,
    immediateUpload = true,
}: ProfileImageAddModalProps) {
    const [step, setStep] = useState<'select' | 'crop' | 'uploading' | 'success' | 'error'>('select');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [zoom, setZoom] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [error, setError] = useState<string | null>(null);
    const [imgAspect, setImgAspect] = useState(1);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imageRef = useRef<HTMLImageElement | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Reset state when modal closes
    useEffect(() => {
        if (!isOpen) {
            // Cleanup blob URLs to prevent memory leaks
            revokeObjectUrl(previewUrl);
            
            setStep('select');
            setSelectedFile(null);
            setPreviewUrl(null);
            setZoom(1);
            setPosition({ x: 0, y: 0 });
            setError(null);
            setImgAspect(1);
            // Reset file input
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    }, [isOpen, previewUrl]);

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

        revokeObjectUrl(previewUrl);

        setPreviewUrl(URL.createObjectURL(file));
        setZoom(1);
        setPosition({ x: 0, y: 0 });
        setStep('crop');
    };

    const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
        // Prevent default browser behavior (e.g. image dragging, page scroll)
        if (e.cancelable) {
            e.preventDefault();
        }
        setIsDragging(true);
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        setDragStart({ x: clientX - position.x, y: clientY - position.y });
    };

    const handleDragMove = (e: MouseEvent | TouchEvent) => {
        if (!isDragging) return;
        if ('touches' in e) {
            if (e.cancelable) {
                e.preventDefault();
            }
        }
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
            window.addEventListener('touchmove', handleDragMove, { passive: false });
            window.addEventListener('touchend', handleDragEnd);
        }
        return () => {
            window.removeEventListener('mousemove', handleDragMove);
            window.removeEventListener('mouseup', handleDragEnd);
            window.removeEventListener('touchmove', handleDragMove);
            window.removeEventListener('touchend', handleDragEnd);
        };
    }, [isDragging]);

    const cropImage = async (): Promise<Blob | null> => {
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
        const containerAspect = 1; // Square container
        const imgAspect = natWidth / natHeight;

        let drawWidth: number, drawHeight: number;

        if (imgAspect > containerAspect) {
            drawHeight = containerSize;
            drawWidth = containerSize * imgAspect;
        } else {
            drawWidth = containerSize;
            drawHeight = containerSize / imgAspect;
        }

        const baseX = (containerSize - drawWidth) / 2;
        const baseY = (containerSize - drawHeight) / 2;

        ctx.clearRect(0, 0, outputSize, outputSize);
        ctx.save();

        ctx.beginPath();
        ctx.arc(outputSize / 2, outputSize / 2, outputSize / 2, 0, Math.PI * 2);
        ctx.clip();

        ctx.fillStyle = '#1f2937';
        ctx.fillRect(0, 0, outputSize, outputSize);

        ctx.translate(outputSize / 2, outputSize / 2);
        ctx.scale(outputScale, outputScale);
        ctx.translate(-containerSize / 2, -containerSize / 2);

        const originX = containerSize / 2;
        const originY = containerSize / 2;

        ctx.translate(originX, originY);

        ctx.translate(position.x, position.y);
        ctx.scale(zoom, zoom);

        ctx.translate(-originX, -originY);

        ctx.drawImage(
            img,
            baseX,
            baseY,
            drawWidth,
            drawHeight
        );

        ctx.restore();
        return new Promise((resolve) => {
            canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.9);
        });
    };

    const handleCropConfirm = async () => {
        if (!selectedFile) return;

        setStep('uploading');
        setError(null);

        try {
            const croppedBlob = await cropImage();
            if (!croppedBlob) {
                throw new Error('Failed to crop image');
            }

            const croppedFile = new File([croppedBlob], selectedFile.name.replace(/\.[^/.]+$/, '.jpg'), { type: 'image/jpeg' });

            if (immediateUpload) {
                // Upload to Cloudinary
                const uploadedUrl = await uploadImage(croppedFile);

                if (!uploadedUrl) {
                    throw new Error('Failed to upload image');
                }

                // Call the confirm callback with the new URL
                await onConfirm(uploadedUrl);
            } else {
                // Local handling - Create a persistent local URL
                const localUrl = URL.createObjectURL(croppedFile);

                // Call confirm with local URL and file
                await onConfirm(localUrl, croppedFile);
            }

            setStep('success');
            setTimeout(() => {
                onClose();
            }, 1000);
        } catch (err: any) {
            console.error('Error processing image:', err);
            setError(err.message || 'Failed to process image');
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
                        {step === 'select' && 'Add Profile Photo'}
                        {step === 'crop' && 'Adjust Photo'}
                        {step === 'uploading' && 'Uploading...'}
                        {step === 'success' && 'Success!'}
                        {step === 'error' && 'Upload Failed'}
                    </DialogTitle>
                    <DialogDescription className="text-gray-400">
                        {step === 'select' && 'Select a profile photo for the new user (max 5MB)'}
                        {step === 'crop' && 'Drag to position and zoom to fit'}
                        {step === 'uploading' && (immediateUpload ? 'Please wait while we upload the photo...' : 'Processing image...')}
                        {step === 'success' && 'Profile photo ready!'}
                        {step === 'error' && 'Something went wrong. Please try again.'}
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4">
                    {/* Step: Select Image */}
                    {step === 'select' && (
                        <div className="space-y-4">
                            <div
                                onClick={() => fileInputRef.current?.click()}
                                className="border-2 border-dashed border-gray-600 rounded-xl p-8 text-center cursor-pointer hover:cursor-pointer hover:border-blue-500 hover:bg-blue-500/5 transition-colors"
                            >
                                <Plus className="h-12 w-12 text-gray-400 mx-auto mb-3" />
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
                                className="relative w-64 h-64 mx-auto rounded-full overflow-hidden bg-gray-800 border-4 border-gray-700 cursor-move flex items-center justify-center touch-none select-none"
                                onMouseDown={handleDragStart}
                                onTouchStart={handleDragStart}
                            >
                                <img
                                    ref={imageRef}
                                    src={previewUrl}
                                    alt="Preview"
                                    onLoad={(e) => setImgAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
                                    style={{
                                        transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
                                        transformOrigin: 'center',
                                        maxWidth: 'none',
                                        width: imgAspect >= 1 ? 'auto' : '100%',
                                        height: imgAspect >= 1 ? '100%' : 'auto',
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
                                    Confirm
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Step: Uploading */}
                    {step === 'uploading' && (
                        <div className="flex flex-col items-center justify-center py-8">
                            <Loader2 className="h-12 w-12 text-blue-400 animate-spin mb-4" />
                            <p className="text-gray-300">{immediateUpload ? 'Uploading photo...' : 'Processing...'}</p>
                        </div>
                    )}

                    {/* Step: Success */}
                    {step === 'success' && (
                        <div className="flex flex-col items-center justify-center py-8">
                            <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mb-4">
                                <Check className="h-8 w-8 text-white" />
                            </div>
                            <p className="text-green-400 font-medium">
                                Photo Set Successfully!
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
                                    onClick={() => setStep('crop')}
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
