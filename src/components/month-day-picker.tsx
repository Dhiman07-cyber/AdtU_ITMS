/**
 * Month-Day Picker Component
 * 
 * This component mirrors the UI/UX of enhanced-date-picker.tsx but ONLY returns
 * month and day values (no year). Used for the System Renewal Configuration
 * where dates are stored as month/day only.
 * 
 * The year is applied per-student using their sessionEndYear at runtime.
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import * as Popover from '@radix-ui/react-popover';
import { addDays,addMonths,endOfMonth,isSameDay,isSameMonth,setMonth,startOfMonth,subDays,subMonths } from 'date-fns';
import { eachDayOfInterval } from 'date-fns/eachDayOfInterval';
import { Calendar,ChevronDown,ChevronLeft,ChevronRight,Info } from 'lucide-react';
import { useEffect,useState } from 'react';

/**
 * Month/Day value object - the return type of this picker
 * Month is 1-indexed for clarity (1=January, 12=December)
 */
export interface MonthDayValue {
    month: number; // 1-indexed (1=Jan, 12=Dec)
    day: number;   // Day of month (1-31)
}

interface MonthDayPickerProps {
    id: string;
    /** Current value as { month, day } or null */
    value: MonthDayValue | null;
    /** Callback when user selects a date */
    onChange: (value: MonthDayValue) => void;
    /** Optional label */
    label?: string;
    /** Whether the field is required */
    required?: boolean;
    /** Placeholder text */
    placeholder?: string;
    /** Additional CSS classes */
    className?: string;
    /** Show the helper text about month/day storage */
    showHelperText?: boolean;
}

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

const getOrdinal = (day: number): string => {
    if (day > 3 && day < 21) return 'th';
    switch (day % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
    }
};

/**
 * Get maximum valid day for a given month (using 2024 as reference leap year)
 */
const getMaxDayForMonth = (month: number): number => {
    // Use 2024 (leap year) as reference to allow Feb 29
    const date = new Date(2024, month, 0); // month is 1-indexed, so month gives us last day of that month
    return date.getDate();
};

/**
 * Validate if a day is valid for a given month
 */
const isValidDayForMonth = (month: number, day: number): boolean => {
    const maxDay = getMaxDayForMonth(month);
    return day >= 1 && day <= maxDay;
};

export default function MonthDayPicker({
    id,
    value,
    onChange,
    label,
    required = false,
    placeholder = "Select date...",
    className = '',
    showHelperText = true
}: MonthDayPickerProps) {
    const [isOpen, setIsOpen] = useState(false);
    // Use a reference year for display purposes (any leap year like 2024)
    const referenceYear = 2024;

    // Current month being viewed in the calendar (0-indexed for Date compatibility)
    const [currentMonth, setCurrentMonth] = useState(() => {
        if (value) {
            return new Date(referenceYear, value.month - 1, value.day);
        }
        return new Date(referenceYear, new Date().getMonth(), 1);
    });

    const [showMonthDropdown, setShowMonthDropdown] = useState(false);

    // Sync currentMonth with value when it changes
    useEffect(() => {
        if (value) {
            setCurrentMonth(new Date(referenceYear, value.month - 1, value.day));
        }
    }, [value]);

    // Reset dropdowns when opening
    useEffect(() => {
        if (isOpen) {
            setShowMonthDropdown(false);
        }
    }, [isOpen]);

    const handleDateSelect = (date: Date) => {
        const month = date.getMonth() + 1; // Convert to 1-indexed
        const day = date.getDate();

        onChange({ month, day });
        setIsOpen(false);
    };

    const goToPreviousMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
    const goToNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));

    const handleMonthChange = (monthIndex: number) => {
        const newDate = setMonth(currentMonth, monthIndex);
        setCurrentMonth(newDate);
        setShowMonthDropdown(false);
    };

    const getCalendarDays = () => {
        const start = startOfMonth(currentMonth);
        const end = endOfMonth(currentMonth);
        const daysInMonth = eachDayOfInterval({ start, end });
        const startDay = start.getDay();
        const prevMonthDays: Date[] = [];
        for (let i = startDay; i > 0; i--) { prevMonthDays.push(subDays(start, i)); }
        const nextMonthDays: Date[] = [];
        const daysNeeded = 42 - (prevMonthDays.length + daysInMonth.length);
        for (let i = 1; i <= daysNeeded; i++) { nextMonthDays.push(addDays(end, i)); }
        return [...prevMonthDays, ...daysInMonth, ...nextMonthDays];
    };

    // Format display value
    const displayValue = value
        ? `${MONTH_NAMES[value.month - 1]} ${value.day}${getOrdinal(value.day)}`
        : '';

    // Check if a date is selected
    const isSelected = (day: Date): boolean => {
        if (!value) return false;
        return day.getMonth() + 1 === value.month && day.getDate() === value.day;
    };

    return (
        <div className="relative">
            {label && (
                <label htmlFor={id} className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {label} {required && <span className="text-red-500">*</span>}
                </label>
            )}

            <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
                <Popover.Trigger asChild>
                    <div className="relative">
                        <Input
                            id={id}
                            type="text"
                            value={displayValue}
                            placeholder={placeholder}
                            readOnly
                            required={required}
                            className={`pr-9 cursor-pointer text-xs ${className || 'h-10'} border-gray-300 dark:border-gray-600 focus:border-indigo-500 focus:ring-indigo-500 transition-all duration-200 shadow-sm hover:shadow-md`}
                            onClick={(e) => {
                                e.preventDefault();
                                setIsOpen(true);
                            }}
                        />
                        <div className="absolute right-2.5 top-1/2 transform -translate-y-1/2 flex items-center gap-1 pointer-events-none">
                            <Calendar className="h-4 w-4 text-indigo-500" />
                        </div>
                    </div>
                </Popover.Trigger>

                <Popover.Portal>
                    <Popover.Content
                        className="z-[9999] bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 w-[280px] backdrop-blur-sm animate-in fade-in zoom-in-95 duration-200"
                        sideOffset={4}
                        align="start"
                    >
                        {/* Calendar Header - NO YEAR SELECTOR */}
                        <div className="px-2 py-2 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950 dark:to-purple-950 rounded-t-lg">
                            <div className="flex items-center justify-between">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={goToPreviousMonth}
                                    className="h-8 w-8 p-0 hover:bg-indigo-100 dark:hover:bg-indigo-900 rounded-full"
                                >
                                    <ChevronLeft className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                                </Button>

                                <div className="relative">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-8 px-4 text-xs font-semibold text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900"
                                        onClick={() => setShowMonthDropdown(!showMonthDropdown)}
                                    >
                                        {MONTH_NAMES[currentMonth.getMonth()]}
                                        <ChevronDown className="ml-1.5 h-3 w-3" />
                                    </Button>

                                    {/* Month Dropdown */}
                                    {showMonthDropdown && (
                                        <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 bg-white dark:bg-gray-800 rounded-lg shadow-xl border-2 border-indigo-100 dark:border-indigo-900 w-36 z-[10000] animate-in fade-in slide-in-from-top-2 duration-150">
                                            <div className="max-h-48 overflow-y-auto scrollbar-thin">
                                                {MONTH_NAMES.map((month, index) => (
                                                    <button
                                                        key={month}
                                                        type="button"
                                                        className={`block w-full text-left px-3 py-2 text-sm font-medium ${index === currentMonth.getMonth()
                                                                ? 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700'
                                                                : 'text-gray-700 dark:text-gray-300 hover:bg-indigo-50 dark:hover:bg-indigo-950'
                                                            }`}
                                                        onClick={() => handleMonthChange(index)}
                                                    >
                                                        {month}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={goToNextMonth}
                                    className="h-8 w-8 p-0 hover:bg-indigo-100 dark:hover:bg-indigo-900 rounded-full"
                                >
                                    <ChevronRight className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                                </Button>
                            </div>
                        </div>

                        {/* Calendar Grid */}
                        <div className="p-2">
                            <div className="grid grid-cols-7 gap-0.5 mb-1">
                                {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
                                    <div key={day} className="text-center text-[9px] font-bold text-indigo-600 dark:text-indigo-400 uppercase py-0.5">{day}</div>
                                ))}
                            </div>
                            <div className="grid grid-cols-7 gap-0.5">
                                {getCalendarDays().map((day, index) => {
                                    const isCurrentMonth = isSameMonth(day, currentMonth);
                                    const selected = isSelected(day);
                                    const isToday = isSameDay(day, new Date());

                                    return (
                                        <button
                                            key={index}
                                            type="button"
                                            className={`h-6 w-6 flex items-center justify-center text-[10px] font-medium rounded transition-all cursor-pointer ${!isCurrentMonth
                                                    ? 'text-gray-300 dark:text-gray-600'
                                                    : selected
                                                        ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow scale-105'
                                                        : 'text-gray-700 dark:text-gray-300 hover:bg-indigo-50 dark:hover:bg-indigo-950'
                                                } ${isToday && !selected ? 'ring-1 ring-indigo-400' : ''}`}
                                            onClick={() => handleDateSelect(day)}
                                        >
                                            {day.getDate()}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Helper Text */}
                        {showHelperText && (
                            <div className="mx-2 mb-2 p-2 bg-indigo-50/50 dark:bg-indigo-950/50 rounded-lg border border-indigo-100 dark:border-indigo-900">
                                <p className="text-[9px] text-indigo-600 dark:text-indigo-400 flex items-start gap-1.5">
                                    <Info className="h-3 w-3 flex-shrink-0 mt-0.5" />
                                    <span>
                                        Stored as <strong>month/day only</strong>. Year is applied per-student using sessionEndYear.
                                    </span>
                                </p>
                            </div>
                        )}

                        {/* Footer Buttons */}
                        <div className="flex justify-between gap-2 px-2 pb-2 pt-1 border-t border-gray-100 dark:border-gray-700">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setIsOpen(false)}
                                className="h-7 px-3 text-[10px] font-medium flex-1 rounded"
                            >
                                Cancel
                            </Button>
                            {value && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setIsOpen(false)}
                                    className="h-7 px-3 text-[10px] font-medium bg-gradient-to-r from-indigo-500 to-purple-600 text-white border-0 flex-1 rounded shadow-sm hover:shadow-md transition-all"
                                >
                                    Confirm {MONTH_NAMES[value.month - 1].slice(0, 3)} {value.day}
                                </Button>
                            )}
                        </div>
                    </Popover.Content>
                </Popover.Portal>
            </Popover.Root>
        </div>
    );
}

/**
 * Utility: Convert MonthDayValue to display string
 */
export function formatMonthDay(value: MonthDayValue | null): string {
    if (!value) return '';
    return `${MONTH_NAMES[value.month - 1]} ${value.day}${getOrdinal(value.day)}`;
}

/**
 * Utility: Parse a date string (YYYY-MM-DD) to MonthDayValue (strips year)
 */
export function parseToMonthDay(dateStr: string): MonthDayValue | null {
    if (!dateStr) return null;
    const parts = dateStr.split('-');
    if (parts.length < 3) return null;
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);
    if (isNaN(month) || isNaN(day)) return null;
    return { month, day };
}

/**
 * Utility: Convert MonthDayValue to config format (0-indexed month for JS Date)
 */
export function toConfigFormat(value: MonthDayValue): { month: number; day: number } {
    return {
        month: value.month - 1, // Convert to 0-indexed for JS Date compatibility
        day: value.day
    };
}

/**
 * Utility: Convert config format (0-indexed month) to MonthDayValue
 */
export function fromConfigFormat(config: { month: number; day: number }): MonthDayValue {
    return {
        month: config.month + 1, // Convert from 0-indexed to 1-indexed
        day: config.day
    };
}
