import { Card,CardContent } from '@/components/ui/card';

interface ContentBlock {
  type: string;
  text?: string;
  items?: string[];
}

interface StaticPageContent {
  title: string;
  last_updated?: string;
  content: ContentBlock[];
}

interface StaticPageRendererProps {
  data: StaticPageContent;
}

export default function StaticPageRenderer({ data }: StaticPageRendererProps) {
  const renderContent = (block: ContentBlock, index: number) => {
    switch (block.type) {
      case 'h1':
        return (
          <h1 key={index} className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
            {block.text || ''}
          </h1>
        );
      
      case 'h2':
        return (
          <h2 key={index} className="text-2xl font-semibold text-gray-800 dark:text-gray-200 mt-8 mb-3">
            {block.text || ''}
          </h2>
        );
      
      case 'h3':
        return (
          <h3 key={index} className="text-xl font-semibold text-gray-700 dark:text-gray-300 mt-6 mb-2">
            {block.text || ''}
          </h3>
        );
      
      case 'p':
        return (
          <p key={index} className="text-gray-600 dark:text-gray-400 mb-4 leading-relaxed">
            {block.text || ''}
          </p>
        );
      
      case 'ul':
        return (
          <ul key={index} className="list-disc list-inside text-gray-600 dark:text-gray-400 mb-4 space-y-2">
            {block.items?.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        );
      
      case 'ol':
        return (
          <ol key={index} className="list-decimal list-inside text-gray-600 dark:text-gray-400 mb-4 space-y-2">
            {block.items?.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ol>
        );
      
      default:
        return null;
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
          {data.title}
        </h1>
        {data.last_updated && (
          <p className="text-sm text-gray-500">
            Last updated: {new Date(data.last_updated).toLocaleDateString()}
          </p>
        )}
      </div>

      <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
        <CardContent className="pt-6">
          <div className="prose dark:prose-invert max-w-none">
            {data.content.map((block, index) => renderContent(block, index))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

