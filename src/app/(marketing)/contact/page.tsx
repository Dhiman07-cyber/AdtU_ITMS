import ApplyFormNavbar from '@/components/ApplyFormNavbar';
import Footer from '@/components/Footer';
import { Card } from '@/components/ui/card';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { safeMailtoHref, safeTelHref } from '@/lib/security/url-sanitizer';
import { Clock, Headphones, Mail, MapPin, MessageCircle, Phone, Sparkles } from 'lucide-react';

export default async function ContactPage() {
  let config: any = null;

  try {
    config = await getDeadlineConfig();
  } catch (e) {
    console.error('Error reading deadline config on server:', e);
  }

  const contactData = {
    title: config?.landingPage?.contactTitle || "Contact & Support",
    subtitle: config?.landingPage?.contactSubtitle || "Get in touch with our transport support team. We're here to help with all your transportation needs.",
    content: {
      support_email: config?.contactInfo?.email || "transport-support@adtu.edu.in",
      phone: config?.contactInfo?.phone || "+91 93657 71454",
      office_hours: config?.contactInfo?.officeHours || "Mon–Fri, 09:00–17:00 IST",
      address: config?.contactInfo?.address || "ADTU Campus, Sankar Madhab Path, Panikhaiti, Guwahati, Assam 781026"
    }
  };
  const supportMailHref = safeMailtoHref(contactData.content.support_email);
  const supportPhoneHref = safeTelHref(contactData.content.phone);

  return (
    <div
      className="min-h-screen bg-[#05060e] dark:bg-[#05060e] overflow-x-hidden relative"
      style={{
        backgroundImage: 'linear-gradient(to bottom, #05060e 0%, rgba(5, 6, 14, 0.75) 15%, rgba(5, 6, 14, 0.85) 85%, #05060e 100%), url(/landing/hero.jpg)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      }}
    >
      <ApplyFormNavbar />

      <div className="max-w-[70rem] mx-auto px-4 sm:px-6 pt-28 sm:pt-32 pb-6 relative z-10">
        {/* Premium Hero Section */}
        <div className="text-center mb-8 sm:mb-12 space-y-3 animate-fade-in">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-indigo-500/10 border border-indigo-500/20 rounded-full mb-3">
            <Sparkles className="h-4 w-4 text-indigo-400" />
            <span className="text-xs sm:text-sm font-semibold text-indigo-300 tracking-wide">Get in Touch</span>
          </div>

          <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-black animate-slide-in-up tracking-tighter" style={{ animationDelay: '0.1s' }}>
            <span className="block bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 bg-clip-text text-transparent animate-gradient-flow leading-[1.1]">
              {contactData.title}
            </span>
          </h1>

          <p className="text-sm sm:text-base md:text-lg lg:text-xl text-gray-400 max-w-2xl mx-auto leading-relaxed animate-slide-in-up px-4 font-medium" style={{ animationDelay: '0.2s' }}>
            {contactData.subtitle}
          </p>
        </div>

        {/* Premium Cards Grid - Now 4 columns for maximum visibility */}
        <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 animate-slide-in-up" style={{ animationDelay: '0.3s' }}>
          {/* Email Support Card */}
          <Card className="group relative overflow-hidden border-2 border-white/5 hover:border-blue-500/50 transition-all duration-500 animate-fade-in hover-lift shadow-xl bg-[#0c0e1a] flex flex-col items-center justify-center p-7">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-cyan-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
            <div className="relative z-10 flex flex-col items-center text-center gap-1.5 px-4">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg group-hover:scale-110 transition-all duration-500 mb-1">
                <Mail className="h-5 w-5 text-white" />
              </div>
              <span className="bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent font-bold text-sm">
                Email Support
              </span>
              <div className="mt-3 flex flex-col gap-1">
                <a
                  href={supportMailHref ?? undefined}
                  className="text-[10px] sm:text-xs text-blue-600 dark:text-blue-400 font-bold hover:underline break-all"
                >
                  {contactData.content.support_email}
                </a>
                <p className="text-[10px] text-gray-500">24/7 Response</p>
              </div>
            </div>
          </Card>

          {/* Phone Support Card */}
          <Card className="group relative overflow-hidden border-2 border-white/5 hover:border-green-500/50 transition-all duration-500 animate-fade-in hover-lift shadow-xl bg-[#0c0e1a] flex flex-col items-center justify-center p-5" style={{ animationDelay: '0.1s' }}>
            <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 to-emerald-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
            <div className="relative z-10 flex flex-col items-center text-center gap-1.5 px-4">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center shadow-lg group-hover:scale-110 transition-all duration-500 mb-1">
                <Phone className="h-5 w-5 text-white" />
              </div>
              <span className="bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent font-bold text-sm">
                Phone Support
              </span>
              <div className="mt-3 flex flex-col gap-1">
                <a
                  href={supportPhoneHref ?? undefined}
                  className="text-[10px] sm:text-xs text-green-600 dark:text-green-400 font-bold hover:underline"
                >
                  {contactData.content.phone}
                </a>
                <p className="text-[10px] text-gray-500">9 AM - 5 PM IST</p>
              </div>
            </div>
          </Card>

          {/* Office Hours Card */}
          <Card className="group relative overflow-hidden border-2 border-white/5 hover:border-orange-500/50 transition-all duration-500 animate-fade-in hover-lift shadow-xl bg-[#0c0e1a] flex flex-col items-center justify-center p-5" style={{ animationDelay: '0.2s' }}>
            <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 to-amber-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
            <div className="relative z-10 flex flex-col items-center text-center gap-1.5 px-4">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shadow-lg group-hover:scale-110 transition-all duration-500 mb-1">
                <Clock className="h-5 w-5 text-white" />
              </div>
              <span className="bg-gradient-to-r from-orange-600 to-amber-600 bg-clip-text text-transparent font-bold text-sm">
                Office Hours
              </span>
              <div className="mt-3 flex flex-col gap-1">
                <p className="text-[10px] sm:text-xs text-gray-300 font-bold leading-tight">
                  {contactData.content.office_hours}
                </p>
                <p className="text-[10px] text-gray-500">Mon - Fri</p>
              </div>
            </div>
          </Card>

          {/* Visit Us Card */}
          <Card className="group relative overflow-hidden border-2 border-white/5 hover:border-red-500/50 transition-all duration-500 animate-fade-in hover-lift shadow-xl bg-[#0c0e1a] flex flex-col items-center justify-center p-5" style={{ animationDelay: '0.3s' }}>
            <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-rose-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
            <div className="relative z-10 flex flex-col items-center text-center gap-1.5 px-4">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center shadow-lg group-hover:scale-110 transition-all duration-500 mb-1">
                <MapPin className="h-5 w-5 text-white" />
              </div>
              <span className="bg-gradient-to-r from-red-600 to-rose-600 bg-clip-text text-transparent font-bold text-sm">
                Visit Us
              </span>
              <div className="mt-3 flex flex-col gap-1">
                <p className="text-[10px] sm:text-xs text-gray-300 font-bold leading-tight">
                  ADTU Campus, Guwahati
                </p>
                <p className="text-[10px] text-gray-500">Guwahati, Assam</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Map Location Section */}
        <div className="mt-8 sm:mt-12 md:mt-16 animate-slide-in-up" style={{ animationDelay: '0.35s' }}>
          <div className="relative overflow-hidden border-2 border-white/5 rounded-2xl sm:rounded-3xl shadow-2xl bg-[#0c0e1a] p-2 w-full h-[350px] sm:h-[450px]">
            <iframe
              src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d7159.685260480084!2d91.85270905494689!3d26.201797052099195!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x375af77400000001%3A0xfa44ca580f29ec15!2sAssam%20down%20town%20University!5e0!3m2!1sen!2sin!4v1782052683498!5m2!1sen!2sin"
              width="100%"
              height="100%"
              style={{ border: 0 }}
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="w-full h-full rounded-xl sm:rounded-2xl"
            />
          </div>
        </div>

        {/* Premium Help Section */}
        <div className="mt-8 sm:mt-12 md:mt-16 animate-slide-in-up" style={{ animationDelay: '0.4s' }}>
          <Card className="bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600 p-6 sm:p-8 md:p-10 lg:p-12 rounded-2xl sm:rounded-3xl shadow-2xl relative overflow-hidden">
            <div className="relative z-10 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 sm:w-16 sm:h-16 md:w-20 md:h-20 rounded-full bg-white/15 mb-3 sm:mb-4 md:mb-6 shadow-xl animate-pulse">
                <Headphones className="h-6 w-6 sm:h-8 sm:w-8 md:h-10 md:w-10 text-white" />
              </div>
              <h2 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold text-white mb-2 sm:mb-3 md:mb-4">
                Need Immediate Help?
              </h2>
              <p className="text-sm sm:text-base md:text-lg lg:text-xl text-white/90 mb-4 sm:mb-6 md:mb-8 max-w-2xl mx-auto">
                Our dedicated support team is here to assist you with any questions or concerns about your bus service.
              </p>
              <div className="flex flex-wrap justify-center gap-4">
                <a
                  href={supportMailHref ?? undefined}
                  className="px-4 sm:px-6 md:px-8 py-2.5 sm:py-3 md:py-4 bg-white text-blue-600 hover:bg-gray-100 rounded-lg sm:rounded-xl font-bold shadow-2xl transform hover:scale-105 transition-all duration-300 inline-flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 sm:h-5 sm:w-5" />
                  Email Us
                </a>
                <a
                  href={supportPhoneHref ?? undefined}
                  className="px-4 sm:px-6 md:px-8 py-2.5 sm:py-3 md:py-4 bg-white/10 backdrop-blur-sm border-2 border-white text-white hover:bg-white/20 rounded-lg sm:rounded-xl font-bold shadow-2xl transform hover:scale-105 transition-all duration-300 inline-flex items-center gap-2">
                  <Phone className="h-4 w-4 sm:h-5 sm:w-5" />
                  Call Us
                </a>
              </div>
            </div>
          </Card>
        </div>
      </div>
      <Footer className="border-white/5 !bg-[#05060e]" />
    </div>
  );
}



