import React from 'react';
import ContractDiscrepancyReport from '@/components/rfms/ContractDiscrepancyReport';

export default function ContractDiscrepancy() {
  return (
    <div className="min-h-screen bg-background">
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <h1 className="text-3xl font-bold text-foreground tracking-tight">Contract vs RFMS</h1>
          <p className="text-muted-foreground mt-1">Compare contract sale amounts against RFMS order totals</p>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <ContractDiscrepancyReport />
      </div>
    </div>
  );
}