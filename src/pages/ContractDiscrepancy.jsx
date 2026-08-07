import React from 'react';
import ContractDiscrepancyReport from '@/components/rfms/ContractDiscrepancyReport';

export default function ContractDiscrepancy() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Contract vs RFMS</h1>
          <p className="text-slate-500 mt-1">Compare contract sale amounts against RFMS order totals</p>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-6 py-8">
        <ContractDiscrepancyReport />
      </div>
    </div>
  );
}