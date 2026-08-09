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
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!appointment || !appointment.recording_url) {
    return (
      <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
        <div className="max-w-4xl mx-auto">
          <Card className="bg-card border border-border">
            <CardContent className="p-12 text-center">
              <p className="text-muted-foreground">Recording not found</p>
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
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">
        <Link to={createPageUrl('Recordings')}>
          <Button variant="outline" className="mb-6">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Recordings
          </Button>
        </Link>

        <Card className="bg-card border border-border mb-6">
          <CardHeader>
            <CardTitle className="text-2xl">
              {lead ? `${lead.first_name} ${lead.last_name}` : 'Loading...'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div className="flex items-center gap-3 text-foreground">
                <Calendar className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Appointment Date</p>
                  <p className="font-medium">
                    {moment(appointment.appointment_date).format('MMMM D, YYYY')}
                  </p>
                </div>
              </div>

              {dc && (
                <div className="flex items-center gap-3 text-foreground">
                  <User className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Design Consultant</p>
                    <p className="font-medium">{dc.first_name} {dc.last_name}</p>
                  </div>
                </div>
              )}

              {appointment.location_address && (
                <div className="flex items-center gap-3 text-foreground">
                  <MapPin className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Location</p>
                    <p className="font-medium">{appointment.location_address}</p>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 text-foreground">
                <div className="w-5 h-5 flex items-center justify-center">
                  <div className={`w-3 h-3 rounded-full ${
                    appointment.status === 'Sold' ? 'bg-green-500' :
                    appointment.status === 'Completed' ? 'bg-blue-500' :
                    'bg-muted-foreground'
                  }`} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
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
        <Card className="bg-card border border-border mt-6">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                Call Analysis
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => analyzeMutation.mutate()}
                  disabled={analyzeMutation.isPending}
                  className="bg-primary text-primary-foreground hover:opacity-90"
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
            </div>
          </CardHeader>
          <CardContent>
            {analyzeMutation.isPending && (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
                <p className="text-muted-foreground">Analyzing recording with AI...</p>
                <p className="text-sm text-muted-foreground mt-2">This may take a few minutes</p>
              </div>
            )}

            {!hasAnalysis && !analyzeMutation.isPending && (
              <div className="text-center py-12">
                <Sparkles className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground mb-2">No analysis available yet</p>
                <p className="text-sm text-muted-foreground">Click "Analyze Call" to generate transcription, sentiment, and summary</p>
              </div>
            )}

            {hasAnalysis && (
              <div>
                {/* Tabs */}
                <div className="flex gap-2 mb-6 border-b border-border overflow-x-auto">
                  <button
                    onClick={() => setActiveTab('value-adds')}
                    className={cn(
                      "px-4 py-2 text-sm font-medium transition-colors border-b-2 whitespace-nowrap",
                      activeTab === 'value-adds'
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
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
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
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
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
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
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
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
                        <Loader2 className="w-6 h-6 text-primary animate-spin mx-auto mb-2" />
                        <p className="text-muted-foreground">Analyzing value adds with AI...</p>
                      </div>
                    ) : !valueAddAnalysis ? (
                      <div className="text-center py-8">
                        <p className="text-muted-foreground">No value add analysis yet. Click "Analyze Value Adds" to get started.</p>
                      </div>
                    ) : !settings?.value_add_keywords || settings.value_add_keywords.length === 0 ? (
                      <div className="text-center py-8">
                        <p className="text-muted-foreground">No value add keywords configured. Add them in Settings.</p>
                      </div>
                    ) : (
                      <>
                        {/* Summary Stats */}
                        <div className="grid grid-cols-2 gap-4 mb-6">
                          <div className="bg-green-50 dark:bg-green-500/15 border border-green-200 dark:border-green-500/25 rounded-lg p-4">
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                              <div>
                                <p className="text-2xl font-bold text-green-700 dark:text-green-300">
                                  {valueAddAnalysis.filter(v => v.mentioned).length}
                                </p>
                                <p className="text-xs text-green-600 dark:text-green-400">Mentioned</p>
                              </div>
                            </div>
                          </div>
                          <div className="bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/25 rounded-lg p-4">
                            <div className="flex items-center gap-2">
                              <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                              <div>
                                <p className="text-2xl font-bold text-red-700 dark:text-red-300">
                                  {valueAddAnalysis.filter(v => !v.mentioned).length}
                                </p>
                                <p className="text-xs text-red-600 dark:text-red-400">Not Mentioned</p>
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
                                ? "bg-green-50 dark:bg-green-500/15 border-green-200 dark:border-green-500/25"
                                : "bg-red-50 dark:bg-red-500/15 border-red-200 dark:border-red-500/25"
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-3 flex-1">
                                {item.mentioned ? (
                                  <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                                ) : (
                                  <XCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                                )}
                                <div className="flex-1">
                                  <p className={cn(
                                    "font-medium",
                                    item.mentioned ? "text-green-900 dark:text-green-200" : "text-red-900 dark:text-red-200"
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
                                              <span className="bg-yellow-200 dark:bg-yellow-500/30 font-semibold px-1 rounded">
                                                {text.substring(startIdx, endIdx)}
                                              </span>
                                              {text.substring(endIdx)}
                                            </>
                                          );
                                        };

                                        return (
                                          <div
                                            key={mIdx}
                                            className="bg-card border border-green-200 dark:border-green-500/25 rounded-lg p-3"
                                          >
                                            <div className="flex items-center gap-2 mb-2">
                                              <Clock className="w-3 h-3 text-green-600 dark:text-green-400" />
                                              <span className="text-xs font-semibold text-green-600 dark:text-green-400">
                                                {Math.floor(mention.timestamp / 60)}:{String(Math.floor(mention.timestamp % 60)).padStart(2, '0')}
                                              </span>
                                            </div>
                                            <p className="text-sm text-foreground leading-relaxed">
                                              {renderTextWithHighlight()}
                                            </p>
                                            {mention.matchingWords && (
                                              <div className="mt-2 pt-2 border-t border-green-200 dark:border-green-500/25">
                                                <p className="text-xs text-green-600 dark:text-green-400">
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
                                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">
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
                      <p className="text-sm text-muted-foreground">
                        Duration: {Math.floor(analysis.duration / 60)}m {Math.floor(analysis.duration % 60)}s
                        {analysis.utterances && ` • ${analysis.utterances.length} utterances`}
                      </p>
                      <div className="flex items-center gap-3">
                        {analysis.analyzedAt && (
                          <p className="text-xs text-muted-foreground">
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
                        <div key={idx} className="flex gap-3 p-4 rounded-lg bg-secondary">
                          <Badge variant="outline" className="h-6 flex-shrink-0 text-xs">
                            {speakerLabel}
                          </Badge>
                          <div className="flex-1">
                            <p className="text-xs text-muted-foreground mb-1">[{formatTime(utterance.start)} - {formatTime(utterance.end)}]</p>
                            <p className="text-foreground">{utterance.text}</p>
                          </div>
                        </div>
                      );
                    })}
                    
                    {/* Pagination */}
                    {analysis.utterances && analysis.utterances.length > itemsPerPage && (
                      <div className="flex items-center justify-between pt-4 border-t border-border">
                        <p className="text-sm text-muted-foreground">
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
                          <span className="text-sm text-muted-foreground">
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
                        <div key={idx} className="p-4 rounded-lg border border-border">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                {speakerLabel}
                              </Badge>
                              <Badge className={cn(
                                sentiment.sentiment === 'POSITIVE' && "bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-300",
                                sentiment.sentiment === 'NEGATIVE' && "bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300",
                                sentiment.sentiment === 'NEUTRAL' && "bg-secondary text-foreground"
                              )}>
                                {sentiment.sentiment}
                              </Badge>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {formatTime(sentiment.start)} - Confidence: {(sentiment.confidence * 100).toFixed(0)}%
                            </span>
                          </div>
                          <p className="text-foreground">{sentiment.text}</p>
                          </div>
                          );
                          })}

                          {/* Pagination */}
                          {analysis.sentiment && analysis.sentiment.length > itemsPerPage && (
                          <div className="flex items-center justify-between pt-4 border-t border-border">
                          <p className="text-sm text-muted-foreground">
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
                            <span className="text-sm text-muted-foreground">
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
                      <div key={idx} className="p-4 rounded-lg bg-primary/10 border border-primary/20">
                        <h3 className="text-lg font-semibold text-foreground mb-2">
                          {chapter.headline}
                        </h3>
                        <p className="text-sm text-primary mb-3">{chapter.gist}</p>
                        <p className="text-foreground">{chapter.summary}</p>
                      </div>
                    ))}
                    
                    {analysis.topics && Object.keys(analysis.topics).length > 0 && (
                      <div className="mt-6 p-4 rounded-lg bg-secondary border border-border">
                        <h3 className="text-sm font-semibold text-foreground mb-3">Topics Discussed</h3>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(analysis.topics).slice(0, 10).map(([topic, relevance]) => (
                            <Badge key={topic} variant="outline" className="bg-card">
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
              <Card className="bg-card border border-border mt-6">
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground">AssemblyAI Transcript ID (Admin Only)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <code className="bg-secondary px-3 py-2 rounded text-sm text-foreground border border-border font-mono">
                      {appointment.recording_transcript_id}
                    </code>
                  </div>
                </CardContent>
              </Card>
            )}
            
            {hasAnalysis && (
              <Card className="bg-card border border-border mt-6">
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground">AssemblyAI Response (Admin Only)</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="bg-secondary p-4 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto border border-border">
                    {JSON.stringify(analysis, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            )}

              {valueAddAnalysis && (
                <Card className="bg-card border border-border mt-6">
                  <CardHeader>
                    <CardTitle className="text-sm text-muted-foreground">Value Adds Analysis JSON (Admin Only)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="bg-secondary p-4 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto border border-border">
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
            <pre className="bg-secondary p-4 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(analysisResponse, null, 2)}
            </pre>
          </DialogContent>
        </Dialog>
        </div>
        </div>
        );
        }