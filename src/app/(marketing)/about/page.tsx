import StaticPageRenderer from '@/components/StaticPageRenderer';
import aboutData from '@/data/footer/about.json';

export default function AboutPage() {
  return <StaticPageRenderer data={aboutData} />;
}


