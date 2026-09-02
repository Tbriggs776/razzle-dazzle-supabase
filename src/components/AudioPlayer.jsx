import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Loader2, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSignedUrl } from '@/lib/fileUrl';

export default function AudioPlayer({ audioUrl, title = "Conversation Recording", sentimentData = null, utterances = null, speakerNames = null, recordingStatus = null, analysisData = null }) {
  // uploads bucket is private — sign the stored recording path on the fly for playback/download
  const signedAudioUrl = useSignedUrl(audioUrl);
  const audioRef = useRef(null);
  const progressBarRef = useRef(null);
  const graphRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState(null);
  const [hoverData, setHoverData] = useState(null);
  const [currentSpeaker, setCurrentSpeaker] = useState(null);
  const [currentUtterance, setCurrentUtterance] = useState(null);

  useEffect(() => {
    if (!audioRef.current || !signedAudioUrl) return;

    const audio = audioRef.current;
    const hasAnalysisData = utterances && utterances.length > 0;
    if ((recordingStatus === 'uploading' || recordingStatus === 'analyzing') && !hasAnalysisData) {
      setIsLoading(true);
      return;
    }

    const updateCurrentSegment = (time) => {
      if (sentimentData && sentimentData.length > 0) {
        const currentSent = sentimentData.find(s => {
          const startTime = s.start / 1000;
          const endTime = s.end / 1000;
          return time >= startTime && time <= endTime;
        });
        if (currentSent) {
          const isCustomer = currentSent.speaker === 'A' || currentSent.speaker === '0';
          setCurrentSpeaker(isCustomer ? speakerNames?.speaker_A : speakerNames?.speaker_B);
        }
      }

      if (utterances && utterances.length > 0) {
        const timeMs = time * 1000;
        const utterance = utterances.find(u => timeMs >= u.start && timeMs <= u.end);
        if (utterance) {
          setCurrentUtterance(utterance);
        }
      }
    };

    const handleLoadedMetadata = () => {
      setIsLoading(false);
      // Use audio duration if available, otherwise fallback to analysis duration (convert from ms to seconds)
      const audioDuration = audio.duration && isFinite(audio.duration) ? audio.duration : null;
      const analysisDuration = analysisData?.duration ? (analysisData.duration > 1000 ? analysisData.duration / 1000 : analysisData.duration) : null;
      const finalDuration = audioDuration || analysisDuration || 0;
      setDuration(finalDuration);
      setError(null);
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      updateCurrentSegment(audio.currentTime);
    };
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const handleError = () => {
      setIsLoading(false);
      setError('Failed to load audio');
    };

    audio.src = signedAudioUrl;
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, [signedAudioUrl, recordingStatus, sentimentData, utterances, speakerNames]);

  const togglePlayPause = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
    }
  };

  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds) || !isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const downloadRecording = async () => {
    try {
      if (!signedAudioUrl) return;
      const response = await fetch(signedAudioUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `recording-${Date.now()}.webm`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
    }
  };

  const handleProgressClick = (e) => {
    if (!progressBarRef.current || !audioRef.current || duration === 0) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    audioRef.current.currentTime = percentage * duration;
  };

  // Process sentiment data by speaker with smoothing
  const processSentimentBySpeaker = () => {
    if (!sentimentData || !duration) return { speaker_A: [], speaker_B: [] };

    // Group by speaker
    const speakers = {};
    sentimentData.forEach(item => {
      const speaker = item.speaker || 'A';
      if (!speakers[speaker]) speakers[speaker] = [];
      
      // Convert sentiment to numeric value (-1 to 1 scale)
      // Positive sentiment goes to +1, negative goes to -1, neutral at 0
      const value = item.sentiment === 'POSITIVE' ? item.confidence :
                    item.sentiment === 'NEGATIVE' ? -item.confidence : 0;
      
      speakers[speaker].push({
        time: item.start / 1000, // Convert to seconds
        value: value,
        text: item.text
      });
    });

    // Smooth the data with rolling average
    const smoothData = (data, windowSize = 3) => {
      return data.map((point, idx) => {
        const start = Math.max(0, idx - Math.floor(windowSize / 2));
        const end = Math.min(data.length, idx + Math.ceil(windowSize / 2));
        const window = data.slice(start, end);
        const avg = window.reduce((sum, p) => sum + p.value, 0) / window.length;
        return { ...point, value: avg };
      });
    };

    const speakerKeys = Object.keys(speakers);
    return {
      speaker_A: smoothData(speakers[speakerKeys[0]] || []),
      speaker_B: smoothData(speakers[speakerKeys[1]] || [])
    };
  };

  const sentimentBySpeaker = useMemo(() => processSentimentBySpeaker(), [sentimentData, duration]);

  // Generate SVG path for smooth curves
  const generateSmoothPath = (points, height) => {
    if (points.length === 0) return '';

    const yScale = (value) => {
      // Map -1 to 1 range to bottom to top (-1 = negative at bottom, 0 = center neutral, 1 = positive at top)
      return height * (1 - (value + 1) / 2);
    };

    const xScale = (time) => {
      return (time / duration) * 100;
    };

    let path = `M ${xScale(points[0].time)},${yScale(points[0].value)}`;

    for (let i = 0; i < points.length - 1; i++) {
      const curr = points[i];
      const next = points[i + 1];
      
      const x1 = xScale(curr.time);
      const y1 = yScale(curr.value);
      const x2 = xScale(next.time);
      const y2 = yScale(next.value);
      
      // Cubic bezier for smooth curves
      const cx = x1 + (x2 - x1) / 3;
      const cy = y1;
      const dx = x2 - (x2 - x1) / 3;
      const dy = y2;
      
      path += ` C ${cx},${cy} ${dx},${dy} ${x2},${y2}`;
    }

    // Close the path to neutral baseline (0 = center)
    const lastPoint = points[points.length - 1];
    const neutralY = height / 2;
    path += ` L ${xScale(lastPoint.time)},${neutralY}`;
    path += ` L ${xScale(points[0].time)},${neutralY} Z`;

    return path;
  };

  const handleGraphClick = (e) => {
    if (!graphRef.current || !audioRef.current || duration === 0) return;
    const rect = graphRef.current.getBoundingClientRect();
    const percentage = (e.clientX - rect.left) / rect.width;
    audioRef.current.currentTime = percentage * duration;
  };

  const handleGraphHover = (e) => {
    if (!graphRef.current || !duration) return;
    
    const rect = graphRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const time = percentage * duration;

    // Find closest sentiment points
    const findClosest = (points) => {
      if (points.length === 0) return null;
      return points.reduce((prev, curr) => 
        Math.abs(curr.time - time) < Math.abs(prev.time - time) ? curr : prev
      );
    };

    const speakerAPoint = findClosest(sentimentBySpeaker.speaker_A);
    const speakerBPoint = findClosest(sentimentBySpeaker.speaker_B);

    setHoverData({
      time,
      x,
      speakerA: speakerAPoint,
      speakerB: speakerBPoint
    });
  };

  return (
    <div className="bg-white rounded-2xl border border-border p-6 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {recordingStatus && (
            <div className={cn(
              "px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1",
              recordingStatus === 'uploading' && "bg-warn/12 text-warn",
              recordingStatus === 'analyzing' && "bg-purple-100 text-purple-700",
              recordingStatus === 'completed' && "bg-good/12 text-good"
            )}>
              {recordingStatus === 'uploading' && (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Uploading
                </>
              )}
              {recordingStatus === 'analyzing' && (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Analyzing
                </>
              )}
              {recordingStatus === 'completed' && 'Completed'}
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={downloadRecording}
          disabled={isLoading || error}
          className="h-8 text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
        >
          <Download className="w-4 h-4" />
        </Button>
      </div>

      {/* Tone Analysis */}
      {sentimentData && sentimentData.length > 0 && duration > 0 && (
        <div className="mb-6 bg-muted rounded-xl border border-border p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">Tone Analysis</h3>
          </div>
          
          <div 
            ref={graphRef}
            className="relative h-48 bg-white rounded-lg overflow-hidden cursor-pointer border border-border"
            onClick={handleGraphClick}
            onMouseMove={handleGraphHover}
            onMouseLeave={() => setHoverData(null)}
          >
            {/* Y-axis labels */}
            <div className="absolute left-3 top-2 text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Positive</div>
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Neutral</div>
            <div className="absolute left-3 bottom-2 text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Negative</div>

            {/* Grid lines */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              <line x1="0" y1="50%" x2="100%" y2="50%" stroke="#94a3b8" strokeWidth="1" strokeDasharray="4,4" opacity="0.6" />
            </svg>
            
            {/* Sentiment curves */}
            <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 100">
              <defs>
                <linearGradient id="clientGradient" x1="0%" y1="100%" x2="0%" y2="0%">
                  <stop offset="0%" stopColor="#F5C84C" stopOpacity="0.05" />
                  <stop offset="10%" stopColor="#F5C84C" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#F5C84C" stopOpacity="0.8" />
                </linearGradient>
                <linearGradient id="teamGradient" x1="0%" y1="100%" x2="0%" y2="0%">
                  <stop offset="0%" stopColor="#F26B6B" stopOpacity="0.05" />
                  <stop offset="10%" stopColor="#F26B6B" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#F26B6B" stopOpacity="0.8" />
                </linearGradient>
              </defs>
              
              {/* Team Member curve (render first, so it appears behind) */}
              {sentimentBySpeaker.speaker_B.length > 0 && (
                <path
                  d={generateSmoothPath(sentimentBySpeaker.speaker_B, 100)}
                  fill="url(#teamGradient)"
                />
              )}
              
              {/* Client curve (render second, so it overlaps) */}
              {sentimentBySpeaker.speaker_A.length > 0 && (
                <path
                  d={generateSmoothPath(sentimentBySpeaker.speaker_A, 100)}
                  fill="url(#clientGradient)"
                />
              )}
            </svg>
            
            {/* Playhead line */}
            {duration > 0 && (
              <div 
                className="absolute top-0 bottom-0 w-0.5 bg-slate-700 pointer-events-none z-10"
                style={{ left: `${(currentTime / duration) * 100}%` }}
              >
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 bg-slate-700 rounded-full" />
              </div>
            )}
            
            {/* Hover tooltip */}
            {hoverData && (
              <div 
                className="absolute top-0 bottom-0 w-px bg-slate-300 pointer-events-none"
                style={{ left: `${hoverData.x}px` }}
              >
                <div 
                  className="absolute top-2 left-2 bg-slate-900 text-white text-xs rounded-lg p-3 shadow-xl border border-slate-700 whitespace-nowrap z-20"
                  style={{ transform: hoverData.x > 200 ? 'translateX(-100%) translateX(-8px)' : '' }}
                >
                  <div className="font-mono font-semibold mb-2 text-slate-200">
                    {formatTime(hoverData.time)}
                  </div>
                  {hoverData.speakerA && (
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2 h-2 rounded-full bg-[#F5C84C]" />
                      <span className="text-slate-200">{speakerNames?.speaker_A || 'Client'}:</span>
                      <span className={cn(
                        "font-semibold",
                        hoverData.speakerA.value > 0.3 ? "text-good" : 
                        hoverData.speakerA.value < -0.3 ? "text-crit" : "text-muted-foreground"
                      )}>
                        {hoverData.speakerA.value > 0.3 ? 'Positive' : 
                         hoverData.speakerA.value < -0.3 ? 'Negative' : 'Neutral'}
                      </span>
                      <span className="text-muted-foreground">
                        ({hoverData.speakerA.value.toFixed(2)})
                      </span>
                    </div>
                  )}
                  {hoverData.speakerB && (
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#F26B6B]" />
                      <span className="text-slate-200">{speakerNames?.speaker_B || 'Team Member'}:</span>
                      <span className={cn(
                        "font-semibold",
                        hoverData.speakerB.value > 0.3 ? "text-good" : 
                        hoverData.speakerB.value < -0.3 ? "text-crit" : "text-muted-foreground"
                      )}>
                        {hoverData.speakerB.value > 0.3 ? 'Positive' : 
                         hoverData.speakerB.value < -0.3 ? 'Negative' : 'Neutral'}
                      </span>
                      <span className="text-muted-foreground">
                        ({hoverData.speakerB.value.toFixed(2)})
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          
          {/* Legend */}
          <div className="flex items-center justify-center gap-6 mt-4">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-sm bg-gradient-to-b from-[#F5C84C]/70 to-[#F5C84C]/5 border border-[#F5C84C]/30" />
              <span className="text-xs text-foreground font-medium">{speakerNames?.speaker_A || 'Client'}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-sm bg-gradient-to-b from-[#F26B6B]/70 to-[#F26B6B]/5 border border-[#F26B6B]/30" />
              <span className="text-xs text-foreground font-medium">{speakerNames?.speaker_B || 'Team Member'}</span>
            </div>
          </div>
        </div>
      )}

      <audio ref={audioRef} />

      {error ? (
        <div className="mb-4 flex items-center justify-center h-16 bg-crit/10 rounded-lg border border-crit/20">
          <p className="text-crit text-sm">{error}</p>
        </div>
      ) : !audioUrl ? (
        <div className="mb-4 flex items-center justify-center h-16 bg-warn/12 rounded-lg border border-warn/25">
          <p className="text-warn text-sm">No recording URL available</p>
        </div>
      ) : (
        <div className="mb-4 space-y-2">
          <div
            ref={progressBarRef}
            onClick={handleProgressClick}
            className="h-2 bg-muted rounded-full cursor-pointer hover:h-3 transition-all group"
          >
            <div
              className="h-full bg-info rounded-full transition-all"
              style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%' }}
            />
          </div>
          <div className="flex items-center justify-between px-1 text-xs text-muted-foreground font-mono">
            <span>{formatTime(currentTime)}</span>
            <span>{isLoading ? '--:--' : formatTime(duration)}</span>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Button
            onClick={togglePlayPause}
            disabled={isLoading || error}
            size="icon"
            className={cn(
              "w-10 h-10 rounded-full flex-shrink-0",
              isPlaying ? "bg-info hover:bg-info" : "bg-info hover:bg-info"
            )}
          >
            {isPlaying ? (
              <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-white fill-white ml-0.5" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </Button>

          {currentSpeaker && (
            <div className="text-sm font-medium text-foreground">
              <span className="text-info">{currentSpeaker}</span>
            </div>
          )}
        </div>

        {/* Current Transcript Segment */}
        {currentUtterance && (
          <div className="bg-muted rounded-lg p-4 border border-border">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-info uppercase tracking-wide">
                {currentSpeaker || 'Current'}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatTime(currentUtterance.start / 1000)}
              </span>
            </div>
            <p className="text-sm text-foreground leading-relaxed">
              {currentUtterance.words && currentUtterance.words.length > 0 ? (
                currentUtterance.words.map((word, idx) => {
                  const wordStartTime = word.start / 1000;
                  const wordEndTime = word.end / 1000;
                  const isActive = currentTime >= wordStartTime && currentTime <= wordEndTime;
                  return (
                    <span
                      key={idx}
                      className={cn(
                        "transition-all duration-100",
                        isActive && "bg-indigo-200 text-info font-semibold px-1 rounded"
                      )}
                    >
                      {word.text}{' '}
                    </span>
                  );
                })
              ) : (
                currentUtterance.text
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}