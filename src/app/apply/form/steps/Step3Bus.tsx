import RouteSelectionSection from '@/components/RouteSelectionSection';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select';
import { ArrowLeft,ArrowRight } from 'lucide-react';
import { BusStepProps } from './types';

export default function Step3Bus({
  formData,
  handleInputChange,
  onNext,
  onPrev,
  routes,
  buses,
  setCapacityCheckResult,
  handleRefChange,
  applicationState,
  onClear
}: BusStepProps) {
  return (
    <div className="space-y-8 flex-1 flex flex-col">
      <div className="flex items-start justify-between gap-4 border-b border-slate-800/40 pb-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white mb-1">Bus Details</h2>
          <p className="text-sm text-slate-400">Select your preferred route, stop, and bus shift.</p>
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

      <div className="pt-2">
        <RouteSelectionSection
          routes={routes}
          buses={buses}
          selectedRouteId={formData.routeId || ''}
          selectedBusId={formData.busId || ''}
          selected_stop_name={formData.stop_name || ''}
          selectedShift={formData.shift}
          onReferenceChange={handleRefChange}
          onCapacityCheckResult={setCapacityCheckResult}
          isReadOnly={applicationState === 'submitted'}
          hideCapacityAlerts={true}
          shiftContent={
            <div className="space-y-1">
              <Label htmlFor="shift" className="block text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-2">
                Shift Selection <span className="text-red-500">*</span>
              </Label>
              <Select
                value={formData.shift}
                onValueChange={(value) => {
                  handleInputChange('shift', value);
                  handleInputChange('routeId', '');
                  handleInputChange('busId', '');
                  handleInputChange('stop_name', '');
                  handleInputChange('busAssigned', '');
                }}
              >
                <SelectTrigger className="h-10 bg-transparent border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors text-xs text-slate-200">
                  <SelectValue placeholder="Select Shift" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800">
                  <SelectItem value="Morning">Morning Shift</SelectItem>
                  <SelectItem value="Evening">Evening Shift</SelectItem>
                </SelectContent>
              </Select>
            </div>
          }
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
