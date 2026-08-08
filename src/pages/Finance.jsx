import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { ArrowLeft, DollarSign, Loader2, MapPin, Calendar, CheckCircle2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { toast } from 'sonner';

export default function Finance() {
  const queryClient = useQueryClient();
  const [markingPaid, setMarkingPaid] = useState({});
  const [sendingReport, setSendingReport] = useState(false);

  const handleSendReport = async () => {
    setSendingReport(true);
    await base44.functions.invoke('sendFinanceReport', {});
    setSendingReport(false);
    toast.success('Finance report sent!');
  };

  const handleMarkFundsReceived = async (e, projectId) => {
    e.preventDefault();
    e.stopPropagation();
    setMarkingPaid(prev => ({ ...prev, [projectId]: true }));
    await base44.entities.Project.update(projectId, { installation_date_status: null });
    await base44.functions.invoke('sendFundsReceivedEmail', { projectId });
    queryClient.invalidateQueries({ queryKey: ['pendingPaymentProjects'] });
    setMarkingPaid(prev => ({ ...prev, [projectId]: false }));
  };

  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ['pendingPaymentProjects'],
    queryFn: async () => {
      const all = await base44.entities.Project.filter({ installation_date_status: 'pending payment' });
      return all.filter(p => p.status !== 'Cancelled');
    }
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => base44.entities.Customer.list()
  });

  const { data: sales = [] } = useQuery({
    queryKey: ['sales'],
    queryFn: () => base44.entities.Sale.list()
  });

  const isNewToday = (project) => {
    const utcMinus7Offset = 7 * 60 * 60 * 1000;
    const nowAz = new Date(Date.now() - utcMinus7Offset);
    const todayAzStart = new Date(Date.UTC(nowAz.getUTCFullYear(), nowAz.getUTCMonth(), nowAz.getUTCDate()) + utcMinus7Offset);
    const created = new Date(project.created_date.includes('Z') ? project.created_date : project.created_date + 'Z');
    return created >= todayAzStart;
  };

  const getCustomer = (customerId) => customers.find(c => c.id === customerId);
  const getSale = (saleId) => sales.find(s => s.id === saleId);

  const newTodayCount = projects.filter(isNewToday).length;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-5xl mx-auto px-6 py-6">
          <Link
            to={createPageUrl('OrderProcessing')}
            className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Order Processing
          </Link>
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center">
              <DollarSign className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Finance</h1>
              <p className="text-slate-500 mt-1">Projects with pending payment status</p>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-sm px-3 py-1">
                {projects.length} Pending
              </Badge>
              {newTodayCount > 0 && (
                <Badge className="bg-yellow-400 text-yellow-900 border-yellow-500 text-sm px-3 py-1">
                  ⚡ {newTodayCount} New Today
                </Badge>
              )}
              <Button
                onClick={handleSendReport}
                disabled={sendingReport}
                variant="outline"
                className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
              >
                {sendingReport ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                Send Report Email
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        {projectsLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-20">
            <DollarSign className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 text-lg">No projects pending payment</p>
          </div>
        ) : (
          <div className="space-y-3">
            {projects.map((project) => {
              const customer = getCustomer(project.customer);
              const sale = getSale(project.sale);
              const isNew = isNewToday(project);
              return (
                <Link
                  key={project.id}
                  to={createPageUrl('ProjectDetail') + `?id=${project.id}`}
                  className={`block rounded-xl p-5 hover:shadow-md transition-all border ${isNew ? 'bg-yellow-50 border-yellow-400 hover:border-yellow-500' : 'bg-white border-amber-200 hover:border-amber-300'}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <span className="font-semibold text-slate-800 text-lg">
                          {customer ? `${customer.first_name} ${customer.last_name}` : 'Unknown Customer'}
                        </span>
                        <Badge className="bg-amber-100 text-amber-800 border-amber-200">
                          Pending Payment
                        </Badge>
                        {isNew && (
                          <Badge className="bg-yellow-400 text-yellow-900 border-yellow-500">
                            ⚡ New Today
                          </Badge>
                        )}
                        <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-slate-200">
                          {project.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-slate-500 flex-wrap">
                        {sale?.invoice_number && (
                          <div className="flex items-center gap-1">
                            <span className="font-medium text-slate-600">Invoice #{sale.invoice_number}</span>
                          </div>
                        )}
                        {customer?.address_line1 && (
                          <div className="flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5" />
                            <span>{customer.address_line1}{customer.city ? `, ${customer.city}` : ''}</span>
                          </div>
                        )}
                        {project.installation_date && (
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" />
                            <span>Install: {format(new Date(project.installation_date + 'T00:00:00'), 'MMM d, yyyy')}</span>
                          </div>
                        )}
                        {sale?.sale_amount && (
                          <div className="flex items-center gap-1">
                            <DollarSign className="w-3.5 h-3.5" />
                            <span>${sale.sale_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <div className="text-xs text-slate-400 whitespace-nowrap">
                        Created {format(new Date(project.created_date + (project.created_date.includes('Z') ? '' : 'Z')), 'MMM d, yyyy')}
                      </div>
                      <button
                        onClick={(e) => handleMarkFundsReceived(e, project.id)}
                        disabled={markingPaid[project.id]}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors disabled:opacity-50"
                      >
                        {markingPaid[project.id] ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-3 h-3" />
                        )}
                        Deposit Received
                      </button>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}