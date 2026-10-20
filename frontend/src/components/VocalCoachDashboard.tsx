import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Database,
  Activity,
  Award,
  Sparkles,
  Settings,
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Code2,
  Download,
  Music,
  Radio,
  Sliders,
  Play,
  Square,
  Info,
  BookOpen,
} from 'lucide-react';
import {
  autoCorrelate,
  generateVocalTip,
  STANDARD_TARGET_NOTES,
  TargetNote,
  PitchResult,
  VocalAdvice,
} from '../utils/pitchEngine';
import {
  supabase,
  AnalysisLogRow,
  getSupabaseStatus,
  configureSupabase,
  getLocalLogs,
} from '../lib/supabaseClient';

type InputMode = 'mic' | 'simulator';
type ViewMode = 'dashboard' | 'songs';

const API_BASE = import.meta.env.VITE_BACKEND_API_URL || 'http://localhost:5000/api';

interface VocalCoachDashboardProps {
  user?: any;
}

export default function VocalCoachDashboard({ user }: VocalCoachDashboardProps) {
  // Navigation View State
  const [activeView, setActiveView] = useState<ViewMode>('dashboard');

  // Audio Input Mode
  const [inputMode, setInputMode] = useState<InputMode>('simulator');
  const [hasMicTested, setHasMicTested] = useState<boolean>(false);
  const [micAvailable, setMicAvailable] = useState<boolean | null>(null);
  const [systemNotice, setSystemNotice] = useState<string | null>(null);

  // Session State
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [sessionId, setSessionId] = useState<string>('SES1001');
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  // Target Pitch & Audio Settings
  const [selectedTarget, setSelectedTarget] = useState<TargetNote>(STANDARD_TARGET_NOTES[9]); // A4 (440 Hz)
  const [isTonePlaying, setIsTonePlaying] = useState<boolean>(false);
  const [inputGain, setInputGain] = useState<number>(1.0);
  const [silenceThreshold, setSilenceThreshold] = useState<number>(0.012);

  // Virtual Vocal Simulator State
  const [simulatedPitchHz, setSimulatedPitchHz] = useState<number>(440.0);
  const [isSimDriftActive, setIsSimDriftActive] = useState<boolean>(false);
  const [isSimAudible, setIsSimAudible] = useState<boolean>(false);

  // Song Practice Dataset State
  const [selectedTrack, setSelectedTrack] = useState<any>(null);
  const [currentLyricIndex, setCurrentLyricIndex] = useState<number>(0);
  const [dbTracks, setDbTracks] = useState<any[]>([]);

  const sampleTracks = [
    {
      id: 'TRK_TWINKLE',
      title: 'Twinkle Twinkle Little Star',
      artist: 'Traditional',
      difficulty: 'Beginner',
      targetFreq: 261.63,
      lyrics: [
        { time: 0, text: 'Twinkle, twinkle, little star,' },
        { time: 4, text: 'How I wonder what you are!' },
        { time: 8, text: 'Up above the world so high,' },
        { time: 12, text: 'Like a diamond in the sky.' },
      ],
    },
    {
      id: 'TRK_SCALES',
      title: 'Major Scale Vocal Warmup',
      artist: 'SWARA Vocal Coach',
      difficulty: 'Intermediate',
      targetFreq: 440.0,
      lyrics: [
        { time: 0, text: 'Do (C4 - 261 Hz)' },
        { time: 3, text: 'Re (D4 - 293 Hz)' },
        { time: 6, text: 'Mi (E4 - 329 Hz)' },
        { time: 9, text: 'Fa (F4 - 349 Hz)' },
        { time: 12, text: 'Sol (G4 - 392 Hz)' },
      ],
    },
  ];

  // Live Analysis Metrics
  const [currentPitch, setCurrentPitch] = useState<PitchResult | null>(null);
  const [currentTip, setCurrentTip] = useState<VocalAdvice>({
    status: 'silent',
    tip: 'Click "Start Session" to begin real-time pitch assessment.',
    diffHz: 0,
    centsDiff: 0,
    label: 'Standing By',
  });
  const [sessionScore, setSessionScore] = useState<number>(100);
  const [totalPitchFrames, setTotalPitchFrames] = useState<number>(0);
  const [inTuneFrames, setInTuneFrames] = useState<number>(0);

  // Database & API Streaming State
  const [recentLogs, setRecentLogs] = useState<AnalysisLogRow[]>([]);
  const [dbStatus, setDbStatus] = useState(getSupabaseStatus());
  const [isConfigOpen, setIsConfigOpen] = useState<boolean>(false);
  const [isSchemaModalOpen, setIsSchemaModalOpen] = useState<boolean>(false);
  const [supabaseUrlInput, setSupabaseUrlInput] = useState<string>('');
  const [supabaseKeyInput, setSupabaseKeyInput] = useState<string>('');
  const [dbConfigMessage, setDbConfigMessage] = useState<string | null>(null);
  const [isStreamingRow, setIsStreamingRow] = useState<boolean>(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  // Audio Graph Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const referenceOscRef = useRef<OscillatorNode | null>(null);
  const referenceGainRef = useRef<GainNode | null>(null);

  // Simulator Nodes Ref
  const simOscRef = useRef<OscillatorNode | null>(null);
  const simVibratoOscRef = useRef<OscillatorNode | null>(null);
  const simGainRef = useRef<GainNode | null>(null);
  const simMasterGainRef = useRef<GainNode | null>(null);
  const simDriftIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Animation & Throttling Refs
  const animationFrameIdRef = useRef<number | null>(null);
  const frameCounterRef = useRef<number>(0);
  const pitchHistoryRef = useRef<{ time: number; pitch: number; target: number }[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const oscCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionIdRef = useRef<string>('SES1001');

  // Initial load: check hardware devices and cached logs & fetch practice tracks
  useEffect(() => {
    const existing = getLocalLogs();
    if (existing.length > 0) {
      setRecentLogs(existing.slice(0, 5));
    }
    setDbStatus(getSupabaseStatus());

    const fetchTracks = async () => {
      try {
        const { data, error } = await supabase.from('practice_track').select('*');
        if (!error && data && data.length > 0) {
          const formattedTracks = data.map((track) => ({
            id: track.track_id,
            title: track.title,
            artist: track.artist,
            difficulty: track.difficulty,
            targetFreq: track.target_notes ? track.target_notes[0] : 440.0,
            lyrics: track.lyrics_data || []
          }));
          setDbTracks(formattedTracks);
        }
      } catch (err) {
        console.warn('Using fallback local sample tracks.');
      }
    };
    fetchTracks();

    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          const hasAudioInput = devices.some((d) => d.kind === 'audioinput');
          setMicAvailable(hasAudioInput);
          if (hasAudioInput) {
            setInputMode('mic');
          } else {
            setInputMode('simulator');
            setSystemNotice(
              'No physical microphone detected. Virtual Vocal Simulator is enabled so you can test all pitch detection, tuning, and database features.'
            );
          }
          setHasMicTested(true);
        })
        .catch(() => {
          setMicAvailable(false);
          setInputMode('simulator');
          setHasMicTested(true);
        });
    } else {
      setMicAvailable(false);
      setInputMode('simulator');
      setHasMicTested(true);
    }
  }, []);

  // Sync simulated pitch default when target note changes
  useEffect(() => {
    if (!isRecording) {
      setSimulatedPitchHz(selectedTarget.frequency);
    }
  }, [selectedTarget.frequency, isRecording]);

  // Session Duration Timer & Synchronized Lyrics Progression
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isRecording && sessionStartTime) {
      timer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
        setElapsedSeconds(elapsed);

        const activeTracksList = dbTracks.length > 0 ? dbTracks : sampleTracks;
        if (selectedTrack && selectedTrack.lyrics) {
          const lyricIndex = selectedTrack.lyrics.findIndex(
            (l: any, idx: number) =>
              elapsed >= l.time &&
              (idx === selectedTrack.lyrics.length - 1 || elapsed < selectedTrack.lyrics[idx + 1].time)
          );
          if (lyricIndex !== -1) {
            setCurrentLyricIndex(lyricIndex);
          }
        }
      }, 1000);
    } else {
      setElapsedSeconds(0);
      setCurrentLyricIndex(0);
    }
    return () => clearInterval(timer);
  }, [isRecording, sessionStartTime, selectedTrack, dbTracks]);

  /**
   * Reference Tone Synthesizer
   */
  const toggleReferenceTone = useCallback(() => {
    try {
      if (isTonePlaying) {
        if (referenceOscRef.current) {
          referenceOscRef.current.stop();
          referenceOscRef.current.disconnect();
          referenceOscRef.current = null;
        }
        setIsTonePlaying(false);
      } else {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = audioContextRef.current || new AudioCtx();
        audioContextRef.current = ctx;

        if (ctx.state === 'suspended') {
          ctx.resume();
        }

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(selectedTarget.frequency, ctx.currentTime);

        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.08);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        referenceOscRef.current = osc;
        referenceGainRef.current = gain;
        setIsTonePlaying(true);
      }
    } catch (e) {
      console.error('Tone generation error:', e);
      setIsTonePlaying(false);
    }
  }, [isTonePlaying, selectedTarget.frequency]);

  useEffect(() => {
    if (isTonePlaying && referenceOscRef.current && audioContextRef.current) {
      referenceOscRef.current.frequency.setValueAtTime(
        selectedTarget.frequency,
        audioContextRef.current.currentTime
      );
    }
  }, [selectedTarget.frequency, isTonePlaying]);

  /**
   * Update Simulated Pitch in Real-Time
   */
  const updateSimulatedPitch = (newFreq: number) => {
    setSimulatedPitchHz(newFreq);
    if (simOscRef.current && audioContextRef.current) {
      simOscRef.current.frequency.setTargetAtTime(
        newFreq,
        audioContextRef.current.currentTime,
        0.04
      );
    }
  };

  /**
   * Setup Audio Pipeline for Virtual Vocal Simulator
   */
  const setupSimulatorAudio = (ctx: AudioContext, targetFreq: number) => {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyserRef.current = analyser;

    const simOsc = ctx.createOscillator();
    simOsc.type = 'triangle';
    simOsc.frequency.setValueAtTime(targetFreq, ctx.currentTime);

    const vibratoOsc = ctx.createOscillator();
    const vibratoGain = ctx.createGain();
    vibratoOsc.frequency.setValueAtTime(5.2, ctx.currentTime);
    vibratoGain.gain.setValueAtTime(1.2, ctx.currentTime);

    vibratoOsc.connect(simOsc.frequency);
    vibratoOsc.start();
    simVibratoOscRef.current = vibratoOsc;

    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0.28, ctx.currentTime);
    gainNodeRef.current = gainNode;

    simOsc.connect(gainNode);
    gainNode.connect(analyser);

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(isSimAudible ? 0.12 : 0, ctx.currentTime);
    gainNode.connect(masterGain);
    masterGain.connect(ctx.destination);
    simMasterGainRef.current = masterGain;

    simOsc.start();
    simOscRef.current = simOsc;
    simGainRef.current = gainNode;
  };

  /**
   * Start Live Session (Handles Microphone, Virtual Simulator, & Express Backend)
   */
  const startSession = async () => {
    setSystemNotice(null);
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    audioContextRef.current = ctx;

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    let modeToUse: InputMode = inputMode;

    if (modeToUse === 'mic') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;

        const source = ctx.createMediaStreamSource(stream);
        const gainNode = ctx.createGain();
        gainNode.gain.value = inputGain;
        gainNodeRef.current = gainNode;

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        analyserRef.current = analyser;

        source.connect(gainNode);
        gainNode.connect(analyser);
      } catch (err: any) {
        console.warn('Microphone stream error, switching to Virtual Vocal Simulator:', err);
        modeToUse = 'simulator';
        setInputMode('simulator');
        setSystemNotice(
          'No microphone detected or permission unavailable. Automatically running Virtual Vocal Simulator so you can test all pitch analysis and database streaming features!'
        );
        setupSimulatorAudio(ctx, simulatedPitchHz);
      }
    } else {
      setupSimulatorAudio(ctx, simulatedPitchHz);
    }

    const newSessionId = `SES_${Date.now().toString().slice(-6)}`;
    setSessionId(newSessionId);
    sessionIdRef.current = newSessionId;

    setSessionStartTime(Date.now());
    setIsRecording(true);
    pitchHistoryRef.current = [];
    frameCounterRef.current = 0;
    setTotalPitchFrames(0);
    setInTuneFrames(0);
    setSessionScore(100);

    // Call Express backend endpoint with authenticated user ID and email
    try {
      const response = await fetch(`${API_BASE}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: newSessionId,
          userId: user?.id || 'U101',
          userEmail: user?.email || 'darshpamnani@gmail.com',
          trackId: selectedTrack ? selectedTrack.id : 'TRK01',
          targetPitch: selectedTarget.frequency,
        }),
      });
      const data = await response.json();
      console.log('Session initialized & user synced:', data);
    } catch (err) {
      console.warn('Express backend offline, falling back to client-side logging.');
    }

    runAudioAnalysisLoop();
  };

  /**
   * Stop Session & Clean Up Web Audio Graph
   */
  const stopSession = async () => {
    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }

    if (simDriftIntervalRef.current) {
      clearInterval(simDriftIntervalRef.current);
      simDriftIntervalRef.current = null;
      setIsSimDriftActive(false);
    }

    if (simOscRef.current) {
      try {
        simOscRef.current.stop();
        simOscRef.current.disconnect();
      } catch {}
      simOscRef.current = null;
    }

    if (simVibratoOscRef.current) {
      try {
        simVibratoOscRef.current.stop();
        simVibratoOscRef.current.disconnect();
      } catch {}
      simVibratoOscRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    if (isTonePlaying && referenceOscRef.current) {
      try {
        referenceOscRef.current.stop();
      } catch {}
      referenceOscRef.current = null;
      setIsTonePlaying(false);
    }

    const activeSessionId = sessionIdRef.current;

    try {
      const res = await fetch(`${API_BASE}/sessions/${activeSessionId}/score`);
      if (res.ok) {
        const data = await res.json();
        if (typeof data.score === 'number') {
          setSessionScore(data.score);
        }
      }
    } catch (err) {
      console.warn('Backend score fetch skipped.');
    }

    setIsRecording(false);
    setCurrentPitch(null);
    setCurrentTip({
      status: 'silent',
      tip: 'Session ended. Review your performance logs and score.',
      diffHz: 0,
      centsDiff: 0,
      label: 'Session Stopped',
    });
  };

  /**
   * Toggle Pitch Drift Simulation
   */
  const togglePitchDrift = () => {
    if (isSimDriftActive) {
      if (simDriftIntervalRef.current) {
        clearInterval(simDriftIntervalRef.current);
        simDriftIntervalRef.current = null;
      }
      setIsSimDriftActive(false);
    } else {
      setIsSimDriftActive(true);
      const baseFreq = selectedTarget.frequency;
      let step = 0;
      simDriftIntervalRef.current = setInterval(() => {
        step += 0.12;
        const offset = Math.sin(step) * 5.5 + Math.cos(step * 0.7) * 2.5;
        const newFreq = parseFloat((baseFreq + offset).toFixed(2));
        updateSimulatedPitch(newFreq);
      }, 150);
    }
  };

  /**
   * Toggle Simulator Sound Audibility
   */
  const toggleSimAudible = () => {
    const nextVal = !isSimAudible;
    setIsSimAudible(nextVal);
    if (simMasterGainRef.current && audioContextRef.current) {
      simMasterGainRef.current.gain.setTargetAtTime(
        nextVal ? 0.12 : 0,
        audioContextRef.current.currentTime,
        0.05
      );
    }
  };

  /**
   * Main Web Audio Extraction Loop
   */
  const runAudioAnalysisLoop = () => {
    if (!analyserRef.current || !audioContextRef.current) return;

    const analyser = analyserRef.current;
    const sampleRate = audioContextRef.current.sampleRate;
    const buffer = new Float32Array(analyser.fftSize);

    const analyze = () => {
      analyser.getFloatTimeDomainData(buffer);

      drawOscilloscope(buffer);

      const pitchResult = autoCorrelate(buffer, sampleRate, silenceThreshold);
      const advice = generateVocalTip(
        pitchResult ? pitchResult.frequency : null,
        selectedTarget.frequency
      );

      setCurrentPitch(pitchResult);
      setCurrentTip(advice);

      if (pitchResult) {
        pitchHistoryRef.current.push({
          time: Date.now(),
          pitch: pitchResult.frequency,
          target: selectedTarget.frequency,
        });
        if (pitchHistoryRef.current.length > 120) {
          pitchHistoryRef.current.shift();
        }

        setTotalPitchFrames((prev) => {
          const next = prev + 1;
          const isAccurate = Math.abs(pitchResult.frequency - selectedTarget.frequency) <= 2.0;
          if (isAccurate) {
            setInTuneFrames((prevInTune) => {
              const nextInTune = prevInTune + 1;
              const ratio = Math.round((nextInTune / next) * 100);
              setSessionScore(ratio);
              return nextInTune;
            });
          } else {
            setInTuneFrames((prevInTune) => {
              const ratio = Math.round((prevInTune / next) * 100);
              setSessionScore(ratio);
              return prevInTune;
            });
          }
          return next;
        });

        frameCounterRef.current += 1;
        if (frameCounterRef.current >= 11) {
          frameCounterRef.current = 0;
          streamAnalysisLog(pitchResult.frequency, selectedTarget.frequency);
        }
      }

      drawPitchHistory();

      animationFrameIdRef.current = requestAnimationFrame(analyze);
    };

    animationFrameIdRef.current = requestAnimationFrame(analyze);
  };

  /**
   * Background Ingestion (Streams to Express API / Supabase using sessionIdRef)
   */
  const streamAnalysisLog = async (actualPitch: number, targetPitch: number) => {
    setIsStreamingRow(true);
    const activeSessionId = sessionIdRef.current;

    const logPayload = {
      log_id: `LOG_${Date.now().toString().slice(-6)}`,
      session_id: activeSessionId,
      target_pitch: targetPitch,
      actual_pitch: actualPitch,
    };

    try {
      const res = await fetch(`${API_BASE}/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logId: logPayload.log_id,
          sessionId: activeSessionId,
          targetPitch: targetPitch,
          actualPitch: actualPitch,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data && data.log) {
          setRecentLogs((prev) => [data.log, ...prev.slice(0, 4)]);
          if (data.aiTip || data.log.ai_tip) {
            setCurrentTip((prev) => ({
              ...prev,
              tip: data.aiTip || data.log.ai_tip,
            }));
          }
          setTimeout(() => setIsStreamingRow(false), 250);
          return;
        }
      }
    } catch (err) {
      // Fallback direct to Supabase
    }

    try {
      const { data, error } = await supabase
        .from('analysis_log')
        .insert([logPayload])
        .select();

      if (!error && data && data.length > 0) {
        const insertedRow = data[0];
        setRecentLogs((prev) => [insertedRow, ...prev.slice(0, 4)]);
      }
    } catch (err) {
      console.warn('Ingestion stream catch:', err);
    } finally {
      setTimeout(() => setIsStreamingRow(false), 250);
    }
  };

  /**
   * Waveform Oscilloscope Drawing
   */
  const drawOscilloscope = (buffer: Float32Array) => {
    const canvas = oscCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(51, 65, 85, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#06b6d4';
    ctx.beginPath();

    const sliceWidth = width / buffer.length;
    let x = 0;

    for (let i = 0; i < buffer.length; i++) {
      const v = buffer[i] * inputGain;
      const y = (0.5 + v * 0.45) * height;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }

      x += sliceWidth;
    }

    ctx.stroke();
  };

  /**
   * Pitch History Timeline Canvas
   */
  const drawPitchHistory = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const history = pitchHistoryRef.current;
    if (history.length === 0) {
      ctx.strokeStyle = 'rgba(51, 65, 85, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
      return;
    }

    const target = selectedTarget.frequency;
    const minFreq = target * 0.82;
    const maxFreq = target * 1.18;
    const freqRange = maxFreq - minFreq;

    const getCanvasY = (freq: number) => {
      const clamped = Math.max(minFreq, Math.min(maxFreq, freq));
      const norm = (clamped - minFreq) / freqRange;
      return height - norm * height;
    };

    const targetY = getCanvasY(target);
    const upperY = getCanvasY(target + 2);
    const lowerY = getCanvasY(target - 2);

    ctx.fillStyle = 'rgba(16, 185, 129, 0.12)';
    ctx.fillRect(0, upperY, width, Math.max(3, lowerY - upperY));

    ctx.strokeStyle = 'rgba(16, 185, 129, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, targetY);
    ctx.lineTo(width, targetY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.lineWidth = 2.5;
    for (let i = 0; i < history.length - 1; i++) {
      const p1 = history[i];
      const p2 = history[i + 1];

      const x1 = (i / 120) * width;
      const x2 = ((i + 1) / 120) * width;
      const y1 = getCanvasY(p1.pitch);
      const y2 = getCanvasY(p2.pitch);

      const diff = Math.abs(p2.pitch - target);
      if (diff <= 2) {
        ctx.strokeStyle = '#10b981';
      } else if (p2.pitch < target - 2) {
        ctx.strokeStyle = '#f59e0b';
      } else {
        ctx.strokeStyle = '#f43f5e';
      }

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  };

  /**
   * Save Supabase credentials
   */
  const handleSaveCredentials = (e: React.FormEvent) => {
    e.preventDefault();
    const res = configureSupabase(supabaseUrlInput.trim(), supabaseKeyInput.trim());
    setDbConfigMessage(res.message);
    setDbStatus(getSupabaseStatus());
    if (res.success) {
      setTimeout(() => {
        setIsConfigOpen(false);
        setDbConfigMessage(null);
      }, 1200);
    }
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const centsOffset = currentPitch ? currentPitch.cents : 0;
  const needleRotation = Math.max(-50, Math.min(50, centsOffset)) * 0.9;
  const currentTracksList = dbTracks.length > 0 ? dbTracks : sampleTracks;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* 1. Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur px-6 py-3.5 flex items-center justify-between gap-8 sticky top-0 z-30">
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <Activity className="w-5 h-5" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg tracking-tight text-white">SWARA</span>
            
            </div>
            <span className="text-xs text-slate-400 hidden sm:inline">
              Smart Waveform Analysis for Real-time Assessment
            </span>
          </div>
        </div>

        {/* Navigation Tabs (Dashboard vs Songs Library) */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 border border-slate-800 rounded-lg">
          <button
            onClick={() => setActiveView('dashboard')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeView === 'dashboard'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Live Tuner</span>
          </button>
          <button
            onClick={() => setActiveView('songs')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeView === 'songs'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Song Library</span>
          </button>
        </div>

        {/* Audio Mode Switcher */}
        <div className="hidden xl:flex items-center gap-2 bg-slate-950 p-1 border border-slate-800 rounded-lg">
          <button
            onClick={() => {
              if (isRecording) stopSession();
              setInputMode('mic');
            }}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              inputMode === 'mic'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Mic className="w-3.5 h-3.5" />
            <span>Mic</span>
          </button>
          <button
            onClick={() => {
              if (isRecording) stopSession();
              setInputMode('simulator');
            }}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              inputMode === 'simulator'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>Synth</span>
          </button>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden md:flex items-center gap-2 text-xs text-slate-400 font-mono bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded-lg">
            <span>Session: {sessionId}</span>
            <span className="text-slate-600">·</span>
            <span className="tabular-nums font-semibold text-slate-200">
              {formatSeconds(elapsedSeconds)}
            </span>
          </div>

          <button
            onClick={() => setIsConfigOpen(true)}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:text-white hover:border-slate-700 transition-colors whitespace-nowrap"
          >
            <Database className="w-3.5 h-3.5 text-cyan-400" />
            <span>{dbStatus.isConfigured ? 'Supabase Live' : 'Supabase Client'}</span>
          </button>

          <button
            onClick={() => setIsSchemaModalOpen(true)}
            className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:text-white hover:border-slate-700 transition-colors whitespace-nowrap"
          >
            <Code2 className="w-3.5 h-3.5 text-amber-400" />
            <span>Schema Reference</span>
          </button>

          <button
            onClick={isRecording ? stopSession : startSession}
            className={`flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-lg transition-all shadow-sm whitespace-nowrap ${
              isRecording
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-900/40'
                : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-cyan-950/50'
            }`}
          >
            {isRecording ? (
              <>
                <Square className="w-4 h-4 fill-current" />
                <span>Stop</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>Start</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* System Notice Banner */}
      {systemNotice && (
        <div className="bg-cyan-950/40 border-b border-cyan-800/40 px-6 py-2.5 flex items-center justify-between text-xs text-cyan-200">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>{systemNotice}</span>
          </div>
          <button
            onClick={() => setSystemNotice(null)}
            className="text-cyan-400 hover:text-cyan-100 ml-4 font-mono"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* CONDITIONAL VIEW RENDERING */}
      {activeView === 'songs' ? (
        /* ================= SONG PRACTICE LIBRARY VIEW ================= */
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-bold text-cyan-300">Song & Practice Dataset Library</h1>
            <p className="text-xs text-slate-400">
              Select a track from your database dataset below to practice with synchronized live lyrics and real-time AI vocal feedback.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {currentTracksList.map((track) => (
              <div
                key={track.id}
                onClick={() => {
                  setSelectedTrack(track);
                  const matchedNote = STANDARD_TARGET_NOTES.find(
                    (n) => Math.abs(n.frequency - (track.targetFreq || 440)) < 5
                  );
                  if (matchedNote) setSelectedTarget(matchedNote);
                }}
                className={`p-5 rounded-xl border cursor-pointer transition-all ${
                  selectedTrack?.id === track.id
                    ? 'bg-cyan-950/40 border-cyan-500/60 shadow-lg shadow-cyan-950/50'
                    : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-cyan-300">
                    {track.difficulty || 'Intermediate'}
                  </span>
                  <Music className="w-4 h-4 text-slate-400" />
                </div>
                <h3 className="text-base font-semibold text-white">{track.title}</h3>
                <p className="text-xs text-slate-400 mt-0.5">{track.artist}</p>
              </div>
            ))}
          </div>

          {selectedTrack && (
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 flex flex-col gap-6 mt-2">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h2 className="text-sm font-semibold text-white">Active Track: {selectedTrack.title}</h2>
                  <span className="text-xs text-slate-400 font-mono">Dataset ID: {selectedTrack.id}</span>
                </div>
                <button
                  onClick={() => {
                    if (isRecording) {
                      stopSession();
                    } else {
                      startSession();
                    }
                  }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold ${
                    isRecording ? 'bg-rose-600 text-white' : 'bg-cyan-500 text-slate-950'
                  }`}
                >
                  {isRecording ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                  <span>{isRecording ? 'Stop Practice Session' : 'Start Practice Session'}</span>
                </button>
              </div>

              {/* Synchronized Scrolling Lyrics Display */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-8 flex flex-col items-center justify-center min-h-[180px] text-center relative overflow-hidden">
                <div className="text-xs font-mono uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Live Synchronized Lyrics Stream</span>
                </div>

                <div className="text-2xl font-bold text-cyan-200 transition-all duration-300">
                  {selectedTrack.lyrics && selectedTrack.lyrics[currentLyricIndex]
                    ? selectedTrack.lyrics[currentLyricIndex].text
                    : 'Press Start Practice to begin...'}
                </div>

                <div className="text-xs text-slate-500 mt-3 font-mono">
                  Lyric Line {currentLyricIndex + 1} of {selectedTrack.lyrics?.length || 1}
                </div>
              </div>

              {/* Real-time AI Tip Box matching song practice */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-0.5">
                    Live Vocal Guidance
                  </span>
                  <p className="text-sm font-medium text-slate-200">
                    {currentTip.tip}
                  </p>
                </div>
              </div>
            </div>
          )}
        </main>
      ) : (
        /* ================= LIVE TUNER DASHBOARD VIEW ================= */
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-8 flex flex-col gap-6">
            {/* Target Note Selector */}
            <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-4 md:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex flex-col gap-1">
                <label htmlFor="target-note-select" className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Target Reference Pitch
                </label>
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <select
                      id="target-note-select"
                      value={selectedTarget.name}
                      onChange={(e) => {
                        const found = STANDARD_TARGET_NOTES.find((n) => n.name === e.target.value);
                        if (found) {
                          setSelectedTarget(found);
                          if (!isRecording) {
                            setSimulatedPitchHz(found.frequency);
                          }
                        }
                      }}
                      className="appearance-none bg-slate-950 border border-slate-700 hover:border-slate-600 text-white font-mono text-base font-semibold py-2 pl-3.5 pr-9 rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500 cursor-pointer"
                    >
                      {STANDARD_TARGET_NOTES.map((note) => (
                        <option key={note.name} value={note.name}>
                          {note.name} — {note.frequency.toFixed(2)} Hz ({note.category})
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-3 pointer-events-none" />
                  </div>

                  <div className="flex flex-col">
                    <span className="text-xl font-bold font-mono text-cyan-300 tabular-nums">
                      {selectedTarget.frequency.toFixed(2)}
                      <span className="text-xs text-slate-400 ml-1">Hz</span>
                    </span>
                    <span className="text-xs text-slate-500">Octave {selectedTarget.octave}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={toggleReferenceTone}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium border transition-colors ${
                    isTonePlaying
                      ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                      : 'bg-slate-950 border-slate-700 text-slate-300 hover:text-white hover:border-slate-600'
                  }`}
                >
                  {isTonePlaying ? (
                    <>
                      <VolumeX className="w-4 h-4 text-amber-400" />
                      <span>Mute Tone</span>
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-4 h-4 text-cyan-400" />
                      <span>Play Reference Tone</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Virtual Vocal Simulator Control */}
            {inputMode === 'simulator' && (
              <div className="bg-slate-900/90 border border-cyan-800/50 rounded-xl p-4 flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
                  <div className="flex items-center gap-2">
                    <Radio className="w-4 h-4 text-cyan-400" />
                    <span className="text-xs font-semibold text-slate-200">
                      Virtual Vocal Synth Controller
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={togglePitchDrift}
                      className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors ${
                        isSimDriftActive
                          ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {isSimDriftActive ? 'Stop Auto-Drift' : 'Auto Pitch Drift'}
                    </button>

                    <button
                      onClick={toggleSimAudible}
                      className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border transition-colors ${
                        isSimAudible
                          ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {isSimAudible ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                      <span>{isSimAudible ? 'Audio On' : 'Audio Muted'}</span>
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-400">Simulated Pitch:</span>
                    <span className="text-cyan-300 font-bold tabular-nums">
                      {simulatedPitchHz.toFixed(2)} Hz
                    </span>
                  </div>
                  <input
                    type="range"
                    min={Math.max(80, selectedTarget.frequency - 50)}
                    max={selectedTarget.frequency + 50}
                    step="0.25"
                    value={simulatedPitchHz}
                    onChange={(e) => updateSimulatedPitch(parseFloat(e.target.value))}
                    className="w-full accent-cyan-400 h-1.5 bg-slate-950 rounded cursor-pointer"
                  />
                </div>
              </div>
            )}

            {/* Live Pitch Gauge & Real-time Tuner Readout */}
            <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-5 md:p-6 flex flex-col gap-5">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                <div className="flex items-center gap-2">
                  <Music className="w-4 h-4 text-cyan-400" />
                  <h2 className="text-sm font-semibold text-slate-200">
                    Live Pitch Assessment & Tuner Needle
                  </h2>
                </div>
                <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
                  <span>Tolerance: ±2.00 Hz</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
                <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-5 flex flex-col items-center justify-center text-center">
                  <span className="text-xs uppercase font-medium text-slate-500 tracking-wider">
                    Detected Pitch
                  </span>
                  <span
                    className={`text-5xl font-black font-mono tracking-tight my-1 transition-colors ${
                      !currentPitch
                        ? 'text-slate-600'
                        : currentTip.status === 'perfect'
                        ? 'text-emerald-400'
                        : currentTip.status === 'flat'
                        ? 'text-amber-400'
                        : 'text-rose-400'
                    }`}
                  >
                    {currentPitch ? currentPitch.noteName : '--'}
                  </span>
                  <div className="flex items-center gap-2 text-sm font-mono text-slate-300 tabular-nums">
                    <span className="text-lg font-semibold">
                      {currentPitch ? currentPitch.frequency.toFixed(2) : '0.00'}
                    </span>
                    <span className="text-xs text-slate-500">Hz</span>
                  </div>
                </div>

                {/* Real-time Needle Arc Visualizer */}
                <div className="md:col-span-2 flex flex-col items-center justify-center bg-slate-950/80 border border-slate-800/80 rounded-xl p-5 relative overflow-hidden">
                  <div className="w-full flex justify-between text-[11px] font-mono text-slate-500 px-4">
                    <span className="text-amber-400/80">-50 FLAT</span>
                    <span className="text-emerald-400 font-semibold">IN TUNE (0)</span>
                    <span className="text-rose-400/80">+50 SHARP</span>
                  </div>

                  <div className="relative w-64 h-28 mt-2 flex items-end justify-center">
                    <svg className="w-64 h-32 absolute top-0" viewBox="0 0 200 100">
                      <path
                        d="M 20 90 A 80 80 0 0 1 180 90"
                        fill="none"
                        stroke="#1e293b"
                        strokeWidth="8"
                        strokeLinecap="round"
                      />
                      <path
                        d="M 94 10 A 80 80 0 0 1 106 10"
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="10"
                      />
                      <line x1="100" y1="12" x2="100" y2="28" stroke="#10b981" strokeWidth="2.5" />
                    </svg>

                    <div
                      className="w-1 h-20 origin-bottom rounded-full transition-transform duration-100 ease-out z-10"
                      style={{
                        transform: `rotate(${currentPitch ? needleRotation : 0}deg)`,
                        backgroundColor:
                          !currentPitch
                            ? '#475569'
                            : currentTip.status === 'perfect'
                            ? '#10b981'
                            : currentTip.status === 'flat'
                            ? '#f59e0b'
                            : '#f43f5e',
                      }}
                    />
                    <div className="w-4 h-4 rounded-full bg-slate-200 border-2 border-slate-900 absolute bottom-0 z-20" />
                  </div>
                </div>
              </div>
            </div>

            {/* Real-time AI Suggestion Box */}
            <div
              className={`rounded-xl p-4 border transition-all ${
                currentTip.status === 'perfect'
                  ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                  : currentTip.status === 'flat'
                  ? 'bg-amber-950/30 border-amber-500/40 text-amber-200'
                  : currentTip.status === 'sharp'
                  ? 'bg-rose-950/30 border-rose-500/40 text-rose-200'
                  : 'bg-slate-950/50 border-slate-800 text-slate-400'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0">
                  {currentTip.status === 'perfect' && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
                  {currentTip.status === 'flat' && <ArrowDown className="w-5 h-5 text-amber-400" />}
                  {currentTip.status === 'sharp' && <ArrowUp className="w-5 h-5 text-rose-400" />}
                  {currentTip.status === 'silent' && <Sparkles className="w-5 h-5 text-cyan-400" />}
                </div>

                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold uppercase tracking-wider">
                      Real-time AI Vocal Feedback
                    </span>
                    <span className="text-xs font-mono font-medium">{currentTip.label}</span>
                  </div>
                  <p className="text-sm font-medium leading-relaxed">{currentTip.tip}</p>
                </div>
              </div>
            </div>

            {/* Real-time Oscilloscope & Pitch Timeline Visualizers */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-4 flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs font-medium text-slate-400">
                  <span>PCM Audio Waveform</span>
                  <span className="font-mono text-[11px] text-cyan-400">FFT 2048</span>
                </div>
                <div className="h-28 bg-slate-950 rounded-lg overflow-hidden border border-slate-800/60 relative">
                  <canvas ref={oscCanvasRef} width={400} height={112} className="w-full h-full block" />
                </div>
              </div>

              <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-4 flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs font-medium text-slate-400">
                  <span>Pitch Trajectory vs Target</span>
                  <span className="font-mono text-[11px] text-emerald-400">
                    Target: {selectedTarget.frequency.toFixed(1)} Hz
                  </span>
                </div>
                <div className="h-28 bg-slate-950 rounded-lg overflow-hidden border border-slate-800/60 relative">
                  <canvas ref={canvasRef} width={400} height={112} className="w-full h-full block" />
                </div>
              </div>
            </div>
          </section>

          {/* Right Section: Database Streaming & Performance */}
          <aside className="lg:col-span-4 flex flex-col gap-6">
            <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Award className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-sm font-semibold text-slate-200">Session Accuracy</h3>
                </div>
                <span className="text-xs text-slate-500 font-mono">Frames: {totalPitchFrames}</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-950/80 border border-slate-800 p-3.5 rounded-lg flex flex-col">
                  <span className="text-xs text-slate-400 font-medium">Session Score</span>
                  <span className="text-2xl font-black font-mono text-cyan-300 tabular-nums mt-1">
                    {totalPitchFrames > 0 ? `${sessionScore}%` : '--'}
                  </span>
                </div>

                <div className="bg-slate-950/80 border border-slate-800 p-3.5 rounded-lg flex flex-col">
                  <span className="text-xs text-slate-400 font-medium">In-Tune Hits</span>
                  <span className="text-2xl font-black font-mono text-emerald-400 tabular-nums mt-1">
                    {inTuneFrames}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-5 flex flex-col gap-4 flex-1">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-sm font-semibold text-slate-200">Live Log Activity</h3>
                </div>
                <span className="text-xs text-slate-500 font-mono">analysis_log</span>
              </div>

              <div className="flex flex-col gap-2.5">
                {recentLogs.length === 0 ? (
                  <div className="text-center py-8 text-xs text-slate-500 font-mono">
                    No analysis logs logged yet. Start a session.
                  </div>
                ) : (
                  recentLogs.map((log) => (
                    <div
                      key={log.log_id}
                      className="bg-slate-950/90 border border-slate-800/90 rounded-lg p-3 flex flex-col gap-1.5"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono font-semibold text-cyan-300">{log.log_id}</span>
                        <span className="text-[11px] font-mono text-slate-500">{log.session_id}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs font-mono text-slate-300">
                        <div>
                          <span className="text-[10px] text-slate-500 block">Actual</span>
                          {Number(log.actual_pitch).toFixed(1)} Hz
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-500 block">Target</span>
                          {Number(log.target_pitch).toFixed(1)} Hz
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-500 block">Dev</span>
                          {Number(log.pitch_deviation ?? 0).toFixed(1)} Hz
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>
        </main>
      )}

      {/* Settings Modal */}
      {isConfigOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-6 flex flex-col gap-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <Database className="w-5 h-5 text-cyan-400" />
                <h3 className="font-semibold text-base text-white">Supabase Configuration</h3>
              </div>
              <button onClick={() => setIsConfigOpen(false)} className="text-slate-400 hover:text-white text-sm">✕</button>
            </div>
            <form onSubmit={handleSaveCredentials} className="flex flex-col gap-4">
              <input
                type="text"
                placeholder="https://xyzcompany.supabase.co"
                value={supabaseUrlInput}
                onChange={(e) => setSupabaseUrlInput(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-xs font-mono text-slate-200"
              />
              <input
                type="password"
                placeholder="Anon Key..."
                value={supabaseKeyInput}
                onChange={(e) => setSupabaseKeyInput(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-xs font-mono text-slate-200"
              />
              {dbConfigMessage && <div className="text-xs text-cyan-300">{dbConfigMessage}</div>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setIsConfigOpen(false)} className="px-4 py-2 text-xs text-slate-300">Cancel</button>
                <button type="submit" className="px-4 py-2 text-xs font-semibold bg-cyan-500 text-slate-950 rounded-lg">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950/80 px-6 py-4 text-xs text-slate-500 flex items-center justify-between">
        <span>SWARA Vocal Engine · Web Audio API Autocorrelation</span>
        <span>Target Accuracy Window: ±2.0 Hz</span>
      </footer>
    </div>
  );
}