import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ClipboardCheck, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';

const TICKET_CATEGORIES = [
  "Missing Moldings – Transitions",
  "Missing Moldings – Quarter Round",
  "No Photos in Measure Mobile",
  "Photos Unlabeled in CompanyCam",
  "Contradicting Info (RFMS vs Notes)",
  "Install Method Mismatch (Click vs Glue)",
  "Finish Mismatch (Polished vs Matte)",
  "Incorrect Diagram Selected",
  "Multiple Diagrams – Not Identified",
  "Furniture Move Missing / Incorrect",
  "Demolition Missing / Incorrect",
  "No Diagram Provided",
  "Design Mod – Incomplete",
  "Order Shorts",
  "Material Delay",
  "Material Back-ordered",
  "Repair",
  "Inspection",
  "Other"
];

export default function SubmitTicket() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  const [orderNumber, setOrderNumber] = useState('');
  const [customerLastName, setCustomerLastName] = useState('');
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [selectedRequesterId, setSelectedRequesterId] = useState('');
  const [selectedAssignedDcId, setSelectedAssignedDcId] = useState('');

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: currentTeamMember } = useQuery({
    queryKey: ['currentTeamMember', currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return null;
      const members = await base44.entities.TeamMember.filter({ email: currentUser.email });
      return members[0];
    },
    enabled: !!currentUser?.email
  });

  const { data: karina } = useQuery({
    queryKey: ['karina'],
    queryFn: async () => {
      const members = await base44.entities.TeamMember.filter({ first_name: 'Karina' });
      return members[0];
    }
  });

  const { data: allTeamMembers = [] } = useQuery({
    queryKey: ['allTeamMembers'],
    queryFn: () => base44.entities.TeamMember.list()
  });

  // Set default requester to current user when data loads
  React.useEffect(() => {
    if (currentTeamMember && !selectedRequesterId) {
      setSelectedRequesterId(currentTeamMember.id);
    }
  }, [currentTeamMember, selectedRequesterId]);

  // Set default assigned DC to Karina when data loads
  React.useEffect(() => {
    if (karina && !selectedAssignedDcId) {
      setSelectedAssignedDcId(karina.id);
    }
  }, [karina, selectedAssignedDcId]);

  const createTicketMutation = useMutation({
    mutationFn: async (ticketData) => {
      const ticket = await base44.entities.Ticket.create(ticketData);
      
      // Create log entry
      await base44.entities.TicketLog.create({
        ticket: ticket.id,
        action: 'Ticket Created',
        details: `Ticket created for Order #${ticketData.order_number} with ${ticketData.categories.length} categories`,
        user_email: currentUser?.email,
        user_name: currentUser?.full_name
      });

      // Generate shortened URLs
      const dcFullUrl = `${window.location.origin}${createPageUrl('DesignConsultantTicketView')}?id=${ticket.id}`;
      const requesterFullUrl = `${window.location.origin}${createPageUrl('RequesterTicketView')}?id=${ticket.id}`;

      const [dcUrlResponse, requesterUrlResponse] = await Promise.all([
        base44.functions.invoke('shortenUrl', { originalURL: dcFullUrl }),
        base44.functions.invoke('shortenUrl', { originalURL: requesterFullUrl })
      ]);

      // Update ticket with shortened URLs
      await base44.entities.Ticket.update(ticket.id, {
        dc_short_url: dcUrlResponse.data.shortURL,
        requester_short_url: requesterUrlResponse.data.shortURL
      });

      // Send SMS to assigned DC if settings enabled
      const smsSettings = await base44.entities.SMSSettings.list();
      const settings = smsSettings[0];
      const assignedMemberData = await base44.entities.TeamMember.filter({ id: ticketData.assigned_dc });
      const assignedMember = assignedMemberData[0];
      
      if (settings?.send_dc_ticket_sms && assignedMember?.phone) {
        const message = (settings.dc_ticket_assigned_template || '')
          .replace('{dc_first_name}', assignedMember.first_name)
          .replace('{order_number}', ticketData.order_number)
          .replace('{ticket_url}', dcUrlResponse.data.shortURL);

        await base44.functions.invoke('sendSMS', {
          to: assignedMember.phone,
          message
        });

        await base44.entities.TicketLog.create({
          ticket: ticket.id,
          action: 'SMS Sent to DC',
          details: `Notification sent to ${assignedMember.first_name} ${assignedMember.last_name} (${assignedMember.phone})`,
          user_email: currentUser?.email,
          user_name: currentUser?.full_name
        });
      }

      return ticket;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      navigate(createPageUrl('OrderProcessing'));
    },
    onError: (error) => {
      setError(error.message);
    }
  });

  const handleCategoryToggle = (category) => {
    setSelectedCategories(prev => 
      prev.includes(category) 
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!orderNumber || !customerLastName) {
      setError('Order number and customer last name are required');
      return;
    }

    if (selectedCategories.length === 0) {
      setError('Please select at least one category');
      return;
    }

    if (!description) {
      setError('Description is required');
      return;
    }

    if (!selectedRequesterId) {
      setError('Please select a requester');
      return;
    }

    if (!selectedAssignedDcId) {
      setError('Please select an assigned team member');
      return;
    }

    const ticketData = {
      order_number: orderNumber,
      customer_last_name: customerLastName,
      categories: selectedCategories.map(cat => ({
        name: cat,
        status: 'Open',
        needs_additional_info: false
      })),
      description,
      requester: selectedRequesterId,
      assigned_dc: selectedAssignedDcId
    };

    createTicketMutation.mutate(ticketData);
  };

  if (!currentUser || !currentTeamMember) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-3xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-8 py-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                <ClipboardCheck className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">Submit Ticket</h1>
                <p className="text-indigo-100 text-sm">Job Shorts, Claims & Repairs</p>
              </div>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-8 space-y-6">
            {error && (
              <div className="flex items-center gap-2 p-4 rounded-lg bg-red-50 border border-red-200">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="orderNumber">Order Number *</Label>
                <Input
                  id="orderNumber"
                  value={orderNumber}
                  onChange={(e) => setOrderNumber(e.target.value)}
                  placeholder="Enter order number"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="customerLastName">Customer Last Name *</Label>
                <Input
                  id="customerLastName"
                  value={customerLastName}
                  onChange={(e) => setCustomerLastName(e.target.value)}
                  placeholder="Enter last name"
                  required
                />
              </div>
            </div>

            <div className="space-y-3">
              <Label>Categories *</Label>
              <div className="grid grid-cols-1 gap-3 p-4 bg-slate-50 rounded-lg border border-slate-200">
                {TICKET_CATEGORIES.map((category) => (
                  <div key={category} className="flex items-center gap-2">
                    <Checkbox
                      id={category}
                      checked={selectedCategories.includes(category)}
                      onCheckedChange={() => handleCategoryToggle(category)}
                    />
                    <label
                      htmlFor={category}
                      className="text-sm text-slate-700 cursor-pointer select-none"
                    >
                      {category}
                    </label>
                  </div>
                ))}
              </div>
              {selectedCategories.length > 0 && (
                <p className="text-xs text-slate-500">
                  {selectedCategories.length} {selectedCategories.length === 1 ? 'category' : 'categories'} selected
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description *</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the issue in detail..."
                rows={6}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="requester">Requester *</Label>
                <Select
                  value={selectedRequesterId}
                  onValueChange={setSelectedRequesterId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select requester" />
                  </SelectTrigger>
                  <SelectContent>
                    {allTeamMembers.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.first_name} {member.last_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="assignedDc">Assigned To *</Label>
                <Select value={selectedAssignedDcId} onValueChange={setSelectedAssignedDcId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select team member" />
                  </SelectTrigger>
                  <SelectContent>
                    {allTeamMembers.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.first_name} {member.last_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex gap-4 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate(createPageUrl('OrderProcessing'))}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createTicketMutation.isPending}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700"
              >
                {createTicketMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating Ticket...
                  </>
                ) : (
                  'Submit Ticket'
                )}
              </Button>
            </div>
          </form>
        </motion.div>
      </div>
    </div>
  );
}