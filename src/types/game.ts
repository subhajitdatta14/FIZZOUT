export type MatchStatus =
  | 'WAITING'
  | 'READY'
  | 'REVEALING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'EXPIRED';

export type DebateSide = 'FOR' | 'AGAINST';

export type PlayerSlot = 'A' | 'B';

export type DebatePhase = 'BLIND' | 'COUNTER' | 'CONCLUSION' | 'RESULT';

export type RoundPhase = 'BLIND' | 'COUNTER' | 'CONCLUSION' | 'AI_JUDGING' | 'ROUND_RESULT';

export type RoundWinner = 'A' | 'B' | 'DRAW';

export interface MatchRound {
  id: string;
  match_id: string;
  round_number: number;
  phase: RoundPhase;
  topic: string;
  player_a_submitted: boolean;
  player_b_submitted: boolean;
  player_a_score: number | null;
  player_b_score: number | null;
  player_a_reason: string | null;
  player_b_reason: string | null;
  winner: RoundWinner | null;
  created_at: string;
  phase_started_at?: string;
  phase_ends_at?: string;
  time_remaining_seconds?: number;
  server_time?: string;
}

export interface RoundSubmissionsMap {
  BLIND: string | null;
  COUNTER: string | null;
  CONCLUSION: string | null;
}

export interface RoundStateResponse {
  success: boolean;
  round: MatchRound | null;
  currentRoundNumber: number;
  mySubmissions: RoundSubmissionsMap;
  visibleOpponentSubmissions: RoundSubmissionsMap;
  hasSubmittedCurrentPhase: boolean;
  opponentSubmittedCurrentPhase: boolean;
  allRounds?: MatchRound[];
  overallWinner?: RoundWinner | null;
  matchStatus?: MatchStatus;
  serverTime?: string;
  phaseEndsAt?: string;
  phaseStartedAt?: string;
  timeRemainingSeconds?: number;
  phaseDurationSeconds?: number;
  minWords?: number;
  maxWords?: number;
  error?: string;
}

export interface Match {
  id: string;
  room_code: string;
  status: MatchStatus;
  current_round: number;
  current_phase: DebatePhase;
  topic?: string;
  created_at: string;
  expires_at: string;
}

export interface MatchPlayer {
  id: string;
  match_id: string;
  player_id: string;
  player_slot: PlayerSlot;
  display_name: string;
  assigned_side: DebateSide | null;
  joined_at: string;
  is_connected: boolean;
  has_revealed_side: boolean;
}

export interface MatchState {
  match: Match | null;
  players: MatchPlayer[];
  currentPlayer: MatchPlayer | null;
  opponentPlayer: MatchPlayer | null;
  isCreator: boolean;
}

export interface CreateRoomResponse {
  success: boolean;
  match?: Match;
  player?: MatchPlayer;
  players?: MatchPlayer[];
  sessionToken?: string;
  error?: string;
}

export interface JoinRoomResponse {
  success: boolean;
  match?: Match;
  player?: MatchPlayer;
  players?: MatchPlayer[];
  sessionToken?: string;
  error?: string;
}
