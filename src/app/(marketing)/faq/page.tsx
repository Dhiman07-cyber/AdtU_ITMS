import { FAQAccordion } from '@/components/FAQAccordion';
import faqData from '@/data/footer/faq.json';

export default function FAQPage() {
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
          {faqData.title}
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Find answers to commonly asked questions
        </p>
      </div>

      <FAQAccordion items={faqData.items} />
    </div>
  );
}




