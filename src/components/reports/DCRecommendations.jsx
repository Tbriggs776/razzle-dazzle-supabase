import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, RefreshCw } from 'lucide-react';
import { format, addDays, startOfWeek, subDays } from 'date-fns';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const APPTS_PER_DC_PER_DAY = 3;

const getDow = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  return DAY_NAMES[d.getDay()];
};

export default function DCRecommendations({ matrixRows, designConsultants, appointments }) {
  const [recommendation, setRecommendation] = useState('');
  const [loading, setLoading] = useState(false);

  const buildPayload = () => {
    const phoenixOffsetMs = 7 * 60 * 60 * 1000;
    const nowPhoenix = new Date(new Date().getTime() - phoenixOffsetMs);
    const monday = startOfWeek(nowPhoenix, { weekStartsOn: 1 });
    const weekStartStr = format(monday, 'yyyy-MM-dd');
    const weekEndStr = format(addDays(monday, 6), 'yyyy-MM-dd');

    // Current week booked per day
    const bookedThisWeek = {};
    DAYS.forEach(d => bookedThisWeek[d] = 0);
    appointments.forEach(apt => {
      if (!apt.appointment_date) return;
      if (apt.appointment_date < weekStartStr || apt.appointment_date > weekEndStr) return;
      const dow = getDow(apt.appointment_date);
      if (dow && bookedThisWeek.hasOwnProperty(dow)) bookedThisWeek[dow]++;
    });

    // 30-day historical flow per day of week
    const lookbackStart = format(subDays(nowPhoenix, 30), 'yyyy-MM-dd');
    const todayStr = format(nowPhoenix, 'yyyy-MM-dd');
    const historicalByDay = {};
    const weekCountByDay = {};
    DAYS.forEach(d => { historicalByDay[d] = 0; weekCountByDay[d] = 0; });

    const cursor = new Date(subDays(nowPhoenix, 30));
    while (cursor <= nowPhoenix) {
      const dow = DAY_NAMES[cursor.getDay()];
      if (weekCountByDay.hasOwnProperty(dow)) weekCountByDay[dow]++;
      cursor.setDate(cursor.getDate() + 1);
    }

    appointments.forEach(apt => {
      if (!apt.appointment_date) return;
      if (apt.appointment_date < lookbackStart || apt.appointment_date > todayStr) return;
      const dow = getDow(apt.appointment_date);
      if (dow && historicalByDay.hasOwnProperty(dow)) historicalByDay[dow]++;
    });

    const avgApptsByDay = {};
    const suggestedByDay = {};
    DAYS.forEach(d => {
      avgApptsByDay[d] = weekCountByDay[d] > 0 ? parseFloat((historicalByDay[d] / weekCountByDay[d]).toFixed(1)) : 0;
      suggestedByDay[d] = Math.ceil(avgApptsByDay[d] / APPTS_PER_DC_PER_DAY);
    });

    // Available DCs per day
    const availableByDay = {};
    DAYS.forEach(d => availableByDay[d] = 0);
    designConsultants.forEach(dc => {
      const avail = dc.availability || [];
      DAYS.forEach(d => { if (avail.includes(d)) availableByDay[d]++; });
    });

    // Build DC performance summary
    const dcSummary = matrixRows.map(r => ({
      name: r.name,
      totalAppts: r.counts.total,
      sold: r.counts['Sold'] || 0,
      oneLeg: r.counts['One-Leg'] || 0,
      pitchAndMiss: r.counts['Pitch and Miss'] || 0,
      lost: r.counts['Lost'] || 0,
      cancelled: r.counts['Cancelled'] || 0,
      closeRate: r.closeRate + '%',
      totalSalesValue: '$' + Math.round(r.totalRevenue).toLocaleString(),
      aov: '$' + Math.round(r.aov).toLocaleString(),
      avgGP: r.gpCount > 0 ? r.avgGP.toFixed(1) + '%' : 'N/A',
      availability: (designConsultants.find(dc => dc.id === r.dcId)?.availability || []).join(', ') || 'None set'
    }));

    return {
      currentWeek: `${format(monday, 'MMM d')} – ${format(addDays(monday, 6), 'MMM d, yyyy')}`,
      bookedThisWeek,
      historical30DayAvgPerDay: avgApptsByDay,
      availableDCsByDay: availableByDay,
      suggestedDCsByDay: suggestedByDay,
      gapsByDay: DAYS.reduce((acc, d) => {
        acc[d] = suggestedByDay[d] - availableByDay[d];
        return acc;
      }, {}),
      dcPerformance: dcSummary,
      totalDCs: designConsultants.length
    };
  };

  const generateRecommendation = async () => {
    setLoading(true);
    const payload = buildPayload();

    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a flooring company operations analyst. Based on the following appointment and design consultant (DC) data, write a clear plain-English paragraph recommendation. Cover: (1) whether hiring is needed and on which specific days, (2) whether any DCs should be let go or are underperforming based on their close rate, sales value, and GP%, (3) where gaps exist in the weekly schedule that need filling, and (4) any schedule adjustments (e.g., shift a DC from an overstaffed day to an understaffed one). Be specific with names, numbers, and days. Write as a single cohesive paragraph (or a few short paragraphs). Use a professional but direct tone — don't sugarcoat underperformance.

Data (JSON):
${JSON.stringify(payload, null, 2)}`,
        response_json_schema: {
          type: "object",
          properties: {
            recommendation: { type: "string" }
          }
        }
      });
      setRecommendation(result.recommendation || 'No recommendation generated.');
    } catch (e) {
      setRecommendation('Unable to generate recommendation at this time. Please try refreshing.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (matrixRows.length > 0 && designConsultants.length > 0 && appointments.length > 0) {
      generateRecommendation();
    }
  }, [matrixRows, designConsultants, appointments]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-600" />
              AI Staffing Recommendations
            </CardTitle>
            <CardDescription>
              Data-driven analysis of hiring, cuts, and schedule gaps
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={generateRecommendation}
            disabled={loading}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading && !recommendation ? (
          <div className="flex items-center gap-3 py-8 text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin" />
            Analyzing appointment flow, DC performance, and schedule gaps...
          </div>
        ) : (
          <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
            {recommendation}
          </p>
        )}
      </CardContent>
    </Card>
  );
}