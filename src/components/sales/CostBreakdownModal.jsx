import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const fmtDollar = (n) => `$${(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function CostBreakdownModal({ open, onClose, data }) {
  if (!data) return null;
  const { lines, totalCost, orderTotal, grossProfitPercent } = data;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cost Breakdown</DialogTitle>
        </DialogHeader>

        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted">
                <TableHead>Style Name</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Unit Cost</TableHead>
                <TableHead className="text-right">Line Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((item, index) => {
                const lineCost = (item.unitCost || 0) * (item.quantity || 0);
                return (
                  <TableRow key={index}>
                    <TableCell className="font-medium">{item.styleName}</TableCell>
                    <TableCell className="text-right">{item.quantity}</TableCell>
                    <TableCell className="text-right">${item.unitCost?.toFixed(2) || '0.00'}</TableCell>
                    <TableCell className="text-right font-semibold">{fmtDollar(lineCost)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="border-t-2 border-border pt-4 mt-2 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm font-semibold text-foreground">Total Cost:</span>
            <span className="text-lg font-bold text-foreground">{fmtDollar(totalCost)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm font-semibold text-foreground">Order Total:</span>
            <span className="text-lg font-bold text-good">{fmtDollar(orderTotal)}</span>
          </div>
          <div className="flex justify-between items-center pt-2 border-t border-border">
            <span className="text-sm font-semibold text-foreground">Gross Profit %:</span>
            <span className="text-lg font-bold text-info">{grossProfitPercent.toFixed(2)}%</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm font-semibold text-foreground">Gross Profit $:</span>
            <span className="text-lg font-bold text-good">{fmtDollar(orderTotal - totalCost)}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}