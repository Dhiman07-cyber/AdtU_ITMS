import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import * as Popover from '@radix-ui/react-popover';
import { addDays,addMonths,endOfMonth,format,getYear,isAfter,isBefore,isSameDay,isSameMonth,setMonth,setYear,startOfMonth,subDays,subMonths } from 'date-fns';
import { eachDayOfInterval } from 'date-fns/eachDayOfInterval';
import { parseISO } from 'date-fns/parseISO';
import { Calendar,ChevronDown,ChevronLeft,ChevronRight,Clock,Lock } from 'lucide-react';
import React,{ useEffect,useState } from 'react';

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

  // Parse min and max dates
  const minDateObj = minDate ? (minDate.includes('T') ? parseISO(minDate.split('T')[0]) : parseISO(minDate)) : undefined;
  const maxDateObj = maxDate ? (maxDate.includes('T') ? parseISO(maxDate.split('T')[0]) : parseISO(maxDate)) : undefined;

  // For the actual selected date (no time component for calendar display)
  const selectedDateStr = value ? (value.includes('T') ? value.split('T')[0] : value) : '';
  const selectedDate = selectedDateStr ? parseISO(selectedDateStr) : undefined;

  // Sync currentMonth with selectedDate when it changes or when picker opens
  useEffect(() => {
    if (selectedDate && !isNaN(selectedDate.getTime())) {
      setCurrentMonth(selectedDate);
    }
  }, [selectedDateStr, isOpen]);

  // Sync time from value
  useEffect(() => {
    if (value && value.includes('T')) {
      const timePart = value.split('T')[1].slice(0, 5);
      const [h, m] = timePart.split(':').map(Number);
      setSelectedHour(h > 12 ? h - 12 : h === 0 ? 12 : h);
      setSelectedMinute(m);
      setIsPM(h >= 12);
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
    const years = [];
    // Include future years
    for (let year = currentYear + 5; year >= 1920; year--) {
      years.push(year);
    }
    return years;
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const validateAge = (date: Date): boolean => {
    switch (validationType) {
      case 'dob-student': return calculateAge(date) >= 12;
      case 'dob-driver':
      case 'dob-moderator': return calculateAge(date) >= 19;
      case 'joining': return true;
      default: return true;
    }
  };

  const calculateAge = (birthDate: Date): number => {
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  const handleDateSelect = (date: Date) => {
    if (minDateObj && isBefore(date, minDateObj)) return;
    if (maxDateObj && isAfter(date, maxDateObj)) return;

    if (!validateAge(date)) {
      const age = calculateAge(date);
      let message = '';
      
      const isFutureDate = age < 0;

      switch (validationType) {
        case 'dob-student': 
          message = isFutureDate 
            ? "Birth date cannot be in the future. Students must be at least 12 years old."
            : `Students must be at least 12 years old. The selected date would make you ${age} years old.`; 
          break;
        case 'dob-driver':
        case 'dob-moderator': 
          message = isFutureDate
            ? "Birth date cannot be in the future. Staff must be at least 19 years old."
            : `Must be at least 19 years old. The selected date would make you ${age} years old.`; 
          break;
        default: message = 'This date is not selectable.';
      }
      if (onValidationError) onValidationError(message);
      return;
    }

    const dateStr = format(date, 'yyyy-MM-dd');

    if (includeTime) {
      // Store date temporarily and switch to time picker
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
    const prevMonthDays: Date[] = [];
    for (let i = startDay; i > 0; i--) { prevMonthDays.push(subDays(start, i)); }
    const nextMonthDays: Date[] = [];
    const daysNeeded = 42 - (prevMonthDays.length + daysInMonth.length);
    for (let i = 1; i <= daysNeeded; i++) { nextMonthDays.push(addDays(end, i)); }
    return [...prevMonthDays, ...daysInMonth, ...nextMonthDays];
  };

  const isDateSelectable = (date: Date) => {
    if (minDateObj && isBefore(date, minDateObj)) return false;
    if (maxDateObj && isAfter(date, maxDateObj)) return false;
    if (validationType === 'dob-student') return true;
    if (!validateAge(date)) return false;
    return true;
  };

  const displayValue = selectedDate && !isNaN(selectedDate.getTime())
    ? (includeTime && value.includes('T')
      ? format(selectedDate, 'MMMM do, yyyy') + ' ' + formatTime(value.split('T')[1].slice(0, 5))
      : format(selectedDate, 'MMMM do, yyyy'))
    : '';

  function formatTime(time24: string): string {
    const [h, m] = time24.split(':').map(Number);
    const isPM = h >= 12;
    const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${h12}:${m.toString().padStart(2, '0')} ${isPM ? 'PM' : 'AM'}`;
  }

  const handleManualInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (allowManualInput) onChange(e.target.value);
  };

  // Hour options for scrollable picker
  const hours = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const minutes = Array.from({ length: 60 }, (_, i) => i);

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
              value={allowManualInput ? value : displayValue}
              placeholder={placeholder}
              readOnly={!allowManualInput}
              required={required}
              className={`pr-9 text-xs ${className || 'h-10'} border-gray-300 dark:border-gray-600 focus:border-indigo-500 focus:ring-indigo-500 transition-all duration-200 shadow-sm hover:shadow-md`}
              onClick={(e) => {
                if (!allowManualInput) {
                  e.preventDefault();
                  setIsOpen(true);
                }
              }}
              onChange={handleManualInputChange}
            />
            {!allowManualInput && (
              <div className="absolute right-2.5 top-1/2 transform -translate-y-1/2 flex items-center gap-1 pointer-events-none">
                {locked ? (
                  <Lock className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500 animate-pulse" />
                ) : (
                  <>
                    {includeTime && <Clock className="h-3.5 w-3.5 text-purple-500" />}
                    <Calendar className="h-4 w-4 text-indigo-500" />
                  </>
                )}
              </div>
            )}
          </div>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            className="z-[9999] bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 w-[280px] backdrop-blur-sm animate-in fade-in zoom-in-95 duration-200"
            sideOffset={4}
            align="start"
          >
            {pickerMode === 'date' ? (
              <>
                {/* Calendar Header */}
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

                    <div className="flex space-x-2 relative">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 px-3 text-xs font-semibold text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900"
                        onClick={() => { setShowMonthDropdown(!showMonthDropdown); setShowYearDropdown(false); }}
                      >
                        {format(currentMonth, 'MMMM')}
                        <ChevronDown className="ml-1.5 h-3 w-3" />
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 px-3 text-xs font-semibold text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900"
                        onClick={() => { setShowYearDropdown(!showYearDropdown); setShowMonthDropdown(false); }}
                      >
                        {getYear(currentMonth)}
                        <ChevronDown className="ml-1.5 h-3 w-3" />
                      </Button>

                      {/* Dropdowns */}
                      {showMonthDropdown && (
                        <div className="absolute top-full mt-1 left-0 bg-white dark:bg-gray-800 rounded-lg shadow-xl border-2 border-indigo-100 dark:border-indigo-900 w-36 z-[10000] animate-in fade-in slide-in-from-top-2 duration-150">
                          <div className="max-h-48 overflow-y-auto scrollbar-thin" data-lenis-prevent>
                            {monthNames.map((month, index) => (
                              <button
                                key={month}
                                type="button"
                                className={`block w-full text-left px-3 py-2 text-sm font-medium cursor-pointer hover:cursor-pointer ${index === currentMonth.getMonth() ? 'bg-indigo-600 text-white font-bold' : 'text-gray-700 dark:text-gray-300 hover:bg-indigo-50 dark:hover:bg-indigo-900'}`}
                                onClick={() => handleMonthChange(index)}
                              >
                                {month}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {showYearDropdown && (
                        <div className="absolute top-full mt-1 right-0 bg-white dark:bg-gray-800 rounded-lg shadow-xl border-2 border-indigo-100 dark:border-indigo-900 w-24 z-[10000] animate-in fade-in slide-in-from-top-2 duration-150">
                          <div className="max-h-48 overflow-y-auto scrollbar-thin" data-lenis-prevent>
                            {generateYearOptions().map((year) => (
                              <button
                                key={year}
                                type="button"
                                className={`block w-full text-left px-3 py-2 text-sm font-medium cursor-pointer hover:cursor-pointer ${year === getYear(currentMonth) ? 'bg-indigo-600 text-white font-bold' : 'text-gray-700 dark:text-gray-300 hover:bg-indigo-50 dark:hover:bg-indigo-900'}`}
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
                      const isSelected = selectedDate && isSameDay(day, selectedDate);
                      const isSelectable = isDateSelectable(day);
                      const isToday = isSameDay(day, new Date());
                      return (
                        <button
                          key={index}
                          type="button"
                          className={`h-6 w-6 flex items-center justify-center text-[10px] font-medium rounded transition-all ${!isCurrentMonth ? 'text-gray-300 dark:text-gray-600' :
                            isSelected ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow scale-105' :
                              'text-gray-700 dark:text-gray-300 hover:bg-indigo-50 dark:hover:bg-indigo-950'
                            } ${!isSelectable ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'} ${isToday && !isSelected ? 'ring-1 ring-indigo-400' : ''}`}
                          onClick={() => handleDateSelect(day)}
                          disabled={!isSelectable}
                        >
                          {day.getDate()}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Footer Buttons */}
                <div className="flex justify-between gap-2 px-2 pb-2 pt-1 border-t border-gray-100 dark:border-gray-700">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => { onChange(''); setIsOpen(false); }}
                    className="h-7 px-3 text-[10px] font-medium flex-1 rounded"
                  >
                    Clear
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const today = new Date();
                      if (isDateSelectable(today)) {
                        const dateStr = format(today, 'yyyy-MM-dd');
                        if (includeTime) {
                          setTempDate(dateStr);
                          setPickerMode('time');
                        } else {
                          onChange(dateStr);
                          setIsOpen(false);
                        }
                      }
                    }}
                    className="h-7 px-3 text-[10px] font-medium bg-gradient-to-r from-indigo-500 to-purple-600 text-white border-0 flex-1 rounded shadow-sm hover:shadow-md transition-all active:scale-[0.98]"
                  >
                    Today
                  </Button>
                </div>
              </>
            ) : (
              <>
                {/* Time Selection */}
                <div className="p-3">
                  {/* Time Display */}
                  <div className="flex items-center justify-center gap-2 mb-3">
                    <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                      {selectedHour}:{selectedMinute.toString().padStart(2, '0')}
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        onClick={() => setIsPM(false)}
                        className={`px-1.5 py-0.5 text-[9px] font-bold rounded transition-all ${!isPM ? 'bg-purple-500 text-white' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                      >
                        AM
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsPM(true)}
                        className={`px-1.5 py-0.5 text-[9px] font-bold rounded transition-all ${isPM ? 'bg-purple-500 text-white' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                      >
                        PM
                      </button>
                    </div>
                  </div>

                  {/* Hour / Minute Selectors */}
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <div className="text-[9px] font-bold text-purple-600 dark:text-purple-400 uppercase text-center mb-1">Hour</div>
                      <div className="h-36 overflow-y-auto rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900" data-lenis-prevent>
                        {hours.map((hour) => (
                          <button
                            key={hour}
                            type="button"
                            onClick={() => setSelectedHour(hour)}
                            className={`w-full py-1.5 text-xs font-medium transition-all ${selectedHour === hour
                              ? 'bg-purple-500 text-white'
                              : 'text-gray-700 dark:text-gray-300 hover:bg-purple-50 dark:hover:bg-purple-950'}`}
                          >
                            {hour}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="text-[9px] font-bold text-purple-600 dark:text-purple-400 uppercase text-center mb-1">Min</div>
                      <div className="h-36 overflow-y-auto rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900" data-lenis-prevent>
                        {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((minute) => (
                          <button
                            key={minute}
                            type="button"
                            onClick={() => setSelectedMinute(minute)}
                            className={`w-full py-1.5 text-xs font-medium transition-all ${selectedMinute === minute
                              ? 'bg-purple-500 text-white'
                              : 'text-gray-700 dark:text-gray-300 hover:bg-purple-50 dark:hover:bg-purple-950'}`}
                          >
                            {minute.toString().padStart(2, '0')}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Confirm Button */}
                <div className="px-3 pb-3">
                  <Button
                    type="button"
                    onClick={handleTimeConfirm}
                    className="w-full h-8 text-xs font-bold bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded shadow hover:shadow-md transition-all"
                  >
                    <Clock className="h-3 w-3 mr-1" />
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
