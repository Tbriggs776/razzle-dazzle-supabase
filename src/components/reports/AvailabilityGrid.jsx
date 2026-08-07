import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { X, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, addDays, startOfWeek, subDays } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Users } from 'lucide-react';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const getDow = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  return DAY_NAMES[d.getDay()];
};

export default function AvailabilityGrid({ designConsultants, appointments }) {
  const queryClient = useQueryClient();
  const [savingId, setSavingId] = useState(null);
  const [weekOffset, setWeekOffset] = useState(0); // 0 = current week
  const [lookbackDays, setLookbackDays] = useState(30); // 30 or 60
  const [apptsPerDcPerDay, setApptsPerDcPerDay] = useState(3); // capacity assumption

  // Compute the 7 dates for the selected week (Mon–Sun)
  const weekDates = useMemo(() => {
    const phoenixOffsetMs = 7 * 60 * 60 * 1000; // UTC-7
    const nowPhoenix = new Date(new Date().getTime() - phoenixOffsetMs);
    const monday = startOfWeek(nowPhoenix, { weekStartsOn: 1 });
    const baseMonday = addDays(monday, weekOffset * 7);
    return DAYS.map((d, i) => addDays(baseMonday, i));
  }, [weekOffset]);

  const weekStartStr = format(weekDates[0], 'yyyy-MM-dd');
  const weekEndStr = format(weekDates[6], 'yyyy-MM-dd');

  const weekLabel = useMemo(() => {
    const start = weekDates[0];
    const end = weekDates[6];
    const isCurrent = weekOffset === 0;
    const isPast = weekOffset < 0;
    const suffix = isCurrent ? ' (This Week)' : isPast ? '' : ' (Upcoming)';
    return `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}${suffix}`;
  }, [weekDates, weekOffset]);

  // Map each day to its date string for filtering
  const dayDateStrs = useMemo(() => {
    const map = {};
    DAYS.forEach((d, i) => {
      map[d] = format(weekDates[i], 'yyyy-MM-dd');
    });
    return map;
  }, [weekDates]);

  // Count appointments per DC per day within the selected week
  const bookedByDcAndDay = useMemo(() => {
    const map = {}; // { dcId: { Mon: count, Tue: count, ... } }
    designConsultants.forEach(dc => {
      map[dc.id] = {};
      DAYS.forEach(d => { map[dc.id][d] = 0; });
    });
    appointments.forEach(apt => {
      if (!apt.appointment_date) return;
      if (apt.appointment_date < weekStartStr || apt.appointment_date > weekEndStr) return;
      if (!apt.assigned_dc || !map[apt.assigned_dc]) return;
      const dow = getDow(apt.appointment_date);
      if (dow && map[apt.assigned_dc].hasOwnProperty(dow)) {
        map[apt.assigned_dc][dow]++;
      }
    });
    return map;
  }, [appointments, weekStartStr, weekEndStr, designConsultants]);

  // Totals per day across all DCs
  const bookedByDay = useMemo(() => {
    const counts = {};
    DAYS.forEach(d => counts[d] = 0);
    Object.values(bookedByDcAndDay).forEach(dcDays => {
      DAYS.forEach(d => { counts[d] += dcDays[d] || 0; });
    });
    return counts;
  }, [bookedByDcAndDay]);

  const availableByDay = useMemo(() => {
    const counts = {};
    DAYS.forEach(d => counts[d] = 0);
    designConsultants.forEach(dc => {
      const avail = dc.availability || [];
      DAYS.forEach(d => {
        if (avail.includes(d)) counts[d]++;
      });
    });
    return counts;
  }, [designConsultants]);

  const totalBooked = useMemo(() => {
    return DAYS.reduce((sum, d) => sum + bookedByDay[d], 0);
  }, [bookedByDay]);

  const totalAvailable = useMemo(() => {
    return DAYS.reduce((sum, d) => sum + availableByDay[d], 0);
  }, [availableByDay]);

  // Historical appointment flow: average appointments per day of week over lookback period
  const historicalFlow = useMemo(() => {
    const phoenixOffsetMs = 7 * 60 * 60 * 1000; // UTC-7
    const nowPhoenix = new Date(new Date().getTime() - phoenixOffsetMs);
    const lookbackStart = format(subDays(nowPhoenix, lookbackDays), 'yyyy-MM-dd');
    const todayStr = format(nowPhoenix, 'yyyy-MM-dd');

    const totalByDay = {};
    const weekCountByDay = {};
    DAYS.forEach(d => { totalByDay[d] = 0; weekCountByDay[d] = 0; });

    // Count how many of each day-of-week occur in the lookback window
    const cursor = new Date(subDays(nowPhoenix, lookbackDays));
    const end = new Date(nowPhoenix);
    while (cursor <= end) {
      const dow = DAY_NAMES[cursor.getDay()];
      if (weekCountByDay.hasOwnProperty(dow)) weekCountByDay[dow]++;
      cursor.setDate(cursor.getDate() + 1);
    }

    appointments.forEach(apt => {
      if (!apt.appointment_date) return;
      if (apt.appointment_date < lookbackStart || apt.appointment_date > todayStr) return;
      const dow = getDow(apt.appointment_date);
      if (dow && totalByDay.hasOwnProperty(dow)) totalByDay[dow]++;
    });

    const avgByDay = {};
    const suggestedByDay = {};
    DAYS.forEach(d => {
      const weeks = weekCountByDay[d] || 0;
      avgByDay[d] = weeks > 0 ? totalByDay[d] / weeks : 0;
      suggestedByDay[d] = Math.ceil(avgByDay[d] / apptsPerDcPerDay);
    });

    return { avgByDay, suggestedByDay, totalByDay, weekCountByDay, lookbackStart, todayStr };
  }, [appointments, lookbackDays, apptsPerDcPerDay]);

  const toggleAvailability = async (dc, day) => {
    setSavingId(dc.id);
    const current = dc.availability || [];
    const updated = current.includes(day)
      ? current.filter(d => d !== day)
      : [...current, day];
    try {
      await base44.entities.TeamMember.update(dc.id, { availability: updated });
      queryClient.invalidateQueries({ queryKey: ['teamMembers'] });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>DC Availability & Weekly Appointments</CardTitle>
            <CardDescription>
              Toggle X for availability · numbers show booked appointments per DC for the selected week
            </CardDescription>
          </div>
          {/* Week toggle */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setWeekOffset(prev => prev - 1)}
              className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
            >
              <ChevronLeft className="w-4 h-4 text-slate-600" />
            </button>
            <span className="text-sm font-semibold text-slate-700 min-w-[200px] text-center">
              {weekLabel}
            </span>
            <button
              onClick={() => setWeekOffset(prev => prev + 1)}
              className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
            >
              <ChevronRight className="w-4 h-4 text-slate-600" />
            </button>
            {weekOffset !== 0 && (
              <button
                onClick={() => setWeekOffset(0)}
                className="ml-1 px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Today
              </button>
            )}
          </div>
        </div>

        {/* DC suggestion controls */}
        <div className="flex items-end gap-4 mt-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-500">Lookback Period</Label>
            <Select value={String(lookbackDays)} onValueChange={(v) => setLookbackDays(Number(v))}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">Last 30 Days</SelectItem>
                <SelectItem value="60">Last 60 Days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-500">Appts / DC / Day</Label>
            <Input
              type="number"
              min="1"
              max="10"
              value={apptsPerDcPerDay}
              onChange={(e) => setApptsPerDcPerDay(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-24"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left font-semibold text-slate-600 px-3 py-2 min-w-[140px]">
                  Design Consultant
                </th>
                {DAYS.map((d, i) => (
                  <th key={d} className="text-center font-semibold text-slate-600 px-3 py-2 w-20">
                    <div>{d}</div>
                    <div className="text-xs font-normal text-slate-400">
                      {format(weekDates[i], 'M/d')}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {designConsultants.map(dc => {
                const avail = dc.availability || [];
                const dcBooked = bookedByDcAndDay[dc.id] || {};
                return (
                  <tr key={dc.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="font-medium text-slate-700 px-3 py-2">
                      {dc.first_name} {dc.last_name}
                    </td>
                    {DAYS.map(d => {
                      const isAvailable = avail.includes(d);
                      const booked = dcBooked[d] || 0;
                      return (
                        <td key={d} className="text-center px-3 py-2">
                          <button
                            onClick={() => toggleAvailability(dc, d)}
                            disabled={savingId === dc.id}
                            className={`w-12 h-12 rounded-lg flex flex-col items-center justify-center transition-colors mx-auto ${
                              isAvailable
                                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                : 'bg-slate-50 text-slate-300 hover:bg-slate-100'
                            }`}
                          >
                            {savingId === dc.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <>
                                {isAvailable && <X className="w-3.5 h-3.5" />}
                                {booked > 0 && (
                                  <span className={`text-xs font-bold ${isAvailable ? 'text-green-700' : 'text-slate-500'}`}>
                                    {booked}
                                  </span>
                                )}
                              </>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {/* Available DCs per day */}
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                <td className="text-slate-700 px-3 py-2">Available DCs</td>
                {DAYS.map(d => (
                  <td key={d} className="text-center text-slate-700 px-3 py-2">
                    {availableByDay[d]}
                  </td>
                ))}
              </tr>
              {/* Booked appointments per day */}
              <tr className="bg-amber-50 font-bold">
                <td className="text-amber-700 px-3 py-2">Booked This Week</td>
                {DAYS.map(d => (
                  <td key={d} className="text-center text-amber-700 px-3 py-2">
                    {bookedByDay[d]}
                  </td>
                ))}
              </tr>
              {/* Historical average appts per day of week */}
              <tr className="bg-blue-50 font-semibold">
                <td className="text-blue-700 px-3 py-2">
                  Avg Appts/Day
                  <span className="block text-xs font-normal text-blue-400">
                    ({lookbackDays}d lookback)
                  </span>
                </td>
                {DAYS.map(d => (
                  <td key={d} className="text-center text-blue-700 px-3 py-2">
                    {historicalFlow.avgByDay[d].toFixed(1)}
                  </td>
                ))}
              </tr>
              {/* Suggested DCs needed */}
              <tr className="bg-indigo-50 font-bold">
                <td className="text-indigo-700 px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" />
                    Suggested DCs
                  </div>
                  <span className="block text-xs font-normal text-indigo-400">
                    based on {apptsPerDcPerDay} appts/DC/day
                  </span>
                </td>
                {DAYS.map(d => {
                  const suggested = historicalFlow.suggestedByDay[d];
                  const current = availableByDay[d];
                  const gap = suggested - current;
                  return (
                    <td key={d} className="text-center px-3 py-2">
                      <div className="flex flex-col items-center">
                        <span className="text-indigo-700">{suggested}</span>
                        {gap > 0 && (
                          <span className="text-xs text-red-500 font-medium">
                            +{gap} needed
                          </span>
                        )}
                        {gap <= 0 && suggested > 0 && (
                          <span className="text-xs text-green-500 font-medium">✓ covered</span>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Weekly summary */}
        <div className="flex flex-wrap gap-4 mt-4 justify-end">
          <div className="bg-slate-50 rounded-lg px-4 py-3 text-center min-w-[120px]">
            <p className="text-xs text-slate-500 mb-1">DCs on Team</p>
            <p className="text-2xl font-bold text-slate-800">{designConsultants.length}</p>
          </div>
          <div className="bg-indigo-50 rounded-lg px-4 py-3 text-center min-w-[120px]">
            <p className="text-xs text-indigo-500 mb-1">DCs Needed (peak day)</p>
            <p className="text-2xl font-bold text-indigo-600">
              {Math.max(...DAYS.map(d => historicalFlow.suggestedByDay[d]), 0)}
            </p>
          </div>
          <div className="bg-amber-50 rounded-lg px-4 py-3 text-center min-w-[120px]">
            <p className="text-xs text-amber-500 mb-1">Booked This Week</p>
            <p className="text-2xl font-bold text-amber-600">{totalBooked}</p>
          </div>
          <div className="bg-slate-50 rounded-lg px-4 py-3 text-center min-w-[120px]">
            <p className="text-xs text-slate-500 mb-1">Avail. DC-days / Wk</p>
            <p className="text-2xl font-bold text-slate-800">{totalAvailable}</p>
          </div>
          <div className="bg-indigo-50 rounded-lg px-4 py-3 text-center min-w-[120px]">
            <p className="text-xs text-indigo-500 mb-1">Needed DC-days / Wk</p>
            <p className="text-2xl font-bold text-indigo-600">
              {DAYS.reduce((sum, d) => sum + historicalFlow.suggestedByDay[d], 0)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}