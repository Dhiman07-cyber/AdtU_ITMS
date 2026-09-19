/**
 * Premium Export Button Component
 * Reusable export button with consistent styling
 */

import { Download } from 'lucide-react';
import { useState } from 'react';
import { ButtonLoader } from './LoadingSpinner';
import { Button } from './ui/button';

interface ExportButtonProps {
  onClick: () => Promise<void> | void;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export function ExportButton({ 
  onClick, 
  label = "Export", 
  disabled = false,
  className = ""
}: ExportButtonProps) {
  const [exporting, setExporting] = useState(false);

  const handleClick = async () => {
    setExporting(true);
    try {
      await onClick();
    } finally {
      setExporting(false);
    }
  };

  // If className is provided, use it completely; otherwise use defaults
  const buttonClassName = className ? className : "group h-8 px-3.5 bg-white/80 dark:bg-zinc-800/80 hover:bg-zinc-50 dark:hover:bg-zinc-700/80 text-zinc-700 dark:text-zinc-200 hover:text-blue-600 dark:hover:text-blue-400 border border-zinc-200 dark:border-zinc-700/60 shadow-xs text-xs font-semibold rounded-lg transition-all duration-200 active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer";

  return (
    <Button
      onClick={handleClick}
      disabled={disabled || exporting}
      variant="outline"
      className={buttonClassName}
    >
      {exporting ? (
        <ButtonLoader text="Exporting..." />
      ) : (
        <>
          <Download className="h-3.5 w-3.5 mr-1.5 text-zinc-500 dark:text-zinc-400 group-hover:text-blue-500" />
          <span>{label}</span>
        </>
      )}
    </Button>
  );
}

