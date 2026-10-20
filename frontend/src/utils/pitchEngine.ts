/**
 * SAWARA - Smart Waveform Analysis for Real-time Assessment
 * Pitch Extraction Engine using Time-Domain Autocorrelation
 */

export interface PitchResult {
  frequency: number; // Fundamental frequency in Hz
  noteName: string;  // e.g. "A4"
  noteNumber: number;// MIDI note number
  cents: number;     // Deviation in cents from nearest chromatic note (-50 to +50)
  rms: number;       // Root Mean Square energy (signal volume)
  clarity: number;   // Autocorrelation peak correlation value [0..1]
}

export interface VocalAdvice {
  status: 'perfect' | 'flat' | 'sharp' | 'silent';
  tip: string;
  diffHz: number;
  centsDiff: number;
  label: string;
}

export interface TargetNote {
  name: string;
  frequency: number;
  octave: number;
  category?: 'Bass' | 'Baritone' | 'Tenor' | 'Alto' | 'Soprano' | 'Standard';
}

export const STANDARD_TARGET_NOTES: TargetNote[] = [
  { name: 'C3', frequency: 130.81, octave: 3, category: 'Bass' },
  { name: 'E3', frequency: 164.81, octave: 3, category: 'Bass' },
  { name: 'G3', frequency: 196.00, octave: 3, category: 'Baritone' },
  { name: 'A3', frequency: 220.00, octave: 3, category: 'Baritone' },
  { name: 'C4', frequency: 261.63, octave: 4, category: 'Tenor' },
  { name: 'D4', frequency: 293.66, octave: 4, category: 'Tenor' },
  { name: 'E4', frequency: 329.63, octave: 4, category: 'Alto' },
  { name: 'F4', frequency: 349.23, octave: 4, category: 'Alto' },
  { name: 'G4', frequency: 392.00, octave: 4, category: 'Alto' },
  { name: 'A4', frequency: 440.00, octave: 4, category: 'Standard' },
  { name: 'B4', frequency: 493.88, octave: 4, category: 'Soprano' },
  { name: 'C5', frequency: 523.25, octave: 5, category: 'Soprano' },
  { name: 'E5', frequency: 659.25, octave: 5, category: 'Soprano' },
  { name: 'G5', frequency: 783.99, octave: 5, category: 'Soprano' },
  { name: 'A5', frequency: 880.00, octave: 5, category: 'Soprano' },
];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Converts a frequency in Hz to musical note information
 */
export function frequencyToNote(frequency: number): {
  noteName: string;
  noteNumber: number;
  octave: number;
  cents: number;
  exactHz: number;
} {
  if (frequency <= 0) {
    return { noteName: '--', noteNumber: 0, octave: 0, cents: 0, exactHz: 0 };
  }

  // MIDI Note formula: 69 + 12 * log2(f / 440)
  const midiNote = 12 * (Math.log(frequency / 440) / Math.LN2) + 69;
  const roundedMidi = Math.round(midiNote);
  const cents = Math.round((midiNote - roundedMidi) * 100);

  const noteIndex = ((roundedMidi % 12) + 12) % 12;
  const octave = Math.floor(roundedMidi / 12) - 1;
  const noteName = `${NOTE_NAMES[noteIndex]}${octave}`;
  const exactHz = 440 * Math.pow(2, (roundedMidi - 69) / 12);

  return {
    noteName,
    noteNumber: roundedMidi,
    octave,
    cents,
    exactHz: parseFloat(exactHz.toFixed(2)),
  };
}

/**
 * Calculates Root Mean Square (RMS) energy of an audio buffer
 */
export function calculateRMS(buffer: Float32Array): number {
  let sum = 0;
  const len = buffer.length;
  for (let i = 0; i < len; i++) {
    sum += buffer[i] * buffer[i];
  }
  return Math.sqrt(sum / len);
}

/**
 * Real-time Autocorrelation Algorithm
 * Analyzes audio buffer to extract the fundamental frequency (f0)
 *
 * @param buffer Raw Float32 PCM audio data (analyser.fftSize = 2048)
 * @param sampleRate e.g. 44100 or 48000
 * @param minRms RMS noise gate threshold (default 0.01)
 */
export function autoCorrelate(
  buffer: Float32Array,
  sampleRate: number,
  minRms = 0.01
): PitchResult | null {
  const bufferSize = buffer.length;
  const rms = calculateRMS(buffer);

  // Silence gate
  if (rms < minRms) {
    return null;
  }

  // Clip buffer to window with sufficient signal energy
  let r1 = 0;
  let r2 = bufferSize - 1;
  const thres = 0.05 * rms;
  for (let i = 0; i < bufferSize / 2; i++) {
    if (Math.abs(buffer[i]) < thres) {
      r1 = i;
      break;
    }
  }
  for (let i = 1; i < bufferSize / 2; i++) {
    if (Math.abs(buffer[bufferSize - i]) < thres) {
      r2 = bufferSize - i;
      break;
    }
  }

  const trimmed = buffer.slice(r1, r2);
  const trimmedSize = trimmed.length;

  // Autocorrelation buffer
  const c = new Float32Array(trimmedSize);
  for (let i = 0; i < trimmedSize; i++) {
    let sum = 0;
    for (let j = 0; j < trimmedSize - i; j++) {
      sum += trimmed[j] * trimmed[j + i];
    }
    c[i] = sum;
  }

  // Find where correlation drops below zero (first zero-crossing)
  let d = 0;
  while (d < trimmedSize - 1 && c[d] > c[d + 1]) {
    d++;
  }

  // Human vocal range bounds: 65 Hz (C2) to 1100 Hz (C6)
  const maxLag = Math.floor(sampleRate / 65);
  const minLag = Math.floor(sampleRate / 1100);

  let maxVal = -1;
  let maxPos = -1;

  for (let i = Math.max(d, minLag); i < Math.min(trimmedSize, maxLag); i++) {
    if (c[i] > maxVal) {
      maxVal = c[i];
      maxPos = i;
    }
  }

  if (maxPos === -1 || maxVal <= 0 || c[0] <= 0) {
    return null;
  }

  const clarity = maxVal / c[0];
  // If correlation peak isn't strong enough, treat as unvoiced / noise
  if (clarity < 0.65) {
    return null;
  }

  // Parabolic interpolation for sub-sample precision
  let refinedPos = maxPos;
  if (maxPos > 0 && maxPos < trimmedSize - 1) {
    const y0 = c[maxPos - 1];
    const y1 = c[maxPos];
    const y2 = c[maxPos + 1];
    const denominator = 2 * (y0 - 2 * y1 + y2);
    if (Math.abs(denominator) > 1e-6) {
      const delta = (y0 - y2) / denominator;
      refinedPos = maxPos + delta;
    }
  }

  const frequency = sampleRate / refinedPos;

  // Vocal bounds check
  if (frequency < 60 || frequency > 1200) {
    return null;
  }

  const noteInfo = frequencyToNote(frequency);

  return {
    frequency: parseFloat(frequency.toFixed(2)),
    noteName: noteInfo.noteName,
    noteNumber: noteInfo.noteNumber,
    cents: noteInfo.cents,
    rms: parseFloat(rms.toFixed(4)),
    clarity: parseFloat(clarity.toFixed(3)),
  };
}

/**
 * Generates Real-time AI vocal suggestion based on target pitch vs actual pitch
 * As per SAWARA specification:
 * |Actual - Target| <= 2 Hz: "Pitch Perfect! Hold current note posture."
 * Actual < Target - 2 Hz: "Pitch Flat. Increase breath support and lift soft palate."
 * Actual > Target + 2 Hz: "Pitch Sharp. Relax vocal cord tension and lower larynx slightly."
 */
export function generateVocalTip(
  actualPitch: number | null,
  targetPitch: number
): VocalAdvice {
  if (actualPitch === null || actualPitch <= 0) {
    return {
      status: 'silent',
      tip: 'Awaiting vocal input. Sing into the microphone...',
      diffHz: 0,
      centsDiff: 0,
      label: 'Silence Detected',
    };
  }

  const diffHz = parseFloat((actualPitch - targetPitch).toFixed(2));
  const centsDiff = Math.round(1200 * (Math.log(actualPitch / targetPitch) / Math.LN2));

  if (Math.abs(diffHz) <= 2.0) {
    return {
      status: 'perfect',
      tip: 'Pitch Perfect! Hold current note posture.',
      diffHz,
      centsDiff,
      label: 'In Tune (±2 Hz)',
    };
  }

  if (actualPitch < targetPitch - 2.0) {
    return {
      status: 'flat',
      tip: 'Pitch Flat. Increase breath support and lift soft palate.',
      diffHz,
      centsDiff,
      label: `Flat (${diffHz} Hz)`,
    };
  }

  return {
    status: 'sharp',
    tip: 'Pitch Sharp. Relax vocal cord tension and lower larynx slightly.',
    diffHz,
    centsDiff,
    label: `Sharp (+${diffHz} Hz)`,
  };
}
