import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowLeft,Award,BookOpen,Calendar,CreditCard,Download,Loader2,Mail,MapPin,Send,Shield,User } from 'lucide-react';
import Image from 'next/image';
import React,{ useRef } from 'react';
import { toast } from 'sonner';
import { ReviewStepProps } from './types';

export default function Step5Review({
  formData,
  handleInputChange,
  applicationState,
  handleSubmitApplication,
  declarationAgreed,
  setDeclarationAgreed,
  validateForm,
  submitting,
  useOnlinePayment,
  finalImageUrl,
  onPrev
}: ReviewStepProps) {
  const reviewRef = useRef<HTMLDivElement>(null);

  const handleDownloadPdf = async () => {
    if (!declarationAgreed) return;
    try {
      if (!formData) return;

      const { default: jsPDF } = await import('jspdf');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();

      // Branding Colors
      const brandDark = [15, 23, 42] as [number, number, number];
      const brandAccent = [79, 70, 229] as [number, number, number];
      const neutral800 = [30, 41, 59] as [number, number, number];
      const neutral500 = [100, 116, 139] as [number, number, number];
      const neutral100 = [241, 245, 249] as [number, number, number];

      // Fetch Logo
      let logoBase64: string | null = null;
      try {
        const getLogoBase64 = (): Promise<string> => {
          return new Promise((resolve) => {
            const img = new window.Image();
            img.onload = () => {
              const canvas = document.createElement('canvas');
              canvas.width = 515; canvas.height = 204;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(img, 0, 0, 515, 204);
                resolve(canvas.toDataURL('image/png'));
              } else resolve('');
            };
            img.onerror = () => resolve('');
            img.src = '/adtu-new-logo.svg';
          });
        };
        logoBase64 = await getLogoBase64();
      } catch (e) {
        console.warn('Logo fetch failed', e);
      }

      // 1. HEADER (Full width dark background)
      pdf.setFillColor(brandDark[0], brandDark[1], brandDark[2]);
      pdf.rect(0, 0, pageWidth, 55, 'F');

      let headerTextX = 15;
      if (logoBase64) {
        // Logo Container
        pdf.setFillColor(255, 255, 255);
        pdf.roundedRect(15, 12, 55, 30, 3, 3, 'F');
        pdf.addImage(logoBase64, 'PNG', 18, 16, 49, 22);
        headerTextX = 80;
      }

      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(24);
      pdf.text('Assam down town University', headerTextX, 26);

      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(156, 163, 175);
      pdf.text('INTEGRATED TRANSPORT MANAGEMENT SYSTEM', headerTextX, 35);
      pdf.text('APPLICATION RECORD • BUS SERVICE', headerTextX, 40);

      // 2. STUDENT IDENTITY AREA

      // CIRCULAR PHOTO HANDLING (Placed on header separator line y=55)
      let photoUsed = false;
      if (finalImageUrl) {
        try {
          const getCircularBase64 = (url: string): Promise<string> => {
            return new Promise((resolve, reject) => {
              const img = new window.Image();
              if (!url.startsWith('blob:') && !url.startsWith('data:')) img.setAttribute('crossOrigin', 'anonymous');
              img.onload = () => {
                const canvas = document.createElement('canvas');
                const size = Math.min(img.width, img.height);
                canvas.width = size; canvas.height = size;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                  // Draw circular clip
                  ctx.beginPath();
                  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
                  ctx.closePath();
                  ctx.clip();
                  ctx.drawImage(img, (img.width - size) / 2, (img.height - size) / 2, size, size, 0, 0, size, size);
                  resolve(canvas.toDataURL('image/png', 0.95));
                } else reject(new Error('Canvas Error'));
              };
              img.onerror = () => reject(new Error('Img Load Error'));
              img.src = url;
            });
          };

          const circularBase64 = await getCircularBase64(finalImageUrl);
          pdf.setFillColor(255, 255, 255);
          pdf.setDrawColor(neutral100[0], neutral100[1], neutral100[2]);
          pdf.circle(175, 55, 21, 'FD'); // Decorative border exactly on the separator!
          pdf.addImage(circularBase64, 'PNG', 155, 35, 40, 40);
          photoUsed = true;
        } catch (e) {
          console.warn('Circular photo failed:', e);
        }
      }

      if (!photoUsed) {
        pdf.setDrawColor(neutral100[0], neutral100[1], neutral100[2]);
        pdf.setFillColor(neutral100[0], neutral100[1], neutral100[2]);
        pdf.circle(175, 55, 20, 'FD');
        pdf.setTextColor(neutral500[0], neutral500[1], neutral500[2]);
        pdf.setFontSize(8);
        pdf.text('NO PHOTO', 175, 55, { align: 'center', baseline: 'middle' } as any);
      }

      let y = 70;

      // Name & ID
      pdf.setTextColor(brandDark[0], brandDark[1], brandDark[2]);
      pdf.setFontSize(26);
      pdf.setFont('helvetica', 'bold');
      pdf.text((formData.fullName || 'STUDENT NAME').toUpperCase(), 15, y);

      pdf.setFontSize(11);
      pdf.setTextColor(brandAccent[0], brandAccent[1], brandAccent[2]);
      pdf.setFont('helvetica', 'bold');
      pdf.text(`ENROLLMENT ID: ${formData.enrollmentId || 'PENDING'}`, 15, y + 9);
      pdf.setTextColor(neutral500[0], neutral500[1], neutral500[2]);
      pdf.setFont('helvetica', 'normal');
      pdf.text(`STUDENT ACCOUNT • ${formData.email || 'N/A'}`, 15, y + 15);

      y = 100;

      // Layout Constants
      const col1 = 15;
      const col2 = 80;
      const col3 = 145;

      const sectionHeader = (title: string) => {
        pdf.setFillColor(neutral100[0], neutral100[1], neutral100[2]);
        pdf.rect(15, y - 6, 180, 10, 'F');
        pdf.setDrawColor(brandAccent[0], brandAccent[1], brandAccent[2]);
        pdf.setLineWidth(0.7);
        pdf.line(15, y - 6, 15, y + 4);

        pdf.setTextColor(brandDark[0], brandDark[1], brandDark[2]);
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'bold');
        pdf.text(title.toUpperCase(), 20, y);
        y += 11;
      };

      const drawRow = (fields: { label: string, value: string, x: number, width: number }[]) => {
        let maxLines = 1;

        const formattedFields = fields.map(f => {
          const lines = pdf.splitTextToSize(String(f.value || '-'), f.width);
          if (lines.length > maxLines) maxLines = lines.length;
          return { ...f, lines };
        });

        formattedFields.forEach(f => {
          pdf.setTextColor(neutral500[0], neutral500[1], neutral500[2]);
          pdf.setFontSize(8);
          pdf.setFont('helvetica', 'bold');
          pdf.text(f.label.toUpperCase(), f.x, y);

          pdf.setTextColor(brandDark[0], brandDark[1], brandDark[2]);
          pdf.setFontSize(10);
          pdf.setFont('helvetica', 'normal');
          pdf.text(f.lines, f.x, y + 5);
        });

        y += (maxLines * 5) + 9; // Comfortable vertical spacing within the same section format
      };

      // Personal Information
      sectionHeader('Personal Details');
      drawRow([
        { label: 'Gender', value: formData.gender ? formData.gender.charAt(0).toUpperCase() + formData.gender.slice(1).toLowerCase() : '-', x: col1, width: 60 },
        { label: 'Date of Birth', value: formData.dob, x: col2, width: 60 },
        { label: 'Blood Group', value: formData.bloodGroup, x: col3, width: 40 }
      ]);
      drawRow([
        { label: 'Guardian Name', value: formData.parentName, x: col1, width: 60 },
        { label: 'Emergency Contact', value: formData.parentPhone, x: col2, width: 60 },
        { label: 'Address', value: formData.address, x: col3, width: 50 }
      ]);

      y += 8; // Distinctly space out the next section

      // Academic Information
      sectionHeader('Academic & Transport Information');
      drawRow([
        { label: 'Faculty', value: formData.faculty, x: col1, width: 60 },
        { label: 'Department', value: formData.department, x: col2, width: 60 },
        { label: 'Semester', value: formData.semester, x: col3, width: 40 }
      ]);
      drawRow([
        { label: 'Assigned Route', value: formData.routeId?.replace(/_/g, '-')?.toUpperCase(), x: col1, width: 60 },
        { label: 'Pick-up Point', value: formData.stop_name?.toUpperCase(), x: col2, width: 100 }
      ]);

      y += 8; // Distinctly space out the next section

      // Service Details
      sectionHeader('Subscription Service Details');
      drawRow([
        { label: 'Valid Session', value: `${formData.sessionInfo.sessionStartYear} - ${formData.sessionInfo.sessionEndYear}`, x: col1, width: 60 },
        { label: 'Total Duration', value: `${formData.sessionInfo.durationYears} Year(s)`, x: col2, width: 60 }
      ]);

      const expiry = formData.sessionInfo.validUntil 
        ? new Date(formData.sessionInfo.validUntil).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) 
        : 'PENDING APPROVAL';
      drawRow([
        { label: 'Payment Mode', value: formData.paymentInfo.paymentMode?.toUpperCase(), x: col1, width: 60 },
        { label: 'Valid Until', value: expiry, x: col2, width: 60 }
      ]);

      // Add a bit more padding before Declaration
      y += 8;

      // Declaration (Premium corner rounded box)
      pdf.setDrawColor(226, 232, 240);
      pdf.setFillColor(252, 253, 254);
      pdf.roundedRect(15, y, 180, 25, 2, 2, 'FD');
      pdf.setTextColor(71, 85, 105);
      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'normal');
      const dTxt = "I hereby declare that the information furnished above is true, complete and correct to the best of my knowledge and belief. I understand that any false information may lead to cancellation of my transport services.";
      pdf.text(pdf.splitTextToSize(dTxt, 170), 20, y + 8);

      // Verifiable Footer
      pdf.setTextColor(148, 163, 184);
      pdf.setFontSize(7);
      const formattedDate = new Date().toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      pdf.text(`GENERATED ON: ${formattedDate} | STATUS: RECORD COPY`, 105, 285, { align: 'center' });
      pdf.text('© ASSAM DOWN TOWN UNIVERSITY - ITMS RECORD', 105, 290, { align: 'center' });

      pdf.save(`AdtU_Application_${formData.fullName.replace(/\s+/g, '_')}.pdf`);
    } catch (error) {
      console.error('PDF Error:', error);
      window.print();
    }
  };

  const ReviewSection = ({ title, icon: Icon, children }: { title: string, icon: any, children: React.ReactNode }) => (
    <div className="space-y-4 pt-4 border-t border-slate-800/50 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-1.5 bg-indigo-500/10 rounded-lg">
          <Icon className="w-4 h-4 text-indigo-400" />
        </div>
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">{title}</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
        {children}
      </div>
    </div>
  );

  const DetailItem = ({ label, value }: { label: string, value: string | number | undefined }) => (
    <div className="space-y-1 group">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 group-hover:text-indigo-400/70 transition-colors">{label}</p>
      <p className="text-sm font-semibold text-slate-200 border-b border-transparent group-hover:border-slate-800 pb-1 transition-all">{value || 'Not Provided'}</p>
    </div>
  );

  return (
    <div className="space-y-6 flex-1 flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-white mb-1 bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">Review & Submit</h2>
          <p className="text-xs text-slate-500 font-medium">Please verify all your details are correct before finally submitting the form.</p>
        </div>
        <Award className="w-10 h-10 text-indigo-500/20" />
      </div>

      {/* Review Content Container (Captured by html2canvas) */}
      <div
        ref={reviewRef}
        className="bg-[#0c0e1a] border border-slate-800 rounded-3xl p-6 md:p-10 space-y-10 shadow-xl shadow-black/25 relative overflow-hidden [contain:layout_paint]"
      >
        {/* Decorative Grid */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808005_1px,transparent_1px),linear-gradient(to_bottom,#80808005_1px,transparent_1px)] bg-[size:20px_20px] pointer-events-none"></div>

        {/* Header with Image */}
        <div className="flex flex-col md:flex-row gap-8 items-center md:items-start relative z-10">
          <div className="relative group">
            {/* Circular Grid Ornament */}
            <div className="absolute -inset-4 bg-[radial-gradient(circle_at_center,rgba(79,70,229,0.15),transparent_70%)] opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none"></div>
            <div className="absolute inset-0 bg-indigo-500/15 rounded-full group-hover:bg-indigo-500/20 transition-colors duration-300"></div>
            <div className="relative w-32 h-32 md:w-40 md:h-40 rounded-full overflow-hidden border-4 border-slate-800 shadow-xl bg-slate-900 flex items-center justify-center">
              {finalImageUrl ? (
                <Image
                  src={finalImageUrl}
                  alt="Student Photo"
                  fill
                  className="object-cover transition-transform duration-300 group-hover:scale-105"
                />
              ) : (
                <User className="w-16 h-16 text-slate-700" />
              )}
            </div>
            <div className="absolute bottom-1 right-1 bg-indigo-600 text-white p-2 rounded-full shadow-lg border-2 border-[#0c0e1a]">
              <Shield className="w-4 h-4" />
            </div>
          </div>

          <div className="flex-1 space-y-4 text-center md:text-left">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500 mb-1">Student Application</p>
              <h1 className="text-3xl md:text-4xl font-black text-white leading-tight">
                {formData.fullName || 'Full Name'}
              </h1>
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 mt-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                  <Mail className="w-3.5 h-3.5 text-indigo-400" />
                  {formData.email}
                </div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                  <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
                  {formData.enrollmentId}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 justify-center md:justify-start">
              <Badge variant="outline" className="bg-indigo-500/5 border-indigo-500/20 text-indigo-300 font-bold px-3 py-1 text-[10px] uppercase">
                {formData.faculty}
              </Badge>
              <Badge variant="outline" className="bg-blue-500/5 border-blue-500/20 text-blue-300 font-bold px-3 py-1 text-[10px] uppercase">
                Semester {formData.semester}
              </Badge>
            </div>
          </div>
        </div>

        {/* Sections */}
        <div className="space-y-12 relative z-10">
          <ReviewSection title="Personal Details" icon={User}>
            <DetailItem label="Gender" value={formData.gender ? formData.gender.charAt(0).toUpperCase() + formData.gender.slice(1) : ''} />
            <DetailItem label="Date of Birth" value={formData.dob} />
            <DetailItem label="Blood Group" value={formData.bloodGroup} />
            <DetailItem label="Emergency Phone" value={formData.alternatePhone} />
            <DetailItem label="Parent / Guardian" value={formData.parentName} />
            <DetailItem label="Parent Phone" value={formData.parentPhone} />
            <div className="md:col-span-2">
              <DetailItem label="Permanent Address" value={formData.address} />
            </div>
          </ReviewSection>

          <ReviewSection title="Academic Information" icon={BookOpen}>
            <DetailItem label="Department" value={formData.department} />
            <DetailItem label="Enrollment ID" value={formData.enrollmentId} />
            <DetailItem label="Faculty" value={formData.faculty} />
            <DetailItem label="Current Semester" value={formData.semester} />
          </ReviewSection>

          <ReviewSection title="Transportation Selection" icon={MapPin}>
            <DetailItem label="Selected Route" value={formData.routeId ? formData.routeId.charAt(0).toUpperCase() + formData.routeId.slice(1).replace(/_/g, '-') : 'Not Selected'} />
            <DetailItem label="Pick-up Point" value={formData.stop_name ? formData.stop_name.charAt(0).toUpperCase() + formData.stop_name.slice(1) : 'Not Selected'} />
            <DetailItem label="Bus Selected" value={formData.busAssigned || (formData.busId ? formData.busId.charAt(0).toUpperCase() + formData.busId.slice(1).replace(/_/g, '-') : 'Not Selected')} />
            <DetailItem label="Shift Time" value={formData.shift} />
          </ReviewSection>

          <ReviewSection title="Service Period" icon={Calendar}>
            <DetailItem label="Academic Session" value={`${formData.sessionInfo.sessionStartYear} - ${formData.sessionInfo.sessionEndYear}`} />
            <DetailItem label="Duration" value={`${formData.sessionInfo.durationYears} Year(s)`} />
            <DetailItem label="Payment Mode" value={formData.paymentInfo.paymentMode ? formData.paymentInfo.paymentMode.charAt(0).toUpperCase() + formData.paymentInfo.paymentMode.slice(1) : 'Not Selected'} />
            <DetailItem 
              label="Expiry Date" 
              value={formData.sessionInfo.validUntil 
                ? new Date(formData.sessionInfo.validUntil).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) 
                : 'Set after approval'} 
            />
          </ReviewSection>

          {formData.paymentInfo.paymentMode === 'offline' && (
            <ReviewSection title="Offline Payment Details" icon={CreditCard}>
              <DetailItem label="Transaction ID" value={formData.paymentInfo.paymentReference || 'N/A'} />
              <DetailItem 
                label="Payment Date & Time" 
                value={formData.paymentInfo.paidAt 
                  ? new Date(formData.paymentInfo.paidAt).toLocaleString('en-IN', {
                      dateStyle: 'medium',
                      timeStyle: 'short'
                    })
                  : 'N/A'
                } 
              />
            </ReviewSection>
          )}
        </div>

        {/* Watermark/Footer for PDF */}
        <div className="pt-8 border-t border-slate-800/30 hidden md:flex justify-between items-center text-[10px] text-slate-600 font-bold uppercase tracking-widest">
          <span>Assam Down Town University - Bus Services</span>
          <div className="flex items-center gap-2">
            <Shield className="w-3 h-3" />
            <span>Digital Application Proof</span>
          </div>
        </div>
      </div>

      <div className="pt-2">
        <div 
          onClick={(e) => {
            const target = e.target as HTMLElement;
            // If click is on the checkbox itself or the label, let standard event behavior handle it
            if (target.closest('button[role="checkbox"]') || target.closest('label')) {
              return;
            }
            
            const currentChecked = formData.declarationAccepted;
            const newChecked = !currentChecked;
            if (newChecked) {
              if (!validateForm()) return;
              handleInputChange('declarationAccepted', true);
              setDeclarationAgreed(true);
            } else {
              handleInputChange('declarationAccepted', false);
              setDeclarationAgreed(false);
            }
          }}
          className="flex items-start space-x-3 bg-indigo-500/5 p-4 sm:p-6 rounded-2xl border border-indigo-500/10 transition-all hover:bg-indigo-500/10 cursor-pointer select-none"
        >
          <Checkbox
            id="declaration"
            checked={formData.declarationAccepted}
            onCheckedChange={(checked: boolean) => {
              if (checked) {
                if (!validateForm()) return;
                handleInputChange('declarationAccepted', true);
                setDeclarationAgreed(true);
              } else {
                handleInputChange('declarationAccepted', false);
                setDeclarationAgreed(false);
              }
            }}
            className="mt-1.5 border-indigo-500 bg-slate-950/80 hover:border-indigo-400 data-[state=checked]:bg-indigo-600 data-[state=checked]:border-indigo-600 h-5 w-5 rounded-md transition-colors focus-visible:ring-indigo-500 focus-visible:ring-offset-0 focus-visible:ring-2 cursor-pointer"
          />
          <div className="grid gap-1.5 leading-tight">
            <label htmlFor="declaration" className="text-sm font-bold text-slate-200 cursor-pointer select-none">
              Final Declaration
            </label>
            <p className="text-xs text-slate-500 leading-relaxed font-medium">
              I certify that the information provided above is true and accurate to the best of my knowledge. I understand that any false statement may result in the immediate cancellation of my bus service privileges.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-auto pt-6 border-t border-slate-800/50 flex flex-col sm:flex-row justify-between gap-4">
        <Button
          onClick={onPrev}
          variant="outline"
          className="border-slate-800 bg-transparent hover:bg-slate-900 text-slate-400 hover:text-white h-11 px-5 font-semibold rounded-xl transition-colors flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>

        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            variant="outline"
            onClick={() => {
              if (!declarationAgreed) {
                toast.error("Please read and accept the final declaration checkbox to enable PDF download.");
                return;
              }
              handleDownloadPdf();
            }}
            className={`border-slate-800 bg-slate-900/50 text-slate-300 hover:text-white hover:bg-slate-800 h-11 px-6 font-semibold rounded-xl transition-colors flex items-center gap-2 ${!declarationAgreed ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <Download className="w-4 h-4" />
            Download PDF
          </Button>

          <Button
            onClick={() => {
              if (!declarationAgreed) {
                toast.error("Please read and accept the final declaration checkbox before submitting your application.");
                return;
              }
              handleSubmitApplication();
            }}
            disabled={submitting}
            className={`bg-indigo-600 hover:bg-indigo-500 text-white font-semibold h-11 px-8 rounded-xl transition-colors flex items-center gap-2 group ${!declarationAgreed ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {submitting ? (
              <><Loader2 className="h-5 w-5 animate-spin" /> Finalizing...</>
            ) : (
              <><Send className="h-4 w-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" /> Submit Application</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
