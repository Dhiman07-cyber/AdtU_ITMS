import React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import PaymentModeSelector from '@/components/PaymentModeSelector';
import { PaymentStepProps } from './types';
import { calculateSessionDates } from '@/lib/payment/application-payment.service';
import { ArrowLeft, ArrowRight, AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export default function Step4ServicePayment({
  formData,
  handleInputChange,
  onNext,
  onPrev,
  currentUser,
  calculateTotalFee,
  handleSessionDurationChange,
  deadlineConfig,
  applicationState,
  checkFormCompletion,
  setPaymentCompleted,
  setPaymentDetails,
  setUseOnlinePayment,
  setApplicationState,
  setReceiptFile,
  setReceiptPreview,
  showToast,
  onClear,
  receiptPreview
}: PaymentStepProps) {
  const [showCaution, setShowCaution] = React.useState(false);

  const startMonthIndex = deadlineConfig?.academicSessionStart?.month ?? 6; // default to 6 (July)
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const startMonthName = monthNames[startMonthIndex] || 'July';
  const endMonthIndex = deadlineConfig?.academicYear?.anchorMonth ?? ((startMonthIndex + 11) % 12);
  const endMonthName = deadlineConfig?.academicYear?.anchorMonthName || monthNames[endMonthIndex] || 'June';

  const triggerCaution = React.useCallback(() => {
    setShowCaution(true);
  }, []);

  const dismissCaution = () => {
    setShowCaution(false);
  };

  return (
    <div className="space-y-6 flex-1 flex flex-col">
      <Dialog open={showCaution} onOpenChange={setShowCaution}>
        <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md bg-[#12131A] text-white border-white/10 shadow-2xl sm:rounded-2xl">
          <DialogHeader className="flex flex-col items-center text-center">
            <div className="h-12 w-12 rounded-full bg-amber-500/10 flex items-center justify-center border border-amber-500/20 mb-3">
              <AlertTriangle className="h-6 w-6 text-amber-500" />
            </div>
            <DialogTitle className="text-xl font-bold tracking-tight text-white uppercase">
              Caution
            </DialogTitle>
            <DialogDescription className="text-zinc-400 text-sm mt-3 text-justify leading-relaxed">
              The university follows a {startMonthName}-to-{endMonthName} academic session cycle. Please carefully select the academic session for which you want transportation services. The selected academic session determines the validity period of your transportation access. Ensure that the selected session matches the academic year in which you intend to use the service before continuing.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6">
            <Button
              onClick={dismissCaution}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold h-11 rounded-xl transition-all duration-200"
            >
              I Understand
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex items-start justify-between gap-4 border-b border-slate-800/40 pb-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white mb-1">Service & Payment</h2>
          <p className="text-sm text-slate-400">Review your session details and select a payment method.</p>
        </div>
        {onClear && (
          <Button
            type="button"
            variant="outline"
            onClick={onClear}
            className="border-red-950/30 bg-red-950/10 text-red-400 hover:text-white hover:bg-red-900/40 h-9 px-4 text-xs font-semibold rounded-xl transition-colors shrink-0"
          >
            Clear
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4 pt-2">
        <div>
          <Label htmlFor="sessionDuration" className="block text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-2">
            Session Duration
          </Label>
          <Select
            value={formData.sessionInfo.durationYears > 0 ? formData.sessionInfo.durationYears.toString() : "1"}
            onValueChange={handleSessionDurationChange}
            disabled={true}
          >
            <SelectTrigger className="h-10 bg-slate-900 border-slate-800 text-slate-500 cursor-not-allowed text-xs">
              <SelectValue placeholder="1 Year" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 Year</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[9px] text-slate-600 mt-1 italic">Duration is fixed to 1 year</p>
        </div>

        <div>
          <Label htmlFor="sessionStartYear" className="block text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-2">
            Session Start Year <span className="text-red-500">*</span>
          </Label>
          <Select
            value={formData.sessionInfo.sessionStartYear.toString()}
            onValueChange={(value) => {
              const startYear = parseInt(value);
              const duration = formData.sessionInfo.durationYears || 1;
              const endYear = startYear + duration;
              handleInputChange('sessionInfo.sessionStartYear', startYear);
              handleInputChange('sessionInfo.sessionEndYear', endYear);
            }}
            onOpenChange={(open) => {
              if (open) triggerCaution();
            }}
          >
            <SelectTrigger className="h-10 bg-transparent border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors text-xs">
              <SelectValue placeholder="Select Year" />
            </SelectTrigger>
            <SelectContent className="bg-[#12131A] border-slate-800 text-white">
              <SelectItem value={new Date().getFullYear().toString()}>{new Date().getFullYear()}</SelectItem>
              <SelectItem value={(new Date().getFullYear() + 1).toString()}>{new Date().getFullYear() + 1}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[9px] text-slate-600 mt-1 italic">Year when service begins</p>
        </div>

        <div>
          <Label htmlFor="sessionEndYear" className="block text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-2">
            Session End Year
          </Label>
          <Input
            type="number"
            id="sessionEndYear"
            value={formData.sessionInfo.sessionEndYear}
            readOnly
            className="h-10 bg-slate-900 border-slate-800 text-slate-500 cursor-not-allowed text-xs"
          />
          <p className="text-[9px] text-slate-600 mt-1 italic">Auto-calculated</p>
        </div>
      </div>

      <div className="pt-6">
        <PaymentModeSelector
          isFormComplete={checkFormCompletion()}
          showHeader={false}
          amount={formData.sessionInfo.feeEstimate || calculateTotalFee(formData.sessionInfo.durationYears, formData.shift || 'morning')}
          duration={formData.sessionInfo.durationYears}
          sessionStartYear={formData.sessionInfo.sessionStartYear}
          sessionEndYear={formData.sessionInfo.sessionEndYear}
          validUntil={(deadlineConfig ? calculateSessionDates(
            formData.sessionInfo.sessionStartYear,
            formData.sessionInfo.durationYears,
            deadlineConfig
          ).validUntil : '')}
          userId={currentUser?.uid || ''}
          userName={formData.fullName}
          userEmail={formData.email}
          userPhone={formData.phoneNumber}
          enrollmentId={formData.enrollmentId}
          purpose="new_registration"
          initialPaymentId={formData.paymentInfo.paymentReference}
          initialReceiptPreview={receiptPreview || formData.paymentInfo.paymentEvidenceUrl}
          initialPaidAt={formData.paymentInfo.paidAt}
          isReadOnly={applicationState === 'submitted'}
          isVerified={applicationState === 'verified'}
          onPaymentComplete={(details) => {
            setPaymentCompleted(true);
            setPaymentDetails(details);
            setUseOnlinePayment(true);
            setApplicationState('verified');
            showToast('Payment successful! Your application is now verified.', 'success');

            handleInputChange('paymentInfo.paymentMode', 'online');
            handleInputChange('paymentInfo.amountPaid', details.amount || calculateTotalFee(formData.sessionInfo.durationYears, formData.shift || 'morning'));
            handleInputChange('paymentInfo.paymentEvidenceProvided', true);
            handleInputChange('paymentInfo.razorpayPaymentId', details.razorpayPaymentId);
            handleInputChange('paymentInfo.razorpayOrderId', details.razorpayOrderId);
            handleInputChange('paymentInfo.paymentStatus', details.paymentStatus || 'success');
            handleInputChange('paymentInfo.paymentMethod', details.paymentMethod || 'card');
            handleInputChange('paymentInfo.paymentTime', details.paymentTime);
          }}
          onOfflineSelected={(data) => {
            setUseOnlinePayment(false);
            setPaymentCompleted(true);
            setApplicationState('verified');
            handleInputChange('paymentInfo.paymentMode', 'offline');
            handleInputChange('paymentInfo.amountPaid', calculateTotalFee(formData.sessionInfo.durationYears, formData.shift || 'morning'));
            if (data.paymentId) {
              handleInputChange('paymentInfo.paymentReference', data.paymentId);
            }
            if (data.paidAt) {
              handleInputChange('paymentInfo.paidAt', data.paidAt);
            }
          }}
          onReceiptFileSelect={(file) => {
            setReceiptFile(file);
            const previewUrl = URL.createObjectURL(file);
            setReceiptPreview(previewUrl);
          }}
          onReceiptRemove={() => {
            setReceiptFile(null);
            setReceiptPreview('');
          }}
        />
      </div>

      <div className="mt-auto pt-6 border-t border-slate-800 flex justify-between gap-4">
        <Button 
          onClick={onPrev} 
          variant="outline" 
          className="border-slate-800 bg-transparent hover:bg-slate-900 text-slate-400 hover:text-white h-11 px-5 font-semibold rounded-xl transition-colors flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <Button 
          onClick={onNext} 
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold h-11 px-6 rounded-xl transition-colors flex items-center gap-2"
        >
          Continue
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
