import EnhancedDatePicker from '@/components/enhanced-date-picker';
import { OptimizedInput } from '@/components/forms/OptimizedInput';
import { OptimizedSelect } from '@/components/forms/OptimizedSelect';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ArrowRight,Camera,X } from 'lucide-react';
import Image from 'next/image';
import React from 'react';
import { PersonalStepProps } from './types';

export default function Step1Personal({
  formData,
  handleInputChange,
  onNext,
  onPrev,
  currentUser,
  profilePhotoUrl,
  finalImageUrl,
  setShowProfileUpdateModal,
  handleImageRemove,
  onClear
}: PersonalStepProps) {
  const [localAddress, setLocalAddress] = React.useState(formData.address);

  React.useEffect(() => {
    setLocalAddress(formData.address);
  }, [formData.address]);

  return (
    <div className="space-y-4 flex-1 flex flex-col">
      <div className="flex items-start justify-between gap-4 border-b border-slate-800/40 pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white mb-0.5">Your Profile</h2>
          <p className="text-xs text-slate-500">All fields are required. This information is saved to your account.</p>
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

      <div className="flex flex-col items-center justify-center mb-6 pt-2">
        <div className="relative group cursor-pointer" onClick={() => setShowProfileUpdateModal(true)}>
          {finalImageUrl ? (
            <div className="relative h-24 w-24 sm:h-28 sm:w-28 rounded-full overflow-hidden border-4 border-[#0c0e1a] shadow-xl ring-2 ring-indigo-900/50">
              <Image src={finalImageUrl} alt="Profile" fill className="object-cover" />
            </div>
          ) : (
            <div className="h-24 w-24 sm:h-28 sm:w-28 rounded-full bg-slate-900 flex items-center justify-center border-4 border-[#0c0e1a] ring-2 ring-slate-800 shadow-xl group-hover:bg-slate-800 transition-colors">
              <Camera className="h-8 w-8 text-slate-500 group-hover:text-slate-400" />
            </div>
          )}

          <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
            <Camera className="h-8 w-8 text-white drop-shadow-md" />
          </div>

          {finalImageUrl && (
            <button
              onClick={(e) => { e.stopPropagation(); handleImageRemove(); }}
              className="absolute 0 top-0 right-0 p-2 bg-red-500/90 hover:bg-red-500 text-white rounded-full shadow-lg z-10 transition-transform hover:scale-105"
              title="Remove photo"
            >
              <X className="h-4 w-4" strokeWidth={3} />
            </button>
          )}
        </div>

        <div className="mt-4 flex flex-col items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowProfileUpdateModal(true)}
            className="text-[10px] h-8 font-semibold bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            {finalImageUrl ? 'Change Photo' : 'Upload Profile Photo'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
        <OptimizedInput
          id="fullName"
          label="Full Name"
          value={formData.fullName}
          onChange={(value) => handleInputChange('fullName', value)}
          placeholder="Enter your full name"
          required
          className="h-10 text-xs"
          labelClassName="text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-2"
        />

        <OptimizedSelect
          id="gender"
          label="Gender"
          value={formData.gender}
          onChange={(value) => handleInputChange('gender', value)}
          placeholder="Select Gender"
          required
          className="h-10 text-xs"
          labelClassName="text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-2"
        >
          <SelectItem value="male">Male</SelectItem>
          <SelectItem value="female">Female</SelectItem>
          <SelectItem value="other">Other</SelectItem>
        </OptimizedSelect>

        <div>
          <Label className="block text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-2">
            Date of Birth <span className="text-red-500">*</span>
          </Label>
          <EnhancedDatePicker
            id="dob"
            value={formData.dob}
            onChange={(value) => {
              handleInputChange('dob', value);
              if (value) {
                const birthDate = new Date(value);
                const today = new Date();
                let age = today.getFullYear() - birthDate.getFullYear();
                const monthDiff = today.getMonth() - birthDate.getMonth();
                if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
                  age--;
                }
                handleInputChange('age', age.toString());
              }
            }}
            required
            validationType="dob-student"
            className="h-10 text-xs"
          />
        </div>

        <div>
          <Label htmlFor="age" className="block text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-2">
            Age
          </Label>
          <Input
            type="text"
            id="age"
            value={formData.age || ''}
            readOnly
            placeholder="Choose DOB first"
            className="bg-slate-900 border-slate-800 text-slate-500 cursor-not-allowed h-10 text-xs"
          />
        </div>

        <div>
          <Label htmlFor="bloodGroup" className="block text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-2">
            Blood Group
          </Label>
          <Select value={formData.bloodGroup} onValueChange={(v) => handleInputChange('bloodGroup', v)}>
            <SelectTrigger className="h-10 bg-transparent border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors text-xs">
              <SelectValue placeholder="Select Blood Group" />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-800">
              {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(bg => (
                <SelectItem key={bg} value={bg}>{bg}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="email" className="block text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-2">
            Email Address
          </Label>
          <Input
            type="email"
            id="email"
            value={currentUser?.email || formData.email}
            disabled
            className="bg-slate-900/50 border-slate-800 text-slate-500 cursor-not-allowed h-10 text-xs"
          />
        </div>

        <OptimizedInput
          id="phoneNumber"
          label="Phone Number"
          type="tel"
          value={formData.phoneNumber}
          onChange={(value) => handleInputChange('phoneNumber', value)}
          placeholder="10 digit phone number"
          transform={(val) => val.replace(/[^0-9]/g, '')}
          required
          className="h-10 text-xs"
          labelClassName="text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-2"
        />

        <OptimizedInput
          id="alternatePhone"
          label="Alternate Phone Number"
          type="tel"
          value={formData.alternatePhone || ''}
          onChange={(value) => handleInputChange('alternatePhone', value)}
          placeholder="10 digit phone number"
          transform={(val) => val.replace(/[^0-9]/g, '')}
          className="h-10 text-xs"
          labelClassName="text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-2"
        />

        <OptimizedInput
          id="parentName"
          label="Parent Name"
          value={formData.parentName}
          onChange={(value) => handleInputChange('parentName', value)}
          placeholder="Enter parent/guardian name"
          required
          className="h-10 text-xs"
          labelClassName="text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-2"
        />

        <OptimizedInput
          id="parentPhone"
          label="Parent Phone Number"
          type="tel"
          value={formData.parentPhone}
          onChange={(value) => handleInputChange('parentPhone', value)}
          placeholder="Parent phone number"
          transform={(val) => val.replace(/[^0-9]/g, '')}
          required
          className="h-10 text-xs"
          labelClassName="text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-2"
        />

        <div className="md:col-span-2 mt-2">
          <Label className="block text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-2">
            Address <span className="text-red-500">*</span>
          </Label>
          <p className="text-[10px] text-slate-500 mb-1.5 italic">Please provide your complete billing and residential address.</p>
          <Textarea
            id="address"
            value={localAddress}
            onChange={(e) => setLocalAddress(e.target.value)}
            onBlur={() => {
              if (localAddress !== formData.address) {
                handleInputChange('address', localAddress);
              }
            }}
            rows={3}
            required
            className="resize-none bg-transparent border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors py-2 h-24 text-xs"
            placeholder="Enter your complete address"
          />
        </div>
      </div>

      <div className="mt-auto pt-6 border-t border-slate-800 flex justify-end">
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
