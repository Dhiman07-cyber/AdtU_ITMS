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
  const buttonClassName = className ? className : `
    group h-8 px-4 bg-white hover:bg-gray-50 text-gray-600 hover:text-blue-600 border border-gray-200 hover:border-blue-200 shadow-sm hover:shadow-lg hover:shadow-blue-500/10 font-bold text-[10px] uppercase tracking-widest rounded-lg transition-all duration-300 active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer
  `;

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
          <Download className="h-4 w-4 mr-2" />
          {label}
        </>
      )}
    </Button>
  );
}

