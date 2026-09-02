import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { invokeFailure } from '@/lib/invokeResult';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';

/**
 * Pick a lead by typing, against the whole book.
 *
 * REPLACES A DROPDOWN THAT LISTED EVERY LEAD. Both appointment forms rendered a
 * <Select> over Lead.list() -- 17,459 options after the GoHighLevel import, in a
 * control you are meant to scroll. It downloaded 4.8 MB to fill a menu nobody
 * could realistically use, and the browser had to build every option node.
 *
 * Searching happens in Postgres (search_leads), across name, email and phone,
 * debounced, 20 at a time. Typing three letters is faster than scrolling 17,000
 * rows and costs about 50ms.
 *
 * THE SELECTED LEAD IS FETCHED SEPARATELY, and that is the subtle part: once you
 * pick someone and the search term changes, they are no longer in the result
 * set. Without holding onto them the control would show a blank trigger for a
 * lead that is definitely selected -- so it looks unset, gets re-picked, and the
 * form quietly changes the customer. Their name is resolved by id and kept.
 */
export default function LeadPicker({
  value,
  onChange,
  placeholder = 'Search leads by name, email or phone…',
  disabled = false,
  className,
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['leadPicker', debounced],
    queryFn: async () => {
      const res = await base44.functions.invoke('searchLeads', {
        query: debounced || null, limit: 20, offset: 0, sort: 'desc',
      });
      if (invokeFailure(res)) return [];
      return res.data ?? [];
    },
    // Only search once the popover is open; a closed picker on a form the user
    // has not touched should not be querying anything.
    enabled: open,
    placeholderData: (prev) => prev,
  });

  // The chosen lead, by id, independent of what the search currently returns.
  const { data: selected } = useQuery({
    queryKey: ['leadPickerSelected', value],
    queryFn: async () => {
      const rows = await base44.entities.Lead.filter({ id: value }, '-created_date', 1);
      return rows?.[0] ?? null;
    },
    enabled: !!value,
    staleTime: 300000,
  });

  const label = (l) =>
    [`${l.first_name || ''} ${l.last_name || ''}`.trim() || 'Unnamed lead', l.email || l.phone]
      .filter(Boolean).join(' — ');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('h-12 w-full justify-between border-border font-normal', className)}
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected ? label(selected) : 'Select a lead'}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={placeholder} value={term} onValueChange={setTerm} />
          <CommandList>
            {isFetching && (
              <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Searching…
              </div>
            )}
            {!isFetching && results.length === 0 && (
              <CommandEmpty>
                {debounced ? `No leads match "${debounced}".` : 'Start typing to search.'}
              </CommandEmpty>
            )}
            <CommandGroup>
              {results.map((lead) => (
                <CommandItem
                  key={lead.id}
                  value={lead.id}
                  onSelect={() => { onChange(lead.id); setOpen(false); }}
                >
                  <Check className={cn('mr-2 h-4 w-4', value === lead.id ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">{label(lead)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
