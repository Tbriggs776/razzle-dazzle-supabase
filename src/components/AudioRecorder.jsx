import React, { useState, useRef, useEffect } from 'react';
// AudioRecorder component
import { Button } from "@/components/ui/button";
import { Mic, Square, Pause, Play, Upload, Loader2, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { base44 } from '@/api/base44Client';
import * as Bytescale from "@bytescale/sdk";

export default function AudioRecorder({ appointmentId, onUploadComplete }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordedTime, setRecordedTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const startTimeRef = useRef(0);
  const pausedTimeRef = useRef(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const formatTime = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs > 0 ? hrs.toString().padStart(2, '0') + ':' : ''}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setAudioBlob(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setIsPaused(false);
      setAudioBlob(null);
      setUploadSuccess(false);
      
      startTimeRef.current = Date.now() - pausedTimeRef.current * 1000;
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setRecordedTime(elapsed);
      }, 1000);
    } catch (error) {
      console.error('Error accessing microphone:', error);
      alert('Could not access microphone. Please grant permission and try again.');
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      pausedTimeRef.current = recordedTime;
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      startTimeRef.current = Date.now() - pausedTimeRef.current * 1000;
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setRecordedTime(elapsed);
      }, 1000);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const uploadRecording = async () => {
    if (!audioBlob) return;

    setIsUploading(true);
    try {
      const fileName = `recording-${Date.now()}.webm`;
      const file = new File([audioBlob], fileName, { type: 'audio/webm' });
      
      const uploadManager = new Bytescale.UploadManager({
        apiKey: "public_223k2X95KYxtnQTr5pfZZakKp58x"
      });

      const { fileUrl } = await uploadManager.upload({ 
        data: file,
        path: `/appointment-recordings/${appointmentId}/${fileName}`
      });
      
      // Update appointment with recording URL, duration, and set status to analyzing
      await base44.entities.Appointment.update(appointmentId, {
        recording_url: fileUrl,
        recording_status: 'analyzing',
        recording_duration: recordedTime
      });
      
      if (onUploadComplete) {
        await onUploadComplete(fileUrl);
      }
      
      // Trigger analysis in background (non-blocking)
      base44.functions.invoke('triggerAnalysis', { appointmentId }).catch(err => {
        console.error('Failed to trigger analysis:', err);
      });
      
      setUploadSuccess(true);
      setTimeout(() => {
        setAudioBlob(null);
        setRecordedTime(0);
        pausedTimeRef.current = 0;
        setUploadSuccess(false);
      }, 2000);
    } catch (error) {
      console.error('Upload failed:', error);
      alert('Failed to upload recording. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 max-w-[calc(100vw-3rem)]">
      <div className="bg-white rounded-2xl shadow-2xl border-2 border-indigo-200 p-4 sm:p-6 w-full sm:w-80">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-3 h-3 rounded-full",
              isRecording && !isPaused ? "bg-red-500 animate-pulse" : "bg-slate-300"
            )} />
            <span className="text-sm font-semibold text-slate-800">Audio Recording</span>
          </div>
          {uploadSuccess && (
            <CheckCircle2 className="w-5 h-5 text-green-600" />
          )}
        </div>

        <div className="text-center mb-4">
          <div className="text-3xl font-mono font-bold text-slate-800">
            {formatTime(recordedTime)}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {isRecording && !isPaused ? 'Recording...' : isPaused ? 'Paused' : audioBlob ? 'Ready to upload' : 'Not recording'}
          </p>
        </div>

        <div className="flex gap-2">
          {!isRecording && !audioBlob && (
            <Button
              onClick={startRecording}
              className="flex-1 bg-red-600 hover:bg-red-700"
            >
              <Mic className="w-4 h-4 mr-2" />
              Start
            </Button>
          )}

          {isRecording && !isPaused && (
            <>
              <Button
                onClick={pauseRecording}
                variant="outline"
                className="flex-1"
              >
                <Pause className="w-4 h-4 mr-2" />
                Pause
              </Button>
              <Button
                onClick={stopRecording}
                className="flex-1 bg-slate-800 hover:bg-slate-900"
              >
                <Square className="w-4 h-4 mr-2" />
                Stop
              </Button>
            </>
          )}

          {isRecording && isPaused && (
            <>
              <Button
                onClick={resumeRecording}
                className="flex-1 bg-green-600 hover:bg-green-700"
              >
                <Play className="w-4 h-4 mr-2" />
                Resume
              </Button>
              <Button
                onClick={stopRecording}
                className="flex-1 bg-slate-800 hover:bg-slate-900"
              >
                <Square className="w-4 h-4 mr-2" />
                Stop
              </Button>
            </>
          )}

          {audioBlob && !isUploading && !uploadSuccess && (
            <>
              <Button
                onClick={() => {
                  setAudioBlob(null);
                  setRecordedTime(0);
                  pausedTimeRef.current = 0;
                }}
                variant="outline"
                className="flex-1"
              >
                Reset
              </Button>
              <Button
                onClick={uploadRecording}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700"
              >
                <Upload className="w-4 h-4 mr-2" />
                Upload
              </Button>
            </>
          )}

          {uploadSuccess && (
            <Button disabled className="flex-1">
              <CheckCircle2 className="w-4 h-4 mr-2 text-green-600" />
              Upload queued for analysis
            </Button>
          )}

          {isUploading && (
            <Button disabled className="flex-1">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Uploading...
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}