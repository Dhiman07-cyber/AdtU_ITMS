"use client";

import { Button } from "@/components/ui/button";
import { APP_NAME } from '@/config/runtime';
import { useAuth } from '@/contexts/auth-context';
import { ArrowLeft,Bookmark,LayoutDashboard,Loader2,Zap } from 'lucide-react';
import Link from 'next/link';
import { useEffect,useState } from 'react';

interface TermsSection {
  id: string;
  title: string;
  content: string;
}

interface TermsConfig {
  title: string;
  sections: TermsSection[];
}

export default function TermsAndConditionsPage() {
  const { currentUser, userData, needsApplication } = useAuth();
  const appName = APP_NAME;
  const [config, setConfig] = useState<TermsConfig | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTerms = async () => {
      try {
        const response = await fetch('/api/settings/terms-config');
        if (response.ok) {
          const data = await response.json();
          setConfig(data.config);
          setUpdatedAt(data.updatedAt);
        }
      } catch (error) {
        console.error('Failed to load terms:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchTerms();
  }, []);

  if (loading) {
    return (
      <div className="flex-1 min-h-[calc(100dvh-120px)] flex items-center justify-center bg-[#08090C]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500/50" />
          <p className="text-slate-500 font-bold tracking-widest uppercase text-[10px] animate-pulse">Loading Policies</p>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex-1 min-h-[calc(100dvh-120px)] flex items-center justify-center bg-[#08090C]">
        <div className="text-center p-8 rounded-3xl bg-white/[0.02] border border-white/5 max-w-sm mx-6 backdrop-blur-2xl">
          <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <ArrowLeft className="text-red-500 h-6 w-6" />
          </div>
          <h2 className="text-xl font-bold text-slate-200 tracking-tight">Sync Failed</h2>
          <p className="text-slate-500 mt-2 leading-relaxed text-sm">
            Unable to retrieve policy documents.
          </p>
          <Button asChild className="mt-6 bg-slate-800 hover:bg-slate-700 text-white h-11 px-6 rounded-xl font-bold transition-all">
            <Link href="/">Back to Dashboard</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-[calc(100dvh-120px)] bg-[#08090C] text-slate-400 font-sans selection:bg-indigo-500/20">
      {/* Background Gradients - Subtle */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-0 left-0 w-[40%] h-[40%] bg-indigo-500/[0.04] rounded-full blur-[100px]" />
        <div className="absolute bottom-0 right-0 w-[40%] h-[40%] bg-blue-600/[0.04] rounded-full blur-[100px]" />
      </div>

      {/* Navigation Bar */}
      <nav className="sticky top-0 z-50 bg-[#08090C]/80 backdrop-blur-xl border-b border-white/[0.02]">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="h-8 w-8 rounded-lg bg-slate-800 flex items-center justify-center border border-white/5 group-hover:border-indigo-500/50 transition-all">
              <span className="text-indigo-400 font-bold text-lg">A</span>
            </div>
            <span className="font-bold text-lg tracking-tight text-slate-200 transition-colors">{appName}</span>
          </Link>

          <div className="flex items-center gap-2">
            {currentUser ? (
              <Button asChild variant="ghost" className="h-9 px-4 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold border border-white/5">
                <Link href={needsApplication ? "/apply/form" : (userData?.role ? `/${userData.role}` : "/")}>
                  <LayoutDashboard className="h-3.5 w-3.5 mr-2" />
                  Dashboard
                </Link>
              </Button>
            ) : (
              <>
                <Link href="/login">
                  <Button variant="ghost" className="h-9 text-xs text-slate-500 hover:text-slate-200 rounded-lg font-bold">
                    Login
                  </Button>
                </Link>
                <Link href="/login?tab=register">
                  <Button className="h-9 bg-indigo-600/80 hover:bg-indigo-600 text-white rounded-lg px-4 text-xs font-bold">
                    Register
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="relative z-10 max-w-5xl mx-auto px-6 md:py-15 animate-in fade-in slide-in-from-bottom-4 duration-700 mt-10 md:mt-15">
        {/* Header */}
        <div className="space-y-6">
          <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[10px] font-bold tracking-widest uppercase">
            <Bookmark className="h-3 w-3 fill-indigo-400" />
            System Policy {updatedAt && `• Updated ${updatedAt}`}
          </div>

          <h1 className="text-5xl md:text-7xl font-black tracking-tight leading-tight text-slate-200 mb-6 font-display">
            {config.title}
          </h1>

          <p className="text-lg md:text-xl text-slate-400 max-w-2xl leading-relaxed font-light mb-12">
            Institutional standards and operating procedures for the <span className="text-slate-200 font-medium">AdtU Smart Transport</span> ecosystem.
          </p>
        </div>

        {/* Sections */}
        <div className="space-y-24">
          {config.sections.map((section, index) => (
            <div key={index} className="relative group scroll-mt-24">
              <div className="flex flex-col md:flex-row gap-8 md:gap-16">
                {/* Index - Light Indigo Tint */}
                <div className="md:w-16 flex-shrink-0">
                  <div className="sticky top-24 flex flex-col">
                    <span className="text-5xl font-black text-indigo-400 select-none group-hover:text-indigo-300 transition-colors duration-500">
                      {(index + 1).toString().padStart(2, '0')}
                    </span>
                    <div className="h-1 w-8 bg-indigo-500/20 rounded-full mt-2" />
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 space-y-5">
                  <h2 className="text-2xl md:text-3xl font-bold text-slate-200 tracking-tight group-hover:text-indigo-200/80 transition-colors duration-300">
                    {section.title.replace(/^\d+\.\s*/, '')}
                  </h2>
                  <div className="text-base md:text-lg text-slate-300 leading-relaxed whitespace-pre-line font-light group-hover:text-white/90 transition-colors duration-300">
                    {section.content}
                  </div>
                </div>
              </div>

              {index < config.sections.length - 1 && (
                <div className="mt-24 h-px w-full bg-white/[0.03]" />
              )}
            </div>
          ))}
        </div>

        {/* CTA - Muted */}
        {!currentUser && (
          <div className="mt-40 rounded-3xl bg-white/[0.01] border border-white/[0.05] p-10 md:p-16 text-center relative overflow-hidden group">
            <div className="relative z-10 max-w-xl mx-auto">
              <div className="h-12 w-12 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto mb-8 border border-white/5">
                <Zap className="h-6 w-6 text-indigo-400 fill-indigo-400/20" />
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-slate-200 tracking-tight mb-6"> Ready to Begin? </h2>
              <p className="text-base text-slate-500 font-light mb-10 leading-relaxed">
                Join the official AdtU transport ecosystem today. Institutional grade security and efficiency at your fingertips.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button asChild className="h-12 px-8 rounded-xl bg-indigo-600/90 hover:bg-indigo-600 text-white font-bold transition-all">
                  <Link href="/login?tab=register">Register Now</Link>
                </Button>
                <Link href="/login" className="text-slate-600 hover:text-slate-400 font-medium text-sm transition-colors">
                  Existing User Login
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Footer - Subtle */}
        <div className="mt-40 pt-16 border-t border-white/[0.04] pb-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-10">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-slate-900 border border-white/5 flex items-center justify-center shadow-sm">
                <span className="text-indigo-400 text-lg font-black">A</span>
              </div>
              <div>
                <h3 className="font-bold text-xl text-slate-300 tracking-tight">{appName}</h3>
                <p className="text-slate-600 font-bold tracking-widest uppercase text-[8px]">Official Transport Portal</p>
              </div>
            </div>
          </div>

          <div className="text-left md:text-right space-y-4">
            <nav className="flex flex-wrap md:justify-end gap-6 text-[10px] font-bold text-slate-600 uppercase tracking-widest">
              <Link href="/" className="hover:text-slate-300">System</Link>
              <Link href="/terms-and-conditions" className="text-indigo-400 underline decoration-indigo-500/30 decoration-2 underline-offset-4">Policy</Link>
              <Link href="/login" className="hover:text-slate-300">Portal</Link>
            </nav>
            <p className="text-slate-600 text-xs font-medium">
              &copy; {new Date().getFullYear()} Assam down town University.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
