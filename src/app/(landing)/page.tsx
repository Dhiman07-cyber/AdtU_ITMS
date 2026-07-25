"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/contexts/auth-context";
import { APP_NAME } from '@/config/runtime';
import {
  MapPin, Bell, Shield, Bus, Clock, GraduationCap, ArrowRight, Check,
  PlayCircle, Users, CheckCircle2, Navigation, FileText, UserCheck,
  ChevronLeft, ChevronRight
} from "lucide-react";
import Footer from "@/components/Footer";

function LandingVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const retryCountRef = useRef(0);
  const maxRetries = 3;

  // Fetch video URL from Supabase on mount and retry on error
  const fetchVideoUrl = async (retryCount = 0) => {
    try {
      setError(null);
      const response = await fetch('/api/landing-video', {
        cache: 'no-store' // Prevent caching issues during auth transitions
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.url) {
          setVideoUrl(data.url);
          retryCountRef.current = 0; // Reset retry count on success
        } else {
          throw new Error(data.error || 'Invalid video URL response');
        }
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error(`Failed to fetch video URL (attempt ${retryCount + 1}):`, error);

      // Retry logic for transient errors
      if (retryCount < maxRetries) {
        const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff
        setTimeout(() => fetchVideoUrl(retryCount + 1), delay);
      } else {
        setError('Unable to load video. Please refresh the page.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchVideoUrl();
  }, []);

  // Enhanced video error handling
  const handleVideoError = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const videoElement = e.currentTarget;
    let errorMessage = 'Video loading failed';

    if (videoElement.error) {
      switch (videoElement.error.code) {
        case videoElement.error.MEDIA_ERR_ABORTED:
          errorMessage = 'Video loading was aborted';
          break;
        case videoElement.error.MEDIA_ERR_NETWORK:
          errorMessage = 'Network error - video failed to load';
          break;
        case videoElement.error.MEDIA_ERR_DECODE:
          errorMessage = 'Video format or decoding error';
          break;
        case videoElement.error.MEDIA_ERR_SRC_NOT_SUPPORTED:
          errorMessage = 'Video format not supported';
          break;
        default:
          errorMessage = `Video error (code: ${videoElement.error.code})`;
      }
    }

    console.error('❌ Video loading error:', { error: e, videoUrl, errorMessage });

    if (retryCountRef.current < maxRetries) {
      console.log(`🔄 Retrying video load (attempt ${retryCountRef.current + 1})`);
      retryCountRef.current++;
      fetchVideoUrl(retryCountRef.current);
    } else {
      setError(`${errorMessage}. Please refresh the page.`);
    }
  };

  const handleVideoLoaded = () => {
    console.log('✅ Video loaded successfully:', videoUrl);
    setError(null);
    retryCountRef.current = 0; // Reset retry count on successful load
  };

  useEffect(() => {
    if (!videoUrl || isLoading || error) return;
    const interval = setInterval(() => {
      if (videoRef.current && videoRef.current.currentTime >= 187) {
        videoRef.current.currentTime = 0;
        videoRef.current.play().catch(err => console.log("Video play interrupted:", err));
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [videoUrl, isLoading, error]);

  return (
    <div className="relative w-full mx-auto">
      {/* Device wrapper / Card shell with uniform bezel around the video */}
      <div
        className="hero-video-card group relative w-full rounded-2xl overflow-hidden border border-white/10 bg-[#070d19] p-5 sm:p-6 transition-all duration-500 hover:scale-[1.002]"
        style={{
          boxShadow: '0 24px 56px -12px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.05)',
        }}
      >
        {/* Top Header outside the video frame, inside the bezel padding */}
        <div className="hero-video-top-bar absolute top-1.5 sm:top-2.5 left-5 sm:left-6 right-5 sm:right-6 flex items-center justify-between text-slate-400 select-none">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-bold text-slate-200 tracking-wider uppercase">Live Feed</span>
          </div>
          <span className="text-[9px] font-mono font-bold text-slate-400 tracking-wider bg-transparent">
            ADTU-SHUTTLE-STREAM
          </span>
        </div>

        {/* Video Area */}
        <div className="hero-video-card-inner relative w-full aspect-video bg-black/40 rounded-xl overflow-hidden border border-white/5 shadow-inner my-5 sm:my-4">
          {isLoading || !videoUrl ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-10 h-10 border-4 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6">
              <PlayCircle className="w-10 h-10 text-red-400 mb-2" />
              <p className="text-sm text-slate-300 mb-4">{error}</p>
              <button
                onClick={() => fetchVideoUrl()}
                className="px-4 py-2 bg-amber-500/20 border border-amber-500/30 rounded-lg text-amber-300 hover:bg-amber-500/30 transition-colors text-sm"
              >
                Retry
              </button>
            </div>
          ) : (
            <video
              ref={videoRef}
              src={videoUrl}
              autoPlay
              muted
              loop
              playsInline
              className="w-full h-full object-cover"
              onLoadedData={handleVideoLoaded}
              onError={handleVideoError}
              key={videoUrl}
            />
          )}

          {/* Bottom fade */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent pointer-events-none" />
          <div className="absolute inset-0 ring-1 ring-inset ring-white/[0.04] pointer-events-none" />
        </div>

        {/* Bottom tags bar outside the video frame, inside the bezel padding */}
        <div className="hero-video-bottom-bar absolute bottom-1.5 sm:bottom-2.5 left-5 sm:left-6 right-5 sm:right-6 flex items-center justify-between text-[9px] text-slate-400 select-none font-sans">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-slate-200 tracking-wide font-sans">Assam down town University</span>
          </div>
          <div className="flex items-center gap-1 bg-transparent text-teal-400">
            <Shield className="w-3 h-3" />
            <span className="font-bold tracking-wider uppercase">SSL Secured</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PremiumLanding() {
  const { currentUser, userData, loading, needsApplication } = useAuth();
  const appName = APP_NAME;
  const router = useRouter();
  const [landingConfig, setLandingConfig] = useState<any>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const busRef = useRef<HTMLDivElement>(null);
  const lastScrollTop = useRef(0);
  const trackerProgressRef = useRef<HTMLDivElement>(null);

  // References for Dice Sections DOM updates
  const section1Ref = useRef<HTMLDivElement>(null);
  const cube1Ref = useRef<HTMLDivElement>(null);
  const s1Text1Ref = useRef<HTMLDivElement>(null);
  const s1Text2Ref = useRef<HTMLDivElement>(null);
  const s1Dot1Ref = useRef<HTMLButtonElement>(null);
  const s1Dot2Ref = useRef<HTMLButtonElement>(null);

  const section2Ref = useRef<HTMLDivElement>(null);
  const cube2Ref = useRef<HTMLDivElement>(null);
  const s2Text1Ref = useRef<HTMLDivElement>(null);
  const s2Text2Ref = useRef<HTMLDivElement>(null);
  const s2Dot1Ref = useRef<HTMLButtonElement>(null);
  const s2Dot2Ref = useRef<HTMLButtonElement>(null);

  // Directly update DOM elements on scroll for high performance
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const scrollTop = target.scrollTop;
    const scrollHeight = target.scrollHeight;
    const clientHeight = target.clientHeight;

    const totalScrollable = scrollHeight - clientHeight;
    if (totalScrollable <= 0) return;

    const progress = scrollTop / totalScrollable;
    const down = scrollTop >= lastScrollTop.current;
    lastScrollTop.current = scrollTop;

    // Update Bottom Bar Bus Tracker Progress Line
    if (trackerProgressRef.current) {
      trackerProgressRef.current.style.width = `${progress * 100}%`;
    }

    // Update Bottom Bar Bus Tracker
    if (busRef.current) {
      // mathematically bounded bus movement (from 0 to 100% minus the bus width)
      busRef.current.style.left = `calc(${progress} * (100% - 24px))`;
      busRef.current.style.transform = `scaleX(${down ? 1 : -1})`;
    }

    // Update Dice Section 1 (Stages 1 and 2)
    if (section1Ref.current) {
      const rect = section1Ref.current.getBoundingClientRect();
      const sectionHeight = rect.height;
      const scrollable = sectionHeight - clientHeight;
      if (scrollable > 0) {
        const p = Math.max(0, Math.min(1, -rect.top / scrollable));

        // Cube: vertical roll rotation identical to Cube 2
        if (cube1Ref.current) {
          cube1Ref.current.style.transform = `rotateY(calc(-12deg + ${p} * 24deg)) rotateX(calc(-90deg + ${p} * 90deg))`;
        }
        // Stage 1 content cross-fade
        if (s1Text1Ref.current) {
          const op = Math.max(0, Math.min(1, 1 - p * 2.5));
          s1Text1Ref.current.style.opacity = op.toString();
          s1Text1Ref.current.style.transform = `translateY(${-p * 20}px)`;
          s1Text1Ref.current.style.pointerEvents = op < 0.1 ? 'none' : 'auto';
        }
        // Stage 2 content cross-fade
        if (s1Text2Ref.current) {
          const op = Math.max(0, Math.min(1, (p - 0.4) * 2.5));
          s1Text2Ref.current.style.opacity = op.toString();
          s1Text2Ref.current.style.transform = `translateY(${(1 - p) * 20}px)`;
          s1Text2Ref.current.style.pointerEvents = op < 0.1 ? 'none' : 'auto';
        }
        // Active dot adjustments
        if (s1Dot1Ref.current && s1Dot2Ref.current) {
          if (p < 0.5) {
            s1Dot1Ref.current.style.width = '40px';
            s1Dot1Ref.current.style.backgroundColor = '#f59e0b';
            s1Dot2Ref.current.style.width = '8px';
            s1Dot2Ref.current.style.backgroundColor = '#475569';
          } else {
            s1Dot1Ref.current.style.width = '8px';
            s1Dot1Ref.current.style.backgroundColor = '#475569';
            s1Dot2Ref.current.style.width = '40px';
            s1Dot2Ref.current.style.backgroundColor = '#f59e0b';
          }
        }
      }
    }

    // Update Dice Section 2 (Stages 3 and 4)
    if (section2Ref.current) {
      const rect = section2Ref.current.getBoundingClientRect();
      const sectionHeight = rect.height;
      const scrollable = sectionHeight - clientHeight;
      if (scrollable > 0) {
        const p = Math.max(0, Math.min(1, -rect.top / scrollable));

        // Cube vertical rotation (rotates top face to front face)
        if (cube2Ref.current) {
          cube2Ref.current.style.transform = `rotateY(calc(-12deg + ${p} * 24deg)) rotateX(calc(-90deg + ${p} * 90deg))`;
        }
        // Stage 3 content cross-fade
        if (s2Text1Ref.current) {
          const op = Math.max(0, Math.min(1, 1 - p * 2.5));
          s2Text1Ref.current.style.opacity = op.toString();
          s2Text1Ref.current.style.transform = `translateY(${-p * 20}px)`;
          s2Text1Ref.current.style.pointerEvents = op < 0.1 ? 'none' : 'auto';
        }
        // Stage 4 content cross-fade
        if (s2Text2Ref.current) {
          const op = Math.max(0, Math.min(1, (p - 0.4) * 2.5));
          s2Text2Ref.current.style.opacity = op.toString();
          s2Text2Ref.current.style.transform = `translateY(${(1 - p) * 20}px)`;
          s2Text2Ref.current.style.pointerEvents = op < 0.1 ? 'none' : 'auto';
        }
        // Active dot adjustments
        if (s2Dot1Ref.current && s2Dot2Ref.current) {
          if (p < 0.5) {
            s2Dot1Ref.current.style.width = '40px';
            s2Dot1Ref.current.style.backgroundColor = '#f59e0b';
            s2Dot2Ref.current.style.width = '8px';
            s2Dot2Ref.current.style.backgroundColor = '#475569';
          } else {
            s2Dot1Ref.current.style.width = '8px';
            s2Dot1Ref.current.style.backgroundColor = '#475569';
            s2Dot2Ref.current.style.width = '40px';
            s2Dot2Ref.current.style.backgroundColor = '#f59e0b';
          }
        }
      }
    }
  };

  const scrollToStage1 = (stage: number) => {
    if (section1Ref.current && containerRef.current) {
      const container = containerRef.current;
      const sectionTop = section1Ref.current.offsetTop;
      container.scrollTo({
        top: sectionTop + stage * window.innerHeight,
        behavior: 'smooth'
      });
    }
  };

  const scrollToStage2 = (stage: number) => {
    if (section2Ref.current && containerRef.current) {
      const container = containerRef.current;
      const sectionTop = section2Ref.current.offsetTop;
      container.scrollTo({
        top: sectionTop + stage * window.innerHeight,
        behavior: 'smooth'
      });
    }
  };

  // Scroll reveal with IntersectionObserver
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("reveal-active");
          }
        });
      },
      {
        threshold: 0.05,
        rootMargin: "0px 0px -50px 0px",
      }
    );

    const elements = document.querySelectorAll(".reveal-on-scroll");
    elements.forEach((el) => observer.observe(el));

    return () => {
      elements.forEach((el) => observer.unobserve(el));
    };
  }, []);

  // Fetch landing config
  useEffect(() => {
    fetch('/api/settings/landing-config')
      .then(res => {
        if (!res.ok) {
          throw new Error(`Failed to fetch landing config: ${res.status}`);
        }
        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          throw new TypeError("Response is not JSON");
        }
        return res.json();
      })
      .then(data => {
        if (data && data.success) setLandingConfig(data.config);
      })
      .catch(err => {
        console.warn('Landing config fetch error:', err.message || err);
      });
  }, []);

  // Redirect logic if already authenticated
  useEffect(() => {
    if (!loading && currentUser) {
      if (needsApplication) {
        console.log('🔄 Landing: Redirecting new user to application form');
        router.replace("/apply/form");
        return;
      }

      if (userData) {
        router.replace(`/${userData.role}`);
      }
    }
  }, [currentUser, userData, loading, needsApplication, router]);

  const handleSignIn = () => {
    router.push("/login");
  };

  // NOTE: We intentionally do NOT gate the public landing page behind auth `loading`.
  // Gating swapped a full-screen spinner for the entire page once auth resolved,
  // which was the single largest source of CLS (layout shift) and delayed LCP.
  // Anonymous visitors (the common case) now get an immediate first paint; the
  // redirect effect above still routes authenticated users to their dashboard.

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="h-dvh overflow-y-auto snap-y snap-mandatory bg-[#030a16] text-white overflow-x-hidden selection:bg-amber-500/30 selection:text-white scroll-smooth scrollbar-none relative"
    >
      {/* FIXED PAGE-WIDE BACKGROUND IMAGE */}
      <div className="fixed inset-0 z-0 pointer-events-none select-none">
        <Image
          src="/landing/hero.jpg"
          alt="ADTU Campus background"
          fill
          priority
          className="object-cover object-center opacity-90 pointer-events-none select-none"
        />
        {/* Soft atmospheric overlay — covers full width including right edge */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#030a16]/40 via-[#030a16]/70 to-[#030a16]" />
        <div className="absolute inset-0 bg-[#030a16]/20" />
      </div>


      {/* 1. HERO SECTION */}
      <section className="hero-section-container relative h-dvh snap-start snap-always flex items-center justify-center px-6 sm:px-12 lg:px-20 z-10 pt-14 pb-8 overflow-hidden bg-transparent">
        <div className="hero-grid-container relative max-w-[94rem] mx-auto w-full flex flex-col lg:grid lg:grid-cols-12 gap-6 lg:gap-10 items-center z-10 h-full justify-center lg:-translate-y-8">
          {/* Left Text */}
          <div className="hero-text-column order-2 lg:order-1 lg:col-span-5 space-y-4 lg:space-y-5 text-left pr-0 lg:pr-6">
            <div className="hidden lg:inline-flex items-center gap-2 px-3 py-1 bg-teal-500/10 border border-teal-500/20 text-teal-300 rounded-full text-[10px] md:text-xs font-bold tracking-wider uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
              Assam down town University
            </div>

            <h1 className="hero-heading text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight leading-[1.15] text-white">
              Track Your ADTU Bus{" "}
              <span className="bg-gradient-to-r from-amber-400 via-amber-300 to-teal-300 bg-clip-text text-transparent">
                Before You Leave Home
              </span>
            </h1>

            <p className="hero-description text-sm sm:text-base lg:text-lg text-slate-300 leading-relaxed max-w-xl font-medium">
              Experience a smarter, more organized campus commute. Access your digital bus pass, track bus activity, and manage your transport records from one student-friendly portal.
            </p>

            {/* CTAs */}
            <div className="hero-ctas flex flex-col sm:flex-row gap-3 pt-1">
              <button
                onClick={handleSignIn}
                className="px-5 py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-bold rounded-xl transition-all duration-300 hover:shadow-[0_0_20px_rgba(245,158,11,0.25)] hover:scale-[1.01] cursor-pointer text-center text-sm shadow-lg"
              >
                Sign In with Google
              </button>
              <a
                href="https://www.adtu.in"
                target="_blank"
                rel="noopener noreferrer"
                className="px-5 py-3 border border-white/15 text-slate-300 hover:text-white hover:border-white/30 font-semibold rounded-xl transition-all duration-300 text-center text-sm"
              >
                Know More
              </a>
            </div>

            {/* Trust points */}
            <div className="hero-trust-points grid grid-cols-3 gap-3 pt-4 border-t border-slate-800/40 max-w-lg">
              {[
                { label: "Live shuttle track" },
                { label: "Digital QR pass" },
                { label: "Receipt access" }
              ].map((item, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-teal-400 flex-shrink-0" />
                  <span className="text-[10px] sm:text-xs text-slate-400 font-semibold leading-snug">{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right Media Panel */}
          <div className="hero-video-wrapper order-1 lg:order-2 lg:col-span-7 w-full flex items-center justify-center">
            <div className="w-full">
              <LandingVideo />
            </div>
          </div>
        </div>
      </section>

      {/* 2. INTERACTIVE ROTATING DICE SECTIONS */}
      <InteractiveDiceSection1
        sectionRef={section1Ref}
        cubeRef={cube1Ref}
        text1Ref={s1Text1Ref}
        text2Ref={s1Text2Ref}
        dot1Ref={s1Dot1Ref}
        dot2Ref={s1Dot2Ref}
        scrollToStage={scrollToStage1}
      />

      <InteractiveDiceSection2
        sectionRef={section2Ref}
        cubeRef={cube2Ref}
        text1Ref={s2Text1Ref}
        text2Ref={s2Text2Ref}
        dot1Ref={s2Dot1Ref}
        dot2Ref={s2Dot2Ref}
        scrollToStage={scrollToStage2}
      />

      {/* 3. LEARNING & COMMUTING CAROUSEL */}
      <LearningCarousel />

      {/* 4. REDESIGNED PORTAL ACCESS SECTION */}
      <section className="relative h-dvh snap-start snap-always flex items-center justify-center px-4 sm:px-6 lg:px-8 z-10 overflow-hidden">
        {/* Background image for final CTA */}
        <div className="absolute inset-0 z-0">
          <Image
            src="/landing/hero.jpg"
            alt="Portal access background"
            fill
            className="object-cover object-center opacity-85 select-none pointer-events-none"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#030a16]/60 via-[#030a16]/75 to-[#030a16]" />
          <div className="absolute inset-0 bg-[#030a16]/30" />
        </div>

        <div className="relative max-w-3xl mx-auto w-full z-10 reveal-on-scroll px-4">
          <div className="relative overflow-hidden bg-slate-950/90 sm:bg-slate-950/50 sm:backdrop-blur-xl border border-white/10 rounded-3xl p-8 md:p-12 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8)] text-center group">
            {/* Card inner background image */}
            <div className="absolute inset-0 z-0 select-none pointer-events-none">
              <Image
                src="/landing/hero.jpg"
                alt="Card inner background"
                fill
                className="object-cover object-center opacity-80 select-none pointer-events-none"
              />
              <div className="absolute inset-0 bg-slate-950/35" />
            </div>

            {/* Absolute internal soft glow */}
            <div className="hidden sm:block absolute -inset-24 rounded-full opacity-10 bg-radial-gradient from-teal-500 via-transparent to-transparent blur-3xl pointer-events-none group-hover:opacity-20 transition-opacity duration-1000" />

            <div className="relative z-10 space-y-5 max-w-xl mx-auto">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-teal-500/10 border border-teal-500/20 text-teal-400 rounded-full text-[10px] font-bold uppercase tracking-widest">
                <Shield className="w-3 h-3" /> Student Access Portal
              </span>

              <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
                Your Campus Transport, All in One Place
              </h2>

              <p className="text-slate-300 text-sm sm:text-base leading-relaxed font-medium">
                Sign in with your AdtU Google account to track your bus live, view your digital pass, manage your annual bus card renewal, and receive official dispatch alerts — all from one dashboard.
              </p>

              <div className="pt-3 flex flex-col sm:flex-row items-center justify-center gap-3 w-full max-w-md mx-auto">
                <button
                  onClick={handleSignIn}
                  className="w-full sm:w-auto px-5 py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-xl text-sm transition-all duration-300 flex items-center justify-center gap-2 shadow-sm hover:scale-[1.01] cursor-pointer"
                >
                  <span>Sign In with Google</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <a
                  href="https://www.adtu.in/admissions"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full sm:w-auto px-5 py-2.5 border border-white/10 bg-white/[0.02] text-slate-300 hover:text-white hover:bg-white/5 font-semibold rounded-xl text-sm transition-all duration-300 flex items-center justify-center text-center"
                >
                  Know about Admissions
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 9. FOOTER */}
      <Footer className="relative z-10 snap-start snap-always !border-white/5 !bg-[#030a16]" />

      {/* DYNAMIC ISLAND BUS TRACKER */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-lg h-14 bg-slate-950/95 sm:bg-slate-950/80 sm:backdrop-blur-md border border-white/10 rounded-full flex items-center px-6 justify-between shadow-2xl select-none pointer-events-auto">
        <div className="flex flex-col justify-center text-left">
          <span className="text-[11px] font-black tracking-widest text-slate-300">HOME</span>
          <span className="text-[7px] font-bold text-slate-500 tracking-wider leading-none uppercase">Start</span>
        </div>

        <div className="flex-1 mx-4 relative h-6 flex items-center">
          <div className="absolute left-0 right-0 h-0.5 bg-slate-800/80 rounded-full" />
          <div
            ref={trackerProgressRef}
            className="absolute left-0 h-0.5 bg-gradient-to-r from-amber-500 to-teal-400 rounded-full"
            style={{ width: '0%' }}
          />
          <div
            ref={busRef}
            className="absolute w-8 h-6 flex items-center justify-center"
            style={{
              left: '0px',
              transform: 'scaleX(1)',
              transition: 'left 150ms cubic-bezier(0.16, 1, 0.3, 1), transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)'
            }}
          >
            <Bus className="w-5 h-5 text-amber-400 drop-shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-amber-200 blur-[1px] opacity-80" />
          </div>
        </div>

        <div className="flex flex-col justify-center text-right">
          <span className="text-[11px] font-black tracking-widest text-teal-400">UNIVERSITY</span>
          <span className="text-[7px] font-bold text-slate-500 tracking-wider leading-none uppercase">AdtU Campus</span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// SUB-COMPONENTS
// ------------------------------------------------------------------------------------------------

interface InteractiveDiceSectionProps {
  sectionRef: React.RefObject<HTMLDivElement | null>;
  cubeRef: React.RefObject<HTMLDivElement | null>;
  text1Ref: React.RefObject<HTMLDivElement | null>;
  text2Ref: React.RefObject<HTMLDivElement | null>;
  dot1Ref: React.RefObject<HTMLButtonElement | null>;
  dot2Ref: React.RefObject<HTMLButtonElement | null>;
  scrollToStage: (stage: number) => void;
}

const DICE_STOPS = [
  { name: "Kerakuchi", routeNum: "6" },
  { name: "Lal Ganesh", routeNum: "5" },
  { name: "Paltan Bazar", routeNum: "4" },
  { name: "Guwahati Club", routeNum: "3" },
  { name: "Boragaon", routeNum: "2" },
];

function InteractiveDiceSection1({
  sectionRef,
  cubeRef,
  text1Ref,
  text2Ref,
  dot1Ref,
  dot2Ref,
  scrollToStage
}: InteractiveDiceSectionProps) {
  const [stopIdx, setStopIdx] = useState(0);
  const [prevStopIdx, setPrevStopIdx] = useState(DICE_STOPS.length - 1);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setPrevStopIdx(stopIdx);
      setStopIdx(prev => (prev + 1) % DICE_STOPS.length);
      setIsTransitioning(true);

      // Stop transitioning after animation duration (1200ms)
      setTimeout(() => {
        setIsTransitioning(false);
      }, 1200);
    }, 5000);
    return () => clearInterval(interval);
  }, [stopIdx]);

  const steps = [
    {
      title: "Real-Time Tracking & Preparation",
      subtitle: "Stage 01 • Start your day with confidence",
      desc: [
        "See your bus moving live on the map — know exactly where it is before you even step out.",
        "Check the real-time ETA so you reach your stop at just the right time, no guessing.",
      ],
      badge: "Real-time Fleet",
      badgeColor: "bg-teal-500/10 text-teal-400 border-teal-500/20",
    },
    {
      title: "Digital Integration & Commute Safety",
      subtitle: "Stage 02 • Seamless campus boarding",
      desc: ["Ditch physical passes and cash disputes. Display your verified digital QR bus pass on your device for immediate verification by drivers or coordinators upon boarding."],
      badge: "Smart Access",
      badgeColor: "bg-amber-500/10 text-amber-300 border-amber-500/20",
    },
  ];

  return (
    <div ref={sectionRef} className="relative w-full bg-transparent h-[200vh] border-t border-white/5">
      {/* Sticky Content Container */}
      <div className="sticky top-0 h-dvh w-full overflow-hidden z-10 flex items-center pt-12">
        {/* Background: solid base + image overlay to prevent edge bleed */}
        <div className="absolute inset-0 z-0 bg-[#030a16]">
          <Image
            src="/landing/adtu1.jpg"
            alt="ADTU real-time coordination background"
            fill
            className="object-cover object-right opacity-80 pointer-events-none select-none"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#030a16] via-[#030a16]/70 to-[#030a16]/20" />
        </div>

        <div className="relative max-w-[94rem] mx-auto px-5 sm:px-16 lg:px-24 w-full h-full flex flex-col md:flex-row items-center justify-start md:justify-between pt-2 sm:pt-6 md:pt-0 pb-16 sm:pb-24 md:pb-0 gap-8 sm:gap-10 md:gap-0 z-10">
          {/* Left Text Column */}
          <div className="w-full md:w-1/2 flex flex-col justify-start md:justify-center h-auto md:h-full relative pr-0 md:pr-12 order-2 md:order-1 mt-2 md:mt-0">
            <div className="relative h-[300px] sm:h-[320px] md:h-[450px] w-full flex items-center">

              {/* Stage 1 Content */}
              <div ref={text1Ref} className="absolute inset-x-0 space-y-4 md:space-y-6 text-left transition-all duration-75 pt-10">
                <span className="text-xs font-bold text-amber-400 tracking-widest uppercase block">
                  Platform Dynamics
                </span>
                <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white tracking-tight leading-tight">
                  Less guessing. <br />
                  <span className="bg-gradient-to-r from-amber-400 to-teal-400 bg-clip-text text-transparent">
                    More confidence.
                  </span>
                </h2>
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1 border rounded-full text-xs font-bold uppercase tracking-wider ${steps[0].badgeColor}`}>
                    {steps[0].badge}
                  </span>
                </div>
                <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight">{steps[0].title}</h3>
                <ul className="space-y-2 max-w-xl">
                  {(steps[0].desc as string[]).map((point, i) => (
                    <li key={i} className="flex items-start gap-2 text-slate-300 text-sm sm:text-base leading-relaxed font-medium">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-teal-400 flex-shrink-0" />
                      {point}
                    </li>
                  ))}
                </ul>
                <p className="text-xs font-bold text-slate-500 tracking-wider uppercase">
                  {steps[0].subtitle}
                </p>
              </div>

              {/* Stage 2 Content */}
              <div ref={text2Ref} className="absolute inset-x-0 space-y-4 md:space-y-6 text-left opacity-0 pointer-events-none transition-all duration-75 pt-10">
                <span className="text-xs font-bold text-amber-400 tracking-widest uppercase block">
                  Platform Dynamics
                </span>
                <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white tracking-tight leading-tight">
                  Less guessing. <br />
                  <span className="bg-gradient-to-r from-amber-400 to-teal-400 bg-clip-text text-transparent">
                    More confidence.
                  </span>
                </h2>
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1 border rounded-full text-xs font-bold uppercase tracking-wider ${steps[1].badgeColor}`}>
                    {steps[1].badge}
                  </span>
                </div>
                <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight">{steps[1].title}</h3>
                <p className="text-slate-300 text-sm sm:text-base leading-relaxed font-medium max-w-xl">
                  {(steps[1].desc as string[])[0]}
                </p>
                <p className="text-xs font-bold text-slate-500 tracking-wider uppercase">
                  {steps[1].subtitle}
                </p>
              </div>

            </div>

            {/* Dots */}
            <div className="hidden md:flex items-center gap-3 pt-3 md:pt-6 border-t border-white/5 max-w-md mt-3 md:mt-6 justify-center md:justify-start">
              <button
                ref={dot1Ref}
                onClick={() => scrollToStage(0)}
                className="relative h-2 rounded-full transition-all duration-300 w-10 bg-amber-400"
                aria-label="Go to stage 1"
              />
              <button
                ref={dot2Ref}
                onClick={() => scrollToStage(1)}
                className="relative h-2 rounded-full transition-all duration-300 w-2 bg-slate-700"
                aria-label="Go to stage 2"
              />
            </div>
          </div>

          {/* Right Cube Column */}
          <div className="w-full md:w-1/2 flex items-center justify-center p-1 sm:p-2 md:p-8 order-1 md:order-2">
            <div className="relative w-64 h-64 sm:w-72 sm:h-72 md:w-[22rem] md:h-[22rem] flex items-center justify-center [perspective:1200px] select-none">

              {/* Backlight Glow */}
              <div className="hidden sm:block absolute inset-0 rounded-full opacity-20 blur-3xl bg-radial-gradient from-amber-500/50 to-transparent pointer-events-none" />

              {/* 3D Cube */}
              <div
                ref={cubeRef}
                className="w-60 h-60 sm:w-60 sm:h-60 md:w-72 md:h-72 relative [transform-style:preserve-3d] will-change-transform"
                style={{
                  transform: 'rotateY(-12deg) rotateX(-90deg)',
                }}
              >
                {/* Face 1: Live Route Map (Top Face) */}
                <div
                  className="absolute inset-0 w-full h-full bg-[#040c1e]/95 border border-teal-500/20 rounded-2xl p-4 md:p-5 flex flex-col justify-between shadow-2xl [backface-visibility:hidden] [transform:rotateX(90deg)_translateZ(var(--cube-z,120px))]"
                  style={{
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 20px 40px rgba(0,0,0,0.6)'
                  }}
                >
                  <div className="flex justify-between items-center pb-2 border-b border-white/5">
                    <span className="text-[9px] md:text-[10px] font-mono text-teal-400 font-bold uppercase tracking-wider">Live Route Map</span>
                    <span className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-emerald-500 animate-pulse" />
                  </div>
                  <div className="flex-1 py-3 flex flex-col justify-center gap-2">
                    <div className="relative h-20 bg-slate-950/60 rounded-xl border border-white/5 p-2 flex flex-col justify-between overflow-hidden">
                      <div className="absolute top-1/2 left-4 right-4 h-0.5 bg-gradient-to-r from-teal-500/10 to-teal-500/80 -translate-y-1/2" />
                      <div className="flex justify-between relative z-10 text-[9px] font-semibold items-center">
                        {/* Two stops rendered simultaneously during transition */}
                        <div className="relative h-4 flex-1 overflow-hidden text-left">
                          {isTransitioning && (
                            <span
                              key={`out-name-${prevStopIdx}`}
                              className="absolute inset-0 text-slate-300 font-semibold animate-stop-slide-out"
                            >
                              {DICE_STOPS[prevStopIdx].name}
                            </span>
                          )}
                          <span
                            key={`in-name-${stopIdx}`}
                            className="absolute inset-0 text-slate-300 font-semibold animate-stop-slide-in"
                          >
                            {DICE_STOPS[stopIdx].name}
                          </span>
                        </div>
                        <span className="text-teal-300 font-semibold flex-shrink-0 ml-2">Campus</span>
                      </div>
                      <div className="flex justify-between items-center text-[9px] z-10 text-slate-300">
                        <div className="relative h-4 flex-1 overflow-hidden text-left">
                          {isTransitioning && (
                            <span
                              key={`out-route-${prevStopIdx}`}
                              className="absolute inset-0 font-mono text-teal-400 animate-stop-slide-out"
                            >
                              Route-{DICE_STOPS[prevStopIdx].routeNum}
                              <span className="text-teal-400/80"> • Active</span>
                            </span>
                          )}
                          <span
                            key={`in-route-${stopIdx}`}
                            className="absolute inset-0 font-mono text-teal-400 animate-stop-slide-in"
                          >
                            Route-{DICE_STOPS[stopIdx].routeNum}
                            <span className="text-teal-400/80"> • Active</span>
                          </span>
                        </div>
                        <span className="px-1.5 py-0.5 bg-teal-500/10 rounded border border-teal-500/20 text-teal-400 flex-shrink-0 ml-2">ETA 8m</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] md:text-xs text-slate-300 font-medium">
                    <Navigation className="w-3.5 h-3.5 text-teal-400" />
                    <span>Track active shuttle coordinates</span>
                  </div>
                </div>

                {/* Face 2: Smart Access Pass (Front Face) */}
                <div
                  className="absolute inset-0 w-full h-full bg-[#040c1e]/95 border border-amber-500/20 rounded-2xl p-4 md:p-5 flex flex-col justify-between shadow-2xl [backface-visibility:hidden] [transform:rotateX(0deg)_translateZ(var(--cube-z,120px))]"
                  style={{
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 20px 40px rgba(0,0,0,0.6)'
                  }}
                >
                  <div className="flex justify-between items-center pb-2 border-b border-white/5">
                    <span className="text-[9px] md:text-[10px] font-mono text-amber-300 font-bold uppercase tracking-wider">Secure Pass</span>
                    <span className="px-1.5 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded text-[7px] md:text-[8px] font-bold text-amber-300 uppercase">Verified</span>
                  </div>
                  <div className="flex-1 py-3 flex flex-col items-center justify-center">
                    <div className="relative w-20 h-20 bg-slate-950/60 rounded-xl border border-white/5 flex items-center justify-center p-3 overflow-hidden">
                      {/* Scanning laser line */}
                      <div className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-amber-400 to-transparent shadow-[0_0_8px_rgba(245,158,11,0.8)] animate-laser z-20" />

                      {/* Mock QR Code SVG */}
                      <svg className="w-14 h-14 text-amber-400/80 z-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="6" height="6" rx="1" />
                        <rect x="3" y="15" width="6" height="6" rx="1" />
                        <rect x="15" y="3" width="6" height="6" rx="1" />
                        <rect x="5" y="5" width="2" height="2" fill="currentColor" stroke="none" />
                        <rect x="5" y="17" width="2" height="2" fill="currentColor" stroke="none" />
                        <rect x="17" y="5" width="2" height="2" fill="currentColor" stroke="none" />
                        <path d="M12 3h1m3 0h1M12 6h3m1 0h1m2 0h1M12 9h1m2 0h2m-5 3v1m0 2v1m3-3h1m2 0h1m-3 3h2m-6 3h1m2 0h3m-5 3h1m2 0h2" />
                      </svg>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] md:text-xs text-slate-300 font-medium">
                    <FileText className="w-3.5 h-3.5 text-amber-400" />
                    <span>Tap to scan and verify boarding</span>
                  </div>
                </div>

                {/* Decorative Bottom Face */}
                <div
                  className="absolute inset-0 w-full h-full bg-[#040c1e]/60 border border-white/5 rounded-2xl [backface-visibility:hidden] [transform:rotateX(-90deg)_translateZ(var(--cube-z,120px))]"
                  style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)' }}
                />
                {/* Decorative Left Face */}
                <div
                  className="absolute inset-0 w-full h-full bg-[#040c1e]/60 border border-white/5 rounded-2xl [backface-visibility:hidden] [transform:rotateY(-90deg)_translateZ(var(--cube-z,120px))]"
                  style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)' }}
                />
                {/* Decorative Right Face */}
                <div
                  className="absolute inset-0 w-full h-full bg-[#040c1e]/60 border border-white/5 rounded-2xl [backface-visibility:hidden] [transform:rotateY(90deg)_translateZ(var(--cube-z,120px))]"
                  style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)' }}
                />
                {/* Decorative Back Face */}
                <div
                  className="absolute inset-0 w-full h-full bg-[#040c1e]/60 border border-white/5 rounded-2xl [backface-visibility:hidden] [transform:rotateY(180deg)_translateZ(var(--cube-z,120px))]"
                  style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)' }}
                />

              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Snap Targets */}
      <div className="absolute inset-0 pointer-events-none z-0">
        <div className="h-dvh snap-start snap-always" />
        <div className="h-dvh snap-start snap-always" />
      </div>
    </div>
  );
}

function InteractiveDiceSection2({
  sectionRef,
  cubeRef,
  text1Ref,
  text2Ref,
  dot1Ref,
  dot2Ref,
  scrollToStage
}: InteractiveDiceSectionProps) {
  const steps = [
    {
      title: "Bus Card Renewal & Payment Logs",
      subtitle: "Stage 03 • Annual renewal, zero queues",
      desc: [
        "Renew your bus service online for the year — no more standing in long lines at the office.",
        "Payment is supported both online and offline. Track your renewal status — Approved, Pending, or Rejected — right from your portal.",
      ],
      badge: "Annual Renewal",
      badgeColor: "bg-teal-500/10 text-teal-400 border-teal-500/20",
    },
    {
      title: "Official Dispatch Notifications",
      subtitle: "Stage 04 • Be first to know, always",
      desc: [
        "Get official alerts the moment bus timings change — no confusion, no missed rides.",
        "Schedule or route changes? You’re notified instantly through the ITMS platform.",
      ],
      badge: "Live Alerts",
      badgeColor: "bg-amber-500/10 text-amber-300 border-amber-500/20",
    },
  ];

  return (
    <div ref={sectionRef} className="relative w-full bg-transparent h-[200vh] border-t border-white/5">
      {/* Sticky Content Container */}
      <div className="sticky top-0 h-dvh w-full overflow-hidden z-10 flex items-center pt-12">
        {/* Background: solid base + image overlay to prevent edge bleed */}
        <div className="absolute inset-0 z-0 bg-[#030a16]">
          <Image
            src="/landing/adtu2.jpg"
            alt="ADTU bus card renewal background"
            fill
            className="object-cover object-center opacity-75 pointer-events-none select-none"
          />
          <div className="absolute inset-0 bg-gradient-to-l from-[#030a16] via-[#030a16]/70 to-[#030a16]/20" />
        </div>

        <div className="relative max-w-[94rem] mx-auto px-5 sm:px-16 lg:px-24 w-full h-full flex flex-col md:flex-row items-center justify-start md:justify-between pt-2 sm:pt-6 md:pt-0 pb-16 sm:pb-24 md:pb-0 gap-8 sm:gap-10 md:gap-0 z-10">
          {/* Left Cube Column */}
          <div className="w-full md:w-1/2 flex items-center justify-center p-1 sm:p-2 md:p-8 order-1 md:order-1">
            <div className="relative w-64 h-64 sm:w-72 sm:h-72 md:w-[22rem] md:h-[22rem] flex items-center justify-center [perspective:1200px] select-none">

              {/* Backlight Glow */}
              <div className="hidden sm:block absolute inset-0 rounded-full opacity-20 blur-3xl bg-radial-gradient from-teal-500/50 to-transparent pointer-events-none" />

              {/* 3D Cube */}
              <div
                ref={cubeRef}
                className="w-60 h-60 sm:w-60 sm:h-60 md:w-72 md:h-72 relative [transform-style:preserve-3d] will-change-transform"
                style={{
                  transform: 'rotateY(-12deg) rotateX(-90deg)',
                }}
              >
                {/* Face 3: Commute History (Top Face) */}
                <div
                  className="absolute inset-0 w-full h-full bg-[#040c1e]/95 border border-indigo-500/20 rounded-2xl p-3 sm:p-4 md:p-5 flex flex-col justify-between shadow-2xl [backface-visibility:hidden] [transform:rotateX(90deg)_translateZ(var(--cube-z,120px))]"
                  style={{
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 20px 40px rgba(0,0,0,0.6)'
                  }}
                >
                  <div className="flex justify-between items-center pb-1.5 border-b border-white/5">
                    <span className="text-[9px] md:text-[10px] font-mono text-indigo-400 font-bold uppercase tracking-wider">Bus Card Renewal</span>
                    <span className="text-[8px] md:text-[9px] text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20 font-bold">Annual Pass</span>
                  </div>
                  {/* Mock Bus Pass Card */}
                  <div className="flex-1 my-2.5 p-3 rounded-xl bg-gradient-to-tr from-indigo-950/80 via-[#0a122c]/90 to-violet-950/60 border border-indigo-500/30 flex flex-col justify-between relative overflow-hidden shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),_0_8px_20px_rgba(0,0,0,0.4)] select-none">
                    {/* Metallic gold chip & logo */}
                    <div className="flex justify-between items-start">
                      <div className="w-8 h-6 rounded bg-gradient-to-br from-amber-300 via-amber-400 to-yellow-600 border border-amber-200/50 p-1 flex flex-wrap gap-0.5 opacity-90 shadow-sm">
                        <div className="w-[6px] h-[4px] border border-amber-900/30 rounded-xs" />
                        <div className="w-[6px] h-[4px] border border-amber-900/30 rounded-xs" />
                        <div className="w-[6px] h-[4px] border border-amber-900/30 rounded-xs" />
                        <div className="w-[6px] h-[4px] border border-amber-900/30 rounded-xs" />
                      </div>
                      <div className="flex flex-col items-end leading-none">
                        <span className="text-[9px] font-black tracking-wider text-indigo-300">ADTU ITMS</span>
                        <span className="text-[5px] text-slate-400 font-mono tracking-widest mt-0.5">TRANSIT SMART CARD</span>
                      </div>
                    </div>

                    {/* Card Number & Name */}
                    <div className="my-1 text-left">
                      <div className="text-[10px] font-mono text-indigo-200/80 tracking-widest font-semibold">
                        4902 • 1084 • 3920
                      </div>
                      <div className="text-[9px] font-bold text-slate-100 uppercase tracking-wider mt-0.5">
                        Student-X
                      </div>
                    </div>

                    {/* Footer / Valid / Status */}
                    <div className="flex justify-between items-center border-t border-white/5 pt-1.5 mt-0.5">
                      <div className="text-left leading-none">
                        <span className="text-[5px] text-slate-500 block">VALID THRU</span>
                        <span className="text-[7px] font-mono text-slate-300 font-bold">12 / 2026</span>
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-[7px] font-bold text-emerald-400 uppercase tracking-wider">
                        Active Pass
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] md:text-xs text-slate-300 font-medium">
                    <UserCheck className="w-3.5 h-3.5 text-indigo-400" />
                    <span>No queues — renew from your portal</span>
                  </div>
                </div>

                {/* Face 4: Transit Operations (Front Face) */}
                <div
                  className="absolute inset-0 w-full h-full bg-[#040c1e]/95 border border-orange-500/20 rounded-2xl p-3 sm:p-4 md:p-5 flex flex-col justify-between shadow-2xl [backface-visibility:hidden] [transform:rotateX(0deg)_translateZ(var(--cube-z,120px))]"
                  style={{
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 20px 40px rgba(0,0,0,0.6)'
                  }}
                >
                  <div className="flex justify-between items-center pb-1.5 border-b border-white/5">
                    <span className="text-[9px] md:text-[10px] font-mono text-orange-400 font-bold uppercase tracking-wider">Dispatch Alerts</span>
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
                      <span className="text-[8px] text-orange-400 bg-orange-500/10 px-1 rounded font-mono font-bold">Live Feed</span>
                    </div>
                  </div>
                  {/* Live Dispatch Stream Board */}
                  <div className="flex-1 py-2 flex flex-col gap-2 justify-center text-left">
                    <div className="text-[7px] font-bold text-slate-500 uppercase tracking-widest px-1">ACTIVE FLIGHTS / DISPATCHES</div>

                    {/* Dispatch 1 */}
                    <div className="p-2 bg-[#050d1d] hover:bg-[#071329] rounded-xl border border-white/5 flex items-center justify-between gap-2 shadow-inner transition-colors duration-300">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-md bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400 font-black text-[8px] font-mono shadow-sm">
                          B-04
                        </div>
                        <div>
                          <div className="text-[8.5px] font-bold text-slate-200 leading-none">Route-4 (Paltan Bazar)</div>
                          <div className="text-[6px] text-slate-400 font-mono mt-0.5">Departed 08:10 • Driver: P. Kalita</div>
                        </div>
                      </div>
                      <span className="px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20 text-[6.5px] font-bold tracking-wider uppercase font-mono animate-pulse">
                        EN ROUTE
                      </span>
                    </div>

                    {/* Dispatch 2 */}
                    <div className="p-2 bg-[#050d1d] hover:bg-[#071329] rounded-xl border border-white/5 flex items-center justify-between gap-2 shadow-inner transition-colors duration-300">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-md bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 font-black text-[8px] font-mono shadow-sm">
                          B-09
                        </div>
                        <div>
                          <div className="text-[8.5px] font-bold text-slate-200 leading-none">Route-7 (Lal Ganesh)</div>
                          <div className="text-[6px] text-slate-400 font-mono mt-0.5">Diverted via Bypass • Traffic Alert</div>
                        </div>
                      </div>
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[6.5px] font-bold tracking-wider uppercase font-mono">
                        DIVERTED
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] md:text-xs text-slate-300 font-medium">
                    <Bell className="w-3.5 h-3.5 text-orange-400" />
                    <span>Official dispatches pushed to your portal</span>
                  </div>
                </div>

                {/* Decorative Bottom Face */}
                <div
                  className="absolute inset-0 w-full h-full bg-[#040c1e]/60 border border-white/5 rounded-2xl [backface-visibility:hidden] [transform:rotateX(-90deg)_translateZ(var(--cube-z,120px))]"
                  style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)' }}
                />
                {/* Decorative Left Face */}
                <div
                  className="absolute inset-0 w-full h-full bg-[#040c1e]/60 border border-white/5 rounded-2xl [backface-visibility:hidden] [transform:rotateY(-90deg)_translateZ(var(--cube-z,120px))]"
                  style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)' }}
                />
                {/* Decorative Right Face */}
                <div
                  className="absolute inset-0 w-full h-full bg-[#040c1e]/60 border border-white/5 rounded-2xl [backface-visibility:hidden] [transform:rotateY(90deg)_translateZ(var(--cube-z,120px))]"
                  style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)' }}
                />
                {/* Decorative Back Face */}
                <div
                  className="absolute inset-0 w-full h-full bg-[#040c1e]/60 border border-white/5 rounded-2xl [backface-visibility:hidden] [transform:rotateY(180deg)_translateZ(var(--cube-z,120px))]"
                  style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)' }}
                />

              </div>
            </div>
          </div>

          {/* Right Text Column */}
          <div className="w-full md:w-1/2 flex flex-col justify-start md:justify-center h-auto md:h-full relative order-2 md:order-2 pl-0 md:pl-12 mt-2 md:mt-0 md:-translate-y-8">
            <div className="relative h-[300px] sm:h-[320px] md:h-[450px] w-full flex items-center">

              {/* Stage 3 Content */}
              <div ref={text1Ref} className="absolute inset-x-0 space-y-4 md:space-y-6 text-left transition-all duration-75 pt-10">
                <span className="text-xs font-bold text-amber-400 tracking-widest uppercase block">
                  Platform Dynamics
                </span>
                <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white tracking-tight leading-tight">
                  Less guessing. <br />
                  <span className="bg-gradient-to-r from-amber-400 to-teal-400 bg-clip-text text-transparent">
                    More confidence.
                  </span>
                </h2>
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1 border rounded-full text-xs font-bold uppercase tracking-wider ${steps[0].badgeColor}`}>
                    {steps[0].badge}
                  </span>
                </div>
                <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight">{steps[0].title}</h3>
                <ul className="space-y-2 max-w-xl">
                  {(steps[0].desc as string[]).map((point, i) => (
                    <li key={i} className="flex items-start gap-2 text-slate-300 text-sm sm:text-base leading-relaxed font-medium">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-teal-400 flex-shrink-0" />
                      {point}
                    </li>
                  ))}
                </ul>
                <p className="text-xs font-bold text-slate-500 tracking-wider uppercase">
                  {steps[0].subtitle}
                </p>
              </div>

              {/* Stage 4 Content */}
              <div ref={text2Ref} className="absolute inset-x-0 space-y-4 md:space-y-6 text-left opacity-0 pointer-events-none transition-all duration-75 pt-10">
                <span className="text-xs font-bold text-amber-400 tracking-widest uppercase block">
                  Platform Dynamics
                </span>
                <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white tracking-tight leading-tight">
                  Less guessing. <br />
                  <span className="bg-gradient-to-r from-amber-400 to-teal-400 bg-clip-text text-transparent">
                    More confidence.
                  </span>
                </h2>
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1 border rounded-full text-xs font-bold uppercase tracking-wider ${steps[1].badgeColor}`}>
                    {steps[1].badge}
                  </span>
                </div>
                <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight">{steps[1].title}</h3>
                <ul className="space-y-2 max-w-xl">
                  {(steps[1].desc as string[]).map((point, i) => (
                    <li key={i} className="flex items-start gap-2 text-slate-300 text-sm sm:text-base leading-relaxed font-medium">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                      {point}
                    </li>
                  ))}
                </ul>
                <p className="text-xs font-bold text-slate-500 tracking-wider uppercase">
                  {steps[1].subtitle}
                </p>
              </div>

            </div>



            {/* Dots */}
            <div className="hidden md:flex items-center gap-3 pt-3 md:pt-6 border-t border-white/5 max-w-md mt-3 md:mt-6 justify-center md:justify-start">
              <button
                ref={dot1Ref}
                onClick={() => scrollToStage(0)}
                className="relative h-2 rounded-full transition-all duration-300 w-10 bg-amber-400"
                aria-label="Go to stage 3"
              />
              <button
                ref={dot2Ref}
                onClick={() => scrollToStage(1)}
                className="relative h-2 rounded-full transition-all duration-300 w-2 bg-slate-700"
                aria-label="Go to stage 4"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Snap Targets */}
      <div className="absolute inset-0 pointer-events-none z-0">
        <div className="h-dvh snap-start snap-always" />
        <div className="h-dvh snap-start snap-always" />
      </div>
    </div>
  );
}

function LearningCarousel() {
  const slides = [
    {
      title: "Know your bus before you leave",
      desc: "Check if your bus is running, see where it is on the map, and get the real ETA — all before stepping out.",
      icon: <Navigation className="w-6 h-6 text-teal-400" />,
      tag: "Live Tracking",
      accent: "border-teal-500/25",
    },
    {
      title: "Your bus pass, always with you",
      desc: "A digital QR pass on your phone replaces the physical card. Show it to the driver — no paper, no hassle.",
      icon: <FileText className="w-6 h-6 text-amber-400" />,
      tag: "Digital Pass",
      accent: "border-amber-500/25",
    },
    {
      title: "Renew your bus service online",
      desc: "No more queues. Renew your annual bus card online, pay your way, and track approval status instantly.",
      icon: <CheckCircle2 className="w-6 h-6 text-emerald-400" />,
      tag: "Annual Renewal",
      accent: "border-emerald-500/25",
    },
    {
      title: "Official alerts for schedule changes",
      desc: "Timing changed? Route reassigned? Get an official notification instantly — so you're never caught off guard.",
      icon: <Bell className="w-6 h-6 text-orange-400" />,
      tag: "Dispatch Alerts",
      accent: "border-orange-500/25",
    },
    {
      title: "Schedules aligned to your lectures",
      desc: "Bus dispatch is coordinated with lecture timings so you reach campus on time, every time.",
      icon: <Clock className="w-6 h-6 text-indigo-400" />,
      tag: "Academics First",
      accent: "border-indigo-500/25",
    },
    {
      title: "Safe, trusted, transparent",
      desc: "Receipts, renewal history, and route logs all in one place. Secure and accessible anytime.",
      icon: <Shield className="w-6 h-6 text-rose-400" />,
      tag: "Family Trust",
      accent: "border-rose-500/25",
    },
  ];

  const N = slides.length;
  // 5x slides to guarantee infinite loop on all screen widths
  const extendedSlides = [...slides, ...slides, ...slides, ...slides, ...slides];

  const [slideIndex, setSlideIndex] = useState(2 * N); // Start at index 12 (Card 1 of 3rd set)
  const [isTransitioning, setIsTransitioning] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const handleResize = () => {
      setIsMobile(window.innerWidth < 640);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setIsTransitioning(true);
      setSlideIndex(prev => prev + 1);
    }, 5000); // 5 seconds per slide
    return () => clearInterval(timer);
  }, [slideIndex]); // Recreate interval on index change to avoid rushing after manual interactions

  // Finds the index in extendedSlides closest to slideIndex representing targetRealIdx
  const getClosestReplica = (targetRealIdx: number) => {
    let closestIdx = 2 * N + targetRealIdx;
    let minDiff = Math.abs(closestIdx - slideIndex);

    for (let k = 0; k < 5; k++) {
      const candidate = k * N + targetRealIdx;
      const diff = Math.abs(candidate - slideIndex);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = candidate;
      }
    }
    return closestIdx;
  };

  const handleTransitionEnd = (e: React.TransitionEvent) => {
    // Prevent child element transitions (like text/opacity) from bubbling up
    if (e.target !== e.currentTarget) return;

    if (slideIndex >= 3 * N) {
      // Instantly jump back by N slides without transition animation
      setIsTransitioning(false);
      setSlideIndex(slideIndex - N);

      // Re-enable transitions in the next frame to support smooth subsequent movements
      setTimeout(() => {
        setIsTransitioning(true);
      }, 50);
    } else if (slideIndex < 2 * N) {
      // Instantly jump forward by N slides without transition animation
      setIsTransitioning(false);
      setSlideIndex(slideIndex + N);

      setTimeout(() => {
        setIsTransitioning(true);
      }, 50);
    }
  };

  const handleDotClick = (idx: number) => {
    setIsTransitioning(true);
    setSlideIndex(getClosestReplica(idx));
  };

  const handleCardClick = (idx: number) => {
    setIsTransitioning(true);
    setSlideIndex(getClosestReplica(idx % N));
  };

  // Card layout calculations
  const cardStep = isMobile ? 314 : 364;
  const halfCard = isMobile ? 157 : 182;

  // Shared hardware-accelerated transition styles
  const containerTransition = isTransitioning
    ? 'transform 1500ms cubic-bezier(0.22, 1, 0.36, 1)'
    : 'none';

  const cardTransition = isTransitioning
    ? 'transform 1500ms cubic-bezier(0.22, 1, 0.36, 1), opacity 1500ms cubic-bezier(0.22, 1, 0.36, 1), border-color 1500ms cubic-bezier(0.22, 1, 0.36, 1), background-color 1500ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 1500ms cubic-bezier(0.22, 1, 0.36, 1)'
    : 'none';

  const textTransition = isTransitioning
    ? 'color 1500ms cubic-bezier(0.22, 1, 0.36, 1), transform 1500ms cubic-bezier(0.22, 1, 0.36, 1), opacity 1500ms cubic-bezier(0.22, 1, 0.36, 1)'
    : 'none';

  const tagTransition = isTransitioning
    ? 'color 1500ms cubic-bezier(0.22, 1, 0.36, 1), background-color 1500ms cubic-bezier(0.22, 1, 0.36, 1), border-color 1500ms cubic-bezier(0.22, 1, 0.36, 1)'
    : 'none';

  return (
    <div className="relative w-full h-dvh snap-start snap-always flex flex-col justify-center sm:justify-start pt-16 sm:pt-24 pb-8 border-t border-white/5 overflow-hidden">
      {/* Background image for Commuter Experience */}
      <div className="absolute inset-0 z-0">
        <Image
          src="/landing/adtusw.jpg"
          alt="Commuter experience background"
          fill
          className="object-cover object-center opacity-85 select-none pointer-events-none"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#030a16]/60 via-[#030a16]/75 to-[#030a16]" />
        <div className="absolute inset-0 bg-[#030a16]/30" />
      </div>
      {/* Heading */}
      <div className="max-w-5xl mx-auto px-6 w-full z-10 mb-6 text-center sm:text-left">
        <span className="text-xs font-bold text-teal-400 tracking-widest uppercase block mb-1">
          COMMUTER EXPERIENCE
        </span>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
          Smart Transit, Crafted for Campus Life
        </h2>
      </div>

      {/* Carousel Wrapper */}
      {mounted && (
        <div className="w-full max-w-5xl mx-auto overflow-hidden z-10 relative px-4 bg-transparent">
          <div
            className="flex flex-row flex-nowrap min-w-max w-max py-8 bg-transparent"
            style={{
              transform: `translateX(calc(var(--carousel-center) - ${slideIndex * cardStep + halfCard}px))`,
              transition: containerTransition
            }}
            onTransitionEnd={handleTransitionEnd}
          >
            {extendedSlides.map((slide, idx) => {
              const distance = Math.abs(slideIndex - idx);
              const isActive = distance === 0;
              const isNeighbor = distance === 1;

              return (
                <div
                  key={idx}
                  className="w-[290px] sm:w-[340px] shrink-0 mx-3 rounded-2xl p-6 cursor-pointer select-none relative overflow-hidden"
                  style={{
                    transform: `scale(${isActive ? 1.05 : isNeighbor ? 0.92 : 0.85})`,
                    opacity: isActive ? 1 : isNeighbor ? 0.45 : 0.15,
                    zIndex: 30 - Math.min(distance, 5),
                    border: '1px solid',
                    borderColor: isActive ? 'rgba(251, 191, 36, 0.2)' : 'rgba(255, 255, 255, 0.03)',
                    backgroundColor: isActive ? '#0b1322' : 'rgba(4, 9, 18, 0.65)',
                    boxShadow: isActive
                      ? '0 20px 40px -10px rgba(0, 0, 0, 0.85), inset 0 1px 0 rgba(255, 255, 255, 0.03)'
                      : 'inset 0 2px 4px rgba(0, 0, 0, 0.6)',
                    transition: cardTransition
                  }}
                  onClick={() => handleCardClick(idx)}
                >
                  {/* Neomorphic accent top border */}
                  <div
                    className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-amber-400/80 to-yellow-500/80"
                    style={{
                      opacity: isActive ? 1 : 0,
                      transition: isTransitioning ? 'opacity 1500ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none'
                    }}
                  />

                  {/* Icon Section (sunken well when inactive, glowing when active) */}
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
                    style={{
                      backgroundColor: isActive ? 'rgba(251, 191, 36, 0.06)' : 'rgba(0, 0, 0, 0.25)',
                      border: '1px solid',
                      borderColor: isActive ? 'rgba(251, 191, 36, 0.25)' : 'rgba(255, 255, 255, 0.02)',
                      boxShadow: isActive
                        ? '0 4px 12px rgba(251, 191, 36, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.05)'
                        : 'inset 2px 2px 5px rgba(0, 0, 0, 0.5)',
                      transform: `scale(${isActive ? 1.05 : 0.95})`,
                      transition: isTransitioning ? 'all 1500ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none'
                    }}
                  >
                    {slide.icon}
                  </div>

                  {/* Badge Tag */}
                  <span
                    className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider mb-3 inline-block"
                    style={{
                      color: isActive ? '#fbbf24' : '#64748b',
                      backgroundColor: isActive ? 'rgba(251, 191, 36, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                      border: '1px solid',
                      borderColor: isActive ? 'rgba(251, 191, 36, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                      transition: tagTransition
                    }}
                  >
                    {slide.tag}
                  </span>

                  {/* Title */}
                  <h3
                    className="text-sm font-bold mb-1.5 leading-snug"
                    style={{
                      color: isActive ? '#ffffff' : '#94a3b8',
                      transform: `translateY(${isActive ? '0px' : '-4px'})`,
                      opacity: isActive ? 1 : 0.7,
                      transition: textTransition
                    }}
                  >
                    {slide.title}
                  </h3>

                  {/* Description */}
                  <p
                    className="text-xs leading-relaxed"
                    style={{
                      color: isActive ? '#cbd5e1' : '#64748b',
                      transform: `translateY(${isActive ? '0px' : '-4px'})`,
                      opacity: isActive ? 1 : 0.5,
                      transition: textTransition
                    }}
                  >
                    {slide.desc}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Navigation Dots */}
          <div className="flex justify-center gap-2 mt-4 bg-transparent font-sans">
            {slides.map((_, idx) => {
              const isActiveDot = (slideIndex % N) === idx;
              return (
                <button
                  key={idx}
                  onClick={() => handleDotClick(idx)}
                  className={`h-1.5 rounded-full transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] relative overflow-hidden ${isActiveDot ? "w-8 bg-slate-800" : "w-1.5 bg-slate-700 hover:bg-slate-600"
                    }`}
                  aria-label={`Go to slide ${idx + 1}`}
                >
                  {isActiveDot && (
                    <span
                      key={slideIndex}
                      className="absolute inset-y-0 left-0 w-full h-full bg-amber-400 rounded-full origin-left animate-carousel-progress"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
