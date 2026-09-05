'use client';

import { Button } from '@/components/ui/button';

export function CopyRulesButton({ content }: { content: string }) {
  const handleCopy = () => {
    if (content) {
      navigator.clipboard.writeText(content);
    }
  };

  return (
    <Button onClick={handleCopy}>
      Copy to Clipboard
    </Button>
  );
}
