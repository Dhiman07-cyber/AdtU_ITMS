"use client";

import React, { useState, useEffect, useRef } from "react";
import { use } from "react";
import { useRouter } from "next/navigation";
import { signalCollectionRefresh } from '@/hooks/useEventDrivenRefresh';
import FacultyDepartmentSelector from '@/components/faculty-department-selector';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from '@/contexts/toast-context';
import { Info, Camera, AlertTriangle } from "lucide-react";
import { getAllRoutes, getAllBuses, Route, getStudentById, updateStudent } from '@/lib/dataService';
import { PremiumPageLoader } from '@/components/LoadingSpinner';
import EnhancedDatePicker from "@/components/enhanced-date-picker";
import ProfileImageAddModal from "@/components/ProfileImageAddModal";
import { cn } from "@/lib/utils";
import { normalizeShift } from "@/lib/utils/shift-utils";

// Define the form data type - matching ADD form exactly
type StudentFormData = {
  name: string;
  email: string;
  phone: string;
  alternatePhone: string;
  enrollmentId: string;
  gender: string;
  dob: string;
  faculty: string;
  department: string;
  semester: string;
  parentName: string;
  parentPhone: string;
  busAssigned: string;
  busId?: string;
  routeId: string;
  profilePhoto: File | null;
  profilePhotoUrl: string;
  address: string;
  bloodGroup: string;
  shift: string;
  approvedBy: string;
  // Bus Session System Fields
  sessionDuration: string;
  sessionStartYear: number;
  sessionEndYear: number;
  validUntil: string;
  pickupPoint: string;
};

export default function EditStudentPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { addToast } = useToast();
  // Unwrap the params promise using React's use function
  const { id: studentId } = use(params);

  // State for routes and buses
  const [routes, setRoutes] = useState<Route[]>([]);
  const [buses, setBuses] = useState<any[]>([]);
  const [loadingRoutes, setLoadingRoutes] = useState(true);
  const [loadingBuses, setLoadingBuses] = useState(true);
  const [facultySelected, setFacultySelected] = useState(false);
  const [deadlineConfig, setDeadlineConfig] = useState<any>(null);

  // Fetch deadline config
  useEffect(() => {
    const fetchDeadlineConfig = async () => {
      try {
        const response = await fetch('/api/settings/deadline-config');
        if (response.ok) {
          const data = await response.json();
          setDeadlineConfig(data.config || data);
        }
      } catch (error) {
        console.error("Error fetching deadline config:", error);
      }
    };
    fetchDeadlineConfig();
  }, []);

  const [loading, setLoading] = useState(true);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [formData, setFormData] = useState<StudentFormData>({
    name: '',
    email: '',
    phone: '',
    alternatePhone: '',
    enrollmentId: '',
    gender: '',
    dob: '',
    faculty: '',
    department: '',
    semester: '',
    parentName: '',
    parentPhone: '',
    busAssigned: '',
    routeId: '',
    profilePhoto: null,
    profilePhotoUrl: '',
    address: '',
    bloodGroup: '',
    shift: '',
    approvedBy: '',
    sessionDuration: '1',
    sessionStartYear: new Date().getUTCFullYear(),
    sessionEndYear: new Date().getUTCFullYear() + 1,
    validUntil: new Date(Date.UTC(new Date().getUTCFullYear() + 1, 5, 30, 23, 59, 59, 999)).toISOString(),
    pickupPoint: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Fetch routes when component mounts
  useEffect(() => {
    const fetchRoutesAndBuses = async () => {
      try {
        const [routesData, busesData] = await Promise.all([
          getAllRoutes(),
          getAllBuses()
        ]);
        setRoutes(routesData);
        setBuses(busesData);
      } catch (error) {
        console.error('Error fetching data:', error);
        addToast('Failed to load routes and buses', 'error');
      } finally {
        setLoadingRoutes(false);
        setLoadingBuses(false);
      }
    };

    fetchRoutesAndBuses();
  }, [addToast]);

  // Format bus assignment display when buses are loaded or initial data is set
  useEffect(() => {
    if (buses.length > 0 && formData.busId) {
      const bus = buses.find(b => b.id === formData.busId || b.busId === formData.busId);
      if (bus) {
        let busNumber = bus.displayIndex || bus.sequenceNumber;
        const busIdStr = bus.id || bus.busId || '';

        if (!busNumber && busIdStr.includes('_')) {
          busNumber = busIdStr.split('_')[1];
        }

        if (!busNumber) {
          busNumber = bus.busNumber || '?';
        }

        const licensePlate = bus.licensePlate || bus.plateNumber || (bus.busNumber !== busNumber ? bus.busNumber : 'N/A');
        const formatted = `Bus-${busNumber} (${licensePlate})`;

        if (formData.busAssigned !== formatted) {
          setFormData(prev => ({ ...prev, busAssigned: formatted }));
        }
      }
    }
  }, [buses, formData.busId]);




  const fetchStudentData = async () => {
    try {
      setLoading(true);
      const studentData = await getStudentById(studentId);

      if (studentData) {
        const initialFormData: StudentFormData = {
          name: studentData.fullName || studentData.name || '',
          email: studentData.email || '',
          phone: studentData.phoneNumber || studentData.phone || '',
          alternatePhone: studentData.alternatePhone || studentData.altPhone || '',
          enrollmentId: studentData.enrollmentId || '',
          gender: studentData.gender || '',
          dob: studentData.dob || '',
          faculty: studentData.faculty || '',
          department: studentData.department || '',
          semester: studentData.semester || '',
          parentName: studentData.parentName || '',
          parentPhone: studentData.parentPhone || '',
          busAssigned: studentData.busAssigned || '',
          busId: studentData.busId || '',
          routeId: studentData.routeId || studentData.assignedRouteId || '',
          profilePhoto: null,
          profilePhotoUrl: studentData.profilePhotoUrl || '',
          address: studentData.address || studentData.location || '',
          bloodGroup: studentData.bloodGroup || '',
          shift: normalizeShift(studentData.shift),
          approvedBy: studentData.approvedBy || '',
          sessionDuration: studentData.sessionDuration?.toString() || '1',
          sessionStartYear: studentData.sessionStartYear || new Date().getUTCFullYear(),
          sessionEndYear: studentData.sessionEndYear || (new Date().getUTCFullYear() + 1),
          validUntil: studentData.validUntil || (deadlineConfig ? new Date(Date.UTC(studentData.sessionEndYear || (new Date().getUTCFullYear() + 1), deadlineConfig.academicYear?.anchorMonth ?? 5, deadlineConfig.academicYear?.anchorDay ?? 30, 23, 59, 59, 999)).toISOString() : new Date(Date.UTC(new Date().getUTCFullYear() + 1, 5, 30, 23, 59, 59, 999)).toISOString()),
          // PRIORITIZE stopName as requested by user since it's the valid field in Firestore
          pickupPoint: studentData.stopName || studentData.pickupPoint || studentData.stopId || '',
        };

        setFormData(initialFormData);
        setPreviewUrl(studentData.profilePhotoUrl || null);
        setFacultySelected(!!studentData.faculty);
      } else {
        addToast('Student not found', 'error');
        router.push("/admin/students");
      }
    } catch (error: any) {
      console.error("Error fetching student data:", error);
      addToast(`Failed to fetch student data: ${error.message || 'Unknown error'}`, 'error');
      router.push("/admin/students");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (studentId) {
      fetchStudentData();
    }
  }, [studentId]);


  const handleFacultySelect = (faculty: string) => {
    setFormData(prev => ({ ...prev, faculty }));
    setFacultySelected(true);
  };

  const handleDepartmentSelect = (department: string) => {
    setFormData(prev => ({ ...prev, department }));
  };

  const formatApprovedBy = (val: string) => {
    if (!val) return '';
    return val.replace(/\(ADMIN\)/gi, '(Admin)');
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    let { name, value } = e.target;

    if (name === 'phone' || name === 'alternatePhone' || name === 'parentPhone') {
      value = value.replace(/[^0-9]/g, '');
    }

    setFormData(prev => ({ ...prev, [name]: value }));

    if (errors[name]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData(prev => ({ ...prev, [name]: value }));

    if (errors[name]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  const handleDateChange = (name: string, value: string) => {
    setFormData(prev => ({ ...prev, [name]: value }));

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
    setImageError(false);
    if (file) {
      setFormData(prev => ({ ...prev, profilePhoto: file }));
    }
    setIsImageModalOpen(false);
  };

  // Validation function
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



    if (!formData.gender) {
      newErrors.gender = "Gender is required";
    }

    if (!formData.faculty) {
      newErrors.faculty = "Faculty is required";
    }

    if (!formData.department) {
      newErrors.department = "Department is required";
    }

    if (!formData.parentName.trim()) {
      newErrors.parentName = "Parent name is required";
    }

    if (!formData.parentPhone.trim()) {
      newErrors.parentPhone = "Parent phone number is required";
    }

    if (!formData.enrollmentId.trim()) {
      newErrors.enrollmentId = "Enrollment ID is required";
    }

    if (!formData.dob) {
      newErrors.dob = "Date of birth is required";
    }

    if (!formData.routeId) {
      newErrors.routeId = "Route is required";
    }

    if (!formData.shift) {
      newErrors.shift = "Shift is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (validateForm()) {
      try {
        setLoading(true);

        const currentStudent = await getStudentById(studentId);
        const originalProfilePhotoUrl = currentStudent?.profilePhotoUrl || '';

        let profilePhotoUrl = formData.profilePhotoUrl;
        if (formData.profilePhoto) {
          try {
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
                      targetType: 'student',
                      targetId: studentId,
                      newImageUrl: profilePhotoUrl,
                      oldImageUrl: originalProfilePhotoUrl,
                    }),
                  });
                }
              } catch (cleanupError) {
                console.warn('Failed to cleanup old profile image:', cleanupError);
              }
            }
          } catch (uploadError: any) {
            addToast(`Failed to upload profile photo: ${uploadError.message}`, 'error');
            setLoading(false);
            return;
          }
        }

        const updateData: any = {
          name: formData.name,
          fullName: formData.name,
          phone: formData.phone,
          alternatePhone: formData.alternatePhone,
          enrollmentId: formData.enrollmentId,
          gender: formData.gender,
          faculty: formData.faculty,
          department: formData.department,
          semester: formData.semester,
          parentName: formData.parentName,
          parentPhone: formData.parentPhone,
          dob: formData.dob,
          routeId: formData.routeId,
          busAssigned: formData.busAssigned,
          busId: formData.busId,
          profilePhotoUrl: profilePhotoUrl,
          address: formData.address,
          bloodGroup: formData.bloodGroup,
          shift: formData.shift,
          sessionDuration: parseInt(formData.sessionDuration),
          sessionStartYear: formData.sessionStartYear,
          sessionEndYear: formData.sessionEndYear,
          validUntil: formData.validUntil,
          pickupPoint: formData.pickupPoint,
        };

        const updatedStudent = await updateStudent(studentId, updateData);

        if (updatedStudent) {
          addToast('Student updated successfully!', 'success');
          // Signal the students list page to refresh when it's rendered
          signalCollectionRefresh('students');
          router.push("/admin/students");
        } else {
          addToast('Failed to update student', 'error');
        }
      } catch (error: any) {
        console.error("Error updating student:", error);
        addToast(`Failed to update student: ${error.message || 'Unknown error'}`, 'error');
      } finally {
        setLoading(false);
      }
    } else {
      addToast('Please fix the errors in the form', 'error');
    }
  };

  const handleReset = () => {
    if (studentId) {
      fetchStudentData();
    }
    addToast('Form reset successfully', 'info');
  };

  const selectedBus = buses.find(b => b.id === formData.busId || b.busId === formData.busId);
  const busShift = selectedBus?.shift?.toLowerCase() || '';
  const selectedShift = formData.shift?.toLowerCase() || '';
  const hasShiftConflict = selectedBus && busShift !== 'both' && busShift !== selectedShift;

  if (loading || loadingRoutes || loadingBuses) {
    return <PremiumPageLoader message="Loading student profile..." subMessage="Preparing editing tools..." />;
  }

  return (
    <div className="mt-10 py-4 bg-[#010717] min-h-screen w-full overflow-x-hidden">
      {/* Header */}
      <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Edit Student</h1>
            <p className="text-gray-400 text-xs">Update student details including faculty and department information</p>
          </div>
          <Link
            href="/admin/students"
            className="inline-flex items-center px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-sm border border-white/20 hover:border-white/30 rounded-lg transition-all duration-200 hover:shadow-lg"
          >
            Back
          </Link>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 pb-10 overflow-hidden">
        <div className="bg-gradient-to-br from-[#0E0F12] to-[#1A1B23] rounded-2xl shadow-2xl border border-white/10 p-4 sm:p-10 hover:border-white/20 transition-all duration-300">
          <form onSubmit={handleSubmit} className="space-y-3">
            {/* Profile Photo Section */}
            <div className="flex flex-col items-center mb-8">
              <div className="relative group cursor-pointer" onClick={() => setIsImageModalOpen(true)}>
                <div className="relative h-24 w-24 rounded-full overflow-hidden border-4 border-white/10 dark:border-white/10 shadow-xl ring-2 ring-blue-500/20 group-hover:ring-blue-500/40 transition-all duration-300">
                  {previewUrl && !imageError ? (
                    <img
                      src={previewUrl}
                      alt="Profile"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                      onError={() => setImageError(true)}
                    />
                  ) : (
                    <div className="h-full w-full bg-white/5 flex items-center justify-center">
                      <Camera className="h-8 w-8 text-white/20 group-hover:text-white/40 group-hover:scale-110 transition-all duration-300" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center">
                    <Camera className="h-6 w-6 text-white" />
                  </div>
                </div>

                {previewUrl && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreviewUrl(null);
                      setFormData(prev => ({ ...prev, profilePhoto: null, profilePhotoUrl: '' }));
                    }}
                    className="absolute -top-1 -right-1 p-1.5 bg-red-500/80 text-white rounded-full shadow-lg hover:bg-red-500 transition-all duration-200 z-10"
                    title="Remove photo"
                  >
                    <span className="block w-3 h-3 text-center leading-[10px] text-xs font-bold">×</span>
                  </button>
                )}
              </div>
              <p className="mt-3 text-[10px] text-gray-500 font-medium uppercase tracking-wider">Student Profile Photo</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Left Column */}
              <div className="space-y-3">
                <div>
                  <Label htmlFor="name" className="block text-xs font-medium text-gray-400 mb-1">Full Name</Label>
                  <Input
                    type="text"
                    id="name"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    required
                    className="h-9 w-full bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-blue-500/50"
                  />
                  {errors.name && <p className="text-red-500 text-[10px] mt-1">{errors.name}</p>}
                </div>

                <div>
                  <Label htmlFor="gender" className="block text-xs font-medium text-gray-400 mb-1">Gender</Label>
                  <Select
                    key={formData.gender}
                    value={formData.gender}
                    onValueChange={(value) => handleSelectChange('gender', value)}
                  >
                    <SelectTrigger className="h-9 w-full bg-blue-600/10 border-blue-500/20 text-white">
                      <SelectValue placeholder="Select Gender" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0E0F12] border-white/10 text-white">
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  {errors.gender && <p className="text-red-500 text-[10px] mt-1">{errors.gender}</p>}
                </div>

                <div>
                  <EnhancedDatePicker
                    id="dob"
                    label="Date of Birth"
                    value={formData.dob}
                    onChange={(value) => handleDateChange('dob', value)}
                    required
                    validationType="dob-student"
                    className="h-9 w-full bg-white/5 border-white/10 text-white"
                  />
                  {errors.dob && <p className="text-red-500 text-[10px] mt-1">{errors.dob}</p>}
                </div>

                <div>
                  <Label htmlFor="phone" className="block text-xs font-medium text-gray-400 mb-1">Phone Number</Label>
                  <Input
                    type="tel"
                    id="phone"
                    name="phone"
                    value={formData.phone}
                    onChange={handleInputChange}
                    required
                    className="h-9 w-full bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-blue-500/50"
                  />
                  {/* Fixed phone input syntax */}
                  {errors.phone && <p className="text-red-500 text-[10px] mt-1">{errors.phone}</p>}
                </div>

                <div>
                  <Label htmlFor="email" className="block text-xs font-medium text-gray-400 mb-1">Email Address</Label>
                  <Input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    readOnly
                    className="h-9 bg-white/5 border-white/10 text-white/50 cursor-not-allowed"
                  />
                </div>

                <div>
                  <Label htmlFor="alternatePhone" className="block text-xs font-medium text-gray-400 mb-1">Alternate Phone Number</Label>
                  <Input
                    type="tel"
                    id="alternatePhone"
                    name="alternatePhone"
                    value={formData.alternatePhone}
                    onChange={handleInputChange}
                    className="h-9 w-full bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-blue-500/50"
                  />
                </div>

                <div>
                  <Label htmlFor="address" className="block text-xs font-medium text-gray-400 mb-1">Address</Label>
                  <Textarea
                    id="address"
                    name="address"
                    value={formData.address}
                    onChange={handleInputChange}
                    className="resize-none w-full text-xs min-h-[110px] bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-blue-500/50"
                  />
                </div>
              </div>

              {/* Right Column */}
              <div className="space-y-3 pt-[1px]">
                <div className="space-y-1">
                  <FacultyDepartmentSelector
                    onFacultySelect={handleFacultySelect}
                    onDepartmentSelect={handleDepartmentSelect}
                    initialFaculty={formData.faculty}
                    initialDepartment={formData.department}
                  />
                </div>

                <div>
                  <Label htmlFor="parentName" className="block text-xs font-medium text-gray-400 mb-1">Parent Name</Label>
                  <Input
                    type="text"
                    id="parentName"
                    name="parentName"
                    value={formData.parentName}
                    onChange={handleInputChange}
                    required
                    className="h-9 w-full bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-blue-500/50"
                  />
                </div>

                <div>
                  <Label htmlFor="parentPhone" className="block text-xs font-medium text-gray-400 mb-1">Parent Phone Number</Label>
                  <Input
                    type="tel"
                    id="parentPhone"
                    name="parentPhone"
                    value={formData.parentPhone}
                    onChange={handleInputChange}
                    required
                    className="h-9 w-full bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-blue-500/50"
                  />
                </div>

                <div>
                  <Label htmlFor="semester" className="block text-xs font-medium text-gray-400 mt-3 mb-1">Semester</Label>
                  <Select
                    key={formData.semester}
                    value={formData.semester}
                    onValueChange={(value) => handleSelectChange('semester', value)}
                  >
                    <SelectTrigger className="h-9 w-full bg-blue-600/10 border-blue-500/20 text-white">
                      <SelectValue placeholder="Select Semester" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0E0F12] border-white/10 text-white">
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((sem) => {
                        const label = sem === 1 ? '1st Semester' : sem === 2 ? '2nd Semester' : sem === 3 ? '3rd Semester' : `${sem}th Semester`;
                        return <SelectItem key={sem} value={label}>{label}</SelectItem>;
                      })}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="enrollmentId" className="block text-xs font-medium text-gray-400 mb-1">Enrollment ID</Label>
                  <Input
                    type="text"
                    id="enrollmentId"
                    name="enrollmentId"
                    value={formData.enrollmentId}
                    onChange={handleInputChange}
                    required
                    className="h-9 w-full bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-blue-500/50"
                  />
                </div>

                <div>
                  <Label htmlFor="bloodGroup" className="block text-xs font-medium text-gray-400 mb-1">Blood Group</Label>
                  <Select
                    key={formData.bloodGroup}
                    value={formData.bloodGroup}
                    onValueChange={(value) => handleSelectChange('bloodGroup', value)}
                  >
                    <SelectTrigger className="h-9 w-full bg-blue-600/10 border-blue-500/20 text-white">
                      <SelectValue placeholder="Select Blood Group" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0E0F12] border-white/10 text-white">
                      {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(bg => (
                        <SelectItem key={bg} value={bg}>{bg}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="approvedBy" className="block text-xs font-medium text-gray-400 mb-1">Approved By</Label>
                  <Input
                    type="text"
                    id="approvedBy"
                    name="approvedBy"
                    value={formatApprovedBy(formData.approvedBy)}
                    readOnly
                    className="bg-white/5 w-full border-white/10 text-white/50 cursor-not-allowed h-9"
                  />
                  <p className="text-[10px] text-gray-500 mt-0.5">This field is auto-filled and cannot be changed.</p>
                </div>
              </div>
            </div>

            {/* BUS SERVICE SESSION DETAILS */}
            <div className="mt-8 pt-6 border-t border-white/10">
              <h3 className="text-sm font-semibold mb-4 text-white flex items-center gap-2">
                <div className="w-1.5 h-4 bg-blue-500 rounded-full"></div>
                Bus Service Session Details
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-4">
                <div>
                  <Label htmlFor="shift" className="block text-xs font-medium text-gray-400 mb-1">Shift <span className="text-red-500">*</span></Label>
                  <Select
                    key={formData.shift}
                    value={formData.shift}
                    onValueChange={(value) => handleSelectChange('shift', value)}
                  >
                    <SelectTrigger className="h-9 w-full bg-blue-600/10 border-blue-500/20 text-white">
                      <SelectValue placeholder="Select Shift" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0E0F12] border-white/10 text-white">
                      <SelectItem value="Morning">Morning Shift</SelectItem>
                      <SelectItem value="Evening">Evening Shift</SelectItem>
                    </SelectContent>
                  </Select>
                  {hasShiftConflict && (
                    <div className="text-[10px] text-red-500 mt-2 bg-red-500/10 border border-red-500/20 p-2 rounded flex items-start gap-1.5 leading-relaxed">
                      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                      <span>
                        The assigned bus ({formData.busAssigned}) does not operate in the {formData.shift} shift. Please use the <Link href="/admin/smart-allocation" className="underline hover:text-red-400">Student Reassignment</Link> portal to change shift and bus together, or revert the shift.
                      </span>
                    </div>
                  )}
                </div>

                <div>
                  <Label className="block text-xs font-medium text-gray-400 mb-1">Session Duration</Label>
                  <div
                    onClick={() => addToast('To renew or change session duration, please visit the Student Renewal page.', 'info')}
                    className="cursor-default group"
                  >
                    <div className="h-9 px-3 flex items-center bg-white/5 border border-dashed border-white/20 rounded-md text-sm text-white/50 group-hover:bg-white/[0.08] transition-all duration-200 overflow-hidden">
                      <span className="truncate">
                        {formData.sessionDuration} {parseInt(formData.sessionDuration) === 1 ? 'Year' : 'Years'}
                      </span>
                    </div>
                  </div>

                </div>

                {/* Assigned Route and Assigned Bus */}
                <div>
                  <Label className="block text-xs font-medium text-gray-400 mb-1">Assigned Route</Label>
                  <div
                    onClick={() => addToast('To reassign students to a different route, please visit the Student Reassignment page.', 'info')}
                    className="cursor-default group"
                  >
                    <div className="h-9 px-3 flex items-center bg-white/5 border border-dashed border-white/20 rounded-md text-sm text-white/50 group-hover:bg-white/[0.08] transition-all duration-200 overflow-hidden">
                      <span className="truncate">
                        {routes.find(r => (r.routeId || r.id) === formData.routeId)?.routeName || routes.find(r => (r.routeId || r.id) === formData.routeId)?.route || formData.routeId || 'No route assigned'}
                      </span>
                    </div>
                  </div>
                  <div className="text-[10px] text-amber-500/80 mt-1.5 flex items-start gap-1.5 font-medium leading-relaxed">
                    <Info className="h-3 w-3 mt-0.5 shrink-0" />
                    <span className="break-words">
                      Visit <Link href="/admin/smart-allocation" className="underline hover:text-amber-400 transition-colors">Student Reassignment</Link> to change assignments
                    </span>
                  </div>
                </div>

                <div>
                  <Label className="block text-xs font-medium text-gray-400 mb-1">Assigned Bus</Label>
                  <div
                    onClick={() => addToast('To reassign students to a different bus, please visit the Student Reassignment page.', 'info')}
                    className="cursor-default group"
                  >
                    <div className="h-9 px-3 flex items-center bg-white/5 border border-dashed border-white/20 rounded-md text-sm text-white/50 group-hover:bg-white/[0.08] transition-all duration-200 overflow-hidden">
                      <span className="truncate">{formData.busAssigned || 'No bus assigned'}</span>
                    </div>
                  </div>
                  <div className="text-[10px] text-amber-500/80 mt-1.5 flex items-start gap-1.5 font-medium leading-relaxed">
                    <Info className="h-3 w-3 mt-0.5 shrink-0" />
                    <span className="break-words">
                      Visit <Link href="/admin/smart-allocation" className="underline hover:text-amber-400 transition-colors">Student Reassignment</Link> to change assignments
                    </span>
                  </div>
                </div>

                <div>
                  <Label className="block text-xs font-medium text-gray-400 mb-1">Pickup Point / Stop</Label>
                  <Select
                    key={`${formData.routeId}-${formData.pickupPoint}`}
                    value={formData.pickupPoint}
                    onValueChange={(value) => handleSelectChange('pickupPoint', value)}
                  >
                    <SelectTrigger className="h-9 w-full bg-blue-600/10 border-blue-500/20 text-white capitalize">
                      <SelectValue placeholder={formData.pickupPoint || "Select Pickup Point"} />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0E0F12] border-white/10 text-white">
                      {(() => {
                        const route = routes.find(r =>
                          (r.routeId === formData.routeId) ||
                          (r.id === formData.routeId) ||
                          (r.routeId && formData.routeId && r.routeId.toString() === formData.routeId.toString())
                        );

                        const stops = route?.stops?.map((stop: any) => typeof stop === 'string' ? stop : stop.name) || [];
                        const currentPoint = formData.pickupPoint;

                        // Ensure current value is in the list
                        if (currentPoint && !stops.includes(currentPoint)) {
                          stops.unshift(currentPoint);
                        }

                        if (stops.length === 0 && currentPoint) {
                          return (
                            <SelectItem value={currentPoint} className="capitalize">
                              {currentPoint}
                            </SelectItem>
                          )
                        }

                        return stops.slice(0, -1).map((stopName: string, idx: number) => (
                          <SelectItem key={`${stopName}-${idx}`} value={stopName} className="capitalize">
                            {stopName}
                          </SelectItem>
                        ));
                      })()}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="block text-xs font-medium text-gray-400 mb-1">Session Start Year</Label>
                  <div
                    onClick={() => addToast('Session years can only be modified through the Student Renewal page.', 'info')}
                    className="cursor-default group"
                  >
                    <div className="h-9 px-3 flex items-center bg-white/5 border border-dashed border-white/20 rounded-md text-sm text-white/50 group-hover:bg-white/[0.08] transition-all duration-200 overflow-hidden">
                      <span className="truncate">{formData.sessionStartYear}</span>
                    </div>
                  </div>

                </div>

                <div>
                  <Label className="block text-xs font-medium text-gray-400 mb-1">Session End Year</Label>
                  <div className="h-9 px-3 flex items-center bg-white/5 border border-white/10 rounded-md text-sm text-white/50 cursor-not-allowed">
                    {formData.sessionEndYear}
                  </div>

                </div>

                <div>
                  <Label className="block text-xs font-medium text-gray-400 mb-1">Valid Until</Label>
                  <div className="h-9 px-3 flex items-center bg-white/5 border border-white/10 rounded-md text-sm text-white/50 cursor-not-allowed">
                    {formData.validUntil && !isNaN(new Date(formData.validUntil).getTime())
                      ? new Date(formData.validUntil).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
                      : 'N/A'}
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row justify-end gap-3 mt-10 pt-6 border-t border-white/10">
                <Button
                  type="button"
                  onClick={handleReset}
                  className="w-full sm:w-auto bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border border-blue-600/20 px-6 transition-all duration-200 order-2 sm:order-1"
                >
                  Reset
                </Button>
                <Button
                  type="button"
                  onClick={() => router.push('/admin/students')}
                  className="w-full sm:w-auto bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-600/20 px-6 transition-all duration-200 order-3 sm:order-2"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={loading || !!hasShiftConflict}
                  className={cn(
                    "w-full sm:w-auto px-8 transition-all duration-200 order-1 sm:order-3",
                    hasShiftConflict 
                      ? "bg-red-600/50 text-white/50 cursor-not-allowed" 
                      : "bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-900/20 text-white"
                  )}
                >
                  {loading ? 'Updating...' : hasShiftConflict ? 'Shift Conflict' : 'Update Student'}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </div >

      <ProfileImageAddModal
        isOpen={isImageModalOpen}
        onClose={() => setIsImageModalOpen(false)}
        onConfirm={handleImageConfirm}
        immediateUpload={false}
      />
    </div >
  );
}