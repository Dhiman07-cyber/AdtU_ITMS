import FacultyDepartmentSelector from '@/components/faculty-department-selector';
import { OptimizedInput } from '@/components/forms/OptimizedInput';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select';
import { ArrowLeft,ArrowRight } from 'lucide-react';
import { AcademicStepProps } from './types';

export default function Step2Academic({
  formData,
  handleInputChange,
  onNext,
  onPrev,
  handleFacultySelect,
  handleDepartmentSelect,
  onClear
}: AcademicStepProps) {
  return (
    <div className="space-y-8 flex-1 flex flex-col">
      <div className="flex items-start justify-between gap-4 border-b border-slate-800/40 pb-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white mb-1">Academic Information</h2>
          <p className="text-sm text-slate-400">Please provide your current course and enrollment details.</p>
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-6 pt-4">
        <div className="md:col-span-2">
          <FacultyDepartmentSelector
            onFacultySelect={handleFacultySelect}
            onDepartmentSelect={handleDepartmentSelect}
            initialFaculty={formData.faculty}
            initialDepartment={formData.department}
          />
        </div>

        <div>
          <Label htmlFor="semester" className="block text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-2">
            Semester <span className="text-red-500">*</span>
          </Label>
          <Select
            value={formData.semester}
            onValueChange={(value) => handleInputChange('semester', value)}
          >
            <SelectTrigger className="h-10 bg-transparent border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors text-xs">
              <SelectValue placeholder="Select Semester" />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-800">
              {['1st Semester', '2nd Semester', '3rd Semester', '4th Semester', '5th Semester', '6th Semester', '7th Semester', '8th Semester'].map((sem) => (
                <SelectItem key={sem} value={sem}>{sem}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <OptimizedInput
          id="enrollmentId"
          label="Enrollment ID"
          value={formData.enrollmentId}
          onChange={(value) => handleInputChange('enrollmentId', value)}
          placeholder="Enter enrollment ID"
          required
          className="h-10 text-xs"
          labelClassName="text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-2"
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
