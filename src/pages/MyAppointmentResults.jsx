import React from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import MyAppointmentResultsTable from '@/components/appointments/MyAppointmentResultsTable';

export default function MyAppointmentResults() {
  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    retry: false,
  });

  if (userLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader
          eyebrow="Performance"
          title="My Results"
          subtitle="Track your appointment outcomes by day, week, month, year, or a custom range"
        />

        <MyAppointmentResultsTable currentUser={currentUser} />
      </div>
    </div>
  );
}
