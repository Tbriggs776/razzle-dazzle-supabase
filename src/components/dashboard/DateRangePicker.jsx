import React, { useState, useRef, useEffect } from 'react';
import { Calendar } from 'lucide-react';

const PRESETS = [
  { label: 'Today', days: 1 },
  { label: 'Yesterday', days: 1, offset: 1 },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 14 days', days: 14 },
  { label: 'Last 28 days', days: 28 },
  { label: 'Last 30 days', days: 30 },
  { label: 'This month', type: 'this_month' },
  { label: 'Last month', type: 'last_month' },
  { label: 'This quarter', type: 'this_quarter' },
  { label: 'Last quarter', type: 'last_quarter' },
];

function getPhoenixToday() {
  return new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' }));
}

function formatDate(d) {
  if (!d) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isSameDay(a, b) {
  return a && b && a.toDateString() === b.toDateString();
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function presetToRange(preset) {
  const today = getPhoenixToday();
  if (preset.type === 'this_month') {
    return { start: startOfMonth(today), end: today };
  }
  if (preset.type === 'last_month') {
    const lm = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    return { start: lm, end: endOfMonth(lm) };
  }
  if (preset.type === 'this_quarter') {
    const q = Math.floor(today.getMonth() / 3);
    return { start: new Date(today.getFullYear(), q * 3, 1), end: today };
  }
  if (preset.type === 'last_quarter') {
    const q = Math.floor(today.getMonth() / 3);
    const lq = q === 0 ? 3 : q - 1;
    const lqYear = q === 0 ? today.getFullYear() - 1 : today.getFullYear();
    return { start: new Date(lqYear, lq * 3, 1), end: new Date(lqYear, lq * 3 + 3, 0) };
  }
  if (preset.offset) {
    const d = addDays(today, -preset.offset);
    return { start: d, end: d };
  }
  const start = preset.days === 1 ? today : addDays(today, -(preset.days - 1));
  return { start, end: today };
}

function CalendarMonth({ year, month, rangeStart, rangeEnd, hoverDate, onDayClick, onDayHover }) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = getPhoenixToday();

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  const effectiveEnd = hoverDate && rangeStart && !rangeEnd
    ? (hoverDate >= rangeStart ? hoverDate : rangeStart)
    : rangeEnd;
  const effectiveStart = hoverDate && rangeStart && !rangeEnd && hoverDate < rangeStart
    ? hoverDate : rangeStart;

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  return (
    <div className="w-full lg:w-64">
      <div className="text-center font-semibold text-foreground mb-3 text-sm">
        {MONTHS[month]} {year}
      </div>
      <div className="grid grid-cols-7 mb-1">
        {DAYS.map(d => (
          <div key={d} className="text-center text-xs text-muted-foreground font-medium py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          if (!day) return <div key={`e-${i}`} />;
          const isStart = isSameDay(day, effectiveStart);
          const isEnd = isSameDay(day, effectiveEnd);
          const inRange = effectiveStart && effectiveEnd && day > effectiveStart && day < effectiveEnd;
          const isToday = isSameDay(day, today);
          const isFuture = day > today;

          return (
            <button
              key={day.getDate()}
              disabled={isFuture}
              onClick={() => onDayClick(day)}
              onMouseEnter={() => onDayHover(day)}
              className={[
                'relative h-8 text-sm transition-colors',
                isFuture ? 'text-muted-foreground cursor-not-allowed' : 'cursor-pointer',
                isStart || isEnd ? 'bg-slate-800 text-white font-bold rounded-md z-10' : '',
                inRange ? 'bg-muted text-foreground' : '',
                !isStart && !isEnd && !inRange && !isFuture ? 'hover:bg-muted text-foreground' : '',
                isToday && !isStart && !isEnd ? 'font-bold underline' : '',
              ].filter(Boolean).join(' ')}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function DateRangePicker({ value, onChange }) {
  const today = getPhoenixToday();
  const [open, setOpen] = useState(false);
  const [rangeStart, setRangeStart] = useState(value?.start || today);
  const [rangeEnd, setRangeEnd] = useState(value?.end || today);
  const [hoverDate, setHoverDate] = useState(null);
  const [selecting, setSelecting] = useState(false); // true = waiting for end date
  const [activePreset, setActivePreset] = useState('Today');

  // Calendar navigation
  const [leftYear, setLeftYear] = useState(today.getFullYear());
  const [leftMonth, setLeftMonth] = useState(today.getMonth());
  const rightMonth = leftMonth === 11 ? 0 : leftMonth + 1;
  const rightYear = leftMonth === 11 ? leftYear + 1 : leftYear;

  const ref = useRef();
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handlePreset = (preset) => {
    const { start, end } = presetToRange(preset);
    setRangeStart(start);
    setRangeEnd(end);
    setSelecting(false);
    setActivePreset(preset.label);
  };

  const handleDayClick = (day) => {
    if (!selecting || !rangeStart) {
      setRangeStart(day);
      setRangeEnd(null);
      setSelecting(true);
      setActivePreset(null);
    } else {
      const start = day < rangeStart ? day : rangeStart;
      const end = day < rangeStart ? rangeStart : day;
      setRangeStart(start);
      setRangeEnd(end);
      setSelecting(false);
      setActivePreset(null);
    }
  };

  const handleUpdate = () => {
    if (rangeStart && rangeEnd) {
      onChange({ start: rangeStart, end: rangeEnd });
      setOpen(false);
    }
  };

  const handleCancel = () => {
    setRangeStart(value?.start || today);
    setRangeEnd(value?.end || today);
    setOpen(false);
  };

  const prevMonth = () => {
    if (leftMonth === 0) { setLeftMonth(11); setLeftYear(y => y - 1); }
    else setLeftMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (leftMonth === 11) { setLeftMonth(0); setLeftYear(y => y + 1); }
    else setLeftMonth(m => m + 1);
  };

  const displayLabel = value
    ? isSameDay(value.start, value.end)
      ? formatDate(value.start)
      : `${formatDate(value.start)} – ${formatDate(value.end)}`
    : 'Select date range';

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg bg-white text-sm font-medium text-foreground hover:bg-muted transition-colors shadow-sm"
      >
        <Calendar className="w-4 h-4 text-muted-foreground" />
        {displayLabel}
      </button>

      {open && (
        <div className="fixed left-1/2 top-1/2 z-50 flex w-[calc(100vw-2rem)] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto bg-white border border-border rounded-xl shadow-xl lg:absolute lg:left-auto lg:right-0 lg:top-full lg:mt-2 lg:w-auto lg:max-h-none lg:translate-x-0 lg:translate-y-0 lg:flex-row lg:overflow-visible">
          {/* Presets */}
          <div className="grid grid-cols-2 gap-1 border-b border-border p-3 lg:w-40 lg:grid-cols-1 lg:gap-0.5 lg:border-b-0 lg:border-r">
            {PRESETS.map(p => (
              <button
                key={p.label}
                onClick={() => handlePreset(p)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${activePreset === p.label ? 'bg-slate-800 text-white font-semibold' : 'text-muted-foreground hover:bg-muted'}`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Calendars */}
          <div className="min-w-0 p-4">
            <div className="flex items-center gap-2 mb-3 lg:gap-4">
              <button onClick={prevMonth} className="shrink-0 p-1 rounded hover:bg-muted text-muted-foreground">‹</button>
              <div className="flex min-w-0 flex-col gap-6 flex-1 justify-center lg:flex-row lg:gap-8">
                <CalendarMonth
                  year={leftYear} month={leftMonth}
                  rangeStart={rangeStart} rangeEnd={rangeEnd} hoverDate={hoverDate}
                  onDayClick={handleDayClick} onDayHover={setHoverDate}
                />
                <CalendarMonth
                  year={rightYear} month={rightMonth}
                  rangeStart={rangeStart} rangeEnd={rangeEnd} hoverDate={hoverDate}
                  onDayClick={handleDayClick} onDayHover={setHoverDate}
                />
              </div>
              <button onClick={nextMonth} className="shrink-0 p-1 rounded hover:bg-muted text-muted-foreground">›</button>
            </div>

            {/* Custom date inputs */}
            <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-border">
              <div className="flex min-w-0 items-center gap-2">
                <label className="text-xs text-muted-foreground font-medium">Start:</label>
                <input
                  type="date"
                  value={rangeStart ? rangeStart.toLocaleDateString('en-CA') : ''}
                  max={today.toLocaleDateString('en-CA')}
                  onChange={(e) => {
                    const d = new Date(e.target.value + 'T00:00:00');
                    if (!isNaN(d.getTime())) {
                      setRangeStart(d);
                      if (!rangeEnd || d > rangeEnd) setRangeEnd(d);
                      setActivePreset(null);
                    }
                  }}
                  className="text-sm border border-border rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <label className="text-xs text-muted-foreground font-medium">End:</label>
                <input
                  type="date"
                  value={rangeEnd ? rangeEnd.toLocaleDateString('en-CA') : ''}
                  max={today.toLocaleDateString('en-CA')}
                  onChange={(e) => {
                    const d = new Date(e.target.value + 'T00:00:00');
                    if (!isNaN(d.getTime())) {
                      setRangeEnd(d);
                      if (!rangeStart || d < rangeStart) setRangeStart(d);
                      setActivePreset(null);
                    }
                  }}
                  className="text-sm border border-border rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-border">
              <span className="text-xs text-muted-foreground">Dates shown in Mountain Standard Time (Arizona)</span>
              <div className="ml-auto flex shrink-0 gap-2">
                <button onClick={handleCancel} className="px-4 py-1.5 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted">Cancel</button>
                <button
                  onClick={handleUpdate}
                  disabled={!rangeStart || !rangeEnd}
                  className="px-4 py-1.5 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-40"
                >
                  Update
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}