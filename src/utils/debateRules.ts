// Debate timing and word count rules for FIZZ OUT
// FINAL DEBATE SETTINGS:
// Blind: 2 min 30s (150s), min 10 words, no max limit
// Counter: 4 min (240s), 40-60 words
// Conclusion: 1 min 30s (90s), 10-20 words

export interface PhaseRule {
  durationSeconds: number;
  minWords: number;
  maxWords: number; // 0 indicates no maximum word limit
  label: string;
}

export const PHASE_RULES: Record<string, PhaseRule> = {
  BLIND: {
    durationSeconds: 150, // 2 minutes 30 seconds
    minWords: 10,
    maxWords: 0, // No maximum word limit
    label: 'THE GAMBIT',
  },
  COUNTER: {
    durationSeconds: 240, // 4 minutes
    minWords: 40,
    maxWords: 60,
    label: 'COUNTERSTRIKE',
  },
  CONCLUSION: {
    durationSeconds: 90, // 1 minute 30 seconds
    minWords: 10,
    maxWords: 20,
    label: 'FINAL STRIKE',
  },
};

/**
 * Returns the official display name of the phase
 */
export function getPhaseDisplayName(phase: string): string {
  switch (phase) {
    case 'BLIND':
      return 'THE GAMBIT';
    case 'COUNTER':
      return 'COUNTERSTRIKE';
    case 'CONCLUSION':
      return 'FINAL STRIKE';
    case 'AI_JUDGING':
      return 'AI ADJUDICATION';
    case 'ROUND_RESULT':
      return 'ROUND VERDICT';
    default:
      return 'THE GAMBIT';
  }
}

/**
 * Consistently counts words by trimming leading/trailing whitespace
 * and splitting on one or more whitespace characters.
 */
export function countWords(text: string): number {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

/**
 * Truncates text to at most maxWords while preserving word boundaries.
 */
export function limitWords(text: string, maxWords: number): string {
  if (!text) return '';
  if (maxWords <= 0) return text;
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ');
}

/**
 * Formats seconds into MM:SS format (e.g. 132 -> "02:12", 48 -> "00:48")
 */
export function formatTimeMMSS(seconds: number): string {
  const safeSec = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safeSec / 60);
  const secs = safeSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
