import { ApplicationFormData,ApplicationState } from '@/lib/types/application';

// This file defines the shared props for all step components
export interface StepProps {
  formData: ApplicationFormData;
  handleInputChange: (field: string, value: any) => void;
  onNext: () => void;
  onPrev?: () => void;
  onClear?: () => void;
  isSubmitting?: boolean;
}

export interface PersonalStepProps extends StepProps {
  currentUser: any;
  profilePhotoUrl: string;
  finalImageUrl: string | null;
  setShowProfileUpdateModal: (v: boolean) => void;
  handleImageRemove: () => void;
}

export interface AcademicStepProps extends StepProps {
  handleFacultySelect: (faculty: string) => void;
  handleDepartmentSelect: (department: string) => void;
}

export interface BusStepProps extends StepProps {
  routes: any[];
  buses: any[];
  setCapacityCheckResult: (res: any) => void;
  handleRefChange: (field: string, value: any) => void;
  applicationState: ApplicationState;
}

export interface PaymentStepProps extends StepProps {
  currentUser: any;
  calculateTotalFee: (duration: number, shift: string) => number;
  handleSessionDurationChange: (value: string) => void;
  deadlineConfig: any;
  applicationState: ApplicationState;
  checkFormCompletion: () => boolean;
  setPaymentCompleted: (v: boolean) => void;
  setPaymentDetails: (details: any) => void;
  setUseOnlinePayment: (v: boolean) => void;
  setApplicationState: (state: ApplicationState) => void;
  setReceiptFile: (file: File | null) => void;
  setReceiptPreview: (url: string) => void;
  showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  receiptPreview: string;
}

export interface ReviewStepProps extends StepProps {
  applicationState: ApplicationState;
  handleSubmitApplication: () => void;
  declarationAgreed: boolean;
  setDeclarationAgreed: (v: boolean) => void;
  validateForm: () => boolean;
  saving: boolean;
  handleSaveDraft: () => void;
  submitting: boolean;
  useOnlinePayment: boolean;
  finalImageUrl: string | null;
}
