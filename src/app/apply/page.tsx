"use client";

import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Shield,
  CreditCard,
  Clock,
  ArrowRight,
  Info,
  FileText,
  MapPin,
  GraduationCap,
  CheckCircle,
  Bus
} from 'lucide-react';
import Link from 'next/link';
import ApplyFormNavbar from '@/components/ApplyFormNavbar';
import { PremiumPageLoader } from '@/components/LoadingSpinner';
import Footer from '@/components/Footer';

export default function ApplyLandingPage() {
  const { currentUser, userData, loading } = useAuth();
  const router = useRouter();
  const [config, setConfig] = useState<any>(null);
  const [activeStep, setActiveStep] = useState(0);
  const mobileScrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Ref and state for Journey section scroll tracking
  const journeySectionRef = useRef<HTMLDivElement>(null);
  const [journeyProgress, setJourneyProgress] = useState(0);

  // Scroll visibility states
  const [thingsVisible, setThingsVisible] = useState(false);
  const thingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchConfig() {
      try {
        const res = await fetch('/api/settings/deadline-config');
        if (res.ok) {
          const data = await res.json();
          setConfig(data.config);
        }
      } catch (e) {
        console.error('Error fetching dynamic config:', e);
      }
    }
    fetchConfig();
  }, []);

  useEffect(() => {
    if (!loading) {
      if (userData && userData.role) {
        router.push(`/${userData.role}`);
      } else if (!currentUser) {
        router.push('/login');
      }
    }
  }, [loading, currentUser, userData, router]);

  // Toggle .no-global-scrollbar class on HTML element for Apply Landing page to prevent scrollbar track/gutter space
  useEffect(() => {
    document.documentElement.classList.add('no-global-scrollbar');
    return () => {
      document.documentElement.classList.remove('no-global-scrollbar');
    };
  }, []);

  // Combined scroll handler for the custom scrollable container
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const scrollTop = target.scrollTop;
    const clientHeight = target.clientHeight;

    // Calculate scroll progress for the Journey section
    if (journeySectionRef.current) {
      const section = journeySectionRef.current;
      const sectionTop = section.offsetTop;
      const sectionHeight = section.offsetHeight;
      const relativeScrollTop = scrollTop - sectionTop;
      const scrollable = sectionHeight - clientHeight;

      if (scrollable > 0 && relativeScrollTop >= 0) {
        const pct = Math.max(0, Math.min(1, relativeScrollTop / scrollable));

        // Only trigger continuous float state updates and step changes on desktop to avoid layout lag and mobile scroll glitches
        if (window.innerWidth >= 768) {
          setJourneyProgress(pct * 4);
          const stepIndex = Math.max(0, Math.min(4, Math.round(pct * 4)));
          setActiveStep((prev) => (prev !== stepIndex ? stepIndex : prev));
        }
      }
    }



    // Trigger reveal for Things You Should Know
    if (thingsRef.current) {
      const rect = thingsRef.current.getBoundingClientRect();
      if (rect.top < clientHeight * 0.9) {
        setThingsVisible(true);
      }
    }
  };

  const handleMobileScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const width = container.offsetWidth;
    const scrollLeft = container.scrollLeft;
    const index = Math.round(scrollLeft / width);
    if (index >= 0 && index < 5 && index !== activeStep) {
      setActiveStep(index);
    }
  };

  const selectMobileStep = (index: number) => {
    setActiveStep(index);
    const container = mobileScrollRef.current;
    if (container) {
      const children = container.children;
      if (children && children[index]) {
        children[index].scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'center'
        });
      }
    }
  };



  if (loading) {
    return <PremiumPageLoader fullScreen message="Loading your dashboard..." subMessage="Fetching your application status and account details..." />;
  }

  if (!currentUser) {
    return null;
  }

  const stepsData = [
    {
      num: "01",
      title: "Digital Registration",
      desc: "Submit your details and preferred route through our streamlined student portal.",
      icon: FileText,
      detailTitle: "Seamless Online Portal",
      detailDesc: "Register from anywhere in minutes. Simply select your route, specify your boarding point, and upload your payment details to start.",
      actions: ["Enter student enrollment details", "Select preferred bus route", "Specify closest boarding stop"],
      helpfulInfo: "Have your enrollment number and payment receipt details ready."
    },
    {
      num: "02",
      title: "Academic Verification",
      desc: "The system automatically verifies your enrollment status with the university registrar.",
      icon: Shield,
      detailTitle: "Automated Student Registry Match",
      detailDesc: "We instantly cross-reference your registration details with the official university student directory to confirm active enrollment status and department information.",
      actions: ["Validate student ID", "Verify active course registration", "Confirm department eligibility"],
      helpfulInfo: "Ensure your name and enrollment number match official records."
    },
    {
      num: "03",
      title: "Flexible Payments",
      desc: "Pay your bus fees online or offline without waiting in long queue counters.",
      icon: CreditCard,
      detailTitle: "Clearance of Dues",
      detailDesc: "Pay at your convenience using online bank transfers or offline deposits. Moderators review payment receipts within 24 to 48 hours for immediate clearance.",
      actions: ["Choose online or offline mode", "Submit payment transaction ID", "Get automatic fee clearance log"],
      helpfulInfo: "Verification is typically cleared within 24 to 48 hours."
    },
    {
      num: "04",
      title: "Route & Timing Setup",
      desc: "Live coordinate matching to align bus schedules with your lecture timings.",
      icon: Clock,
      detailTitle: "Intelligent Transit Assignment",
      detailDesc: "To ensure that you never miss your ride and get a guaranteed seat, the system maps your timetable to schedule alerts and optimize bus shifts.",
      actions: ["Verify seat allocation", "Check shuttle shift times", "Establish route coordinates"],
      helpfulInfo: "Routes are aligned with university timing and shifts."
    },
    {
      num: "05",
      title: "Digital Pass Activation",
      desc: "Your phone acts as your secure QR bus pass. Just scan and board instantly.",
      icon: CheckCircle,
      detailTitle: "Smart QR Boarding Pass",
      detailDesc: "No more worries about losing physical cards. Simply display the digital bus pass generated on your phone to scan and board smoothly.",
      actions: ["Generate secure QR code", "Activate pass on dashboard", "Ready for terminal scanning"],
      helpfulInfo: "Your digital pass is valid for the entire academic session."
    }
  ];

  const thingsData = [
    {
      title: "Pass Validity",
      desc: "Your digital pass remains active for your entire academic tenure. It is securely stored on your phone, so there is no danger of losing it.",
      svg: (
        <svg viewBox="0 0 100 100" className="w-12 h-12 text-[#3B82F6] transition-all duration-300">
          <rect x="15" y="25" width="70" height="60" rx="8" stroke="currentColor" strokeWidth="4" className="fill-none" />
          <line x1="15" y1="42" x2="85" y2="42" stroke="currentColor" strokeWidth="4" />
          <line x1="32" y1="18" x2="32" y2="30" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          <line x1="68" y1="18" x2="68" y2="30" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          <circle cx="35" cy="55" r="4" className="fill-[#3B82F6]" />
          <circle cx="50" cy="55" r="4" className="fill-[#3B82F6]" />
          <circle cx="65" cy="55" r="4" className="fill-[#3B82F6]" />
          <circle cx="35" cy="70" r="4" className="fill-[#3B82F6]" />
          <circle cx="50" cy="70" r="4" className="fill-[#3B82F6]/30" />
          <circle cx="65" cy="70" r="4" className="fill-[#3B82F6]/30" />
        </svg>
      )
    },
    {
      title: "Fast Verification",
      desc: "Once you submit your application, our moderators verify your online transactions or offline slips within 24 to 48 hours.",
      svg: (
        <svg viewBox="0 0 100 100" className="w-12 h-12 text-[#3B82F6] transition-all duration-300">
          <circle cx="50" cy="50" r="38" stroke="currentColor" strokeWidth="4" className="fill-none" />
          <path d="M 50 20 L 50 50 L 72 50" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="50" cy="50" r="4" className="fill-[#171C2B] stroke-[#3B82F6] stroke-[3]" />
        </svg>
      )
    },
    {
      title: "Easy Boarding",
      desc: "No physical cards needed. Simply display the digital pass QR code on your mobile screen when boarding the shuttle.",
      svg: (
        <svg viewBox="0 0 100 100" className="w-12 h-12 text-[#3DDC97] transition-all duration-300">
          <rect x="22" y="16" width="56" height="68" rx="6" stroke="currentColor" strokeWidth="4" className="fill-none" />
          <line x1="34" y1="32" x2="66" y2="32" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          <line x1="34" y1="46" x2="56" y2="46" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          <path d="M 34 65 L 44 72 L 66 52" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="stroke-[#3DDC97]" />
        </svg>
      )
    },
    {
      title: "Annual Renewal",
      desc: "Skip the counters. When a new semester or academic year starts, easily renew your pass directly through your online dashboard.",
      svg: (
        <svg viewBox="0 0 100 100" className="w-12 h-12 text-[#3B82F6] transition-all duration-300">
          <path d="M 50 18 A 32 32 0 0 1 80 58 L 88 58" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="fill-none" />
          <path d="M 80 44 L 80 58 L 66 58" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M 50 82 A 32 32 0 0 1 20 42 L 12 42" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="fill-none" />
          <path d="M 20 56 L 20 42 L 34 42" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    }
  ];

  const ActiveIcon = stepsData[activeStep]?.icon || FileText;

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="apply-landing-container h-screen overflow-y-auto snap-y snap-mandatory bg-[#0F1117] text-slate-200 font-sans selection:bg-[#6E7BFF]/20 selection:text-[#7F8CFF] overflow-x-hidden scroll-smooth scrollbar-none relative"
    >
      <style dangerouslySetInnerHTML={{
        __html: `
        @keyframes fadeInSlide {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-step-change {
          animation: fadeInSlide 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}} />

      <ApplyFormNavbar />

      {/* 1. HERO SECTION */}
      <section className="apply-snap-section relative h-screen snap-start snap-always flex items-center justify-center px-6 lg:px-8">
        {/* Background Image Container */}
        <div className="absolute inset-0 min-h-dvh md:min-h-0 z-0">
          {/* Main Hero Image */}
          <div
            className="absolute inset-0 w-full h-full min-h-dvh md:min-h-0 bg-cover bg-left md:bg-center bg-no-repeat"
            style={{
              backgroundImage: 'url(/apply/hero_new.webp)'
            }}
          />
          {/* Gradient Overlay */}
          <div className="absolute inset-0 w-full h-full min-h-dvh md:min-h-0 bg-gradient-to-b from-[#0F1117] via-[#0F1117]/30 to-[#0F1117]" />
        </div>

        <div className="max-w-7xl mx-auto flex flex-col items-center justify-center text-center relative z-10">
          <div className="max-w-3xl space-y-8 flex flex-col items-center">
            <div className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-full bg-[#3B82F6]/10 border border-[#3B82F6]/20 text-[#3B82F6] text-xs font-semibold shadow-sm w-fit transition-all duration-300 hover:border-[#3B82F6]/40">
              <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6] animate-pulse"></span>
              <span>Official Transit Portal</span>
            </div>

            <h1 className="text-4xl sm:text-5xl md:text-6xl font-black text-white leading-[1.1] tracking-tight">
              Campus Transportation <br />
              <span className="bg-gradient-to-r from-[#3B82F6] via-[#A855F7] to-[#EC4899] bg-clip-text text-transparent inline-block">
                Made Simpler
              </span>
            </h1>

            <p className="text-slate-300 text-base md:text-lg leading-relaxed max-w-xl font-medium">
              Experience a smarter, more organized campus commute. Access your digital bus pass, track bus activity in real-time, and manage your transport records from one student-friendly portal.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2 w-full max-w-xs sm:max-w-md mx-auto">
              <Link href="/apply/form" className="w-full sm:w-auto">
                <Button className="w-full bg-gradient-to-r from-[#3B82F6] to-[#4F46E5] hover:from-[#2563EB] hover:to-[#4338CA] text-white font-bold px-8 py-4 h-auto text-sm rounded-xl transition-all duration-300 ease-out hover:scale-[1.03] hover:-translate-y-0.5 active:scale-[0.98] active:translate-y-0 shadow-[0_4px_20px_rgba(59,130,246,0.3)] hover:shadow-[0_4px_25px_rgba(79,70,229,0.4)] whitespace-nowrap inline-flex items-center justify-center">
                  Start Application
                </Button>
              </Link>
              <Link href="/contact" className="w-full sm:w-auto">
                <Button variant="outline" className="w-full border-white/10 text-slate-300 hover:text-white hover:border-[#3B82F6]/50 hover:bg-gradient-to-r hover:from-[#3B82F6]/10 hover:to-[#4F46E5]/10 bg-transparent px-8 py-4 h-auto text-sm rounded-xl transition-all duration-300 ease-out hover:scale-[1.03] hover:-translate-y-0.5 active:scale-[0.98] active:translate-y-0 whitespace-nowrap inline-flex items-center justify-center">
                  Contact Support
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 3. SIGNATURE PROCESS JOURNEY SECTION */}
      <section
        ref={journeySectionRef}
        className="apply-journey-section relative h-screen md:h-[500vh] bg-[#0F1117] snap-start snap-always"
      >
        <div className="relative md:sticky md:top-0 h-full md:h-screen w-full flex items-center overflow-visible md:overflow-hidden z-10">
          {/* Background image that stays intact and moves slightly on scroll */}
          <div
            className="absolute inset-0 z-0 bg-[#0F1117] transition-transform duration-500 ease-out"
            style={{
              backgroundImage: 'linear-gradient(to bottom, #0F1117 0%, rgba(15, 17, 23, 0.4) 15%, rgba(15, 17, 23, 0.4) 85%, #0F1117 100%), url(/apply/image2.webp)',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              transform: `scale(1.05) translateY(${-(journeyProgress / 4) * 20}px)`
            }}
          />

          <div className="max-w-7xl mx-auto px-6 lg:px-8 w-full z-10 transform md:translate-y-8 translate-y-0">
            {/* Desktop Two-Column Layout */}
            <div className="hidden md:grid grid-cols-12 gap-12 items-center relative">
              {/* Left Column (Details of active step) */}
              <div className="col-span-6 pr-4">
                <div className="max-w-xl space-y-4 mb-8">
                  <span className="text-[10px] font-bold text-[#3B82F6] uppercase tracking-widest block font-mono">Operational Workflow</span>
                  <h2 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight">The Application Journey</h2>
                  <p className="text-slate-350 text-sm leading-relaxed font-medium">
                    Step-by-step review process from digital registration to final bus pass generation.
                  </p>
                </div>

                <div key={activeStep} className="animate-step-change space-y-5 bg-[#141824] border border-white/[0.08] p-6 rounded-3xl shadow-[inset_0_2px_4px_rgba(255,255,255,0.06),_inset_0_-2px_4px_rgba(0,0,0,0.4),_0_10px_40px_rgba(0,0,0,0.3)]">
                  <div className="flex items-center justify-between">
                    <span className="text-5xl font-black text-[#3B82F6]/15 font-mono">{stepsData[activeStep].num}</span>
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-r from-[#3B82F6]/10 to-[#4F46E5]/10 border border-[#3B82F6]/20 flex items-center justify-center text-[#3B82F6] shadow-sm">
                      <ActiveIcon className="h-6 w-6" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <span className="text-[10px] font-bold text-[#3B82F6] font-mono tracking-widest uppercase">Step Details</span>
                    <h3 className="text-xl font-black text-white">{stepsData[activeStep].title}</h3>
                    <p className="text-xs text-slate-400 leading-relaxed">{stepsData[activeStep].detailDesc}</p>
                  </div>

                  <div className="space-y-3 pt-2">
                    <span className="text-[10px] font-bold text-slate-500 font-mono tracking-widest uppercase block">Verification Checkpoints</span>
                    <div className="space-y-1.5">
                      {stepsData[activeStep].actions.map((act, i) => (
                        <div key={i} className="flex items-center space-x-2 text-xs text-slate-300 font-medium">
                          <div className="w-1.5 h-1.5 rounded-full bg-[#3B82F6]"></div>
                          <span>{act}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Progress indicator nodes */}
                <div className="flex items-center space-x-2 pt-6 mt-6 border-t border-white/6">
                  {stepsData.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        if (containerRef.current && journeySectionRef.current) {
                          const sectionTop = journeySectionRef.current.offsetTop;
                          const stepScrollTop = sectionTop + idx * containerRef.current.clientHeight;
                          containerRef.current.scrollTo({
                            top: stepScrollTop,
                            behavior: 'smooth'
                          });
                        }
                      }}
                      className={`h-1.5 rounded-full transition-all duration-300 ${activeStep === idx ? 'bg-gradient-to-r from-[#3B82F6] to-[#4F46E5] w-8' : 'bg-white/10 hover:bg-white/20 w-2.5'
                        }`}
                      aria-label={`Go to step ${idx + 1}`}
                    />
                  ))}
                </div>
              </div>

              {/* Right Column (Stacked Cards) */}
              <div className="col-span-6 relative h-[400px] flex items-center justify-center">
                {stepsData.map((step, idx) => {
                  const Icon = step.icon;
                  const isActive = activeStep === idx;

                  // Calculate dynamic transforms based on journeyProgress
                  const diff = idx - journeyProgress;
                  let transformStyle = '';
                  let opacityStyle = 0;
                  let zIndexStyle = 0;

                  if (diff <= -1) {
                    transformStyle = 'translateY(-120%) scale(0.9) rotate(-4deg)';
                    opacityStyle = 0;
                    zIndexStyle = 10;
                  } else if (diff < 0) {
                    const pct = -diff; // 0 to 1
                    transformStyle = `translateY(${-pct * 120}%) scale(${1 - pct * 0.1}) rotate(${-pct * 4}deg)`;
                    opacityStyle = 1 - pct;
                    zIndexStyle = 30;
                  } else if (diff >= 0 && diff < 1) {
                    const pct = diff; // 0 to 1
                    transformStyle = `translateY(${pct * 24}px) scale(${1 - pct * 0.05})`;
                    opacityStyle = 1;
                    zIndexStyle = 20;
                  } else if (diff >= 1 && diff < 2) {
                    const pct = diff - 1; // 0 to 1
                    transformStyle = `translateY(${24 + pct * 24}px) scale(${0.95 - pct * 0.05})`;
                    opacityStyle = 1;
                    zIndexStyle = 15;
                  } else {
                    transformStyle = 'translateY(48px) scale(0.9)';
                    opacityStyle = 0;
                    zIndexStyle = 5;
                  }

                  return (
                    <div
                      key={idx}
                      className="absolute w-full p-8 rounded-2xl border bg-[#171C2B] border-white/[0.08] shadow-[inset_0_2px_4px_rgba(255,255,255,0.06),_inset_0_-2px_4px_rgba(0,0,0,0.4),_0_15px_35px_rgba(0,0,0,0.3)] transition-all duration-300 ease-out"
                      style={{
                        transform: transformStyle,
                        opacity: opacityStyle,
                        zIndex: zIndexStyle,
                        pointerEvents: isActive ? 'auto' : 'none'
                      }}
                    >
                      <div className="space-y-4">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-bold text-slate-500 font-mono">STAGE 0{idx + 1} OF 05</span>
                          <div className={`p-2 rounded-xl border ${isActive ? 'bg-gradient-to-r from-[#3B82F6]/10 to-[#4F46E5]/10 border-[#3B82F6]/20 text-[#3B82F6]' : 'bg-[#1B2132] border-white/6 text-slate-400'}`}>
                            <Icon className="w-5 h-5" />
                          </div>
                        </div>
                        <h4 className="text-xl font-bold text-white">{step.title}</h4>
                        <p className="text-sm text-slate-400 leading-relaxed">{step.desc}</p>

                        <div className="pt-4 border-t border-white/6 flex items-center justify-between text-xs text-[#3B82F6] font-medium font-mono">
                          <span>{step.helpfulInfo}</span>
                          {isActive && (
                            <span className="flex h-2 w-2 relative">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#3B82F6] opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#3B82F6]"></span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Dedicated Mobile Stepper Carousel */}
            <div className="block md:hidden space-y-4">
              <div className="max-w-xl space-y-2 text-center px-4 mb-4">
                <span className="text-[10px] font-bold text-[#3B82F6] uppercase tracking-widest block font-mono">Operational Workflow</span>
                <h2 className="text-2xl font-extrabold text-white tracking-tight">The Application Journey</h2>
                <p className="text-slate-350 text-xs leading-relaxed">
                  Step-by-step review process from digital registration to final bus pass generation.
                </p>
              </div>

              {/* Step navigation nodes at top */}
              <div className="relative flex items-center justify-between px-4 max-w-sm mx-auto">
                <div className="absolute left-6 right-6 h-[2px] bg-white/10 top-1/2 -translate-y-1/2 z-0"></div>
                {stepsData.map((step, idx) => (
                  <button
                    key={idx}
                    onClick={() => selectMobileStep(idx)}
                    className={`w-9 h-9 rounded-full border flex items-center justify-center font-mono text-xs font-bold relative z-10 transition-all duration-300 ease-out active:scale-95 ${activeStep === idx
                      ? 'bg-gradient-to-r from-[#3B82F6] to-[#4F46E5] border-transparent text-white shadow-lg scale-110'
                      : 'bg-[#171C2B] border-white/6 text-slate-400 hover:border-white/20 hover:scale-105'
                      }`}
                  >
                    {idx + 1}
                  </button>
                ))}
              </div>

              {/* Horizontal Snap Scroll Container */}
              <div
                ref={mobileScrollRef}
                onScroll={handleMobileScroll}
                className="flex overflow-x-auto snap-x snap-mandatory no-scrollbar w-full py-4"
              >
                {stepsData.map((step, idx) => {
                  const Icon = step.icon;
                  return (
                    <div key={idx} className="w-full flex-shrink-0 snap-center px-4">
                      <div className="bg-[#171C2B] border border-white/[0.08] p-5 rounded-2xl shadow-[inset_0_2px_4px_rgba(255,255,255,0.06),_inset_0_-2px_4px_rgba(0,0,0,0.4),_0_10px_20px_rgba(0,0,0,0.3)] space-y-4">
                        <div className="flex justify-between items-center">
                          <div className="w-10 h-10 rounded-xl bg-[#1B2132] border border-white/6 flex items-center justify-center text-[#3B82F6]">
                            <Icon className="h-5 w-5" />
                          </div>
                          <span className="text-[10px] font-bold text-slate-500 font-mono">STEP 0{idx + 1} OF 05</span>
                        </div>

                        <div className="space-y-2">
                          <h4 className="text-lg font-black text-white">{step.title}</h4>
                          <p className="text-xs text-slate-400 leading-relaxed">{step.desc}</p>
                        </div>

                        <div className="pt-3 border-t border-white/6 space-y-2">
                          <span className="text-[9px] font-bold text-[#3B82F6] font-mono tracking-widest uppercase block">Verification Checkpoints</span>
                          <div className="space-y-1.5">
                            {step.actions.map((act, i) => (
                              <div key={i} className="flex items-center space-x-2 text-[11px] text-slate-300">
                                <div className="w-1 h-1 rounded-full bg-[#3B82F6]"></div>
                                <span>{act}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="bg-[#1B2132] p-3 rounded-lg border border-white/6 text-[10px] text-slate-400 font-medium leading-relaxed">
                          {step.helpfulInfo}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Snap Targets for Section Scroll Snapping */}
        <div className="absolute inset-0 pointer-events-none z-0 hidden md:block">
          <div className="h-screen snap-start snap-always" />
          <div className="h-screen snap-start snap-always" />
          <div className="h-screen snap-start snap-always" />
          <div className="h-screen snap-start snap-always" />
          <div className="h-screen snap-start snap-always" />
        </div>
      </section>

      {/* 4. THINGS YOU SHOULD KNOW */}
      <section
        className="apply-snap-section apply-things-section relative min-h-screen md:h-screen snap-start snap-always flex items-center justify-center px-6 lg:px-8 py-20 md:py-0"
        style={{
          backgroundImage: 'linear-gradient(to bottom, #0F1117 0%, rgba(15, 17, 23, 0.3) 15%, rgba(15, 17, 23, 0.3) 85%, #0F1117 100%), url(/apply/image3.webp)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat'
        }}
      >
        <div className="max-w-7xl mx-auto w-full space-y-12">
          <div className="text-center space-y-4 max-w-xl mx-auto">
            <span className="text-[10px] font-bold text-[#3B82F6] uppercase tracking-widest block font-mono">Terms & Policies</span>
            <h2 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight">Things You Should Know</h2>
            <p className="text-slate-330 text-sm leading-relaxed font-medium">
              Familiarize yourself with transit rules and schedules before starting your application.
            </p>
          </div>

          <div
            ref={thingsRef}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6"
          >
            {thingsData.map((topic, idx) => (
              <div
                key={idx}
                className={`p-6 rounded-2xl bg-[#141824] border border-white/[0.08] shadow-[inset_0_2px_4px_rgba(255,255,255,0.06),_inset_0_-2px_4px_rgba(0,0,0,0.4),_0_8px_30px_rgba(0,0,0,0.3)] space-y-4 transition-all duration-700 hover:border-[#3B82F6]/40 hover:-translate-y-1 hover:shadow-[inset_0_2px_4px_rgba(255,255,255,0.06),_inset_0_-2px_4px_rgba(0,0,0,0.4),_0_12px_30px_rgba(59,130,246,0.12)] group cursor-default ${thingsVisible
                  ? 'opacity-100 translate-y-0 scale-100'
                  : 'opacity-0 translate-y-8 scale-95'
                  }`}
                style={{ transitionDelay: `${idx * 150}ms` }}
              >
                <div className="w-12 h-12 rounded-xl bg-[#1B2132]/90 border border-white/6 flex items-center justify-center group-hover:scale-105 transition-transform duration-300">
                  {topic.svg}
                </div>
                <div className="space-y-2">
                  <h3 className="text-base font-bold text-white transition-colors duration-300 group-hover:text-[#3B82F6]">{topic.title}</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">{topic.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* 6. FOOTER */}
      <Footer className="relative z-10 snap-start snap-always !border-white/5 !bg-[#0F1117]" />
    </div>
  );
}
