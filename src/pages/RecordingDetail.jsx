import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Calendar, User, MapPin, Loader2, ExternalLink, Sparkles, MessageSquare, TrendingUp, FileText, ChevronLeft, ChevronRight, CheckCircle2, XCircle, Clock } from 'lucide-react';
import AudioPlayer from '../components/AudioPlayer';
import moment from 'moment';
import { cn } from '@/lib/utils';

export default function RecordingDetail() {
  const urlParams = new URLSearchParams(window.location.search);
  const appointmentId = urlParams.get('id');
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('value-adds');
  const [showResponseModal, setShowResponseModal] = useState(false);
  const [analysisResponse, setAnalysisResponse] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const { data: appointment, isLoading: appointmentLoading } = useQuery({
    queryKey: ['appointment', appointmentId],
    queryFn: () => base44.entities.Appointment.filter({ id: appointmentId }),
    enabled: !!appointmentId,
    select: (data) => data[0]
  });

  const { data: lead } = useQuery({
    queryKey: ['lead', appointment?.customer],
    queryFn: () => base44.entities.Lead.filter({ id: appointment.customer }),
    enabled: !!appointment?.customer,
    select: (data) => data[0]
  });

  const { data: dc } = useQuery({
    queryKey: ['dc', appointment?.assigned_dc],
    queryFn: () => base44.entities.TeamMember.filter({ id: appointment.assigned_dc }),
    enabled: !!appointment?.assigned_dc,
    select: (data) => data[0]
  });

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ['smsSettings'],
    queryFn: async () => {
      const allSettings = await base44.entities.SMSSettings.list();
      return allSettings[0] || null;
    }
  });

  const isAdmin = currentUser?.role === 'admin';

  // Reset page when tab changes
  React.useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, itemsPerPage]);

  // Subscribe to real-time appointment updates
  React.useEffect(() => {
    if (!appointmentId) return;
    
    const unsubscribe = base44.entities.Appointment.subscribe((event) => {
      if (event.id === appointmentId && event.type === 'update') {
        queryClient.invalidateQueries({ queryKey: ['appointment', appointmentId] });
      }
    });
    
    return unsubscribe;
  }, [appointmentId, queryClient]);

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const { data } = await base44.functions.invoke('analyzeRecording', {
        appointmentId
      });
      return data;
    },
    onSuccess: (data) => {
      setAnalysisResponse(data);
      setShowResponseModal(true);
      queryClient.invalidateQueries({ queryKey: ['appointment', appointmentId] });
    }
  });

  const analyzeValueAddsMutation = useMutation({
    mutationFn: async () => {
      const { data } = await base44.functions.invoke('analyzeValueAdds', {
        appointmentId
      });
      return data.results || [];
    },
    onSuccess: (results) => {
      queryClient.setQueryData(['valueAddAnalysis', appointmentId], results);
    }
  });

  const analysis = appointment?.recording_analysis;
  const hasAnalysis = analysis && analysis.transcript;

  // Use cached value adds if available, otherwise show empty state
  const valueAddAnalysis = appointment?.recording_analysis?.value_adds || null;
  const valueAddsLoading = analyzeValueAddsMutation.isPending;

  if (appointmentLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  if (!appointment || !appointment.recording_url) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 p-6">
        <div className="max-w-4xl mx-auto">
          <Card className="bg-white border border-slate-200">
            <CardContent className="p-12 text-center">
              <p className="text-slate-600">Recording not found</p>
              <Link to={createPageUrl('Recordings')}>
                <Button className="mt-4" variant="outline">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Recordings
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 p-6">
      <div className="max-w-4xl mx-auto">
        <Link to={createPageUrl('Recordings')}>
          <Button variant="outline" className="mb-6">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Recordings
          </Button>
        </Link>

        <Card className="bg-white border border-slate-200 mb-6">
          <CardHeader>
            <CardTitle className="text-2xl">
              {lead ? `${lead.first_name} ${lead.last_name}` : 'Loading...'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div className="flex items-center gap-3 text-slate-700">
                <Calendar className="w-5 h-5 text-slate-400" />
                <div>
                  <p className="text-sm text-slate-500">Appointment Date</p>
                  <p className="font-medium">
                    {moment(appointment.appointment_date).format('MMMM D, YYYY')}
                  </p>
                </div>
              </div>

              {dc && (
                <div className="flex items-center gap-3 text-slate-700">
                  <User className="w-5 h-5 text-slate-400" />
                  <div>
                    <p className="text-sm text-slate-500">Design Consultant</p>
                    <p className="font-medium">{dc.first_name} {dc.last_name}</p>
                  </div>
                </div>
              )}

              {appointment.location_address && (
                <div className="flex items-center gap-3 text-slate-700">
                  <MapPin className="w-5 h-5 text-slate-400" />
                  <div>
                    <p className="text-sm text-slate-500">Location</p>
                    <p className="font-medium">{appointment.location_address}</p>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 text-slate-700">
                <div className="w-5 h-5 flex items-center justify-center">
                  <div className={`w-3 h-3 rounded-full ${
                    appointment.status === 'Sold' ? 'bg-green-500' :
                    appointment.status === 'Completed' ? 'bg-blue-500' :
                    'bg-slate-400'
                  }`} />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Status</p>
                  <p className="font-medium">{appointment.status}</p>
                </div>
              </div>
            </div>

            <Link to={createPageUrl(`AppointmentDetail?id=${appointment.id}`)}>
              <Button variant="outline" size="sm">
                <ExternalLink className="w-4 h-4 mr-2" />
                View Full Appointment
              </Button>
            </Link>
          </CardContent>
        </Card>

        <AudioPlayer 
          audioUrl={appointment.recording_url}
          title={`Recording - ${moment(appointment.appointment_date).format('MMM D, YYYY')}`}
          sentimentData={appointment.recording_analysis?.sentiment}
          utterances={appointment.recording_analysis?.utterances}
          speakerNames={{
            speaker_A: lead ? `${lead.first_name} (Customer)` : 'Customer',
            speaker_B: dc ? `${dc.first_name} (Design Consultant)` : 'Design Consultant'
          }}
          recordingStatus={appointment.recording_status}
          analysisData={appointment.recording_analysis}
        />

        {/* Analysis Section */}
        <Card className="bg-white border border-slate-200 mt-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-600" />
                Call Analysis
              </CardTitle>
              <Button
                onClick={() => analyzeMutation.mutate()}
                disabled={analyzeMutation.isPending}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                {analyzeMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    {hasAnalysis ? 'Re-analyze Call' : 'Analyze Call'}
                  </>
                )}
              </Button>
              {hasAnalysis && valueAddAnalysis === null && (
                <Button
                  onClick={() => analyzeValueAddsMutation.mutate()}
                  disabled={analyzeValueAddsMutation.isPending}
                  variant="outline"
                  className="ml-2"
                >
                  {analyzeValueAddsMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Analyze Value Adds
                    </>
                  )}
                </Button>
              )}
              {hasAnalysis && valueAddAnalysis !== null && (
                <Button
                  onClick={() => analyzeValueAddsMutation.mutate()}
                  disabled={analyzeValueAddsMutation.isPending}
                  variant="ghost"
                  size="sm"
                  className="ml-2"
                >
                  {analyzeValueAddsMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    </>
                  ) : (
                    <Sparkles className="w-4 h-4 mr-1" />
                  )}
                  Refresh
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {analyzeMutation.isPending && (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-4" />
                <p className="text-slate-600">Analyzing recording with AI...</p>
                <p className="text-sm text-slate-400 mt-2">This may take a few minutes</p>
              </div>
            )}

            {!hasAnalysis && !analyzeMutation.isPending && (
              <div className="text-center py-12">
                <Sparkles className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <p className="text-slate-600 mb-2">No analysis available yet</p>
                <p className="text-sm text-slate-400">Click "Analyze Call" to generate transcription, sentiment, and summary</p>
              </div>
            )}

            {hasAnalysis && (
              <div>
                {/* Tabs */}
                <div className="flex gap-2 mb-6 border-b border-slate-200 overflow-x-auto">
                  <button
                    onClick={() => setActiveTab('value-adds')}
                    className={cn(
                      "px-4 py-2 text-sm font-medium transition-colors border-b-2 whitespace-nowrap",
                      activeTab === 'value-adds'
                        ? "border-indigo-600 text-indigo-600"
                        : "border-transparent text-slate-600 hover:text-slate-800"
                    )}
                  >
                    <Sparkles className="w-4 h-4 inline mr-2" />
                    Value Adds
                  </button>
                  <button
                    onClick={() => setActiveTab('transcript')}
                    className={cn(
                      "px-4 py-2 text-sm font-medium transition-colors border-b-2 whitespace-nowrap",
                      activeTab === 'transcript'
                        ? "border-indigo-600 text-indigo-600"
                        : "border-transparent text-slate-600 hover:text-slate-800"
                    )}
                  >
                    <MessageSquare className="w-4 h-4 inline mr-2" />
                    Transcript
                  </button>
                  <button
                    onClick={() => setActiveTab('sentiment')}
                    className={cn(
                      "px-4 py-2 text-sm font-medium transition-colors border-b-2 whitespace-nowrap",
                      activeTab === 'sentiment'
                        ? "border-indigo-600 text-indigo-600"
                        : "border-transparent text-slate-600 hover:text-slate-800"
                    )}
                  >
                    <TrendingUp className="w-4 h-4 inline mr-2" />
                    Sentiment
                  </button>
                  <button
                    onClick={() => setActiveTab('summary')}
                    className={cn(
                      "px-4 py-2 text-sm font-medium transition-colors border-b-2 whitespace-nowrap",
                      activeTab === 'summary'
                        ? "border-indigo-600 text-indigo-600"
                        : "border-transparent text-slate-600 hover:text-slate-800"
                    )}
                  >
                    <FileText className="w-4 h-4 inline mr-2" />
                    Summary
                  </button>
                </div>

                {/* Value Adds Tab */}
                {activeTab === 'value-adds' && (
                  <div className="space-y-3">
                    {valueAddsLoading ? (
                      <div className="text-center py-8">
                        <Loader2 className="w-6 h-6 text-indigo-600 animate-spin mx-auto mb-2" />
                        <p className="text-slate-500">Analyzing value adds with AI...</p>
                      </div>
                    ) : !valueAddAnalysis ? (
                      <div className="text-center py-8">
                        <p className="text-slate-500">No value add analysis yet. Click "Analyze Value Adds" to get started.</p>
                      </div>
                    ) : !settings?.value_add_keywords || settings.value_add_keywords.length === 0 ? (
                      <div className="text-center py-8">
                        <p className="text-slate-500">No value add keywords configured. Add them in Settings.</p>
                      </div>
                    ) : (
                      <>
                        {/* Summary Stats */}
                        <div className="grid grid-cols-2 gap-4 mb-6">
                          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="w-5 h-5 text-green-600" />
                              <div>
                                <p className="text-2xl font-bold text-green-700">
                                  {valueAddAnalysis.filter(v => v.mentioned).length}
                                </p>
                                <p className="text-xs text-green-600">Mentioned</p>
                              </div>
                            </div>
                          </div>
                          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                            <div className="flex items-center gap-2">
                              <XCircle className="w-5 h-5 text-red-600" />
                              <div>
                                <p className="text-2xl font-bold text-red-700">
                                  {valueAddAnalysis.filter(v => !v.mentioned).length}
                                </p>
                                <p className="text-xs text-red-600">Not Mentioned</p>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Value Add Items */}
                        {valueAddAnalysis.map((item, idx) => (
                          <div
                            key={idx}
                            className={cn(
                              "p-4 rounded-lg border-2",
                              item.mentioned
                                ? "bg-green-50 border-green-200"
                                : "bg-red-50 border-red-200"
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-3 flex-1">
                                {item.mentioned ? (
                                  <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                                ) : (
                                  <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                                )}
                                <div className="flex-1">
                                  <p className={cn(
                                    "font-medium",
                                    item.mentioned ? "text-green-900" : "text-red-900"
                                  )}>
                                    {item.keyword}
                                  </p>

                                  {item.mentioned && item.mentions && item.mentions.length > 0 && (
                                    <div className="mt-3 space-y-2">
                                      {item.mentions.map((mention, mIdx) => {
                                        const renderTextWithHighlight = () => {
                                          if (!mention.matchingWords) return mention.text;

                                          const text = mention.text;
                                          const matchWords = mention.matchingWords.toLowerCase();
                                          const lowerText = text.toLowerCase();

                                          const startIdx = lowerText.indexOf(matchWords);
                                          if (startIdx === -1) return text;

                                          const endIdx = startIdx + matchWords.length;
                                          return (
                                            <>
                                              {text.substring(0, startIdx)}
                                              <span className="bg-yellow-200 font-semibold px-1 rounded">
                                                {text.substring(startIdx, endIdx)}
                                              </span>
                                              {text.substring(endIdx)}
                                            </>
                                          );
                                        };

                                        return (
                                          <div
                                            key={mIdx}
                                            className="bg-white border border-green-200 rounded-lg p-3"
                                          >
                                            <div className="flex items-center gap-2 mb-2">
                                              <Clock className="w-3 h-3 text-green-600" />
                                              <span className="text-xs font-semibold text-green-600">
                                                {Math.floor(mention.timestamp / 60)}:{String(Math.floor(mention.timestamp % 60)).padStart(2, '0')}
                                              </span>
                                            </div>
                                            <p className="text-sm text-slate-700 leading-relaxed">
                                              {renderTextWithHighlight()}
                                            </p>
                                            {mention.matchingWords && (
                                              <div className="mt-2 pt-2 border-t border-green-200">
                                                <p className="text-xs text-green-600">
                                                  <span className="font-semibold">Matching words:</span> {mention.matchingWords}
                                                </p>
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}

                                  {!item.mentioned && (
                                    <p className="text-xs text-red-600 mt-1">
                                      Not mentioned during conversation
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}

                {/* Transcript Tab */}
                {activeTab === 'transcript' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-sm text-slate-600">
                        Duration: {Math.floor(analysis.duration / 60)}m {Math.floor(analysis.duration % 60)}s
                        {analysis.utterances && ` • ${analysis.utterances.length} utterances`}
                      </p>
                      <div className="flex items-center gap-3">
                        {analysis.analyzedAt && (
                          <p className="text-xs text-slate-400">
                            Analyzed {moment(analysis.analyzedAt).fromNow()}
                          </p>
                        )}
                        <Select value={itemsPerPage.toString()} onValueChange={(v) => setItemsPerPage(Number(v))}>
                          <SelectTrigger className="w-24 h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="10">10</SelectItem>
                            <SelectItem value="50">50</SelectItem>
                            <SelectItem value="100">100</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {analysis.utterances?.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((utterance, idx) => {
                      // Determine if this is customer or consultant based on speaker identifier
                      const isCustomer = utterance.speaker === 'A' || 
                                        (lead && utterance.speaker === lead.first_name) ||
                                        utterance.speaker === '0';
                      
                      const speakerLabel = isCustomer
                        ? (lead ? `${lead.first_name} (Customer)` : 'Customer')
                        : (dc ? `${dc.first_name} (Design Consultant)` : 'Design Consultant');

                      const formatTime = (ms) => {
                        const totalSeconds = Math.floor(ms / 1000);
                        const minutes = Math.floor(totalSeconds / 60);
                        const seconds = totalSeconds % 60;
                        return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
                      };
                      
                      return (
                        <div key={idx} className="flex gap-3 p-4 rounded-lg bg-slate-50">
                          <Badge variant="outline" className="h-6 flex-shrink-0 text-xs">
                            {speakerLabel}
                          </Badge>
                          <div className="flex-1">
                            <p className="text-xs text-slate-500 mb-1">[{formatTime(utterance.start)} - {formatTime(utterance.end)}]</p>
                            <p className="text-slate-700">{utterance.text}</p>
                          </div>
                        </div>
                      );
                    })}
                    
                    {/* Pagination */}
                    {analysis.utterances && analysis.utterances.length > itemsPerPage && (
                      <div className="flex items-center justify-between pt-4 border-t">
                        <p className="text-sm text-slate-600">
                          Showing {((currentPage - 1) * itemsPerPage) + 1} - {Math.min(currentPage * itemsPerPage, analysis.utterances.length)} of {analysis.utterances.length}
                        </p>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </Button>
                          <span className="text-sm text-slate-600">
                            Page {currentPage} of {Math.ceil(analysis.utterances.length / itemsPerPage)}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentPage(p => p + 1)}
                            disabled={currentPage >= Math.ceil(analysis.utterances.length / itemsPerPage)}
                          >
                            <ChevronRight className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Sentiment Tab */}
                {activeTab === 'sentiment' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-end mb-4">
                      <Select value={itemsPerPage.toString()} onValueChange={(v) => setItemsPerPage(Number(v))}>
                        <SelectTrigger className="w-24 h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="10">10</SelectItem>
                          <SelectItem value="50">50</SelectItem>
                          <SelectItem value="100">100</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {analysis.sentiment?.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((sentiment, idx) => {
                      // Determine if this is customer or consultant based on speaker identifier
                      const isCustomer = sentiment.speaker === 'A' || 
                                        (lead && sentiment.speaker === lead.first_name) ||
                                        sentiment.speaker === '0';
                      
                      const speakerLabel = isCustomer
                        ? (lead ? `${lead.first_name} (Customer)` : 'Customer')
                        : (dc ? `${dc.first_name} (Design Consultant)` : 'Design Consultant');

                      const formatTime = (ms) => {
                        const totalSeconds = Math.floor(ms / 1000);
                        const minutes = Math.floor(totalSeconds / 60);
                        const seconds = totalSeconds % 60;
                        return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
                      };
                      
                      return (
                        <div key={idx} className="p-4 rounded-lg border border-slate-200">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                {speakerLabel}
                              </Badge>
                              <Badge className={cn(
                                sentiment.sentiment === 'POSITIVE' && "bg-green-100 text-green-700",
                                sentiment.sentiment === 'NEGATIVE' && "bg-red-100 text-red-700",
                                sentiment.sentiment === 'NEUTRAL' && "bg-slate-100 text-slate-700"
                              )}>
                                {sentiment.sentiment}
                              </Badge>
                            </div>
                            <span className="text-xs text-slate-500">
                              {formatTime(sentiment.start)} - Confidence: {(sentiment.confidence * 100).toFixed(0)}%
                            </span>
                          </div>
                          <p className="text-slate-700">{sentiment.text}</p>
                          </div>
                          );
                          })}

                          {/* Pagination */}
                          {analysis.sentiment && analysis.sentiment.length > itemsPerPage && (
                          <div className="flex items-center justify-between pt-4 border-t">
                          <p className="text-sm text-slate-600">
                            Showing {((currentPage - 1) * itemsPerPage) + 1} - {Math.min(currentPage * itemsPerPage, analysis.sentiment.length)} of {analysis.sentiment.length}
                          </p>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                              disabled={currentPage === 1}
                            >
                              <ChevronLeft className="w-4 h-4" />
                            </Button>
                            <span className="text-sm text-slate-600">
                              Page {currentPage} of {Math.ceil(analysis.sentiment.length / itemsPerPage)}
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setCurrentPage(p => p + 1)}
                              disabled={currentPage >= Math.ceil(analysis.sentiment.length / itemsPerPage)}
                            >
                              <ChevronRight className="w-4 h-4" />
                            </Button>
                          </div>
                          </div>
                          )}
                          </div>
                          )}

                {/* Summary Tab */}
                {activeTab === 'summary' && (
                  <div className="space-y-6">
                    {analysis.summary?.map((chapter, idx) => (
                      <div key={idx} className="p-4 rounded-lg bg-indigo-50 border border-indigo-200">
                        <h3 className="text-lg font-semibold text-slate-800 mb-2">
                          {chapter.headline}
                        </h3>
                        <p className="text-sm text-indigo-600 mb-3">{chapter.gist}</p>
                        <p className="text-slate-700">{chapter.summary}</p>
                      </div>
                    ))}
                    
                    {analysis.topics && Object.keys(analysis.topics).length > 0 && (
                      <div className="mt-6 p-4 rounded-lg bg-purple-50 border border-purple-200">
                        <h3 className="text-sm font-semibold text-slate-800 mb-3">Topics Discussed</h3>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(analysis.topics).slice(0, 10).map(([topic, relevance]) => (
                            <Badge key={topic} variant="outline" className="bg-white">
                              {topic.split('>').pop()?.trim() || topic}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Admin Debug Section */}
        {isAdmin && (
          <>
            {appointment.recording_transcript_id && (
              <Card className="bg-white border border-slate-200 mt-6">
                <CardHeader>
                  <CardTitle className="text-sm text-slate-600">AssemblyAI Transcript ID (Admin Only)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <code className="bg-slate-50 px-3 py-2 rounded text-sm text-slate-700 border border-slate-200 font-mono">
                      {appointment.recording_transcript_id}
                    </code>
                  </div>
                </CardContent>
              </Card>
            )}
            
            {hasAnalysis && (
              <Card className="bg-white border border-slate-200 mt-6">
                <CardHeader>
                  <CardTitle className="text-sm text-slate-600">AssemblyAI Response (Admin Only)</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="bg-slate-50 p-4 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto border border-slate-200">
                    {JSON.stringify(analysis, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            )}

              {valueAddAnalysis && (
                <Card className="bg-white border border-slate-200 mt-6">
                  <CardHeader>
                    <CardTitle className="text-sm text-slate-600">Value Adds Analysis JSON (Admin Only)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="bg-slate-50 p-4 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto border border-slate-200">
                      {JSON.stringify(valueAddAnalysis, null, 2)}
                    </pre>
                  </CardContent>
                </Card>
              )}
          </>
        )}

        {/* Analysis Response Modal */}
        <Dialog open={showResponseModal} onOpenChange={setShowResponseModal}>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Analysis Response</DialogTitle>
            </DialogHeader>
            <pre className="bg-slate-50 p-4 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(analysisResponse, null, 2)}
            </pre>
          </DialogContent>
        </Dialog>
        </div>
        </div>
        );
        }