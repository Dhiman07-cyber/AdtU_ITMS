'use client';

export function HowItWorksStyles() {
  return (
    <style jsx global>{`
      .pattern-grid-premium {
        background-size: 50px 50px;
        background-image: linear-gradient(to right, rgba(255, 255, 255, 0.02) 1px, transparent 1px),
                          linear-gradient(to bottom, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
      }
      .pattern-diagonal {
        background: repeating-linear-gradient(
          45deg,
          transparent,
          transparent 10px,
          rgba(255, 255, 255, 0.01) 10px,
          rgba(255, 255, 255, 0.01) 11px
        );
      }
      
      @keyframes drift-slow {
        0% { transform: translate(0, 0) scale(1); }
        33% { transform: translate(30px, -50px) scale(1.1); }
        66% { transform: translate(-20px, 20px) scale(0.9); }
        100% { transform: translate(0, 0) scale(1); }
      }
      .animate-drift-slow {
        animation: drift-slow 20s ease-in-out infinite;
      }
      
      @keyframes drift-medium {
        0% { transform: translate(0, 0) rotate(0deg); }
        50% { transform: translate(-40px, 40px) rotate(5deg); }
        100% { transform: translate(0, 0) rotate(0deg); }
      }
      .animate-drift-medium {
        animation: drift-medium 15s ease-in-out infinite;
      }

      @keyframes gradient-shift {
        0%, 100% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
      }
      .animate-gradient {
        animation: gradient-shift 1.5s linear infinite;
      }
      
      @keyframes float-delay-1 {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-20px); }
      }
      .animate-float-1 {
        animation: float-delay-1 6s ease-in-out infinite;
      }

      @keyframes float-delay-2 {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-15px); }
      }
      .animate-float-2 {
        animation: float-delay-2 5s ease-in-out infinite 1s;
      }
    `}</style>
  );
}
