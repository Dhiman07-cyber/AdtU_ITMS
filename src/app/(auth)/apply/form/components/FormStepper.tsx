import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';
import { memo } from 'react';

export interface StepInfo {
  num: number;
  title: string;
}

interface FormStepperProps {
  steps: StepInfo[];
  currentStep: number;
  onStepClick: (step: number) => void;
  vertical?: boolean;
  isStepComplete?: (step: number) => boolean;
  completedSteps?: Readonly<Partial<Record<number, boolean>>>;
  visitedSteps?: number[];
}

function FormStepper({
  steps, 
  currentStep, 
  onStepClick, 
  vertical = false,
  isStepComplete = () => false,
  completedSteps,
  visitedSteps = []
}: FormStepperProps) {
  if (vertical) {
    return (
      <div className="w-full h-full flex flex-col pt-8">
        <div className="flex flex-col gap-12 relative">
          {/* Connecting lines container - Vertical */}
          <div className="absolute left-[20px] sm:left-[24px] top-0 bottom-0 w-0.5 z-0 bg-slate-800 rounded-full overflow-hidden">
            <div 
              className="w-full bg-emerald-500 transition-[height] duration-300 ease-out"
              style={{ height: `${((currentStep - 1) / (steps.length - 1)) * 100}%` }}
            />
          </div>

          {/* Steps */}
          {steps.map((step) => {
            const isFullyCompleted = completedSteps?.[step.num] ?? isStepComplete(step.num);
            const hasBeenVisited = visitedSteps.includes(step.num);
            const isActive = step.num === currentStep;
            
            // Backtrack logic: If the step is ahead of current and not complete, show as gray (default)
            // This 'resets' blue circles when you jump back to an earlier step
            const shouldShowAsVisited = hasBeenVisited;

            return (
              <div 
                key={step.num} 
                className="relative z-10 flex items-center gap-4 cursor-pointer group"
                onClick={() => onStepClick(step.num)}
              >
                {/* Circle container */}
                <div 
                  className={cn(
                    "w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-sm font-bold transition-[background-color,color,border-color,box-shadow,transform] duration-200 shadow-lg flex-shrink-0",
                    isFullyCompleted 
                      ? "bg-emerald-500 text-white hover:bg-emerald-600 scale-100 shadow-emerald-500/20" 
                      : isActive 
                        ? "bg-white text-slate-900 border-4 border-slate-900 ring-2 ring-indigo-500 ring-offset-2 ring-offset-slate-950 scale-105" 
                        : shouldShowAsVisited
                          ? "bg-indigo-600 text-white border border-indigo-400 hover:bg-indigo-500 shadow-indigo-500/10"
                          : "bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white"
                  )}
                >
                  {isFullyCompleted ? <Check className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={3} /> : step.num}
                </div>

                {/* Step Title and Status */}
                <div className="flex flex-col">
                  <span 
                    className={cn(
                      "text-[10px] sm:text-[11px] font-bold tracking-widest uppercase transition-colors duration-300",
                      isFullyCompleted ? "text-emerald-500/80" : isActive ? "text-indigo-400" : shouldShowAsVisited ? "text-indigo-300/60" : "text-slate-500"
                    )}
                  >
                    Step {step.num}
                  </span>
                  <span 
                    className={cn(
                      "text-xs sm:text-sm font-bold transition-colors duration-300 whitespace-nowrap",
                      isActive ? "text-white" : isFullyCompleted ? "text-slate-300" : shouldShowAsVisited ? "text-slate-400" : "text-slate-500 group-hover:text-slate-200"
                    )}
                  >
                    {step.title}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Default Horizontal Layout
  return (
    <div className="w-full max-w-4xl mx-auto mb-16 px-4 sm:px-8">
      <div className="flex items-center justify-between relative">
        {/* Connecting lines container */}
        <div className="absolute left-[5%] right-[5%] top-1/2 -translate-y-1/2 h-0.5 z-0 flex rounded-full overflow-hidden bg-slate-800">
          <div 
            className="h-full bg-emerald-500 transition-[width] duration-300 ease-out"
            style={{ width: `${((currentStep - 1) / (steps.length - 1)) * 100}%` }}
          />
        </div>

        {/* Steps */}
        {steps.map((step) => {
          const isFullyCompleted = completedSteps?.[step.num] ?? isStepComplete(step.num);
          const hasBeenVisited = visitedSteps.includes(step.num);
          const isActive = step.num === currentStep;

          // Backtrack logic: If the step is ahead of current and not complete, show as gray (default)
          // This 'resets' blue circles when you jump back to an earlier step
          const shouldShowAsVisited = hasBeenVisited;

          return (
            <div 
              key={step.num} 
              className="relative z-10 flex flex-col items-center gap-3 cursor-pointer group"
              onClick={() => onStepClick(step.num)}
            >
              {/* Circle container */}
              <div 
                className={cn(
                  "w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-sm font-bold transition-[background-color,color,border-color,box-shadow,transform] duration-200 shadow-lg",
                  isFullyCompleted 
                    ? "bg-emerald-500 text-white hover:bg-emerald-600 scale-100 shadow-emerald-500/20" 
                    : isActive 
                      ? "bg-white text-slate-900 border-4 border-slate-900 ring-2 ring-indigo-500 ring-offset-2 ring-offset-slate-950 scale-110" 
                      : shouldShowAsVisited
                        ? "bg-indigo-600 text-white border border-indigo-400 hover:bg-indigo-500 shadow-indigo-500/10"
                        : "bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white"
                )}
              >
                {isFullyCompleted ? <Check className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={3} /> : step.num}
              </div>

              {/* Step Title */}
              <div className={cn(
                "absolute -bottom-8 w-max text-center transition-opacity duration-200",
                !isActive && "hidden md:block"
              )}>
                <span 
                  className={cn(
                    "text-[10px] sm:text-[11px] font-bold tracking-wide transition-colors duration-300",
                    isFullyCompleted ? "text-emerald-500" : isActive ? "text-white" : shouldShowAsVisited ? "text-indigo-300/60" : "text-slate-500 group-hover:text-slate-300"
                  )}
                >
                  {step.title}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(FormStepper);
