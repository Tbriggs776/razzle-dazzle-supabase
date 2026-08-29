import React from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Upload, X } from "lucide-react";
import { cn } from '@/lib/utils';
import { SignedImage } from '@/lib/fileUrl';

const ROLES = ["Admin", "Design Consultant", "Customer Service Rep", "Order Processor", "Sales Manager", "Finance Manager", "Operations", "Customer Experience Coordinator"];

export default function TeamMemberForm({ teamMember, onSubmit, onCancel, isLoading }) {
  const [uploading, setUploading] = React.useState(false);
  const [formData, setFormData] = React.useState({
    first_name: teamMember?.first_name || '',
    last_name: teamMember?.last_name || '',
    email: teamMember?.email || '',
    phone: teamMember?.phone || '',
    role: teamMember?.role || 'Design Consultant',
    profile_photo: teamMember?.profile_photo || '',
    is_active: teamMember?.is_active ?? true,
    calendar_integration_enabled: teamMember?.calendar_integration_enabled ?? false,
    google_calendar_id: teamMember?.google_calendar_id || '',
    timezone: teamMember?.timezone || 'America/Phoenix',
    calendar_color: teamMember?.calendar_color || '#4F46E5',
    bio: teamMember?.bio || ''
  });

  const COLOR_PRESETS = ['#4F46E5', '#DC2626', '#16A34A', '#2563EB', '#EA580C', '#7C3AED', '#0891B2', '#D97706', '#C084FC', '#06B6D4'];

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setFormData(prev => ({ ...prev, profile_photo: file_url }));
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setUploading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Personal Information */}
      <div className="space-y-6">
        <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider">Personal Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="first_name" className="text-slate-700">First Name *</Label>
            <Input
              id="first_name"
              value={formData.first_name}
              onChange={(e) => handleChange('first_name', e.target.value)}
              required
              className="h-12 border-slate-200 focus:border-indigo-500 focus:ring-indigo-500 transition-all"
              placeholder="John"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="last_name" className="text-slate-700">Last Name *</Label>
            <Input
              id="last_name"
              value={formData.last_name}
              onChange={(e) => handleChange('last_name', e.target.value)}
              required
              className="h-12 border-slate-200 focus:border-indigo-500 focus:ring-indigo-500 transition-all"
              placeholder="Doe"
            />
          </div>
        </div>
      </div>

      {/* Contact Information */}
      <div className="space-y-6">
        <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider">Contact Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-slate-700">Email *</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => handleChange('email', e.target.value)}
              required
              className="h-12 border-slate-200 focus:border-indigo-500 focus:ring-indigo-500 transition-all"
              placeholder="john@example.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone" className="text-slate-700">Phone</Label>
            <PhoneInput
              id="phone"
              value={formData.phone}
              onChange={(e) => handleChange('phone', e.target.value)}
              className="h-12 border-slate-200 focus:border-indigo-500 focus:ring-indigo-500 transition-all"
            />
          </div>
        </div>
      </div>

      {/* Profile Photo */}
      <div className="space-y-6">
        <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider">Profile Photo</h3>
        <div className="space-y-4">
          {formData.profile_photo && (
            <div className="relative w-32 h-32 rounded-xl overflow-hidden border-2 border-slate-200">
              <SignedImage
                src={formData.profile_photo}
                alt="Profile"
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, profile_photo: '' }))}
                className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          <div>
            <input
              type="file"
              id="photo-upload"
              accept="image/*"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setUploading(true);
                try {
                  const { file_url } = await base44.integrations.Core.UploadFile({ file });
                  setFormData(prev => ({ ...prev, profile_photo: file_url }));
                } catch (error) {
                  console.error('Upload failed:', error);
                } finally {
                  setUploading(false);
                }
              }}
              className="hidden"
              disabled={uploading}
            />
            <label htmlFor="photo-upload">
              <Button
                type="button"
                variant="outline"
                disabled={uploading}
                onClick={() => document.getElementById('photo-upload').click()}
                className="h-12 px-6 border-slate-200 cursor-pointer"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Upload Photo
                  </>
                )}
              </Button>
            </label>
            <p className="text-xs text-slate-500 mt-2">Recommended: Square image, at least 200x200px</p>
          </div>
        </div>
      </div>

      {/* Bio */}
      <div className="space-y-6">
        <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider">Bio</h3>
        <div className="space-y-2">
          <Label htmlFor="bio" className="text-slate-700">Short Bio</Label>
          <Textarea
            id="bio"
            value={formData.bio}
            onChange={(e) => handleChange('bio', e.target.value)}
            className="border-slate-200 focus:border-indigo-500 focus:ring-indigo-500 transition-all resize-none"
            placeholder="A short description shown to customers on their appointment page..."
            rows={3}
          />
        </div>
      </div>

      {/* Role & Status */}
      <div className="space-y-6">
        <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider">Role & Status</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="role" className="text-slate-700">Role</Label>
            <Select value={formData.role} onValueChange={(value) => handleChange('role', value)}>
              <SelectTrigger className="h-12 border-slate-200">
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-slate-700">Active Status</Label>
            <div className="flex items-center gap-3 h-12 px-4 border border-slate-200 rounded-lg">
              <Switch
                checked={formData.is_active}
                onCheckedChange={(checked) => handleChange('is_active', checked)}
              />
              <span className="text-sm text-slate-600">
                {formData.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Calendar Color (Design Consultants Only) */}
      {formData.role === 'Design Consultant' && (
        <div className="space-y-6">
          <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider">Calendar Color</h3>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <input
                type="color"
                value={formData.calendar_color}
                onChange={(e) => handleChange('calendar_color', e.target.value)}
                className="w-16 h-16 rounded-lg cursor-pointer"
              />
              <div>
                <p className="text-sm font-medium text-slate-700">Selected Color</p>
                <p className="text-sm text-slate-500 font-mono mt-1">{formData.calendar_color}</p>
              </div>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {COLOR_PRESETS.map(color => (
                <button
                  key={color}
                  type="button"
                  onClick={() => handleChange('calendar_color', color)}
                  className={cn(
                    "w-12 h-12 rounded-lg transition-transform hover:scale-110",
                    formData.calendar_color === color && "ring-2 ring-slate-400 scale-110"
                  )}
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
            <p className="text-xs text-slate-500">
              This color will be used for appointment cards and calendar display in the Schedule Assistant.
            </p>
          </div>
        </div>
      )}

      {/* Calendar Integration */}
      <div className="space-y-6">
        <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider">Calendar Integration</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 border border-slate-200 rounded-lg">
            <div>
              <Label className="text-slate-700">Enable Google Calendar Integration</Label>
              <p className="text-sm text-slate-500 mt-1">
                Sync appointments with Google Calendar
              </p>
            </div>
            <Switch
              checked={formData.calendar_integration_enabled}
              onCheckedChange={(checked) => handleChange('calendar_integration_enabled', checked)}
            />
          </div>

          {formData.calendar_integration_enabled && (
            <>
              <div className="space-y-2">
                <Label htmlFor="google_calendar_id" className="text-slate-700">
                  Google Calendar ID (Optional)
                </Label>
                <Input
                  id="google_calendar_id"
                  value={formData.google_calendar_id}
                  onChange={(e) => handleChange('google_calendar_id', e.target.value)}
                  className="h-12 border-slate-200 focus:border-indigo-500 focus:ring-indigo-500 transition-all"
                  placeholder="example@group.calendar.google.com"
                />
                <p className="text-xs text-slate-500">
                  Leave blank to use primary calendar. For a specific calendar, find this ID in Google Calendar settings under "Integrate calendar"
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="timezone" className="text-slate-700">
                  Timezone
                </Label>
                <Select
                  value={formData.timezone}
                  onValueChange={(value) => handleChange('timezone', value)}
                >
                  <SelectTrigger className="h-12 border-slate-200">
                    <SelectValue placeholder="Select timezone" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="America/Phoenix">America/Phoenix (MST)</SelectItem>
                    <SelectItem value="America/Los_Angeles">America/Los_Angeles (PST)</SelectItem>
                    <SelectItem value="America/Denver">America/Denver (MST)</SelectItem>
                    <SelectItem value="America/Chicago">America/Chicago (CST)</SelectItem>
                    <SelectItem value="America/New_York">America/New_York (EST)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500">
                  Calendar events will be created in this timezone.
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-4 pt-6 border-t border-slate-100">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          className="px-6 h-11 text-slate-600 hover:text-slate-800 hover:bg-slate-100"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isLoading}
          className="px-8 h-11 bg-indigo-600 hover:bg-indigo-700 text-white transition-all"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Team Member'
          )}
        </Button>
      </div>
    </form>
  );
}