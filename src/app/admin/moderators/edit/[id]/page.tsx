"use client";

import { useState, useEffect, useRef } from "react";
import { use } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Link from "next/link";
import { useToast } from '@/contexts/toast-context';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import ProfileImageAddModal from "@/components/ProfileImageAddModal";
import EnhancedDatePicker from "@/components/enhanced-date-picker";
import { getModeratorById, updateModerator } from '@/lib/dataService';
import { Camera, User } from "lucide-react";
import { signalCollectionRefresh } from '@/hooks/useEventDrivenRefresh';
import { PremiumPageLoader } from "@/components/LoadingSpinner";
import { useDebouncedStorage } from '@/hooks/useDebouncedStorage';


export default function EditModeratorPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { addToast } = useToast();
  // Unwrap the params promise using React's use function
  const { id: moderatorId } = use(params);

  const [moderator, setModerator] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [finalImageUrl, setFinalImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    alternatePhone: '',
    dob: '',
    joiningDate: '',
    aadharNumber: '',
    profilePhoto: null as File | null,
    profilePhotoUrl: '',
    employeeId: '',
    approvedBy: '',
    address: '',
    status: 'active' as 'active' | 'inactive',
  });

  // Debounced storage to prevent input lag
  const storage = useDebouncedStorage('moderatorEditFormData', {
    debounceMs: 500,
    excludeFields: ['profilePhoto', 'email'],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Save form data to localStorage whenever it changes (except sensitive fields)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      storage.save(formData);
    }
  }, [formData, storage]);

  const fetchModeratorData = async () => {
    try {
      setLoading(true);
      const foundModerator = await getModeratorById(moderatorId);
      if (foundModerator) {
        setModerator(foundModerator);
        const initialFormData = {
          name: foundModerator.fullName || foundModerator.name || '',
          email: foundModerator.email || '',
          phone: foundModerator.phone || '',
          alternatePhone: foundModerator.alternatePhone || foundModerator.altPhone || '',
          dob: foundModerator.dob || '',
          joiningDate: foundModerator.joiningDate || foundModerator.joinDate || '',
          aadharNumber: foundModerator.aadharNumber || '',
          profilePhoto: null,
          profilePhotoUrl: foundModerator.profilePhotoUrl || '',
          employeeId: foundModerator.employeeId || '',
          approvedBy: foundModerator.approvedBy || '',
          address: foundModerator.address || '',
          status: (foundModerator.status === 'active' || foundModerator.status === 'inactive')
            ? foundModerator.status
            : 'active' as 'active' | 'inactive',
        };

        setFormData(initialFormData);
        if (foundModerator.profilePhotoUrl) {
          setPreviewUrl(foundModerator.profilePhotoUrl);
          setFinalImageUrl(foundModerator.profilePhotoUrl);
        }
      } else {
        addToast('Moderator not found', 'error');
        router.push("/admin/moderators");
      }
    } catch (error) {
      console.error("Error fetching moderator:", error);
      addToast('Error fetching moderator data', 'error');
      router.push("/admin/moderators");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (moderatorId) {
      fetchModeratorData();
    }
  }, [moderatorId, router, addToast]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let { name, value } = e.target;

    // Numeric-only restriction for phone number fields
    if (name === 'phone' || name === 'alternatePhone') {
      value = value.replace(/[^0-9]/g, '');
    }

    setFormData(prev => ({ ...prev, [name]: value }));

    // Clear error when user starts typing
    if (errors[name]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleDateChange = (name: string, value: string) => {
    setFormData(prev => ({ ...prev, [name]: value }));

    // Clear error when user makes a selection
    if (errors[name]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  const handleImageConfirm = (newImageUrl: string, file?: File) => {
    setPreviewUrl(newImageUrl);
    setFinalImageUrl(newImageUrl);
    setImageError(false); // Reset error state on new image
    if (file) {
      setFormData(prev => ({ ...prev, profilePhoto: file }));
    }
    setIsImageModalOpen(false);
  };

  const handleImageRemove = () => {
    setPreviewUrl(null);
    setFinalImageUrl(null);
    setFormData(prev => ({ ...prev, profilePhoto: null, profilePhotoUrl: '' }));
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = "Full name is required";
    }

    if (!formData.phone.trim()) {
      newErrors.phone = "Phone number is required";
    } else if (!/^\d{10,}$/.test(formData.phone)) {
      newErrors.phone = "Phone number must be at least 10 digits";
    }

    if (formData.alternatePhone && !/^\d{10,}$/.test(formData.alternatePhone)) {
      newErrors.alternatePhone = "Alternate phone number must be at least 10 digits";
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

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      addToast('Please fix the errors in the form', 'error');
      return;
    }

    setLoadingSubmit(true);

    try {
      let profilePhotoUrl = formData.profilePhotoUrl;

      // Upload profile photo to Cloudinary if provided
      if (formData.profilePhoto) {
        try {
          const originalProfilePhotoUrl = moderator?.profilePhotoUrl || '';
          const formDataUpload = new FormData();
          formDataUpload.append('file', formData.profilePhoto);

          // SECURITY: Get auth token for the secured upload route
          const { auth } = await import('@/lib/firebase');
          const idToken = await auth.currentUser?.getIdToken();

          const response = await fetch('/api/upload', {
            method: 'POST',
            headers: idToken ? { 'Authorization': `Bearer ${idToken}` } : {},
            body: formDataUpload,
          });

          if (!response.ok) {
            throw new Error('Failed to upload profile photo');
          }

          const uploadResult = await response.json();
          profilePhotoUrl = uploadResult.url;

          // Delete old Cloudinary image if photo changed and old image exists
          if (originalProfilePhotoUrl && originalProfilePhotoUrl !== profilePhotoUrl) {
            try {
              const { auth } = await import('@/lib/firebase');
              const { currentUser } = auth;
              if (currentUser) {
                const idToken = await currentUser.getIdToken();
                await fetch('/api/update-profile-photo', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    idToken,
                    targetType: 'moderator',
                    targetId: moderatorId,
                    newImageUrl: profilePhotoUrl,
                    oldImageUrl: originalProfilePhotoUrl,
                  }),
                });
              }
            } catch (cleanupError) {
              console.warn('Failed to cleanup old profile image:', cleanupError);
              // Continue with the update even if cleanup fails
            }
          }
        } catch (uploadError: any) {
          addToast(`Failed to upload profile photo: ${uploadError.message}`, 'error');
          setLoadingSubmit(false);
          return;
        }
      }

      // Prepare data for update
      const updateData: any = {
        name: formData.name,
        fullName: formData.name, // For consistency
        email: formData.email,
        phone: formData.phone,
        alternatePhone: formData.alternatePhone,
        dob: formData.dob,
        joiningDate: formData.joiningDate,
        aadharNumber: formData.aadharNumber,
        employeeId: formData.employeeId,
        profilePhotoUrl: profilePhotoUrl,
        approvedBy: formData.approvedBy,
        address: formData.address,
        status: formData.status,
      };

      const updatedModerator = await updateModerator(moderatorId, updateData);

      if (updatedModerator) {
        // Clear saved form data on successful submission
        if (typeof window !== 'undefined') {
          localStorage.removeItem('moderatorEditFormData');
        }

        addToast('Moderator updated successfully!', 'success');

        // Signal the moderators list page to refresh when it's rendered
        signalCollectionRefresh('moderators');

        router.push("/admin/moderators");
      } else {
        addToast('Failed to update moderator', 'error');
      }
    } catch (error: any) {
      console.error("Error updating moderator:", error);
      addToast(`Failed to update moderator: ${error.message || 'Unknown error'}`, 'error');
    } finally {
      setLoadingSubmit(false);
    }
  };

  const handleReset = () => {
    if (moderatorId) {
      fetchModeratorData();
    }

    addToast('Form reset successfully', 'info');
  };

  if (loading) {
    return <PremiumPageLoader message="Loading moderator profile..." subMessage="Preparing editing tools..." />;
  }

  if (!moderator) {
    return (
      <div className="mt-10 min-h-screen flex items-center justify-center bg-[#010717]">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white">Moderator not found</h1>
          <Link href="/admin/moderators" className="text-blue-500 hover:text-blue-700 mt-4 inline-block">
            Back to Moderators
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-10 py-4 bg-[#010717] min-h-screen w-full overflow-x-hidden">
      {/* Header */}
      <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Edit Moderator</h1>
            <p className="text-gray-400 text-xs">Update moderator information and permissions</p>
          </div>
          <Link
            href="/admin/moderators"
            className="inline-flex items-center px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-sm border border-white/20 hover:border-white/30 rounded-lg transition-colors"
          >
            Back
          </Link>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 overflow-hidden">
        <div className="bg-gradient-to-br from-[#0E0F12] to-[#1A1B23] rounded-2xl shadow-xl border border-white/10 p-4 sm:p-10">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex flex-col items-center mb-8">
              <div
                className="relative cursor-pointer group"
                onClick={() => setIsImageModalOpen(true)}
              >
                <div className="relative">
                  {previewUrl && !imageError ? (
                    <div className="h-36 w-36 rounded-full overflow-hidden border-2 border-white/10 shadow-lg bg-gradient-to-br from-[#16171d] to-[#0e0f12]">
                      <img
                        src={previewUrl}
                        alt="Profile Preview"
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          console.error("Image load error");
                          setImageError(true);
                        }}
                      />
                    </div>
                  ) : (
                    <div className="h-36 w-36 rounded-full bg-gradient-to-br from-gray-800/50 to-gray-900/50 flex items-center justify-center border-2 border-dashed border-white/20 shadow-lg group-hover:border-white/40 transition-colors">
                      <div className="flex flex-col items-center">
                        {formData.name ? (
                          <span className="text-white font-bold text-4xl">{formData.name.charAt(0).toUpperCase()}</span>
                        ) : (
                          <User className="h-10 w-10 text-gray-500 group-hover:text-gray-300 transition-colors" />
                        )}
                      </div>
                    </div>
                  )}

                  {/* Hover Overlay */}
                  <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                    <div className="flex flex-col items-center">
                      <Camera className="h-8 w-8 text-white mb-1" />
                      <span className="text-[10px] font-bold text-white uppercase tracking-wider">Change Photo</span>
                    </div>
                  </div>
                </div>
              </div>

              {previewUrl && (
                <button
                  type="button"
                  onClick={handleImageRemove}
                  className="mt-4 text-sm text-red-400 hover:text-red-300 transition-colors"
                >
                  Remove Photo
                </button>
              )}

              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-2">Click to upload or adjust profile photo</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left Column */}
              <div className="space-y-4">
                <div>
                  <Label htmlFor="name" className="block text-xs font-medium text-gray-300 mb-1">
                    Full Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="text"
                    id="name"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    placeholder="Full name"
                    required
                    className="w-full"
                  />
                  {errors.name && <p className="text-red-500 text-[10px] mt-0.5">{errors.name}</p>}
                </div>

                <div>
                  <Label htmlFor="email" className="block text-xs font-medium text-gray-300 mb-1">
                    Email Address <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    required
                    disabled
                    className="w-full bg-white/5 border-white/10"
                  />
                  <p className="text-[10px] text-gray-500 mt-0.5 truncate">Email cannot be changed</p>
                </div>

                <div>
                  <Label htmlFor="phone" className="block text-xs font-medium text-gray-300 mb-1">
                    Phone Number <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="tel"
                    id="phone"
                    name="phone"
                    value={formData.phone}
                    onChange={handleInputChange}
                    placeholder="10-digit phone"
                    required
                    className="w-full"
                  />
                  {errors.phone && <p className="text-red-500 text-[10px] mt-0.5">{errors.phone}</p>}
                </div>

                <div>
                  <Label htmlFor="alternatePhone" className="block text-xs font-medium text-gray-300 mb-1">
                    Alternate Phone
                  </Label>
                  <Input
                    type="tel"
                    id="alternatePhone"
                    name="alternatePhone"
                    value={formData.alternatePhone}
                    onChange={handleInputChange}
                    placeholder="Optional"
                    className="w-full"
                  />
                  {errors.alternatePhone && <p className="text-red-500 text-[10px] mt-0.5">{errors.alternatePhone}</p>}
                </div>

                <div>
                  <Label htmlFor="address" className="block text-xs font-medium text-gray-300 mb-1">
                    Address
                  </Label>
                  <Textarea
                    id="address"
                    name="address"
                    value={formData.address}
                    onChange={handleTextareaChange}
                    placeholder="Full address"
                    rows={4}
                    className="resize-none w-full"
                  />
                </div>
              </div>

              {/* Right Column */}
              <div className="space-y-4">
                <div>
                  <Label htmlFor="aadharNumber" className="block text-xs font-medium text-gray-300 mb-1">
                    AADHAR Number <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="text"
                    id="aadharNumber"
                    name="aadharNumber"
                    value={formData.aadharNumber}
                    onChange={handleInputChange}
                    placeholder="AADHAR number"
                    required
                    className="w-full"
                  />
                  {errors.aadharNumber && <p className="text-red-500 text-[10px] mt-0.5">{errors.aadharNumber}</p>}
                </div>

                <div>
                  <Label htmlFor="employeeId" className="block text-xs font-medium text-gray-300 mb-1">
                    Employee/Staff ID
                  </Label>
                  <Input
                    type="text"
                    id="employeeId"
                    name="employeeId"
                    value={formData.employeeId}
                    onChange={handleInputChange}
                    placeholder="Employee ID"
                    className="w-full"
                  />
                </div>

                <div>
                  <EnhancedDatePicker
                    id="dob"
                    label="Date of Birth"
                    value={formData.dob}
                    onChange={(value) => handleDateChange('dob', value)}
                    required
                    validationType="dob-moderator"
                    className="w-full"
                  />
                  {errors.dob && <p className="text-red-500 text-[10px] mt-0.5">{errors.dob}</p>}
                </div>

                <div>
                  <EnhancedDatePicker
                    id="joiningDate"
                    label="Joining Date"
                    value={formData.joiningDate}
                    onChange={(value) => handleDateChange('joiningDate', value)}
                    required
                    validationType="joining"
                    className="w-full"
                  />
                  {errors.joiningDate && <p className="text-red-500 text-[10px] mt-0.5">{errors.joiningDate}</p>}
                </div>

                <div>
                  <Label htmlFor="approvedBy" className="block text-xs font-medium text-gray-300 mb-1">
                    Approved By
                  </Label>
                  <Input
                    type="text"
                    id="approvedBy"
                    name="approvedBy"
                    value={formData.approvedBy}
                    readOnly
                    className="bg-white/5 border-white/10 cursor-not-allowed w-full text-gray-400"
                    disabled
                  />

                </div>

                <div>
                  <Label htmlFor="status" className="block text-xs font-medium text-gray-300 mb-1">
                    Status <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={formData.status}
                    onValueChange={(value: 'active' | 'inactive') => setFormData(prev => ({ ...prev, status: value }))}
                  >
                    <SelectTrigger className="w-full bg-white/5 border-white/10 text-white">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0E0F12] border-white/10 text-white">
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row justify-end gap-3 pt-6 border-t border-white/10">
              <Button
                type="button"
                onClick={handleReset}
                className="w-full sm:w-auto bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border border-blue-600/20 px-6 transition-all duration-200 order-2 sm:order-1"
              >
                Reset
              </Button>
              <Link href="/admin/moderators" className="w-full sm:w-auto order-3 sm:order-2">
                <Button type="button" className="w-full bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-600/20 px-6 transition-all duration-200">
                  Cancel
                </Button>
              </Link>
              <Button
                type="submit"
                disabled={loadingSubmit}
                className="w-full sm:w-auto bg-green-600 hover:bg-green-700 text-white px-8 shadow-lg shadow-green-900/20 transition-all duration-200 order-1 sm:order-3"
              >
                {loadingSubmit ? (
                  <div className="flex items-center space-x-2">
                    <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Updating...</span>
                  </div>
                ) : (
                  "Update Moderator"
                )}
              </Button>
            </div>
          </form>
        </div>
      </div>

      <ProfileImageAddModal
        isOpen={isImageModalOpen}
        onClose={() => setIsImageModalOpen(false)}
        onConfirm={handleImageConfirm}
        immediateUpload={false}
      />
    </div>
  );
}