"use client";

import { cn } from '@/lib/utils';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown,ChevronUp,Clock } from 'lucide-react';
import { useEffect,useState } from 'react';

export interface TimeValue {
    hour: number;  // 0-23 (24-hour format)
    minute: number; // 0-59
}

interface TimePickerProps {
    id?: string;
    value: TimeValue | null;
    onChange: (value: TimeValue) => void;
    label?: string;
    required?: boolean;
    placeholder?: string;
    className?: string;
    showHelperText?: boolean;
}

/**
 * Format time for display (12-hour format with AM/PM)
 */
function formatTimeDisplay(time: TimeValue | null): string {
    if (!time) return '';
    const hour12 = time.hour % 12 || 12;
    const ampm = time.hour < 12 ? 'AM' : 'PM';
    const minuteStr = time.minute.toString().padStart(2, '0');
    return `${hour12}:${minuteStr} ${ampm}`;
}

/**
 * Format time for config storage (24-hour format)
 */
export function formatTime24(time: TimeValue): string {
    return `${time.hour.toString().padStart(2, '0')}:${time.minute.toString().padStart(2, '0')}`;
}

/**
 * Convert config format to TimeValue
 */
export function fromConfigTime(config: { hour?: number; minute?: number } | null): TimeValue | null {
    if (!config || config.hour === undefined || config.minute === undefined) return null;
    return { hour: config.hour, minute: config.minute };
}

/**
 * Time Picker Component
 * Allows selection of hour and minute with a scrollable picker UI
 */
export default function TimePicker({
    id,
    value,
    onChange,
    label,
    required = false,
    placeholder = "Select time...",
    className = '',
    showHelperText = false
}: TimePickerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [selectedHour, setSelectedHour] = useState(value?.hour ?? 0);
    const [selectedMinute, setSelectedMinute] = useState(value?.minute ?? 0);

    // Sync internal state with external value
    useEffect(() => {
        if (value) {
            setSelectedHour(value.hour);
            setSelectedMinute(value.minute);
        }
    }, [value]);

    const handleConfirm = () => {
        onChange({ hour: selectedHour, minute: selectedMinute });
        setIsOpen(false);
    };

    const incrementHour = () => setSelectedHour(h => (h + 1) % 24);
    const decrementHour = () => setSelectedHour(h => (h - 1 + 24) % 24);
    const incrementMinute = () => setSelectedMinute(m => (m + 5) % 60); // 5-minute increments
    const decrementMinute = () => setSelectedMinute(m => (m - 5 + 60) % 60);

    const displayValue = value ? formatTimeDisplay(value) : '';

    return (
        <div className={cn("relative", className)}>
            {label && (
                <label htmlFor={id} className="block text-sm font-medium text-gray-300 mb-2">
                    {label}
                    {required && <span className="text-red-500 ml-1">*</span>}
                </label>
            )}

            <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
                <Popover.Trigger asChild>
                    <button
                        type="button"
                        id={id}
                        className={cn(
                            "w-full flex items-center gap-3 px-4 py-3 rounded-xl",
                            "bg-[#0A0B10] border border-white/10",
                            "text-left transition-all duration-200",
                            "hover:border-white/20 focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20",
                            "outline-none",
                            isOpen && "border-indigo-500/50 ring-2 ring-indigo-500/20"
                        )}
                    >
                        <Clock className="h-5 w-5 text-indigo-400 flex-shrink-0" />
                        <span className={cn(
                            "flex-1",
                            displayValue ? "text-white font-medium" : "text-gray-500"
                        )}>
                            {displayValue || placeholder}
                        </span>
                    </button>
                </Popover.Trigger>

                <Popover.Portal>
                    <Popover.Content
                        className="z-[9999] bg-[#12131A] border border-white/10 rounded-2xl shadow-2xl p-4 w-[280px]"
                        sideOffset={8}
                        align="start"
                    >
                        {/* Time Picker Header */}
                        <div className="text-center mb-4">
                            <h4 className="text-white font-semibold text-sm">Select Time</h4>
                            <p className="text-gray-500 text-xs mt-1">IST (Indian Standard Time)</p>
                        </div>

                        {/* Time Selector */}
                        <div className="flex items-center justify-center gap-4 mb-4">
                            {/* Hour Selector */}
                            <div className="flex flex-col items-center">
                                <button
                                    type="button"
                                    onClick={incrementHour}
                                    className="p-2 rounded-lg hover:bg-white/10 transition-colors text-gray-400 hover:text-white"
                                >
                                    <ChevronUp className="h-5 w-5" />
                                </button>
                                <div className="w-16 h-14 flex items-center justify-center bg-indigo-500/20 rounded-xl border border-indigo-500/30">
                                    <span className="text-2xl font-bold text-white">
                                        {selectedHour.toString().padStart(2, '0')}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={decrementHour}
                                    className="p-2 rounded-lg hover:bg-white/10 transition-colors text-gray-400 hover:text-white"
                                >
                                    <ChevronDown className="h-5 w-5" />
                                </button>
                                <span className="text-xs text-gray-500 mt-1">Hour</span>
                            </div>

                            {/* Separator */}
                            <div className="text-3xl font-bold text-white/50 pb-6">:</div>

                            {/* Minute Selector */}
                            <div className="flex flex-col items-center">
                                <button
                                    type="button"
                                    onClick={incrementMinute}
                                    className="p-2 rounded-lg hover:bg-white/10 transition-colors text-gray-400 hover:text-white"
                                >
                                    <ChevronUp className="h-5 w-5" />
                                </button>
                                <div className="w-16 h-14 flex items-center justify-center bg-indigo-500/20 rounded-xl border border-indigo-500/30">
                                    <span className="text-2xl font-bold text-white">
                                        {selectedMinute.toString().padStart(2, '0')}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={decrementMinute}
                                    className="p-2 rounded-lg hover:bg-white/10 transition-colors text-gray-400 hover:text-white"
                                >
                                    <ChevronDown className="h-5 w-5" />
                                </button>
                                <span className="text-xs text-gray-500 mt-1">Minute</span>
                            </div>
                        </div>

                        {/* AM/PM Indicator */}
                        <div className="flex justify-center gap-2 mb-4">
                            <span className={cn(
                                "px-3 py-1 rounded-lg text-sm font-medium transition-colors",
                                selectedHour < 12
                                    ? "bg-indigo-500/30 text-indigo-300 border border-indigo-500/50"
                                    : "bg-white/5 text-gray-500"
                            )}>
                                AM
                            </span>
                            <span className={cn(
                                "px-3 py-1 rounded-lg text-sm font-medium transition-colors",
                                selectedHour >= 12
                                    ? "bg-indigo-500/30 text-indigo-300 border border-indigo-500/50"
                                    : "bg-white/5 text-gray-500"
                            )}>
                                PM
                            </span>
                        </div>

                        {/* Preview */}
                        <div className="bg-white/5 rounded-lg p-3 mb-4">
                            <div className="text-center">
                                <span className="text-lg font-bold text-white">
                                    {formatTimeDisplay({ hour: selectedHour, minute: selectedMinute })}
                                </span>
                                <span className="text-gray-500 text-xs ml-2">
                                    ({formatTime24({ hour: selectedHour, minute: selectedMinute })})
                                </span>
                            </div>
                        </div>

                        {/* Confirm Button */}
                        <button
                            type="button"
                            onClick={handleConfirm}
                            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-colors"
                        >
                            Confirm
                        </button>

                        {showHelperText && (
                            <p className="text-[10px] text-gray-500 text-center mt-3">
                                Time is stored in 24-hour format (IST)
                            </p>
                        )}

                        <Popover.Arrow className="fill-[#12131A]" />
                    </Popover.Content>
                </Popover.Portal>
            </Popover.Root>
        </div>
    );
}
