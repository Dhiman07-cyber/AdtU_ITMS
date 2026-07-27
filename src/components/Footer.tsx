"use client";

import FeedbackModal from '@/components/FeedbackModal';
import { Button } from '@/components/ui/button';
import { APP_NAME } from '@/config/runtime';
import { useAuth } from '@/contexts/auth-context';
import { MessageSquare } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React,{ useState } from 'react';

interface FooterProps {
  className?: string;
}

const Footer = React.memo(function Footer({ className = '' }: FooterProps) {
  const { currentUser, userData } = useAuth();
  const appName = APP_NAME;
  const router = useRouter();

  const [showFeedbackModal, setShowFeedbackModal] = useState(false);

  const userRole = userData?.role || '';
  const showFeedbackToRole = userRole === 'student' || userRole === 'driver';

  return (
    <>
      {/* Feedback Modal */}
      <FeedbackModal isOpen={showFeedbackModal} onClose={() => setShowFeedbackModal(false)} />

      {/* Footer */}
      <footer className={`border-t border-white/10 bg-[#0E0F12] py-4 sm:py-8 lg:py-10 px-5 sm:px-7 lg:px-14 ${className}`}>
        <div className="max-w-6xl mx-auto">
          {/* Main Footer Content */}
          <div className="grid grid-cols-2 lg:grid-cols-12 gap-x-4 sm:gap-x-6 lg:gap-x-8 gap-y-8 sm:gap-y-10 lg:gap-y-0 mb-4 sm:mb-8">
            {/* Branding */}
            <div className="space-y-1.5 sm:space-y-3 col-span-2 lg:col-span-3">
              <div className="space-y-1.5 sm:space-y-2">
                <Image src="/adtu-new-logo.svg" alt="AdtU Logo" width={144} height={56} className="w-24 h-auto sm:w-36" style={{ height: 'auto' }} />
                <div>
                  <h3 className="text-sm sm:text-lg font-bold text-white">{appName}</h3>
                  <p className="text-[10px] sm:text-xs text-[#9CA3AF] leading-relaxed max-w-[280px]">Official Real-Time Campus Transportation Management Platform</p>
                  <div className="space-y-0.5 sm:space-y-1 mt-1.5 sm:mt-2">
                    <div className="flex items-center gap-1.5 text-[10px] sm:text-xs text-[#9CA3AF]">
                      <div className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-green-400 rounded-full"></div>
                      <span>Live tracking & real-time updates</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] sm:text-xs text-[#9CA3AF]">
                      <div className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-green-400 rounded-full"></div>
                      <span>Secure & reliable campus transport</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Links */}
            <div className="space-y-1.5 sm:space-y-3 lg:col-span-2">
              <h4 className="text-xs sm:text-base font-semibold text-white flex items-center gap-1 sm:gap-1.5">
                <span className="text-[10px] sm:text-sm">🔗</span> Quick Links
              </h4>
              <ul className="space-y-1 sm:space-y-2">
                <li><a href="https://adtu.in" target="_blank" rel="noopener noreferrer" className="text-[#B0B3B8] hover:text-white transition-colors text-[10px] sm:text-xs flex items-center gap-1">
                  <span className="text-[10px] sm:text-xs">🌐</span> Website
                </a></li>
                <li><a href="https://apply.adtu.in/" target="_blank" rel="noopener noreferrer" className="text-[#B0B3B8] hover:text-white transition-colors text-[10px] sm:text-xs flex items-center gap-1">
                  <span className="text-[10px] sm:text-xs">📝</span> Admission
                </a></li>
                <li><a href="https://adtu.in/files/2024/09/03/45783568.pdf" target="_blank" rel="noopener noreferrer" className="text-[#B0B3B8] hover:text-white transition-colors text-[10px] sm:text-xs flex items-center gap-1">
                  <span className="text-[10px] sm:text-xs">📋</span> Grievance
                </a></li>
                <li><a href="https://adtu.in/anti-ragging.html" target="_blank" rel="noopener noreferrer" className="text-[#B0B3B8] hover:text-white transition-colors text-[10px] sm:text-xs flex items-center gap-1">
                  <span className="text-[10px] sm:text-xs">🛡️</span> Anti Ragging
                </a></li>
              </ul>
            </div>

            {/* Support */}
            <div className="space-y-1.5 sm:space-y-3 lg:col-span-2">
              <h4 className="text-xs sm:text-base font-semibold text-white flex items-center gap-1 sm:gap-1.5">
                <span className="text-[10px] sm:text-sm">☎</span> Support
              </h4>
              <div className="space-y-1 sm:space-y-2 text-[10px] sm:text-xs">
                <div className="flex items-center gap-1 text-[#B0B3B8]">
                  <span className="text-[10px] sm:text-xs">📞</span>
                  <span className="text-[10px] sm:text-xs">+91 93657 71454</span>
                </div>
                <div className="flex items-center gap-1 text-[#B0B3B8]">
                  <span className="text-[10px] sm:text-xs">📞</span>
                  <span className="text-[10px] sm:text-xs">+91 91270 70577</span>
                </div>
                <div className="flex items-center gap-1 text-[#B0B3B8]">
                  <span className="text-[10px] sm:text-xs">📞</span>
                  <span className="text-[10px] sm:text-xs">+91 60039 03319</span>
                </div>
              </div>
            </div>

            {/* Legal */}
            <div className="space-y-1.5 sm:space-y-3 lg:col-span-2">
              <h4 className="text-xs sm:text-base font-semibold text-white flex items-center gap-1 sm:gap-1.5">
                <span className="text-[10px] sm:text-sm">⚖</span> Legal
              </h4>
              <ul className="space-y-1 sm:space-y-2">
                <li><Link href="/terms-and-conditions" className="text-[#B0B3B8] hover:text-white transition-colors text-[10px] sm:text-xs">Terms & Conditions</Link></li>
                <li><Link href="/privacy-policy" className="text-[#B0B3B8] hover:text-white transition-colors text-[10px] sm:text-xs">Privacy Policy</Link></li>
              </ul>
            </div>

            {/* Campus View / Feedback Section */}
            <div className="space-y-1.5 sm:space-y-3 col-span-2 lg:col-span-3">
              <h4 className="text-xs sm:text-base font-semibold text-white flex items-center gap-1 sm:gap-1.5">
                <span className="text-[10px] sm:text-sm">🏛</span> Campus View
              </h4>
              <div className="space-y-1.5 sm:space-y-2">
                <a href="https://adtu.in/view-360/" target="_blank" rel="noopener noreferrer" className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-[#B0B3B8] hover:text-white hover:bg-white/10 transition-all duration-300 text-[10px] sm:text-xs font-medium">
                  <span className="text-sm">🎥</span> Go for 3D Campus Tour
                </a>

                {/* Feedback Button for Students and Drivers */}
                {showFeedbackToRole && (
                  <Button
                    onClick={() => setShowFeedbackModal(true)}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white border-0 transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-blue-500/25 text-[10px] sm:text-xs px-2 sm:px-3 py-1 sm:py-2 min-h-[1.75rem] sm:min-h-[2.25rem]"
                  >
                    <MessageSquare className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-1 flex-shrink-0" />
                    <span className="truncate">Have feedback? Tell us</span>
                  </Button>
                )}

                {/* Admin/Moderator Feedback Link */}
                {(userRole === 'admin' || userRole === 'moderator') && (
                  <Button
                    onClick={() => router.push('/admin/feedback')}
                    variant="outline"
                    size="sm"
                    className="w-full bg-white/5 border-white/10 text-[#B0B3B8] hover:bg-white/10 hover:text-white transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-white/10 text-[10px] sm:text-xs px-2 sm:px-3 py-1 sm:py-2 min-h-[1.75rem] sm:min-h-[2.25rem]"
                  >
                    <MessageSquare className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-1 flex-shrink-0" />
                    <span className="truncate">Open Feedback Manager</span>
                  </Button>
                )}

                <div className="text-[10px] sm:text-xs text-[#9CA3AF] leading-relaxed">
                  <div>Assam down town University,</div>
                  <div>Sankar Madhab Path, Gandhi Nagar,</div>
                  <div>Panikhaiti, Guwahati, Assam, India,</div>
                  <div>Pin – 781026</div>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Bar */}
          <div className="pt-3 sm:pt-6">
            <div className="text-center">
              <div className="text-[#9CA3AF] text-[10px] sm:text-xs pb-22">
                © {new Date().getFullYear()} {appName}. Managed by the Administrative Team of AdtU. All Rights Reserved.
              </div>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
});

export default Footer;
