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
    bg-white hover:bg-gray-100 !text-black border border-gray-300
    dark:bg-gray-800 dark:hover:bg-gray-700 dark:!text-white dark:border-gray-600
    rounded-lg px-6 py-2 shadow-md hover:shadow-lg 
    transition-all duration-200 transform hover:scale-[1.01] active:scale-[0.99]
    font-medium
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

