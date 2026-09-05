'use client';

import { Card, CardContent } from '@/components/ui/card';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

interface FAQItem {
  q: string;
  a: string;
}

export function FAQAccordion({ items }: { items: FAQItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      {items.map((item, index) => (
        <Card 
          key={index}
          className="cursor-pointer hover:border-gray-400 dark:hover:border-gray-600 transition-colors"
          onClick={() => setOpenIndex(openIndex === index ? null : index)}
        >
          <CardContent className="pt-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  {item.q}
                </h3>
                {openIndex === index && (
                  <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                    {item.a}
                  </p>
                )}
              </div>
              <ChevronDown 
                className={`h-5 w-5 text-gray-500 transition-transform ${
                  openIndex === index ? 'transform rotate-180' : ''
                }`}
              />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
