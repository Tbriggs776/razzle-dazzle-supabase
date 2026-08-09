import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Calculator, DollarSign, CreditCard, TrendingUp } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

const FINANCING_OPTIONS = {
  synchrony: {
    deferred: [
      { name: 'Everyday 6 Months', fee: 1.49, minPurchase: '$299 - $1998.99' },
      { name: '6 Months', fee: 1.49, minPurchase: 'N/A' },
      { name: '12 Months', fee: 3.42, minPurchase: '$1999+' },
      { name: '12 Months (Alt)', fee: 3.42, minPurchase: 'N/A' },
      { name: '15 Months', fee: 5.46, minPurchase: 'N/A' },
      { name: '18 Months', fee: 7.26, minPurchase: 'N/A' },
      { name: '24 Months', fee: 11.84, minPurchase: 'N/A' },
    ],
    equalPayment: [
      { name: '24 Months 0% APR', fee: 9.94 },
      { name: '36 Months 0% APR', fee: 12.20 },
      { name: '48 Months 0% APR', fee: 16.10 },
      { name: '60 Months 0% APR', fee: 19.51 },
    ],
    fixedPay: [
      { name: '24 Months 9.99% APR', fee: 6.66 },
      { name: '36 Months 9.99% APR', fee: 9.22 },
      { name: '48 Months 9.99% APR', fee: 11.92 },
      { name: '60 Months 9.99% APR', fee: 14.79 },
    ],
  },
  momnt: [
    { name: '65 to 180 Months - 6.99% to 23.15% APR', fee: 5.50 },
    { name: '120 Months - 9.99% APR', fee: 7.50 },
    { name: '144 Months - 11.99% APR', fee: 0.00 },
    { name: '60 Months - 5.99% APR', fee: 11.50 },
    { name: '96 Months - 17.99% APR', fee: 7.75 },
    { name: '108 Months - 17.99% APR', fee: 12.50 },
    { name: '96 Months - 17.99% to 29.99% APR', fee: 7.50 },
    { name: '120 Months - 9.99% to 26.99% APR', fee: 0.00 },
    { name: '12 Month NO NO', fee: 7.75 },
    { name: '24 Month NO NO', fee: 12.50 },
  ],
};

export default function InvoiceCalculator() {
  const [invoiceTotal, setInvoiceTotal] = useState('');
  const [displayValue, setDisplayValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [creditCardEnabled, setCreditCardEnabled] = useState(false);
  const [selectedFinancing, setSelectedFinancing] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const isAdmin = currentUser?.role === 'admin';

  const handleInvoiceChange = (e) => {
    const value = e.target.value.replace(/[^0-9.]/g, '');
    setInvoiceTotal(value);
    setDisplayValue(value);
  };

  const handleBlur = () => {
    setIsFocused(false);
    if (invoiceTotal) {
      const num = parseFloat(invoiceTotal);
      if (!isNaN(num)) {
        setDisplayValue('$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
      }
    }
  };

  const handleFocus = () => {
    setIsFocused(true);
    setDisplayValue(invoiceTotal);
  };

  const calculations = useMemo(() => {
    const total = parseFloat(invoiceTotal) || 0;
    if (total === 0) return null;

    const ccFee = creditCardEnabled ? total * 0.035 : 0;
    const financingFee = selectedFinancing ? total * ((selectedFinancing.fee + 1.5) / 100) : 0;
    const totalBill = total + ccFee + financingFee;

    return {
      invoiceTotal: total,
      ccFee,
      financingFee,
      totalBill,
    };
  }, [invoiceTotal, creditCardEnabled, selectedFinancing]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center">
              <Calculator className="w-7 h-7 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground tracking-tight">Invoice Calculator</h1>
              <p className="text-muted-foreground mt-1">Calculate customer billing with fees</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Input */}
          <div className="lg:col-span-2 space-y-6">
            {/* Invoice Input */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <DollarSign className="w-5 h-5 text-primary" />
                    Invoice Total
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <Label htmlFor="invoice">Enter Invoice Amount</Label>
                    <Input
                      id="invoice"
                      type="text"
                      placeholder="$0.00"
                      value={displayValue}
                      onChange={handleInvoiceChange}
                      onFocus={handleFocus}
                      onBlur={handleBlur}
                      className="text-2xl h-16 font-semibold"
                    />
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Credit Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CreditCard className="w-5 h-5 text-primary" />
                    Credit Card Fee
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between p-4 rounded-lg border border-border bg-secondary">
                    <div>
                      <p className="font-medium text-foreground">Enable Credit Card Fee</p>
                      <p className="text-sm text-muted-foreground mt-1">3.5% processing fee</p>
                    </div>
                    <Switch
                      checked={creditCardEnabled}
                      onCheckedChange={setCreditCardEnabled}
                    />
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Financing Options */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-primary" />
                    Financing Options
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Synchrony Header */}
                  <div className="bg-primary/10 border-2 border-primary/20 rounded-lg p-4">
                    <h2 className="text-xl font-bold text-primary">Synchrony</h2>
                  </div>

                  {/* Deferred Interest */}
                  <div>
                    <h3 className="font-semibold text-foreground mb-3">Deferred Interest Promotions</h3>
                    <div className="space-y-2">
                      {FINANCING_OPTIONS.synchrony.deferred.map((option, idx) => (
                        <button
                          key={idx}
                          onClick={() => setSelectedFinancing(selectedFinancing?.name === option.name ? null : { ...option, vendor: 'Synchrony' })}
                          className={cn(
                            "w-full flex items-center justify-between p-3 rounded-lg border transition-all",
                            selectedFinancing?.name === option.name
                              ? "bg-primary/10 border-primary shadow-sm"
                              : "bg-card border-border hover:border-primary/40 hover:bg-primary/5"
                          )}
                        >
                          <div className="text-left">
                            <p className="font-medium text-foreground">{option.name}</p>
                            <p className="text-xs text-muted-foreground">{option.minPurchase}</p>
                          </div>
                          <div className="text-right">
                            <span className={cn(
                              "text-sm font-semibold px-2 py-1 rounded",
                              selectedFinancing?.name === option.name
                                ? "bg-primary/15 text-primary"
                                : "bg-secondary text-secondary-foreground"
                            )}>
                              {isAdmin ? Math.ceil(option.fee) : ''}%
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Equal Payment - 0% APR */}
                  <div>
                    <h3 className="font-semibold text-foreground mb-3">Equal Payment Promotions - 0.00% APR</h3>
                    <div className="space-y-2">
                      {FINANCING_OPTIONS.synchrony.equalPayment.map((option, idx) => (
                        <button
                          key={idx}
                          onClick={() => setSelectedFinancing(selectedFinancing?.name === option.name ? null : { ...option, vendor: 'Synchrony' })}
                          className={cn(
                            "w-full flex items-center justify-between p-3 rounded-lg border transition-all",
                            selectedFinancing?.name === option.name
                              ? "bg-primary/10 border-primary shadow-sm"
                              : "bg-card border-border hover:border-primary/40 hover:bg-primary/5"
                          )}
                        >
                          <p className="font-medium text-foreground">{option.name}</p>
                          <span className={cn(
                           "text-sm font-semibold px-2 py-1 rounded",
                           selectedFinancing?.name === option.name
                             ? "bg-primary/15 text-primary"
                             : "bg-secondary text-secondary-foreground"
                          )}>
                           {isAdmin ? Math.ceil(option.fee) : ''}%
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Fixed Pay - 9.99% APR */}
                  <div>
                    <h3 className="font-semibold text-foreground mb-3">Fixed Pay Promotions - 9.99% APR</h3>
                    <div className="space-y-2">
                      {FINANCING_OPTIONS.synchrony.fixedPay.map((option, idx) => (
                        <button
                          key={idx}
                          onClick={() => setSelectedFinancing(selectedFinancing?.name === option.name ? null : { ...option, vendor: 'Synchrony' })}
                          className={cn(
                            "w-full flex items-center justify-between p-3 rounded-lg border transition-all",
                            selectedFinancing?.name === option.name
                              ? "bg-primary/10 border-primary shadow-sm"
                              : "bg-card border-border hover:border-primary/40 hover:bg-primary/5"
                          )}
                        >
                          <p className="font-medium text-foreground">{option.name}</p>
                          <span className={cn(
                            "text-sm font-semibold px-2 py-1 rounded",
                            selectedFinancing?.name === option.name
                              ? "bg-primary/15 text-primary"
                              : "bg-secondary text-secondary-foreground"
                          )}>
                            {isAdmin ? Math.ceil(option.fee) : ''}%
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* MOMNT Financing */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-primary" />
                    Financing Options
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* MOMNT Header */}
                  <div className="bg-brand-blue/10 border-2 border-brand-blue/20 rounded-lg p-4">
                    <h2 className="text-xl font-bold text-brand-blue">MOMNT</h2>
                  </div>

                  {/* MOMNT Options */}
                  <div>
                    <h3 className="font-semibold text-foreground mb-3">Merchant Fee Options</h3>
                    <div className="space-y-2">
                      {FINANCING_OPTIONS.momnt.map((option, idx) => (
                        <button
                          key={idx}
                          onClick={() => setSelectedFinancing(selectedFinancing?.name === option.name ? null : { ...option, vendor: 'MOMNT' })}
                          className={cn(
                            "w-full flex items-center justify-between p-3 rounded-lg border transition-all",
                            selectedFinancing?.name === option.name
                              ? "bg-brand-blue/10 border-brand-blue shadow-sm"
                              : "bg-card border-border hover:border-brand-blue/40 hover:bg-brand-blue/5"
                          )}
                        >
                          <p className="font-medium text-foreground">{option.name}</p>
                          <span className={cn(
                            "text-sm font-semibold px-2 py-1 rounded",
                            selectedFinancing?.name === option.name
                              ? "bg-brand-blue/15 text-brand-blue"
                              : "bg-secondary text-secondary-foreground"
                          )}>
                            {isAdmin ? Math.ceil(option.fee) : ''}%
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* Right Column - Summary */}
          <div>
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
              className="sticky top-6"
            >
              <Card className="border-2 border-primary/30 bg-gradient-to-br from-card to-primary/5">
                <CardHeader>
                  <CardTitle className="text-primary">Billing Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {calculations ? (
                    <>
                      <div className="space-y-3">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Invoice Total:</span>
                          <span className="font-semibold text-foreground">
                            ${calculations.invoiceTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                        
                        {creditCardEnabled && (
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">CC Fee (3.5%):</span>
                            <span className="font-semibold text-foreground">
                              +${calculations.ccFee.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                        )}
                        
                        {selectedFinancing && (
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">
                              {selectedFinancing.vendor} - {selectedFinancing.name}:
                            </span>
                            <span className="font-semibold text-foreground">
                              +${calculations.financingFee.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="pt-3 border-t-2 border-primary/30">
                        <div className="flex justify-between items-center">
                          <span className="text-lg font-semibold text-foreground">Total to Bill:</span>
                          <span className="text-2xl font-bold text-primary">
                            ${calculations.totalBill.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>

                      {(creditCardEnabled || selectedFinancing) && (
                        <div className="pt-3 border-t border-border">
                          <div className="text-xs text-muted-foreground space-y-1">
                            <p>Additional Fees:</p>
                            <p className="font-medium text-foreground">
                              ${(calculations.ccFee + calculations.financingFee).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <Calculator className="w-12 h-12 mx-auto mb-3 opacity-50" />
                      <p className="text-sm">Enter an invoice amount to see calculations</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}