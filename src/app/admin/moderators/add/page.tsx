"use client";

import EnhancedDatePicker from "@/components/enhanced-date-picker";
import { OptimizedInput,OptimizedSelect,OptimizedTextarea } from '@/components/forms';
import { PremiumPageLoader } from "@/components/LoadingSpinner";
import ProfileImageAddModal from '@/components/ProfileImageAddModal';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectItem } from "@/components/ui/select";
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/contexts/toast-context';
import { useDebouncedStorage } from '@/hooks/useDebouncedStorage';
import { signalCollectionRefresh } from '@/hooks/useEventDrivenRefresh';
import { getAllModerators } from "@/lib/dataService";
import { uploadImage } from '@/lib/upload';
import { Camera,RotateCcw,Trash2 } from "lucide-react";
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect,useState } from 'react';

export default function AddModeratorPage() {
  const { currentUser, userData, loading } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();

  // Define the form data type
  type ModeratorFormData = {
    name: string;
    email: string;
    aadharNumber: string;
    dob: string;
    joiningDate: string;
    profilePhoto: File | null;
    phone: string;
    alternatePhone: string;
    employeeId: string;
    approvedBy: string;
    address: string;
    status: 'active' | 'inactive';
  };

  // Always initialize with empty form data - no auto-fill
  const getInitialFormData = (): ModeratorFormData => {
    // Try to load from localStorage first
    if (typeof window !== 'undefined') {
      const savedData = localStorage.getItem('moderatorFormData');
      if (savedData) {
        try {
          const parsedData = JSON.parse(savedData);
          // Ensure sensitive fields are not auto-filled
          return {
            ...parsedData,
            email: '',
            profilePhoto: null
          };
        } catch (e) {
          console.error('Error parsing saved form data:', e);
        }
      }
    }

    return {
      name: '',
      email: '',
      aadharNumber: '',
      dob: '',
      joiningDate: '',
      profilePhoto: null,
      phone: '',
      alternatePhone: '',
      employeeId: '',
      approvedBy: '',
      address: '',
      status: 'active',
    };
  };

  const [formData, setFormData] = useState<ModeratorFormData>(getInitialFormData());

  // Debounced storage to prevent input lag
  const storage = useDebouncedStorage<ModeratorFormData>('moderatorFormData', {
    debounceMs: 500,
    excludeFields: ['profilePhoto', 'email'],
  });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [finalImageUrl, setFinalImageUrl] = useState<string | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; error?: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [defaultEmployeeId, setDefaultEmployeeId] = useState("");

  useEffect(() => {
    const initData = async () => {
      try {
        const moderators = await getAllModerators();
        const nextNum = moderators.length + 1;
        const newId = `MB-${nextNum}`;
        setFormData(prev => ({ ...prev, employeeId: newId }));
        setDefaultEmployeeId(newId);
      } catch (error) {
        console.error("Failed to fetch moderators count", error);
      }
    };
    initData();
  }, []);

  // Auto-fill approvedBy field with current admin's details
  useEffect(() => {
    const fetchApproverDetails = async () => {
      if (userData && (userData.name || userData.fullName)) {
        const approverName = userData.fullName || userData.name;
        let idSuffix = '';

        if (userData.role === 'admin') {
          idSuffix = 'Admin';
        } else if (userData.role === 'moderator') {
          idSuffix = (userData as any).employeeId || (userData as any).empId || (userData as any).staffId || (userData as any).id || (userData as any).uid || 'MODERATOR';
        } else {
          idSuffix = userData.role?.charAt(0).toUpperCase() + userData.role?.slice(1) || 'Unknown';
        }

        const approvedByValue = `${approverName} (${idSuffix})`;

        setFormData(prev => {
          if (!prev.approvedBy || prev.approvedBy === '' || prev.approvedBy.includes('undefined')) {
            return { ...prev, approvedBy: approvedByValue };
          }
          return prev;
        });
      }
    };
    fetchApproverDetails();
  }, [userData]);

  // Save form data to localStorage whenever it changes (except sensitive fields)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      storage.save(formData);
    }
  }, [formData]); // Removed storage from deps - it's stable

  useEffect(() => {
    if (!loading && !currentUser) {
      router.push('/login');
    }

    if (userData && userData.role !== 'admin') {
      router.push(`/${userData.role}`);
    }

    // Force clear any auto-filled values after component mounts
    setTimeout(() => {
      setFormData(prev => ({
        ...prev,
        email: ''
      }));
    }, 100);
  }, [currentUser, userData, loading, router]);

  // Completely disable localStorage for email
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Force clear any existing localStorage data for sensitive fields
      const savedData = localStorage.getItem('moderatorFormData');
      if (savedData) {
        try {
          const parsedData = JSON.parse(savedData);
          if (parsedData.email) {
            // Remove sensitive fields - handled by storage hook
            storage.clear();
            storage.save(parsedData);
          }
        } catch (e) {
          console.error('Error cleaning saved form data:', e);
        }
      }
    }
  }, []);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = "Full name is required";
    }

    if (!formData.email.trim()) {
      newErrors.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = "Please enter a valid email address";
    }

    if (!formData.aadharNumber.trim()) {
      newErrors.aadharNumber = "AADHAR number is required";
    } else if (!/^\d{8,}$/.test(formData.aadharNumber)) {
      newErrors.aadharNumber = "AADHAR number must be at least 8 digits";
    }

    if (!formData.dob) {
      newErrors.dob = "Date of birth is required";
    }

    if (!formData.joiningDate) {
      newErrors.joiningDate = "Joining date is required";
    }

    // Required phone validation
    if (!formData.phone.trim()) {
      newErrors.phone = "Phone number is required";
    } else if (!/^\d{10,15}$/.test(formData.phone)) {
      newErrors.phone = "Phone number must be 10-15 digits";
    }

    if (formData.alternatePhone && !/^\d{10,15}$/.test(formData.alternatePhone)) {
      newErrors.alternatePhone = "Alternate phone number must be 10-15 digits";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let { name, value } = e.target;

    // Numeric-only restriction for phone number fields
    if (name === 'phone' || name === 'alternatePhone') {
      value = value.replace(/[^0-9]/g, '');
    }

    setFormData((prev: ModeratorFormData) => ({ ...prev, [name]: value }));
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev: ModeratorFormData) => ({ ...prev, [name]: value }));
  };

  const handleDateChange = (name: string, value: string) => {
    setFormData((prev: ModeratorFormData) => ({ ...prev, [name]: value }));
  };

  const handleImageConfirm = (file: File) => {
    // Legacy support
  };

  const handleProfileImageAdd = (url: string, file?: File) => {
    setFinalImageUrl(url);
    if (file) {
      setFormData((prev: ModeratorFormData) => ({ ...prev, profilePhoto: file }));
    }
    setPreviewUrl(url);
    setShowImageModal(false);
    addToast('Profile photo selected', 'success');
  };

  const handleImageRemove = () => {
    setPreviewUrl(null);
    setFinalImageUrl(null);
    setFormData((prev: ModeratorFormData) => ({ ...prev, profilePhoto: null }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setLoadingSubmit(true);
    setResult(null);

    try {
      let profilePhotoUrl = finalImageUrl || '';

      // Upload profile photo to Cloudinary first if we have a file and it's not already uploaded
      if (formData.profilePhoto) {
        try {
          const uploadedUrl = await uploadImage(formData.profilePhoto);
          if (uploadedUrl) {
            profilePhotoUrl = uploadedUrl;
          }
        } catch (uploadError: any) {
          console.error('Failed to upload profile photo:', uploadError);
          addToast(`Failed to upload profile photo: ${uploadError.message}`, 'error');
          setLoadingSubmit(false);
          return;
        }
      }

      // Get Firebase ID token for authentication
      const idToken = await currentUser?.getIdToken();

      const response = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + idToken
        },
        body: JSON.stringify({
          email: formData.email,
          name: formData.name,
          role: 'moderator',
          phone: formData.phone,
          alternatePhone: formData.alternatePhone,
          profilePhotoUrl: profilePhotoUrl,
          aadharNumber: formData.aadharNumber,
          dob: formData.dob,
          joiningDate: formData.joiningDate,
          employeeId: formData.employeeId,
          approvedBy: formData.approvedBy,
          address: formData.address,
          status: formData.status
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Clear saved form data on successful submission
        if (typeof window !== 'undefined') {
          storage.clear();
        }

        // Signal the moderators list page to refresh when it's rendered
        signalCollectionRefresh('moderators');

        addToast(data.message || 'Moderator created successfully!', 'success');
        setTimeout(() => {
          router.push('/admin/moderators');
        }, 2000);
      } else {
        addToast(data.error || 'Failed to create moderator', 'error');
      }
    } catch (error: any) {
      console.error('Error creating moderator:', error);
      addToast(`Failed to create moderator: ${error.message || 'Unknown error'}`, 'error');
    } finally {
      setLoadingSubmit(false);
    }
  };

  const handleReset = () => {
    const employeeId = (userData as any)?.employeeId || 'ADMIN';
    const approvedByValue = userData?.name ? `${userData.name} (${employeeId})` : '';

    setFormData({
      name: '',
      email: '',
      aadharNumber: '',
      dob: '',
      joiningDate: '',
      profilePhoto: null,
      phone: '',
      alternatePhone: '',
      employeeId: '',
      approvedBy: approvedByValue,
      address: '',
      status: 'active',
    });
    setPreviewUrl(null);
    setFinalImageUrl(null);
    setErrors({});

    // Clear saved form data
    if (typeof window !== 'undefined') {
      storage.clear();
    }

    addToast('Form reset successfully', 'info');
  };

  const handleRestoreEmployeeId = () => {
    setFormData(prev => ({ ...prev, employeeId: defaultEmployeeId }));
  };

  if (loading) {
    return <PremiumPageLoader message="Preparing moderator form..." subMessage="Loading resources..." />;
  }

  if (!currentUser || !userData || userData.role !== 'admin') {
    return null;
  }

  return (
    <div className="mt-10 py-4">
      {/* Header */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Add Moderator</h1>
            <p className="text-gray-400 text-xs text-left">Register a new moderator in the system</p>
          </div>
          <Link
            href="/admin/moderators"
            className="inline-flex items-center px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-sm border border-white/20 hover:border-white/30 rounded-lg transition-colors"
          >
            <span className="mr-1.5 text-sm">←</span>
            Back
          </Link>
        </div>
      </div>

      {/* Main Content - Enhanced spacing and premium styling */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-gradient-to-br from-[#0E0F12] to-[#1A1B23] rounded-2xl shadow-xl border border-white/10 p-4 sm:p-10">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Profile Photo Section - Modal Position Picker */}
            <div className="flex flex-col items-center mb-8">
              <div className="relative group cursor-pointer" onClick={() => setShowImageModal(true)}>
                {finalImageUrl ? (
                  <div className="relative h-24 w-24 rounded-full overflow-hidden border-4 border-white dark:border-gray-800 shadow-xl ring-2 ring-blue-100 dark:ring-blue-900">
                    <Image
                      src={finalImageUrl}
                      alt="Profile"
                      fill
                      className="object-cover"
                    />
                  </div>
                ) : (
                  <div className="h-24 w-24 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center border-4 border-white dark:border-gray-800 shadow-xl ring-2 ring-slate-100 dark:ring-slate-800 group-hover:bg-slate-200 dark:group-hover:bg-slate-700 transition-colors">
                    <Camera className="h-8 w-8 text-slate-400" />
                  </div>
                )}

                <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                  <Camera className="h-6 w-6 text-white" />
                </div>

                {finalImageUrl && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleImageRemove();
                    }}
                    className="absolute -top-1 -right-1 p-1.5 bg-red-500 text-white rounded-full shadow-lg hover:bg-red-600 transition-colors z-10"
                    title="Remove photo"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              <p className="mt-3 text-sm text-gray-500 font-medium">Click to upload photo</p>

              <ProfileImageAddModal
                isOpen={showImageModal}
                onClose={() => setShowImageModal(false)}
                onConfirm={handleProfileImageAdd}
                immediateUpload={false}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column: Name, Email, Phone, Alt Phone, Address */}
              <div className="space-y-3">
                <div>
                  <OptimizedInput
                    id="name"
                    label="Full Name"
                    value={formData.name}
                    onChange={(value) => setFormData(prev => ({ ...prev, name: value }))}
                    required
                    placeholder="Enter full name"
                  />
                  {errors.name && <p className="text-red-500 text-xs mt-0.5">{errors.name}</p>}
                </div>

                <div>
                  <OptimizedInput
                    id="email"
                    label="Email Address"
                    type="email"
                    value={formData.email}
                    onChange={(value) => setFormData(prev => ({ ...prev, email: value }))}
                    required
                    placeholder="Enter email address"
                  />
                  {errors.email && <p className="text-red-500 text-xs mt-0.5">{errors.email}</p>}
                </div>

                <div>
                  <OptimizedInput
                    id="phone"
                    label="Phone Number"
                    type="tel"
                    value={formData.phone}
                    onChange={(value) => setFormData(prev => ({ ...prev, phone: value }))}
                    required
                    placeholder="Enter phone number"
                    transform={(val) => val.replace(/[^0-9]/g, '')}
                  />
                  {errors.phone && <p className="text-red-500 text-xs mt-0.5">{errors.phone}</p>}
                </div>

                <div>
                  <OptimizedInput
                    id="alternatePhone"
                    label="Alternate Phone Number"
                    type="tel"
                    value={formData.alternatePhone}
                    onChange={(value) => setFormData(prev => ({ ...prev, alternatePhone: value }))}
                    placeholder="Enter alternate phone number"
                    transform={(val) => val.replace(/[^0-9]/g, '')}
                  />
                  {errors.alternatePhone && <p className="text-red-500 text-xs mt-0.5">{errors.alternatePhone}</p>}
                </div>

                <div>
                  <OptimizedTextarea
                    id="address"
                    label="Address"
                    value={formData.address}
                    onChange={(value) => setFormData(prev => ({ ...prev, address: value }))}
                    placeholder="Enter full address"
                    rows={4}
                  />
                </div>
              </div>

              {/* Right Column: Aadhar, Employee ID, DOB, Joining Date, Approved By, Status */}
              <div className="space-y-3">
                <div>
                  <OptimizedInput
                    id="aadharNumber"
                    label="AADHAR Number"
                    value={formData.aadharNumber}
                    onChange={(value) => setFormData(prev => ({ ...prev, aadharNumber: value }))}
                    required
                    placeholder="Enter AADHAR number"
                  />
                  {errors.aadharNumber && <p className="text-red-500 text-xs mt-0.5">{errors.aadharNumber}</p>}
                </div>

                <div>
                  <Label htmlFor="employeeId" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Employee ID
                  </Label>
                  <div className="relative">
                    <OptimizedInput
                      id="employeeId"
                      value={formData.employeeId}
                      onChange={(value) => setFormData(prev => ({ ...prev, employeeId: value }))}
                      placeholder="Enter Employee ID"
                      className="pr-8"
                    />
                    {formData.employeeId !== defaultEmployeeId && defaultEmployeeId && (
                      <button
                        type="button"
                        onClick={handleRestoreEmployeeId}
                        className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
                        title="Restore Default ID"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {errors.employeeId && <p className="text-red-500 text-xs mt-0.5">{errors.employeeId}</p>}
                </div>

                <div>
                  <EnhancedDatePicker
                    id="dob"
                    label="Date of Birth"
                    value={formData.dob}
                    onChange={(value) => handleDateChange('dob', value)}
                    required
                    validationType="dob-moderator"
                  />
                  {errors.dob && <p className="text-red-500 text-xs mt-0.5">{errors.dob}</p>}
                </div>

                <div>
                  <EnhancedDatePicker
                    id="joiningDate"
                    label="Joining Date"
                    value={formData.joiningDate}
                    onChange={(value) => handleDateChange('joiningDate', value)}
                    required
                    validationType="joining"
                  />
                  {errors.joiningDate && <p className="text-red-500 text-xs mt-0.5">{errors.joiningDate}</p>}
                </div>

                <div>
                  <Label htmlFor="approvedBy" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Approved By
                  </Label>
                  <Input
                    type="text"
                    id="approvedBy"
                    name="approvedBy"
                    value={formData.approvedBy}
                    readOnly
                    placeholder="System Generated"
                    className="bg-gray-100 dark:bg-gray-700 cursor-not-allowed h-9 text-sm"
                    disabled
                  />
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">This field is auto-filled</p>
                </div>

                <div>
                  <OptimizedSelect
                    id="status"
                    label="Status"
                    value={formData.status}
                    onChange={(value: string) => setFormData(prev => ({ ...prev, status: value as 'active' | 'inactive' }))}
                    placeholder="Select status"
                    required
                  >
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </OptimizedSelect>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 mt-4 w-full">
              <Button
                type="button"
                onClick={handleReset}
                className="bg-blue-600 hover:bg-blue-700 text-white w-full h-8 px-3 text-xs"
              >
                Reset
              </Button>
              <Link href="/admin/moderators" className="w-full block">
                <Button type="button" className="bg-red-600 hover:bg-red-700 text-white w-full h-8 px-3 text-xs">
                  Cancel
                </Button>
              </Link>
              <Button
                type="submit"
                disabled={loadingSubmit}
                className="bg-green-600 hover:bg-green-700 text-white w-full h-8 px-3 text-xs"
              >
                {loadingSubmit ? "Creating..." : "Add Moderator"}
              </Button>
            </div>
          </form>
        </div>

        {result && (
          <div className={`mt-4 p-4 rounded-md ${result.success ? "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200" : "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200"}`}>
            <p><strong>{result.success ? "Success!" : "Error:"}</strong></p>
            <p>{result.success ? "Moderator created successfully! Redirecting..." : result.error}</p>
          </div>
        )}
      </div>
    </div>

  );
}
