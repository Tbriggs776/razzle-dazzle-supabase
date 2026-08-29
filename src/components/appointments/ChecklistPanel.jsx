import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Loader2, Brain, User, Home, Wrench, Lightbulb, Heart, DollarSign, BarChart3, Calendar, Megaphone, CheckCircle2, Info, Camera, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SignedImage } from '@/lib/fileUrl';

const VALUE_ADDS_1 = ["$35 room sale", "Basic floor prep included", "Painted baseboards", "Dustless tile demo"];
const VALUE_ADDS_2 = ["Lifetime labor warranty", "Worry free flooring & install", "One time warranty transfer", "Field manager", "Half inch carpet pad"];

export default function ChecklistPanel({ checklistId, appointmentId, onChecklistUpdate }) {
  const queryClient = useQueryClient();
  const [hasChanges, setHasChanges] = useState(false);
  const [expandedItems, setExpandedItems] = useState([]);

  // Support both checklistId (preferred) and appointmentId (legacy)
  const lookupId = checklistId || appointmentId;
  const isLookupById = !!checklistId;

  const { data: checklist, isLoading } = useQuery({
    queryKey: ['checklist', lookupId],
    queryFn: async () => {
      if (isLookupById) {
        // Look up directly by ID
        const checklists = await base44.entities.AppointmentSettingChecklist.filter({ 
          id: lookupId
        });
        return checklists[0] || null;
      } else {
        // Look up by appointment ID
        const checklists = await base44.entities.AppointmentSettingChecklist.filter({ 
          appointment: lookupId
        });
        return checklists[0] || null;
      }
    },
    enabled: !!lookupId
  });

  const [formData, setFormData] = useState({});

  React.useEffect(() => {
    if (checklist) {
      setFormData(checklist);
      // Auto-expand all sections on load
      setExpandedItems(['intro', 'contact', 'property', 'reason', 'valueadds', 'preferences', 'financing', 'budget', 'scheduling', 'marketing', 'verification', 'outro', 'finalcategories']);
    }
  }, [checklist]);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.AppointmentSettingChecklist.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checklist', lookupId] });
      setHasChanges(false);
    },
    onError: (error) => {
      console.error('Failed to create checklist:', error);
    }
  });

  const updateMutation = useMutation({
    mutationFn: (data) => {
      if (!checklist?.id) {
        throw new Error('Checklist ID not found');
      }
      return base44.entities.AppointmentSettingChecklist.update(checklist.id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checklist', lookupId] });
      setHasChanges(false);
      if (onChecklistUpdate) {
        onChecklistUpdate();
      }
    },
    onError: (error) => {
      console.error('Failed to save checklist:', error);
    }
  });

  const handleChange = (field, value) => {
    const newData = { ...formData, [field]: value };
    setFormData(newData);
    setHasChanges(true);
    
    // Auto-save after a short delay
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    autoSaveTimeoutRef.current = setTimeout(() => {
      if (checklist?.id) {
        updateMutation.mutate(newData);
      } else if (appointmentId) {
        createMutation.mutate({ ...newData, appointment: appointmentId });
      }
    }, 1000);
  };

  const handlePlaceSelected = (addressData) => {
    const newData = {
      ...formData,
      customer_street: addressData.address_line1,
      city: addressData.city,
      state: addressData.state,
      postal_code: addressData.zip
    };
    setFormData(newData);
    setHasChanges(true);
    
    // Auto-save
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    autoSaveTimeoutRef.current = setTimeout(() => {
      if (checklist?.id) {
        updateMutation.mutate(newData);
      } else if (appointmentId) {
        createMutation.mutate({ ...newData, appointment: appointmentId });
      }
    }, 1000);
  };

  const autoSaveTimeoutRef = React.useRef(null);

  React.useEffect(() => {
    const handleSaveTrigger = () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
      if (checklist?.id) {
        updateMutation.mutate(formData);
      } else if (appointmentId) {
        createMutation.mutate({ ...formData, appointment: appointmentId });
      }
    };

    window.addEventListener('triggerChecklistSave', handleSaveTrigger);

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
      window.removeEventListener('triggerChecklistSave', handleSaveTrigger);
    };
  }, [checklist?.id, formData, appointmentId]);

  const toggleMultiSelect = (field, option) => {
    const current = formData[field] || [];
    const newValue = current.includes(option)
      ? current.filter(item => item !== option)
      : [...current, option];
    const newData = { ...formData, [field]: newValue };
    setFormData(newData);
    setHasChanges(true);
    
    // Auto-save after a short delay
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    autoSaveTimeoutRef.current = setTimeout(() => {
      if (checklist?.id) {
        updateMutation.mutate(newData);
      } else if (appointmentId) {
        createMutation.mutate({ ...newData, appointment: appointmentId });
      }
    }, 1000);
  };

  const handleSave = () => {
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    if (checklist?.id) {
      updateMutation.mutate(formData);
    } else if (appointmentId) {
      createMutation.mutate({ ...formData, appointment: appointmentId });
    }
  };

  const getCompletionStatus = () => {
    const sections = [
      {
        name: 'Intro & Process',
        required: []
      },
      {
        name: 'Customer Contact Info',
        required: ['customer_first_name', 'customer_last_name', 'customer_phone', 'customer_email', 'customer_street', 'city', 'state', 'postal_code']
      },
      {
        name: 'Property / Project Details',
        required: ['other_project_notes', 'lives_at_address']
      },
      {
        name: 'Reason & Scope',
        required: []
      },
      {
        name: 'Additional Options / Value Adds',
        required: []
      },
      {
        name: 'Preferences & Household',
        required: []
      },
      {
        name: 'Incentives, Financing, Budget',
        required: []
      },
      {
        name: 'Budget & Project Minimums',
        required: []
      },
      {
        name: 'Scheduling',
        required: []
      },
      {
        name: 'Marketing Source',
        required: []
      },
      {
        name: 'Verification Step',
        required: ['verified_accuracy']
      },
      {
        name: 'Outro',
        required: []
      },
      {
        name: 'Final Categories',
        required: ['home_size', 'budget_range'],
        requiredArray: ['material_type']
      }
    ];
    
    const completedSections = sections.filter(section => {
      if (section.required.length === 0 && !section.requiredArray) return true;
      const fieldsOk = section.required.every(field => formData[field]);
      const arraysOk = (section.requiredArray || []).every(field => formData[field]?.length > 0);
      return fieldsOk && arraysOk;
    }).length;
    
    const totalSections = sections.length;
    const percentage = Math.round((completedSections / totalSections) * 100);
    
    return { completed: completedSections, total: totalSections, percentage };
  };

  const toggleAllSections = () => {
    if (expandedItems.length > 0) {
      setExpandedItems([]);
    } else {
      setExpandedItems(['intro', 'contact', 'property', 'reason', 'valueadds', 'preferences', 'financing', 'budget', 'scheduling', 'marketing', 'verification', 'outro', 'photos', 'finalcategories']);
    }
  };

  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const handlePhotoUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploadingPhoto(true);
    try {
      const uploadedUrls = await Promise.all(
        files.map(async (file) => {
          const { file_url } = await base44.integrations.Core.UploadFile({ file });
          return file_url;
        })
      );
      const newPhotos = [...(formData.photos || []), ...uploadedUrls];
      handleChange('photos', newPhotos);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleRemovePhoto = (index) => {
    const newPhotos = (formData.photos || []).filter((_, i) => i !== index);
    handleChange('photos', newPhotos);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-indigo-600 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  const status = getCompletionStatus();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between mb-4">
          <CardTitle className="text-xl font-bold">Appointment Setting Checklist</CardTitle>
          <div className="flex items-center gap-3">
            <Button
              onClick={toggleAllSections}
              variant="outline"
              size="sm"
              className="border-slate-200"
            >
              {expandedItems.length > 0 ? 'Collapse All' : 'Expand All'}
            </Button>
            {(createMutation.isPending || updateMutation.isPending) && (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </div>
            )}
          </div>
        </div>
        
        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm text-slate-600">
            <span className="font-medium">Progress</span>
            <span className="font-semibold">{status.percentage}%</span>
          </div>
          <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full transition-all duration-500",
                status.percentage === 100 ? "bg-green-500" : "bg-indigo-600"
              )}
              style={{ width: `${status.percentage}%` }}
            />
          </div>
          <p className="text-xs text-slate-500">
            {status.completed} of {status.total} sections completed
          </p>
        </div>
      </CardHeader>

      <CardContent>
        <Accordion type="multiple" value={expandedItems} onValueChange={setExpandedItems} className="space-y-2">
          {/* Intro & Process */}
          <AccordionItem value="intro" className="border rounded-lg px-4">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-3">
                <Brain className="w-5 h-5 text-purple-600" />
                <span className="font-semibold">Intro & Process</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pt-4">
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={formData.how_process_works || false}
                  onCheckedChange={(checked) => handleChange('how_process_works', checked)}
                />
                <Label className="cursor-pointer" onClick={() => handleChange('how_process_works', !formData.how_process_works)}>
                  How the process works
                </Label>
              </div>
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={formData.set_expectations || false}
                  onCheckedChange={(checked) => handleChange('set_expectations', checked)}
                />
                <Label className="cursor-pointer" onClick={() => handleChange('set_expectations', !formData.set_expectations)}>
                  Set expectations
                </Label>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Customer Contact Info */}
          <AccordionItem value="contact" className="border rounded-lg px-4">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-3">
                <User className="w-5 h-5 text-blue-600" />
                <span className="font-semibold">Customer Contact Info</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>First Name *</Label>
                  <Input
                    value={formData.customer_first_name || ''}
                    onChange={(e) => handleChange('customer_first_name', e.target.value)}
                    placeholder="First name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Last Name *</Label>
                  <Input
                    value={formData.customer_last_name || ''}
                    onChange={(e) => handleChange('customer_last_name', e.target.value)}
                    placeholder="Last name"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Phone *</Label>
                  <PhoneInput
                    value={formData.customer_phone || ''}
                    onChange={(e) => handleChange('customer_phone', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Secondary Phone</Label>
                  <PhoneInput
                    value={formData.secondary_phone || ''}
                    onChange={(e) => handleChange('secondary_phone', e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Email *</Label>
                <Input
                  type="email"
                  value={formData.customer_email || ''}
                  onChange={(e) => handleChange('customer_email', e.target.value)}
                  placeholder="email@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Street Address *</Label>
                <AddressAutocomplete
                  value={formData.customer_street || ''}
                  onChange={(value) => handleChange('customer_street', value)}
                  onPlaceSelected={handlePlaceSelected}
                  placeholder="Start typing an address..."
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>City *</Label>
                  <Input
                    value={formData.city || ''}
                    onChange={(e) => handleChange('city', e.target.value)}
                    placeholder="City"
                  />
                </div>
                <div className="space-y-2">
                  <Label>State *</Label>
                  <Input
                    value={formData.state || ''}
                    onChange={(e) => handleChange('state', e.target.value)}
                    placeholder="ST"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Postal Code *</Label>
                  <Input
                    value={formData.postal_code || ''}
                    onChange={(e) => handleChange('postal_code', e.target.value)}
                    placeholder="12345"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Additional Address Details</Label>
                <Input
                  value={formData.additional_address_details || ''}
                  onChange={(e) => handleChange('additional_address_details', e.target.value)}
                  placeholder="Apt, suite, etc."
                />
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Property / Project Details */}
          <AccordionItem value="property" className="border rounded-lg px-4">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-3">
                <Home className="w-5 h-5 text-green-600" />
                <span className="font-semibold">Property / Project Details</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Project Notes/Detailed Summary *</Label>
                <p className="text-xs text-slate-500 mb-1">
                  Enter insights to set the DC up for success at the appointment (e.g., 60 months 0% interest was a massive factor, wife wears the pants so make sure to get her onboard, etc.)
                </p>
                <Textarea
                  value={formData.other_project_notes || ''}
                  onChange={(e) => handleChange('other_project_notes', e.target.value)}
                  placeholder="Enter detailed summary and insights..."
                  className="min-h-24"
                />
              </div>
              <div className="space-y-2">
                <Label>Lives at Address *</Label>
                <Select value={formData.lives_at_address} onValueChange={(val) => handleChange('lives_at_address', val)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Yes">Yes</SelectItem>
                    <SelectItem value="No">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Home Built Era</Label>
                <Select value={formData.home_built_era} onValueChange={(val) => handleChange('home_built_era', val)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="On or before 1978">On or before 1978</SelectItem>
                    <SelectItem value="After 1978">After 1978</SelectItem>
                  </SelectContent>
                </Select>
                {formData.home_built_era === 'On or before 1978' && (
                  <div className="flex items-center gap-3 p-4 bg-red-50 border-2 border-red-500 rounded-lg mt-2">
                    <span className="text-3xl">🛑</span>
                    <div>
                      <p className="text-red-700 font-bold text-lg">STOP — On or Before 1978</p>
                      <p className="text-red-600 text-sm font-medium">Asbestos risk — notify the DC and follow proper protocol before scheduling.</p>
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>Property Year</Label>
                <Input
                  type="number"
                  value={formData.property_year || ''}
                  onChange={(e) => handleChange('property_year', parseInt(e.target.value) || '')}
                  placeholder="2010"
                />
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Reason & Scope */}
          <AccordionItem value="reason" className="border rounded-lg px-4">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-3">
                <Wrench className="w-5 h-5 text-orange-600" />
                <span className="font-semibold">Reason & Scope</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Reason for Call</Label>
                <Input
                  value={formData.reason_for_call || ''}
                  onChange={(e) => handleChange('reason_for_call', e.target.value)}
                  placeholder="Why are they calling?"
                />
              </div>
              <div className="space-y-2">
                <Label>Number of Rooms</Label>
                <Input
                  type="text"
                  value={formData.number_of_rooms || ''}
                  onChange={(e) => handleChange('number_of_rooms', e.target.value)}
                  placeholder="3"
                />
              </div>
              <div className="space-y-2">
                <Label>Value Adds (Select all that apply)</Label>
                <div className="space-y-2 pl-2">
                  {VALUE_ADDS_1.map(option => (
                    <div key={option} className="flex items-center gap-2">
                      <Checkbox
                        checked={(formData.value_adds_1 || []).includes(option)}
                        onCheckedChange={() => toggleMultiSelect('value_adds_1', option)}
                      />
                      <Label className="cursor-pointer font-normal" onClick={() => toggleMultiSelect('value_adds_1', option)}>
                        {option}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Estimated Sq Footage</Label>
                <Input
                  type="text"
                  value={formData.estimated_sq_footage || ''}
                  onChange={(e) => handleChange('estimated_sq_footage', e.target.value)}
                  placeholder="1200"
                />
              </div>
              <div className="space-y-2">
                <Label>Flooring Products (Select all that apply)</Label>
                <div className="space-y-2 pl-2">
                  {["Carpet", "Sheet Vinyl", "LVP", "Laminate", "Hardwood", "Tile"].map(option => (
                    <div key={option} className="flex items-center gap-2">
                      <Checkbox
                        checked={(formData.flooring_products || []).includes(option)}
                        onCheckedChange={() => toggleMultiSelect('flooring_products', option)}
                      />
                      <Label className="cursor-pointer font-normal" onClick={() => toggleMultiSelect('flooring_products', option)}>
                        {option}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Colors of Interest</Label>
                <Textarea
                  value={formData.colors_interest || ''}
                  onChange={(e) => handleChange('colors_interest', e.target.value)}
                  placeholder="e.g., Oak, gray, white..."
                />
              </div>
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={formData.unique_product_color || false}
                  onCheckedChange={(checked) => handleChange('unique_product_color', checked)}
                />
                <Label className="cursor-pointer" onClick={() => handleChange('unique_product_color', !formData.unique_product_color)}>
                  Unique product color, reference notes
                </Label>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Additional Options / Value Adds */}
          <AccordionItem value="valueadds" className="border rounded-lg px-4">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-3">
                <Lightbulb className="w-5 h-5 text-yellow-600" />
                <span className="font-semibold">Additional Options / Value Adds</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Additional Value Adds (Select all that apply)</Label>
                <div className="space-y-2 pl-2">
                  {VALUE_ADDS_2.map(option => (
                    <div key={option} className="flex items-center gap-2">
                      <Checkbox
                        checked={(formData.value_adds_2 || []).includes(option)}
                        onCheckedChange={() => toggleMultiSelect('value_adds_2', option)}
                      />
                      <Label className="cursor-pointer font-normal" onClick={() => toggleMultiSelect('value_adds_2', option)}>
                        {option}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Preferences & Household */}
          <AccordionItem value="preferences" className="border rounded-lg px-4">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-3">
                <Heart className="w-5 h-5 text-pink-600" />
                <span className="font-semibold">Preferences & Household</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Plank Size Preference</Label>
                <Input
                  value={formData.plank_size_preference || ''}
                  onChange={(e) => handleChange('plank_size_preference', e.target.value)}
                  placeholder="e.g., Wide plank"
                />
              </div>
              <div className="space-y-2">
                <Label>Has Pets</Label>
                <Select value={formData.has_pets} onValueChange={(val) => handleChange('has_pets', val)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Yes">Yes</SelectItem>
                    <SelectItem value="No">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Significant Other Name</Label>
                <Input
                  value={formData.significant_other_name || ''}
                  onChange={(e) => handleChange('significant_other_name', e.target.value)}
                  placeholder="Name"
                />
              </div>
              <div className="space-y-2">
                <Label>Require All Parties Present</Label>
                <Select value={formData.require_all_parties_present} onValueChange={(val) => handleChange('require_all_parties_present', val)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Yes">Yes</SelectItem>
                    <SelectItem value="No">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Incentives, Financing, Budget */}
          <AccordionItem value="financing" className="border rounded-lg px-4">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-3">
                <DollarSign className="w-5 h-5 text-green-600" />
                <span className="font-semibold">Incentives, Financing, Budget</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Work from Home</Label>
                <Select value={formData.work_from_home} onValueChange={(val) => handleChange('work_from_home', val)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Yes">Yes</SelectItem>
                    <SelectItem value="No">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Owner Occupied Status</Label>
                <Select value={formData.owner_occupied_status} onValueChange={(val) => handleChange('owner_occupied_status', val)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Owner Occupied">Owner Occupied</SelectItem>
                    <SelectItem value="Renting">Renting</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Financing Options</Label>
                <Input
                  value={formData.financing_options || ''}
                  onChange={(e) => handleChange('financing_options', e.target.value)}
                  placeholder="Financing details"
                />
              </div>
              <div className="space-y-2">
                <Label>Credit Score Range</Label>
                <Input
                  value={formData.credit_score_range || ''}
                  onChange={(e) => handleChange('credit_score_range', e.target.value)}
                  placeholder="e.g., 700-750"
                />
              </div>
              <div className="space-y-2">
                <Label>Project Timeframe</Label>
                <Input
                  value={formData.project_timeframe || ''}
                  onChange={(e) => handleChange('project_timeframe', e.target.value)}
                  placeholder="e.g., Next 2 weeks"
                />
              </div>
              <div className="space-y-2">
                <Label>In Stock Product Options</Label>
                <Input
                  value={formData.in_stock_product_options || ''}
                  onChange={(e) => handleChange('in_stock_product_options', e.target.value)}
                  placeholder="In stock options discussed"
                />
              </div>
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={formData.next_day_or_2_day_install || false}
                  onCheckedChange={(checked) => handleChange('next_day_or_2_day_install', checked)}
                />
                <Label className="cursor-pointer" onClick={() => handleChange('next_day_or_2_day_install', !formData.next_day_or_2_day_install)}>
                  Next day or 2 day install
                </Label>
              </div>
              <div className="space-y-2">
                <Label>Collected Other Estimates</Label>
                <Select value={formData.collected_other_estimates} onValueChange={(val) => handleChange('collected_other_estimates', val)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Yes">Yes</SelectItem>
                    <SelectItem value="No">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {formData.collected_other_estimates === "Yes" && (
                <div className="space-y-2">
                  <Label>Which Other Companies?</Label>
                  <Input
                    value={formData.other_companies_estimates || ''}
                    onChange={(e) => handleChange('other_companies_estimates', e.target.value)}
                    placeholder="Enter company names..."
                  />
                </div>
              )}
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={formData.free_air_duct_cleaning || false}
                  onCheckedChange={(checked) => handleChange('free_air_duct_cleaning', checked)}
                />
                <Label className="cursor-pointer" onClick={() => handleChange('free_air_duct_cleaning', !formData.free_air_duct_cleaning)}>
                  Free air duct cleaning
                </Label>
              </div>
              <div className="space-y-2">
                <Label>Unique Value Proposition</Label>
                <Textarea
                  value={formData.unique_value_prop || ''}
                  onChange={(e) => handleChange('unique_value_prop', e.target.value)}
                  placeholder="What makes this offer unique?"
                />
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Budget & Project Minimums */}
          <AccordionItem value="budget" className="border rounded-lg px-4">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-3">
                <BarChart3 className="w-5 h-5 text-indigo-600" />
                <span className="font-semibold">Budget & Project Minimums</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Project Budget</Label>
                <Input
                  value={formData.project_budget || ''}
                  onChange={(e) => handleChange('project_budget', e.target.value)}
                  placeholder="$5,000"
                />
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-blue-900 mb-2">Project Minimums</p>
                    <ul className="text-sm text-blue-800 space-y-1">
                      <li>• Carpet & Sheet Vinyl – $1500</li>
                      <li>• LVP & Laminate – $2500</li>
                      <li>• Hardwood & Tile – $3500</li>
                    </ul>
                  </div>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Scheduling */}
          <AccordionItem value="scheduling" className="border rounded-lg px-4">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-3">
                <Calendar className="w-5 h-5 text-red-600" />
                <span className="font-semibold">Scheduling</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pt-4">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="text-sm text-amber-900">
                  <strong>Both Available Prompt:</strong> Ask if both parties can be present for the appointment if applicable.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Availability Notes</Label>
                <Textarea
                  value={formData.availability_notes || ''}
                  onChange={(e) => handleChange('availability_notes', e.target.value)}
                  placeholder="Customer availability details..."
                />
              </div>
              <div className="space-y-2">
                <Label>Preferred Appointment Date</Label>
                <Input
                  type="date"
                  value={formData.preferred_appointment_date || ''}
                  onChange={(e) => handleChange('preferred_appointment_date', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Appointment Day</Label>
                <Select value={formData.appointment_day} onValueChange={(val) => handleChange('appointment_day', val)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select day" />
                  </SelectTrigger>
                  <SelectContent>
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => (
                      <SelectItem key={day} value={day}>{day}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Preferred Appointment Block</Label>
                <Select value={formData.preferred_appointment_block} onValueChange={(val) => handleChange('preferred_appointment_block', val)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select time block" />
                  </SelectTrigger>
                  <SelectContent>
                    {["9am–11am", "12pm–2pm", "3pm–5pm", "6pm–8pm"].map(block => (
                      <SelectItem key={block} value={block}>{block}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Two Hour Window Confirmation</Label>
                <Select value={formData.two_hour_window_confirmation} onValueChange={(val) => handleChange('two_hour_window_confirmation', val)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Yes">Yes</SelectItem>
                    <SelectItem value="No">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Customer Scheduling Requests</Label>
                <Input
                  value={formData.customer_scheduling_requests || ''}
                  onChange={(e) => handleChange('customer_scheduling_requests', e.target.value)}
                  placeholder="e.g., I need the DC to show up right at 12, or no earlier than 330 PM, etc."
                />
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Marketing Source */}
          <AccordionItem value="marketing" className="border rounded-lg px-4">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-3">
                <Megaphone className="w-5 h-5 text-purple-600" />
                <span className="font-semibold">Marketing Source</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>How Did You Hear About Us?</Label>
                <Select value={formData.heard_about_us} onValueChange={(val) => handleChange('heard_about_us', val)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select source" />
                  </SelectTrigger>
                  <SelectContent>
                    {["Google", "Facebook/Instagram", "TV", "Billboard", "Mailer", "Floor Daddy Vehicle", "Referral", "Realtor Referral", "AI Search", "Independent News", "Homeshow", "Other"].map(source => (
                      <SelectItem key={source} value={source}>{source}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {formData.heard_about_us === "Other" && (
                <div className="space-y-2">
                  <Label>Please Specify</Label>
                  <Input
                    value={formData.heard_about_us_other || ''}
                    onChange={(e) => handleChange('heard_about_us_other', e.target.value)}
                    placeholder="Please specify..."
                  />
                </div>
              )}
            </AccordionContent>
          </AccordionItem>

          {/* Verification Step */}
          <AccordionItem value="verification" className="border rounded-lg px-4">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <span className="font-semibold">Verification Step</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Verified Accuracy *</Label>
                <Select value={formData.verified_accuracy} onValueChange={(val) => handleChange('verified_accuracy', val)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Yes, definitely!">Yes, definitely!</SelectItem>
                    <SelectItem value="Oops I forgot">Oops I forgot</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Photos */}
          <AccordionItem value="photos" className="border rounded-lg px-4">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-3">
                <Camera className="w-5 h-5 text-blue-600" />
                <span className="font-semibold">Photos</span>
                {(formData.photos || []).length > 0 && (
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{formData.photos.length}</span>
                )}
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pt-4">
              <div>
                <label className={cn(
                  "flex items-center justify-center gap-2 w-full h-12 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-colors",
                  uploadingPhoto && "opacity-50 pointer-events-none"
                )}>
                  {uploadingPhoto ? (
                    <><Loader2 className="w-4 h-4 animate-spin text-indigo-600" /><span className="text-sm text-slate-600">Uploading...</span></>
                  ) : (
                    <><Camera className="w-4 h-4 text-slate-500" /><span className="text-sm text-slate-600">Add Photos</span></>
                  )}
                  <input type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoUpload} disabled={uploadingPhoto} />
                </label>
              </div>
              {(formData.photos || []).length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {formData.photos.map((url, idx) => (
                    <div key={idx} className="relative group aspect-square">
                      <SignedImage src={url} alt={`Photo ${idx + 1}`} className="w-full h-full object-cover rounded-lg border border-slate-200" />
                      <button
                        onClick={() => handleRemovePhoto(idx)}
                        className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </AccordionContent>
          </AccordionItem>

          {/* Final Categories */}
          <AccordionItem value="finalcategories" className="border-2 border-indigo-200 rounded-lg px-4 bg-indigo-50/30">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-indigo-600" />
                <span className="font-semibold text-indigo-800">Final Categories *</span>
                <span className="text-xs bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full">Required</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-6 pt-4">
              {/* Home Size */}
              <div className="space-y-2">
                <Label className="font-semibold">Home Size *</Label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {['Full Home', '3 Room', '2 Room', '1 Room'].map(option => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => handleChange('home_size', formData.home_size === option ? '' : option)}
                      className={cn(
                        'px-3 py-2 rounded-lg border text-sm font-medium transition-colors',
                        formData.home_size === option
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-slate-700 border-slate-300 hover:border-indigo-400'
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              {/* Material Type */}
              <div className="space-y-2">
                <Label className="font-semibold">Material Type * (Select all that apply)</Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {['Laminate', 'Tile', 'Wood', 'LVP', 'Carpet'].map(option => {
                    const selected = (formData.material_type || []).includes(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => toggleMultiSelect('material_type', option)}
                        className={cn(
                          'px-3 py-2 rounded-lg border text-sm font-medium transition-colors',
                          selected
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white text-slate-700 border-slate-300 hover:border-indigo-400'
                        )}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Budget Range */}
              <div className="space-y-2">
                <Label className="font-semibold">Budget *</Label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {['1-5k', '5-10k', '10-15k', '15k+', 'Unknown'].map(option => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => handleChange('budget_range', formData.budget_range === option ? '' : option)}
                      className={cn(
                        'px-3 py-2 rounded-lg border text-sm font-medium transition-colors',
                        formData.budget_range === option
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-slate-700 border-slate-300 hover:border-indigo-400'
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Outro */}
          <AccordionItem value="outro" className="border rounded-lg px-4">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-3">
                <Info className="w-5 h-5 text-slate-600" />
                <span className="font-semibold">Outro</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pt-4">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
                <p className="text-sm text-slate-700">
                  <strong>Outro Script:</strong> Thank the customer for their time and confirm they've received the appointment confirmation.
                </p>
                <p className="text-sm text-slate-700">
                  <strong>Visualizer Tool Note:</strong> Remind customer about the online visualizer tool to explore flooring options before the appointment.
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}