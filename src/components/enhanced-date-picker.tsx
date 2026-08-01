import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import * as Popover from '@radix-ui/react-popover';
import { addDays, addMonths, endOfMonth, format, getYear, isAfter, isBefore, isSameDay, isSameMonth, setMonth, setYear, startOfMonth, subDays, subMonths } from 'date-fns';
import { eachDayOfInterval } from 'date-fns/eachDayOfInterval';
import { parseISO } from 'date-fns/parseISO';
import { Calendar as CalendarIcon, ChevronDown, ChevronLeft, ChevronRight, Clock, Lock } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';

interface EnhancedDatePickerProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onValidationError?: (message: string) => void;
  label?: string;
  required?: boolean;
  minDate?: string;
  maxDate?: string;
  placeholder?: string;
  validationType?: 'dob-student' | 'dob-driver' | 'dob-moderator' | 'joining' | 'no-validation';
  allowManualInput?: boolean;
  className?: string;
  includeTime?: boolean;
  locked?: boolean;
}

export default function EnhancedDatePicker({
  id,
  value,
  onChange,
  onValidationError,
  label,
  required = false,
  minDate,
  maxDate,
  placeholder = "YYYY-MM-DD",
  validationType = 'no-validation',
  allowManualInput = false,
  className = '',
  includeTime = false,
  locked = false
}: EnhancedDatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<'date' | 'time'>('date');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [showYearDropdown, setShowYearDropdown] = useState(false);
  const [showMonthDropdown, setShowMonthDropdown] = useState(false);
  const [tempDate, setTempDate] = useState<string>(''); // Temporarily store date until time is picked
  const [selectedHour, setSelectedHour] = useState(() => {
    const now = new Date();
    const h = now.getHours();
    return h > 12 ? h - 12 : h === 0 ? 12 : h;
  });
  const [selectedMinute, setSelectedMinute] = useState(() => {
    const now = new Date();
    return Math.floor(now.getMinutes() / 5) * 5;
  });
  const [isPM, setIsPM] = useState(() => new Date().getHours() >= 12);

  // Safely parse min and max dates
  const parseBoundsDate = (dateStr?: string): Date | undefined => {
    if (!dateStr) return undefined;
    try {
      const clean = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
      const parsed = parseISO(clean);
      return isNaN(parsed.getTime()) ? undefined : parsed;
    } catch {
      return undefined;
    }
  };

  const minDateObj = parseBoundsDate(minDate);
  const maxDateObj = parseBoundsDate(maxDate);

  // Selected date parsing
  const selectedDateStr = value ? (value.includes('T') ? value.split('T')[0] : value) : '';
  const selectedDate = selectedDateStr ? parseBoundsDate(selectedDateStr) : undefined;

  // Sync currentMonth with selectedDate when it changes or when picker opens
  useEffect(() => {
    if (selectedDate && !isNaN(selectedDate.getTime())) {
      setCurrentMonth(selectedDate);
    }
  }, [selectedDateStr, isOpen]);

  // Sync time from value string
  useEffect(() => {
    if (value && value.includes('T')) {
      const timePart = value.split('T')[1].slice(0, 5);
      const [h, m] = timePart.split(':').map(Number);
      if (!isNaN(h) && !isNaN(m)) {
        setSelectedHour(h > 12 ? h - 12 : h === 0 ? 12 : h);
        setSelectedMinute(m);
        setIsPM(h >= 12);
      }
    }
  }, [value]);

  // Reset picker mode when opening
  useEffect(() => {
    if (isOpen) {
      setPickerMode('date');
      setTempDate('');
    }
  }, [isOpen]);

  const generateYearOptions = () => {
    const currentYear = new Date().getFullYear();
    const years: number[] = [];
    for (let year = currentYear + 10; year >= 1920; year--) {
      years.push(year);
    }
    return years;
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const calculateAge = (birthDate: Date): number => {
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  const checkEligibility = (date: Date): { eligible: boolean; reason?: string } => {
    // 1. Min Date Check
    if (minDateObj && isBefore(date, minDateObj) && !isSameDay(date, minDateObj)) {
      return { 
        eligible: false, 
        reason: `Date cannot be earlier than ${format(minDateObj, 'MMM d, yyyy')}.` 
      };
    }
    // 2. Max Date Check
    if (maxDateObj && isAfter(date, maxDateObj) && !isSameDay(date, maxDateObj)) {
      return { 
        eligible: false, 
        reason: `Date cannot be later than ${format(maxDateObj, 'MMM d, yyyy')}.` 
      };
    }

    // 3. Validation Type Checks (Age limits)
    const age = calculateAge(date);
    const isFutureDate = age < 0;

    switch (validationType) {
      case 'dob-student':
        if (isFutureDate) {
          return { eligible: false, reason: "Birth date cannot be in the future. Students must be at least 12 years old." };
        }
        if (age < 12) {
          return { eligible: false, reason: `Students must be at least 12 years old (selected age: ${age} yrs).` };
        }
        break;

      case 'dob-driver':
      case 'dob-moderator':
        if (isFutureDate) {
          return { eligible: false, reason: "Birth date cannot be in the future. Staff must be at least 19 years old." };
        }
        if (age < 19) {
          return { eligible: false, reason: `Staff must be at least 19 years old (selected age: ${age} yrs).` };
        }
        break;

      case 'joining':
        if (isAfter(date, new Date()) && !isSameDay(date, new Date())) {
          return { eligible: false, reason: "Joining date cannot be in the future." };
        }
        break;

      default:
        break;
    }

    return { eligible: true };
  };

  const handleDateSelect = (date: Date) => {
    if (locked) return;

    const { eligible, reason } = checkEligibility(date);

    if (!eligible && reason) {
      // Trigger toast feedback & custom validation callback
      toast.error(reason);
      if (onValidationError) onValidationError(reason);
      return;
    }

    const dateStr = format(date, 'yyyy-MM-dd');

    if (includeTime) {
      setTempDate(dateStr);
      setPickerMode('time');
    } else {
      onChange(dateStr);
      setIsOpen(false);
    }
  };

  const handleTimeConfirm = () => {
    const dateToUse = tempDate || selectedDateStr || format(new Date(), 'yyyy-MM-dd');
    let hour24 = selectedHour;
    if (isPM && selectedHour !== 12) hour24 = selectedHour + 12;
    if (!isPM && selectedHour === 12) hour24 = 0;
    const timeStr = `${hour24.toString().padStart(2, '0')}:${selectedMinute.toString().padStart(2, '0')}`;
    onChange(`${dateToUse}T${timeStr}`);
    setIsOpen(false);
  };

  const goToPreviousMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const goToNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));

  const handleYearChange = (year: number) => {
    // setYear handles leap year transitions automatically (e.g. Feb 29 -> Feb 28 on non-leap year)
    const newDate = setYear(currentMonth, year);
    setCurrentMonth(newDate);
    setShowYearDropdown(false);
  };

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
    
    // Fill previous month days in correct chronological order
    const prevMonthDays: Date[] = [];
    for (let i = startDay; i > 0; i--) { 
      prevMonthDays.push(subDays(start, i)); 
    }
    
    // Fill next month days to complete 42-day grid (6 full weeks)
    const nextMonthDays: Date[] = [];
    const daysNeeded = 42 - (prevMonthDays.length + daysInMonth.length);
    for (let i = 1; i <= daysNeeded; i++) { 
      nextMonthDays.push(addDays(end, i)); 
    }
    
    return [...prevMonthDays, ...daysInMonth, ...nextMonthDays];
  };

  const displayValue = selectedDate && !isNaN(selectedDate.getTime())
    ? (includeTime && value.includes('T')
      ? format(selectedDate, 'MMM d, yyyy') + ' ' + formatTime(value.split('T')[1].slice(0, 5))
      : format(selectedDate, 'MMM d, yyyy'))
    : '';

  function formatTime(time24: string): string {
    const [h, m] = time24.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return time24;
    const isPM = h >= 12;
    const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${h12}:${m.toString().padStart(2, '0')} ${isPM ? 'PM' : 'AM'}`;
  }

  const handleManualInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (allowManualInput) onChange(e.target.value);
  };

  const hours = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  return (
    <div className="relative">
      {label && (
        <label htmlFor={id} className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
          {label} {required && <span className="text-red-500">*</span>}
        </label>
      )}

      <Popover.Root open={isOpen && !locked} onOpenChange={(open) => !locked && setIsOpen(open)}>
        <Popover.Trigger asChild>
          <div className="relative">
            <Input
              id={id}
              type="text"
              value={allowManualInput ? value : displayValue}
              placeholder={placeholder}
              readOnly={!allowManualInput || locked}
              disabled={locked}
              required={required}
              className={`pr-9 text-xs ${className || 'h-10'} border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all rounded-md shadow-xs ${
                locked ? 'opacity-60 cursor-not-allowed bg-slate-50 dark:bg-slate-800' : ''
              }`}
              onClick={(e) => {
                if (locked) return;
                if (!allowManualInput) {
                  e.preventDefault();
                  setIsOpen(true);
                }
              }}
              onChange={handleManualInputChange}
            />
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none text-slate-400 dark:text-slate-500">
              {locked ? (
                <Lock className="h-3.5 w-3.5" />
              ) : (
                <>
                  {includeTime && <Clock className="h-3.5 w-3.5" />}
                  <CalendarIcon className="h-4 w-4" />
                </>
              )}
            </div>
          </div>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            className="z-[9999] bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-800 w-[270px] p-0 animate-in fade-in-50 zoom-in-95 duration-150"
            sideOffset={6}
            align="start"
          >
            {pickerMode === 'date' ? (
              <>
                {/* Header */}
                <div className="px-3 py-2.5 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800/80 rounded-t-xl">
                  <div className="flex items-center justify-between">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={goToPreviousMonth}
                      className="h-7 w-7 p-0 text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 rounded-md"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>

                    <div className="flex items-center gap-1 relative">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800"
                        onClick={() => { setShowMonthDropdown(!showMonthDropdown); setShowYearDropdown(false); }}
                      >
                        {format(currentMonth, 'MMM')}
                        <ChevronDown className="ml-1 h-3 w-3 text-slate-400" />
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800"
                        onClick={() => { setShowYearDropdown(!showYearDropdown); setShowMonthDropdown(false); }}
                      >
                        {getYear(currentMonth)}
                        <ChevronDown className="ml-1 h-3 w-3 text-slate-400" />
                      </Button>

                      {/* Month Dropdown */}
                      {showMonthDropdown && (
                        <div className="absolute top-full mt-1 left-0 bg-white dark:bg-slate-900 rounded-lg shadow-md border border-slate-200 dark:border-slate-800 w-32 z-[10000] py-1 animate-in fade-in-50 duration-100">
                          <div className="max-h-48 overflow-y-auto scrollbar-thin" data-lenis-prevent>
                            {monthNames.map((month, index) => (
                              <button
                                key={month}
                                type="button"
                                className={`block w-full text-left px-3 py-1.5 text-xs transition-colors ${
                                  index === currentMonth.getMonth()
                                    ? 'bg-slate-900 text-white font-medium dark:bg-slate-100 dark:text-slate-900'
                                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                                }`}
                                onClick={() => handleMonthChange(index)}
                              >
                                {month}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Year Dropdown */}
                      {showYearDropdown && (
                        <div className="absolute top-full mt-1 right-0 bg-white dark:bg-slate-900 rounded-lg shadow-md border border-slate-200 dark:border-slate-800 w-24 z-[10000] py-1 animate-in fade-in-50 duration-100">
                          <div className="max-h-48 overflow-y-auto scrollbar-thin" data-lenis-prevent>
                            {generateYearOptions().map((year) => (
                              <button
                                key={year}
                                type="button"
                                className={`block w-full text-left px-3 py-1.5 text-xs transition-colors ${
                                  year === getYear(currentMonth)
                                    ? 'bg-slate-900 text-white font-medium dark:bg-slate-100 dark:text-slate-900'
                                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                                }`}
                                onClick={() => handleYearChange(year)}
                              >
                                {year}
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
                      className="h-7 w-7 p-0 text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 rounded-md"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Calendar Grid */}
                <div className="p-3">
                  <div className="grid grid-cols-7 gap-1 mb-1.5 text-center">
                    {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
                      <div key={day} className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider py-0.5">{day}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {getCalendarDays().map((day, index) => {
                      const isCurrentMonth = isSameMonth(day, currentMonth);
                      const isSelected = selectedDate && isSameDay(day, selectedDate);
                      const { eligible } = checkEligibility(day);
                      const isToday = isSameDay(day, new Date());
                      return (
                        <button
                          key={index}
                          type="button"
                          className={`h-7 w-7 flex items-center justify-center text-xs font-medium rounded-md transition-all ${
                            !isCurrentMonth
                              ? 'text-slate-300 dark:text-slate-600'
                              : isSelected
                              ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold shadow-xs'
                              : eligible
                              ? 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                              : 'text-slate-300 dark:text-slate-600 bg-slate-50 dark:bg-slate-800/30 cursor-not-allowed line-through opacity-40'
                          } ${isToday && !isSelected ? 'ring-1 ring-slate-400 dark:ring-slate-500' : ''}`}
                          onClick={() => handleDateSelect(day)}
                        >
                          {day.getDate()}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Footer Buttons */}
                <div className="flex justify-between items-center gap-2 p-2.5 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50 rounded-b-xl">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => { onChange(''); setIsOpen(false); }}
                    className="h-7 px-3 text-[11px] font-medium text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 flex-1 rounded-md"
                  >
                    Clear
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      const today = new Date();
                      handleDateSelect(today);
                    }}
                    className="h-7 px-3 text-[11px] font-medium bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:hover:bg-white dark:text-slate-900 flex-1 rounded-md transition-colors"
                  >
                    Today
                  </Button>
                </div>
              </>
            ) : (
              <>
                {/* Time Selection */}
                <div className="p-3">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">Select Time</span>
                    <button
                      type="button"
                      onClick={() => setPickerMode('date')}
                      className="text-[11px] font-medium text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                    >
                      ← Back
                    </button>
                  </div>

                  {/* Time Display */}
                  <div className="flex items-center justify-center gap-3 py-2 my-1 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-100 dark:border-slate-800">
                    <div className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                      {selectedHour}:{selectedMinute.toString().padStart(2, '0')}
                    </div>
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => setIsPM(false)}
                        className={`px-2 py-0.5 text-[10px] font-semibold rounded transition-colors ${
                          !isPM ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-500 hover:bg-slate-200/50 dark:hover:bg-slate-700'
                        }`}
                      >
                        AM
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsPM(true)}
                        className={`px-2 py-0.5 text-[10px] font-semibold rounded transition-colors ${
                          isPM ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-500 hover:bg-slate-200/50 dark:hover:bg-slate-700'
                        }`}
                      >
                        PM
                      </button>
                    </div>
                  </div>

                  {/* Hour / Minute Lists */}
                  <div className="flex gap-2 mt-3">
                    <div className="flex-1">
                      <div className="text-[10px] font-medium text-slate-400 uppercase text-center mb-1">Hour</div>
                      <div className="h-32 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-1" data-lenis-prevent>
                        {hours.map((hour) => (
                          <button
                            key={hour}
                            type="button"
                            onClick={() => setSelectedHour(hour)}
                            className={`w-full py-1 text-xs transition-colors ${
                              selectedHour === hour
                                ? 'bg-slate-900 text-white font-semibold dark:bg-slate-100 dark:text-slate-900'
                                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                          >
                            {hour}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="text-[10px] font-medium text-slate-400 uppercase text-center mb-1">Min</div>
                      <div className="h-32 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-1" data-lenis-prevent>
                        {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((minute) => (
                          <button
                            key={minute}
                            type="button"
                            onClick={() => setSelectedMinute(minute)}
                            className={`w-full py-1 text-xs transition-colors ${
                              selectedMinute === minute
                                ? 'bg-slate-900 text-white font-semibold dark:bg-slate-100 dark:text-slate-900'
                                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                          >
                            {minute.toString().padStart(2, '0')}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Confirm Button */}
                <div className="p-2.5 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50 rounded-b-xl">
                  <Button
                    type="button"
                    onClick={handleTimeConfirm}
                    className="w-full h-8 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:hover:bg-white dark:text-slate-900 rounded-md transition-colors shadow-xs"
                  >
                    <Clock className="h-3.5 w-3.5 mr-1.5" />
                    Confirm {selectedHour}:{selectedMinute.toString().padStart(2, '0')} {isPM ? 'PM' : 'AM'}
                  </Button>
                </div>
              </>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
