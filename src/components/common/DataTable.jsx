import * as React from 'react';
import { cn } from '@/lib/utils';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';

// Thin ERP-flavored wrapper over ui/table: muted eyebrow header, right-aligned numeric
// columns (tabular-nums), optional row click. Backs the list + report pages.
// columns: [{ key, header, align?: 'right', numeric?, render?(row,i), className?, cellClassName? }]
export default function DataTable({
  columns = [],
  data = [],
  rowKey,
  onRowClick,
  empty = 'Nothing to show.',
  className,
}) {
  if (!data.length) {
    return (
      <div className="rounded-xl border border-border bg-card py-10 text-center text-sm text-muted-foreground">
        {empty}
      </div>
    );
  }
  return (
    <div className={cn('overflow-hidden rounded-xl border border-border bg-card', className)}>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/60 hover:bg-muted/60">
            {columns.map((c) => (
              <TableHead
                key={c.key}
                className={cn(
                  'text-[11px] font-semibold uppercase tracking-wide',
                  (c.align === 'right' || c.numeric) && 'text-right',
                  c.className
                )}
              >
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row, i) => (
            <TableRow
              key={rowKey ? rowKey(row, i) : i}
              onClick={onRowClick ? () => onRowClick(row, i) : undefined}
              className={cn(onRowClick && 'cursor-pointer')}
            >
              {columns.map((c) => (
                <TableCell
                  key={c.key}
                  className={cn((c.align === 'right' || c.numeric) && 'text-right tabular-nums', c.cellClassName)}
                >
                  {c.render ? c.render(row, i) : row[c.key]}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
