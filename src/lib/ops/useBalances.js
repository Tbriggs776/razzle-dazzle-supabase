import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

/**
 * Every sale's collection state, keyed by sale id, for the stage engine.
 *
 * `sale_balance` is the single definition of the two money gates:
 *   deposit_satisfied — the deposit has CLEARED (Gate 1, ordering)
 *   fully_collected   — nothing is outstanding (Gate 2, install start)
 *
 * Both are non-null in the view by construction, so a sale MISSING from this map
 * means "not loaded yet", never "unpaid". Callers must test `=== false`, never
 * falsiness, or an empty map silently gates every job in the company.
 *
 * Never recompute either flag in JavaScript. sale.deposit_amount is legacy, holds
 * only the first deposit, and cannot see a second payment or a refund.
 */
export function useBalances(enabled = true) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['saleBalances'],
    // Explicit sort: this is a VIEW with no created_date, and the data client
    // defaults to '-created_date', which would 400.
    queryFn: () => base44.entities.SaleBalance.list('-sale_date'),
    enabled,
    staleTime: 60000,
  });

  const balances = useMemo(
    () => Object.fromEntries(rows.map((r) => [r.sale_id, r])),
    [rows],
  );

  return { balances, rows, isLoading };
}
