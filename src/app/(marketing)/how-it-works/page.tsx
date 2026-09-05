import { HowItWorksStyles } from "@/components/HowItWorksStyles";
import {
	ArrowRight,
	Bus,
	CheckCircle2,
	Grid3x3,
	MapPin,
	Navigation,
	Shield,
	Users,
	Zap
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden">
      <HowItWorksStyles />

      {/* GLOBAL BACKGROUND - The source of seamless transitions */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        {/* Base Obsidian Black - The Premium Look */}
        <div className="absolute inset-0 bg-[#030712]"></div>

        {/* Global Grain/Grid Texture */}
        <div className="absolute inset-0 opacity-[0.4] pattern-diagonal"></div>
        <div className="absolute inset-0 opacity-[0.2] pattern-grid-premium"></div>

        {/* 1. Hero Glow (Blue/Purple) */}
        <div className="absolute top-[-10%] left-[20%] w-[800px] h-[800px] bg-blue-600/10 rounded-full blur-[120px] animate-drift-slow opacity-60"></div>
        <div className="absolute top-[10%] right-[-10%] w-[600px] h-[600px] bg-indigo-600/10 rounded-full blur-[100px] animate-drift-medium opacity-50"></div>

        {/* 2. Core Benefits Glow (Warm Amber/Rose touch) */}
        <div className="absolute top-[35%] left-[-10%] w-[900px] h-[900px] bg-rose-500/05 rounded-full blur-[150px] animate-drift-slow delay-1000"></div>

        {/* 3. Why Choose Us Glow (Teal/Cyan) */}
        <div className="absolute top-[55%] right-[0%] w-[800px] h-[800px] bg-teal-500/05 rounded-full blur-[150px] animate-drift-medium delay-2000"></div>

        {/* 4. Bottom Glow (Purple/Blue) */}
        <div className="absolute bottom-[-10%] left-[20%] w-[1000px] h-[800px] bg-indigo-900/10 rounded-full blur-[120px] animate-drift-slow"></div>
      </div>

      {/* Hero Section - Centered Layout */}
      <section className="relative min-h-[80vh] flex items-center justify-center py-20 px-4 sm:px-6 overflow-hidden z-10 pt-32 lg:pt-20">
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-[#0e1015]"></div>
          {/* Brighter, more intense glow - Tuned down opacity for clarity */}
          <div className="absolute top-[20%] left-[-10%] w-[700px] h-[700px] bg-indigo-500/25 rounded-full blur-[120px]"></div>
          <div className="absolute bottom-[20%] right-[-10%] w-[600px] h-[600px] bg-purple-500/25 rounded-full blur-[120px]"></div>
          {/* Central Spotlight */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-[100px]"></div>
        </div>
        <div className="max-w-5xl mx-auto w-full text-center relative z-10">

          <div className="inline-block px-5 py-2 bg-blue-500/10 border border-blue-500/20 rounded-full backdrop-blur-md shadow-lg mb-8">
            <span className="text-xs sm:text-sm font-bold text-blue-300 tracking-wide uppercase italic">💡 The Platform Logic</span>
          </div>

          <h1 className="text-4xl sm:text-6xl md:text-7xl font-bold tracking-tight leading-tight mb-8">
            Simple, Smart, &{" "}
            <span className="block mt-2 bg-gradient-to-r from-pink-400 via-cyan-300 to-purple-400 bg-[length:200%_auto] animate-gradient bg-clip-text text-transparent">
              Seamless Mobility
            </span>
          </h1>

          <p className="text-base sm:text-lg md:text-xl text-slate-400 max-w-3xl mx-auto font-medium leading-relaxed mb-10">
            We've reimagined campus transit. No more uncertainty—just precise tracking, secure tech, and pure reliability.
          </p>

          <Link
            href="/"
            className="group px-8 py-4 bg-white/5 border border-white/10 rounded-2xl font-bold text-sm sm:text-base hover:bg-white/10 transition-all duration-300 backdrop-blur-md flex items-center gap-2 mx-auto cursor-pointer"
          >
            <ArrowRight className="w-5 h-5 rotate-180 group-hover:-translate-x-1 transition-transform" />
            Back to Home
          </Link>
        </div>
      </section>

      {/* Transition Shadow - Smooth Blend */}
      <div className="h-32 -mt-32 relative z-20 bg-gradient-to-b from-transparent to-[#0e0c15] pointer-events-none"></div>

      {/* Redesigned 3-Step Process - Horizontal Premium Grid */}
      <section className="relative py-32 px-4 sm:px-6 z-10 overflow-hidden">
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-[#0e0c15]"></div>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-indigo-500/10 rounded-full blur-[160px]"></div>
        </div>

        <div className="max-w-7xl mx-auto relative z-10">
          <div className="text-center mb-20">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-500/10 border border-indigo-500/20 rounded-full backdrop-blur-md mb-6">
              <Zap className="w-4 h-4 text-indigo-400" />
              <span className="text-xs sm:text-sm font-bold text-indigo-300 tracking-widest uppercase text-shadow-glow">The Workflow</span>
            </div>
            <h2 className="text-4xl sm:text-6xl font-bold text-white tracking-tighter mb-6 leading-tight">
              Experience the <span className="text-indigo-400">Future</span>
            </h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto font-medium leading-relaxed">
              A sophisticated campus transit ecosystem, simplified into three core stages.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            {/* Connecting Line (Desktop) */}
            <div className="hidden md:block absolute top-[45%] left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-500/40 to-transparent z-0"></div>

            {[
              {
                id: "01",
                title: "Secure Access",
                desc: "Unified Google authentication with role-aware environment configuration for students and staff.",
                icon: Shield,
                color: "from-blue-500 to-indigo-600",
                shadow: "shadow-blue-500/20"
              },
              {
                id: "02",
                title: "Live Intelligence",
                desc: "Sub-second GPS broadcasting and real-time tile mapping for precise fleet location tracking.",
                icon: Navigation,
                color: "from-indigo-500 to-purple-600",
                shadow: "shadow-indigo-500/20"
              },
              {
                id: "03",
                title: "Smart Ledger",
                desc: "Automated payment reconciliation and digital pass generation with immutable transaction logs.",
                icon: CheckCircle2,
                color: "from-purple-500 to-pink-600",
                shadow: "shadow-purple-500/20"
              }
            ].map((step, idx) => {
              const Icon = step.icon;
              return (
                <div key={idx} className="group relative">
                  {/* Glass Card */}
                  <div className="relative h-full bg-white/[0.03] backdrop-blur-2xl border border-white/10 rounded-[2.5rem] p-8 sm:p-10 transition-all duration-500 hover:bg-white/[0.06] hover:border-white/20 hover:-translate-y-3 z-10 overflow-hidden shadow-2xl shadow-indigo-500/5">
                    {/* Background Number Watermark */}
                    <span className="absolute -top-4 -right-4 text-9xl font-black text-white/[0.02] select-none group-hover:text-white/[0.04] transition-colors duration-500 pointer-events-none">
                      {step.id}
                    </span>

                    <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${step.color} ${step.shadow} flex items-center justify-center mb-8 group-hover:scale-110 group-hover:rotate-3 transition-all duration-500`}>
                      <Icon className="w-8 h-8 text-white" />
                    </div>

                    <div className="space-y-4 relative z-10">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-indigo-400 tracking-widest uppercase">Step {step.id}</span>
                        <div className="h-px w-8 bg-indigo-500/30"></div>
                      </div>
                      <h3 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">{step.title}</h3>
                      <p className="text-slate-400 text-base sm:text-lg leading-relaxed font-medium">
                        {step.desc}
                      </p>
                    </div>

                    {/* Decorative Corner Glow */}
                    <div className={`absolute -bottom-10 -left-10 w-24 h-24 bg-gradient-to-br ${step.color} opacity-0 group-hover:opacity-20 blur-2xl transition-opacity duration-500`}></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Transition Shadow */}
      <div className="h-24 bg-gradient-to-b from-[#0e0c15] to-[#0c1212] relative z-10"></div>

      {/* Technical Excellence - Emerald/Teal Aura */}
      <section className="relative py-24 px-3 sm:px-4 md:px-6 z-10 overflow-hidden">
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-[#0c1212]"></div>
          <div className="absolute bottom-[20%] right-[-5%] w-[600px] h-[600px] bg-emerald-600/10 rounded-full blur-[120px]"></div>
        </div>

        <div className="max-w-7xl mx-auto relative">
          <div className="text-center mb-16 space-y-4">
            <div className="inline-block px-5 py-2 bg-emerald-500/10 border border-emerald-400/20 rounded-full backdrop-blur-md shadow-lg mb-4">
              <span className="text-xs sm:text-sm font-bold text-emerald-300 tracking-wide uppercase italic text-shadow-glow">🚀 Technical Excellence</span>
            </div>
            <h2 className="text-3xl sm:text-4xl md:text-6xl font-bold text-white tracking-tight leading-tight">
              Built for <span className="text-emerald-400">Scale</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                title: "Atomic Reassignment",
                desc: "Enterprise logic for high-capacity load balancing across buses with stop-specific compatibility checks.",
                icon: Grid3x3,
                color: "emerald"
              },
              {
                title: "Immutable Ledger",
                desc: "Append-only payment recording system ensuring 100% audit-safe financial oversight and history.",
                icon: Shield,
                color: "teal"
              },
              {
                title: "Digital QR Passes",
                desc: "Instant cryptographic bus pass generation with secure scanning for university premises entry.",
                icon: Zap,
                color: "blue"
              },
              {
                title: "Waiting Flags",
                desc: "Real-time 'Waiting at Stop' alerts with GPS coordination allowing drivers to acknowledge arrival.",
                icon: MapPin,
                color: "indigo"
              },
              {
                title: "Driver Swaps",
                desc: "Conflict-free system for temporary duty handovers with automated assignment reversion logic.",
                icon: Bus,
                color: "purple"
              },
              {
                title: "Role Intelligence",
                desc: "Granular access controls for Students, Drivers, Moderators, and Admins with tailored workflows.",
                icon: Users,
                color: "rose"
              }
            ].map((feature, idx) => {
              const Icon = feature.icon;
              return (
                <div key={idx} className="group relative p-8 bg-slate-900/40 border border-slate-800/50 rounded-[2rem] backdrop-blur-xl hover:bg-slate-800/60 hover:border-slate-700/50 transition-all duration-500 hover:-translate-y-2 shadow-2xl overflow-hidden">
                  <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br from-${feature.color}-500/20 to-${feature.color}-600/5 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-6 transition-all duration-500 shadow-inner`}>
                    <Icon className={`w-7 h-7 text-${feature.color}-400`} />
                  </div>
                  <h3 className="text-xl font-bold mb-3 text-white tracking-tight">{feature.title}</h3>
                  <p className="text-slate-400 text-sm sm:text-base font-medium leading-relaxed">{feature.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Transition Shadow */}
      <div className="h-24 bg-gradient-to-b from-[#0c1212] to-[#0c1015] relative z-10"></div>

      {/* Final CTA - Blue/Cyan Aura */}
      <section className="relative py-24 px-3 sm:px-4 md:px-6 z-10 overflow-hidden text-center">
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-[#0c1015]"></div>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] bg-blue-600/15 rounded-full blur-[150px] animate-drift-slow"></div>
        </div>

        <div className="max-w-4xl mx-auto relative z-10">
          <h2 className="text-4xl sm:text-5xl md:text-7xl font-bold mb-8 tracking-tighter">
            Ready to <span className="text-blue-400">Join?</span>
          </h2>
          <p className="text-lg sm:text-xl text-slate-400 mb-12 font-medium leading-relaxed">
            Experience the future of campus transit today. Secure, real-time, and built for Assam down town University.
          </p>
          <Link
            href="/login"
            className="group px-10 py-5 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-2xl font-bold text-lg text-white shadow-[0_20px_40px_rgba(59,130,246,0.3)] hover:shadow-[0_25px_50px_rgba(59,130,246,0.4)] transition-all duration-300 hover:scale-[1.05] inline-flex items-center gap-3 cursor-pointer"
          >
            Sign In with Google
            <ArrowRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative border-t border-white/5 bg-[#030712] py-16 px-4 sm:px-6 z-10">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-12 mb-12">
            <div className="lg:col-span-2 space-y-6">
              <Image src="/adtu-new-logo.svg" alt="AdtU Logo" width={192} height={64} className="w-48 h-auto" style={{ width: 'auto', height: 'auto' }} />
              <div className="space-y-4">
                <h3 className="text-xl font-bold text-white tracking-tight text-shadow-glow">AdtU Bus Services</h3>
                <p className="text-slate-400 font-medium max-w-sm leading-relaxed">Official Real-Time Campus Transportation Management Platform of Assam down town University.</p>
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-slate-400 font-medium">
                    <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
                    <span>Live tracking & real-time updates</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-400 font-medium">
                    <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
                    <span>Secure & reliable campus transport</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <h4 className="text-lg font-bold text-white flex items-center gap-2">🔗 Quick Links</h4>
              <ul className="space-y-4 font-medium">
                <li><a href="https://adtu.in" target="_blank" className="text-slate-400 hover:text-white transition-colors">🌐 Website</a></li>
                <li><a href="https://apply.adtu.in/" target="_blank" className="text-slate-400 hover:text-white transition-colors">📝 Admission</a></li>
                <li><a href="https://adtu.in/anti-ragging.html" target="_blank" className="text-slate-400 hover:text-white transition-colors">🛡️ Anti Ragging</a></li>
              </ul>
            </div>

            <div className="space-y-6">
              <h4 className="text-lg font-bold text-white flex items-center gap-2">☎ Support</h4>
              <div className="space-y-4 font-medium text-slate-400">
                <div className="flex items-center gap-2"><span>📞</span> +91 93657 71454</div>
                <div className="flex items-center gap-2"><span>📞</span> +91 91270 70577</div>
                <div className="flex items-center gap-2"><span>📞</span> +91 60039 03319</div>
              </div>
            </div>

            <div className="space-y-6">
              <h4 className="text-lg font-bold text-white flex items-center gap-2">🏛 Campus</h4>
              <div className="text-slate-400 font-medium leading-relaxed">
                <div>Assam down town University,</div>
                <div>Sankar Madhab Path, Panikhaiti,</div>
                <div>Guwahati, Assam - 781026</div>
              </div>
            </div>
          </div>

          <div className="pt-8 border-t border-white/5 text-center">
            <p className="text-slate-500 font-medium text-sm italic">© 2025 AdtU Bus Services. Managed by IT Team of AdtU. All Rights Reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
