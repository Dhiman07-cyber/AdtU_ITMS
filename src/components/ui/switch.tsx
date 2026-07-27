"use client"

import { cn } from "@/lib/utils";
import * as React from "react";

interface SwitchProps extends React.HTMLAttributes<HTMLButtonElement> {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    disabled?: boolean;
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
    ({ className, checked = false, onCheckedChange, disabled = false, ...props }, ref) => {
        const handleClick = () => {
            if (!disabled && onCheckedChange) {
                onCheckedChange(!checked);
            }
        };

        return (
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                disabled={disabled}
                onClick={handleClick}
                ref={ref}
                className={cn(
                    "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    checked
                        ? "bg-indigo-600 dark:bg-indigo-500"
                        : "bg-gray-200 dark:bg-gray-700",
                    className
                )}
                {...props}
            >
                <span
                    className={cn(
                        "pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform duration-200",
                        checked ? "translate-x-5" : "translate-x-0"
                    )}
                />
            </button>
        );
    }
);

Switch.displayName = "Switch";

export { Switch };
