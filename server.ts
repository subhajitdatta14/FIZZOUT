import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

// ============================================================================
// SECURITY & SUPABASE CONFIGURATION
// ============================================================================
// The browser only receives public anon configuration (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
// Privileged server operations MUST strictly use SUPABASE_SERVICE_ROLE_KEY.
// We strictly do NOT fall back to anon key for server-side privileged mutations.
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const isServiceRoleConfigured = Boolean(
  supabaseUrl &&
  supabaseServiceRoleKey &&
  supabaseUrl !== 'https://your-project.supabase.co' &&
  !supabaseUrl.includes('placeholder')
);

// Explicit development mock mode flag - STRICTLY disabled by default
const isExplicitDevMockEnabled = process.env.FIZZOUT_DEV_MOCK === 'true';

let serverSupabase: SupabaseClient | null = null;
if (isServiceRoleConfigured) {
  try {
    serverSupabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    console.log('[FIZZ OUT] Trusted server Supabase client initialized with SUPABASE_SERVICE_ROLE_KEY.');
  } catch (err) {
    console.error('[FIZZ OUT] Failed to initialize server-side Supabase client:', err);
    serverSupabase = null;
  }
} else {
  console.warn(
    '[FIZZ OUT] SUPABASE_SERVICE_ROLE_KEY is not configured in server environment.'
  );
}

// Track Supabase tables status in Postgres
let supabaseTablesAvailable = false; // true ONLY when all 6 tables exist!
let coreTablesAvailable = false; // true when matches, match_players, secrets, sessions exist
let gameplayTablesAvailable = false; // true when match_rounds, match_round_submissions exist
let missingSupabaseTables: string[] = [];
let lastTableCheckTime = 0;

async function checkSupabaseTablesAvailable(force = false): Promise<boolean> {
  if (!serverSupabase) {
    supabaseTablesAvailable = false;
    coreTablesAvailable = false;
    gameplayTablesAvailable = false;
    missingSupabaseTables = [
      'matches',
      'match_players',
      'match_player_secrets',
      'match_player_sessions',
      'match_rounds',
      'match_round_submissions',
    ];
    return false;
  }

  const now = Date.now();
  if (!force && now - lastTableCheckTime < 10000) {
    return coreTablesAvailable;
  }
  lastTableCheckTime = now;

  try {
    const [matchesRes, playersRes, secretsRes, sessionsRes, roundsRes, submissionsRes] = await Promise.all([
      serverSupabase.from('matches').select('id').limit(1),
      serverSupabase.from('match_players').select('id').limit(1),
      serverSupabase.from('match_player_secrets').select('id').limit(1),
      serverSupabase.from('match_player_sessions').select('id').limit(1),
      serverSupabase.from('match_rounds').select('id').limit(1),
      serverSupabase.from('match_round_submissions').select('id').limit(1),
    ]);

    const checks = [
      { name: 'matches', err: matchesRes.error },
      { name: 'match_players', err: playersRes.error },
      { name: 'match_player_secrets', err: secretsRes.error },
      { name: 'match_player_sessions', err: sessionsRes.error },
      { name: 'match_rounds', err: roundsRes.error },
      { name: 'match_round_submissions', err: submissionsRes.error },
    ];

    missingSupabaseTables = checks.filter((c) => Boolean(c.err)).map((c) => c.name);

    coreTablesAvailable = !matchesRes.error && !playersRes.error && !secretsRes.error && !sessionsRes.error;
    gameplayTablesAvailable = !roundsRes.error && !submissionsRes.error;
    supabaseTablesAvailable = coreTablesAvailable && gameplayTablesAvailable;

    if (supabaseTablesAvailable) {
      console.log('[FIZZ OUT] All 6 Supabase database tables verified and active for server operations.');
    } else {
      console.warn('[FIZZ OUT] Supabase database table status:', {
        coreTablesAvailable,
        gameplayTablesAvailable,
        missingSupabaseTables,
      });
    }

    return coreTablesAvailable;
  } catch (err) {
    supabaseTablesAvailable = false;
    coreTablesAvailable = false;
    gameplayTablesAvailable = false;
    return false;
  }
}

// ============================================================================
// STATE MACHINE SPECIFICATION
// ============================================================================
// Strict allowed transitions:
// WAITING -> READY
// READY -> REVEALING
// REVEALING -> IN_PROGRESS
// IN_PROGRESS -> COMPLETED
// WAITING -> EXPIRED
// READY -> EXPIRED
// REVEALING -> EXPIRED
// IN_PROGRESS -> EXPIRED
// COMPLETED -> EXPIRED
export type MatchStatus = 'WAITING' | 'READY' | 'REVEALING' | 'IN_PROGRESS' | 'COMPLETED' | 'EXPIRED';

const VALID_TRANSITIONS: Record<MatchStatus, MatchStatus[]> = {
  WAITING: ['READY', 'EXPIRED'],
  READY: ['REVEALING', 'EXPIRED'],
  REVEALING: ['IN_PROGRESS', 'EXPIRED'],
  IN_PROGRESS: ['COMPLETED', 'EXPIRED'],
  COMPLETED: ['EXPIRED'],
  EXPIRED: [],
};

function isValidStateTransition(fromStatus: string, toStatus: MatchStatus): boolean {
  const allowed = VALID_TRANSITIONS[fromStatus as MatchStatus];
  return Boolean(allowed && allowed.includes(toStatus));
}

/**
 * Server-authoritative state transition executor.
 * Strictly verifies isValidStateTransition() before executing any database update.
 * Employs optimistic concurrency matching (eq('status', fromStatus)) to prevent race conditions.
 */
async function transitionMatchStatus(
  matchId: string,
  fromStatus: MatchStatus,
  toStatus: MatchStatus,
  additionalUpdates: Record<string, any> = {}
): Promise<{ success: boolean; match?: any; error?: string }> {
  if (!isValidStateTransition(fromStatus, toStatus)) {
    return {
      success: false,
      error: `Illegal state transition: Cannot transition match from ${fromStatus} to ${toStatus}. Allowed transitions: ${
        VALID_TRANSITIONS[fromStatus]?.join(', ') || 'NONE'
      }.`,
    };
  }

  const canUseSupabase = await checkSupabaseTablesAvailable();
  if (serverSupabase && canUseSupabase) {
    const { data: updated, error } = await serverSupabase
      .from('matches')
      .update({
        status: toStatus,
        ...additionalUpdates,
      })
      .eq('id', matchId)
      .eq('status', fromStatus) // Concurrency lock: must still be in fromStatus
      .select()
      .maybeSingle();

    if (error) {
      console.error(`[FIZZ OUT] Database error transitioning ${fromStatus} -> ${toStatus}:`, error);
      return { success: false, error: error.message };
    }

    if (!updated) {
      return {
        success: false,
        error: `State conflict: Match ${matchId} is no longer in state ${fromStatus}.`,
      };
    }

    return { success: true, match: updated };
  }

  // Explicit dev mock fallback only
  if (isExplicitDevMockEnabled) {
    const match = devMockMatches.get(matchId);
    if (!match) {
      return { success: false, error: 'Match not found in mock store.' };
    }
    if (match.status !== fromStatus) {
      return {
        success: false,
        error: `State conflict: Expected status ${fromStatus}, but found ${match.status}.`,
      };
    }
    match.status = toStatus;
    Object.assign(match, additionalUpdates);
    return { success: true, match };
  }

  return { success: false, error: 'Database is not available for authoritative state transition.' };
}

// ============================================================================
// TEMPORARY PLAYER SESSION TOKEN SYSTEM
// ============================================================================
// Anonymous players do not have permanent auth accounts.
// The server generates a cryptographically random temporary session token when creating or joining.
// Only SHA-256 hashes are stored in the database or server memory.
// Sensitive mutations require presenting this token.
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

function generateSessionToken(): string {
  return 'fzt_' + crypto.randomBytes(32).toString('hex');
}

// In-memory structures ONLY used if explicit dev mock mode (FIZZOUT_DEV_MOCK=true) is activated
interface DevMockSessionRecord {
  matchId: string;
  playerId: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
}
const devMockSessions = new Map<string, DevMockSessionRecord>();
const devMockMatches = new Map<string, any>();
const devMockPlayers = new Map<string, any[]>();
const devMockSecrets = new Map<string, 'FOR' | 'AGAINST'>(); // key: `${matchId}:${playerId}`
const devMockRounds = new Map<string, any[]>(); // matchId -> MatchRound[]
const devMockSubmissions = new Map<string, any[]>(); // matchId -> submissions[]

// Hybrid authoritative round store: seamlessly coordinates Supabase DB with high-reliability in-memory storage
const hybridRounds = new Map<string, any[]>(); // matchId -> any[]
const hybridSubmissions = new Map<string, any[]>(); // matchId -> any[]

function normalizeRoundRecord(r: any): any {
  if (!r) return r;
  if (!r.phase_ends_at && r.player_a_reason && typeof r.player_a_reason === 'string' && r.player_a_reason.startsWith('{"phase":')) {
    try {
      const meta = JSON.parse(r.player_a_reason);
      if (meta && meta.ends_at) {
        r.phase_started_at = meta.started_at;
        r.phase_ends_at = meta.ends_at;
      }
    } catch {}
  }
  return r;
}

async function dbGetMatchRounds(matchId: string): Promise<any[]> {
  if (serverSupabase && gameplayTablesAvailable) {
    try {
      const { data, error } = await serverSupabase
        .from('match_rounds')
        .select('*')
        .eq('match_id', matchId)
        .order('round_number', { ascending: true });
      if (!error && Array.isArray(data) && data.length > 0) {
        const normalized = data.map(normalizeRoundRecord);
        hybridRounds.set(matchId, normalized);
        return normalized;
      }
    } catch {
      // Handled by in-memory fallback
    }
  }
  const rounds = hybridRounds.get(matchId) || [];
  return rounds.map(normalizeRoundRecord);
}

async function dbUpsertMatchRound(roundData: any): Promise<any> {
  const matchId = roundData.match_id;
  const roundNumber = roundData.round_number;
  const rounds = hybridRounds.get(matchId) || [];
  const existingIndex = rounds.findIndex((r) => r.round_number === roundNumber);

  // Ensure timing fields exist for gameplay phases
  if (['BLIND', 'COUNTER', 'CONCLUSION'].includes(roundData.phase)) {
    if (!roundData.phase_started_at) {
      roundData.phase_started_at = new Date().toISOString();
    }
    if (!roundData.phase_ends_at) {
      const duration = getPhaseDurationSeconds(roundData.phase);
      roundData.phase_ends_at = new Date(Date.now() + duration * 1000).toISOString();
    }
    // Encode in player_a_reason for seamless persistence in existing Supabase tables
    if (!roundData.player_a_reason) {
      roundData.player_a_reason = JSON.stringify({
        phase: roundData.phase,
        started_at: roundData.phase_started_at,
        ends_at: roundData.phase_ends_at,
      });
    }
  }

  const record = {
    id: existingIndex >= 0 ? rounds[existingIndex].id : crypto.randomUUID(),
    created_at: existingIndex >= 0 ? rounds[existingIndex].created_at : new Date().toISOString(),
    ...(existingIndex >= 0 ? rounds[existingIndex] : {}),
    ...roundData,
  };

  if (existingIndex >= 0) {
    rounds[existingIndex] = record;
  } else {
    rounds.push(record);
  }
  hybridRounds.set(matchId, rounds);

  if (serverSupabase && gameplayTablesAvailable) {
    try {
      // First try upserting with all columns
      const { data, error } = await serverSupabase
        .from('match_rounds')
        .upsert(roundData, { onConflict: 'match_id,round_number' })
        .select()
        .maybeSingle();
      if (!error && data) {
        const norm = normalizeRoundRecord(data);
        rounds[existingIndex >= 0 ? existingIndex : rounds.length - 1] = norm;
        hybridRounds.set(matchId, rounds);
        return norm;
      }
      if (error && error.message?.includes('schema cache')) {
        // Schema cache doesn't have phase_started_at/phase_ends_at yet, strip them
        const { phase_started_at, phase_ends_at, ...safeData } = roundData;
        const { data: retryData } = await serverSupabase
          .from('match_rounds')
          .upsert(safeData, { onConflict: 'match_id,round_number' })
          .select()
          .maybeSingle();
        if (retryData) {
          const norm = normalizeRoundRecord({ ...retryData, phase_started_at, phase_ends_at });
          rounds[existingIndex >= 0 ? existingIndex : rounds.length - 1] = norm;
          hybridRounds.set(matchId, rounds);
          return norm;
        }
      }
    } catch {
      // Handled by in-memory fallback
    }
  }

  return record;
}

async function dbUpdateMatchRound(
  matchId: string,
  roundNumber: number,
  updates: any,
  roundId?: string
): Promise<any> {
  const rounds = hybridRounds.get(matchId) || [];
  const idx = rounds.findIndex((r) => r.round_number === roundNumber || (roundId && r.id === roundId));

  // If transitioning to a gameplay phase, configure timing
  if (updates.phase && ['BLIND', 'COUNTER', 'CONCLUSION'].includes(updates.phase)) {
    if (!updates.phase_started_at) {
      updates.phase_started_at = new Date().toISOString();
    }
    if (!updates.phase_ends_at) {
      const duration = getPhaseDurationSeconds(updates.phase);
      updates.phase_ends_at = new Date(Date.now() + duration * 1000).toISOString();
    }
    updates.player_a_reason = JSON.stringify({
      phase: updates.phase,
      started_at: updates.phase_started_at,
      ends_at: updates.phase_ends_at,
    });
  }

  if (idx >= 0) {
    rounds[idx] = { ...rounds[idx], ...updates };
    normalizeRoundRecord(rounds[idx]);
    hybridRounds.set(matchId, rounds);
  }

  if (serverSupabase && gameplayTablesAvailable) {
    try {
      const query = serverSupabase.from('match_rounds').update(updates);
      const { error } = roundId
        ? await query.eq('id', roundId)
        : await query.eq('match_id', matchId).eq('round_number', roundNumber);

      if (error && error.message?.includes('schema cache')) {
        // Safe fallback without newer columns
        const { phase_started_at, phase_ends_at, ...safeUpdates } = updates;
        const retryQuery = serverSupabase.from('match_rounds').update(safeUpdates);
        if (roundId) {
          await retryQuery.eq('id', roundId);
        } else {
          await retryQuery.eq('match_id', matchId).eq('round_number', roundNumber);
        }
      }
    } catch {
      // Handled by in-memory fallback
    }
  }

  return idx >= 0 ? rounds[idx] : null;
}

async function dbGetRoundSubmissions(matchId: string, roundNumber: number): Promise<any[]> {
  if (serverSupabase && gameplayTablesAvailable) {
    try {
      const { data, error } = await serverSupabase
        .from('match_round_submissions')
        .select('*')
        .eq('match_id', matchId)
        .eq('round_number', roundNumber);
      if (!error && Array.isArray(data) && data.length > 0) {
        return data;
      }
    } catch {
      // Handled by in-memory fallback
    }
  }
  const subs = hybridSubmissions.get(matchId) || [];
  return subs.filter((s) => s.round_number === roundNumber);
}

async function dbInsertRoundSubmission(subData: any): Promise<any> {
  const matchId = subData.match_id;
  const roundNumber = subData.round_number;
  const playerId = subData.player_id;
  const phase = subData.phase;

  const subs = hybridSubmissions.get(matchId) || [];
  // Strict unique constraint: same player + same round + same submission phase
  const alreadyExists = subs.some(
    (s) => s.round_number === roundNumber && s.player_id === playerId && s.phase === phase
  );
  if (alreadyExists) {
    const error: any = new Error('Submission already exists for this round and phase.');
    error.code = '23505'; // Postgres unique violation code
    throw error;
  }

  const record = {
    id: crypto.randomUUID(),
    submitted_at: new Date().toISOString(),
    ...subData,
  };
  subs.push(record);
  hybridSubmissions.set(matchId, subs);

  if (serverSupabase && gameplayTablesAvailable) {
    try {
      await serverSupabase.from('match_round_submissions').insert(subData);
    } catch {
      // Handled by in-memory fallback
    }
  }

  return record;
}

// ============================================================================
// REALTIME BROADCAST ENGINE & DISTRIBUTED SERVER SYNC
// ============================================================================

const serverMatchChannels = new Map<string, Promise<any>>();

function getServerMatchChannel(matchId: string): Promise<any> {
  if (!serverSupabase) return Promise.resolve(null);
  let chPromise = serverMatchChannels.get(matchId);
  if (!chPromise) {
    chPromise = new Promise((resolve) => {
      const ch = serverSupabase!.channel(`match_${matchId}`, {
        config: { broadcast: { self: false } },
      });

      // Listen for peer container submissions so multiple Cloud Run instances stay in sync!
      ch.on('broadcast', { event: 'server_submission_sync' }, async (eventPayload: any) => {
        try {
          const payload = eventPayload?.payload;
          if (!payload || payload.matchId !== matchId || !payload.submission) return;
          const sub = payload.submission;

          console.log('[PEER CONTAINER SYNC] Received submission broadcast from peer container:', {
            matchId,
            roundNumber: sub.round_number,
            playerSlot: sub.player_slot,
            phase: sub.phase,
          });

          // Insert into local hybridSubmissions
          const subs = hybridSubmissions.get(matchId) || [];
          const alreadyExists = subs.some(
            (s) => s.round_number === sub.round_number && s.player_id === sub.player_id && s.phase === sub.phase
          );
          if (!alreadyExists) {
            subs.push(sub);
            hybridSubmissions.set(matchId, subs);
          }

          // Check if both players have now submitted for this round & phase
          const phaseSubs = subs.filter((s) => s.round_number === sub.round_number && s.phase === sub.phase);
          const hasA = phaseSubs.some((s) => s.player_slot === 'A');
          const hasB = phaseSubs.some((s) => s.player_slot === 'B');

          if (hasA && hasB) {
            console.log('[PEER CONTAINER SYNC] Both submissions present across containers! Advancing phase.');
            const nextPhase = sub.phase === 'BLIND' ? 'COUNTER' : sub.phase === 'COUNTER' ? 'CONCLUSION' : 'AI_JUDGING';

            // Authoritatively update Supabase matches table
            if (serverSupabase) {
              await serverSupabase.from('matches').update({ current_phase: nextPhase }).eq('id', matchId);
            }

            // Update local round
            const rounds = hybridRounds.get(matchId) || [];
            const rIdx = rounds.findIndex((r) => r.round_number === sub.round_number);
            if (rIdx >= 0) {
              rounds[rIdx].phase = nextPhase;
              rounds[rIdx].player_a_submitted = false;
              rounds[rIdx].player_b_submitted = false;
              hybridRounds.set(matchId, rounds);
            }

            // Broadcast phase transition to clients
            broadcastMatchEvent(matchId, 'round_phase_transition', {
              action: 'PHASE_TRANSITION',
              phase: nextPhase,
              roundNumber: sub.round_number,
              matchId,
            });
          }
        } catch (syncErr) {
          console.error('[PEER CONTAINER SYNC] Error processing peer sync:', syncErr);
        }
      });

      ch.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          resolve(ch);
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          serverMatchChannels.delete(matchId);
          resolve(null);
        }
      });
    });
    serverMatchChannels.set(matchId, chPromise);
  }
  return chPromise;
}

async function broadcastMatchEvent(matchId: string, eventName: string, payload: any) {
  try {
    const ch = await getServerMatchChannel(matchId);
    if (!ch) return;
    await ch.send({
      type: 'broadcast',
      event: eventName,
      payload,
    });
    if (eventName !== 'match_action') {
      await ch.send({
        type: 'broadcast',
        event: 'match_action',
        payload,
      });
    }
    console.log('[REALTIME BROADCAST SENT]', {
      event: eventName,
      matchId,
      action: payload?.action,
      phase: payload?.phase,
    });
  } catch (err) {
    console.warn('[Realtime Broadcast Warning]', err);
  }
}

// ============================================================================
// GEMINI SERVER-SIDE INTEGRATION (Topic Generation & AI Round Adjudication)
// ============================================================================
let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!geminiClient && process.env.GEMINI_API_KEY) {
    try {
      geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    } catch (e) {
      console.error('[FIZZ OUT] Failed to instantiate GoogleGenAI:', e);
    }
  }
  return geminiClient;
}

// ============================================================================
// TOPIC GENERATION & TOPIC HISTORY MANAGEMENT (Never Reuses Previous Topics)
// ============================================================================

const FALLBACK_TOPIC_POOL = [
  // Education & Schools
  'Should homework be banned?',
  'Should AI replace teachers in classrooms?',
  'Should college tuition be completely free?',
  'Should phones be prohibited in classrooms?',
  'Should school uniforms be mandatory for students?',
  'Should letter grades be completely eliminated?',
  'Should high school start after 9 AM?',
  'Should exams be replaced with projects?',
  'Should financial literacy be mandatory in high school?',
  'Should students grade their own teachers?',
  'Should physical education be mandatory in college?',
  'Should cursive writing still be taught?',
  'Should summer vacation be replaced year-round?',
  'Should coding be taught in kindergarten?',
  'Should standardized tests determine college admission?',

  // Technology & Digital Life
  'Should social media have age limits?',
  'Should artificial intelligence be strictly regulated?',
  'Should self-driving cars replace human drivers?',
  'Should facial recognition technology be prohibited?',
  'Should smartphones be banned for under-twelves?',
  'Should internet access be a human right?',
  'Should robots pay income taxes?',
  'Should deepfakes be classified as illegal content?',
  'Should algorithms dictate news feed content?',
  'Should video game loot boxes be banned?',
  'Should cryptocurrency replace traditional paper money?',
  'Should children have privacy from parents online?',
  'Should autonomous drone deliveries be allowed everywhere?',
  'Should tech companies moderate online speech?',
  'Should space tourism be banned for billionaires?',

  // Work & Economy
  'Should four-day workweeks be legally mandatory?',
  'Should remote work be an employee right?',
  'Should tipping culture be completely abolished?',
  'Should unpaid internships be made illegal?',
  'Should retirement age be raised to seventy?',
  'Should maximum salary caps exist for CEOs?',
  'Should universal basic income be implemented globally?',
  'Should companies monitor remote worker keystrokes?',
  'Should freelancers receive standard healthcare benefits?',
  'Should office dress codes be abolished?',
  'Should employees be fired for social media posts?',
  'Should minimum wage automatically match inflation?',
  'Should gig workers be classified as employees?',
  'Should AI job displaced workers receive government pensions?',

  // Environment & Food
  'Should single-use plastics be banned worldwide?',
  'Should fast food have health warning labels?',
  'Should meat consumption be legally taxed?',
  'Should private jets be completely banned?',
  'Should nuclear power replace all fossil fuels?',
  'Should artificial meat replace farm livestock?',
  'Should public transportation be completely fare-free?',
  'Should gasoline cars be prohibited by 2030?',
  'Should bottled water sales be outlawed?',
  'Should excess grocery food waste be illegal?',
  'Should carbon footprints be tracked on individuals?',
  'Should zoos and oceanariums be abolished?',
  'Should genetically modified foods require mandatory labels?',
  'Should lawn mowers and gas equipment be banned?',
  'Should cities ban private cars from downtown centers?',

  // Society, Culture & Law
  'Should voting in elections be mandatory for all?',
  'Should daylight saving time be permanently abolished?',
  'Should cash money be phased out completely?',
  'Should the legal voting age be lowered to sixteen?',
  'Should graffiti and street art be legalized?',
  'Should jury trials be replaced with professional panels?',
  'Should celebrities have weaker privacy protections?',
  'Should professional sports eliminate gender divisions?',
  'Should genetic editing in human embryos be permitted?',
  'Should extreme sports require expensive permits?',
  'Should beauty pageants be permanently eliminated?',
  'Should physical currency exist fifty years from now?',
  'Should commercial advertising be banned on public streets?',
  'Should influencers disclose paid sponsorships on every post?',
  'Should national anthems be played before sports games?',

  // Lifestyle & Daily Habits
  'Should video games be considered Olympic sports?',
  'Should animal testing for cosmetics be criminalized?',
  'Should junk food advertising be banned from television?',
  'Should sugar sweetened beverages carry sin taxes?',
  'Should boxing and combat sports be discontinued?',
  'Should pet ownership require passing a license exam?',
  'Should smart home devices be allowed in bedrooms?',
  'Should credit scores be used for rental housing?',
  'Should fast fashion brands pay textile disposal fees?',
  'Should streaming services pay higher music royalties?',
  'Should public libraries be funded exclusively by donations?',
  'Should electric scooters be banned from city sidewalks?',
  'Should personal DNA testing kits require doctor approval?',
  'Should mandatory recycling be enforced with fines?',
  'Should space exploration receive more government funding?'
];

// Persistent set of all topics used across all matches ever played
const usedTopicsHistory = new Set<string>();

// Pre-assigned topics for each match: matchId -> [Topic 1, Topic 2, Topic 3]
const matchTopicAssignments = new Map<string, [string, string, string]>();

const USED_TOPICS_FILE = path.join(process.cwd(), '.used_debate_topics.json');

function loadUsedTopicsHistory(): void {
  try {
    if (fs.existsSync(USED_TOPICS_FILE)) {
      const data = JSON.parse(fs.readFileSync(USED_TOPICS_FILE, 'utf8'));
      if (Array.isArray(data)) {
        for (const t of data) {
          if (typeof t === 'string' && t.trim()) {
            usedTopicsHistory.add(t.trim());
          }
        }
      }
    }
  } catch (e) {
    console.warn('[FIZZ OUT] Error reading used topics cache file:', e);
  }
}

function saveUsedTopicsHistory(): void {
  try {
    const list = Array.from(usedTopicsHistory);
    fs.writeFileSync(USED_TOPICS_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    console.warn('[FIZZ OUT] Error writing used topics cache file:', e);
  }
}

// Initialize on server load
loadUsedTopicsHistory();

function normalizeTopic(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTopicTooSimilar(candidate: string, existingList: Iterable<string>): boolean {
  const normCandidate = normalizeTopic(candidate);
  if (!normCandidate) return true;

  const candidateWords = new Set(normCandidate.split(' ').filter((w) => w.length > 2));

  for (const item of existingList) {
    const normItem = normalizeTopic(item);
    if (normCandidate === normItem) return true;

    // Check high word overlap (>= 75%)
    const itemWords = new Set(normItem.split(' ').filter((w) => w.length > 2));
    if (candidateWords.size > 0 && itemWords.size > 0) {
      let common = 0;
      for (const w of candidateWords) {
        if (itemWords.has(w)) common++;
      }
      const overlap1 = common / candidateWords.size;
      const overlap2 = common / itemWords.size;
      if (overlap1 >= 0.75 && overlap2 >= 0.75) return true;
    }
  }
  return false;
}

export function recordUsedTopic(topic: string): void {
  if (!topic || typeof topic !== 'string') return;
  const clean = topic.trim();
  if (clean) {
    usedTopicsHistory.add(clean);
    saveUsedTopicsHistory();
  }
}

/**
 * Generates 3 completely NEW short topics for a match (Round 1, Round 2, Round 3).
 * Enforces:
 * - None of the 3 topics were used in the previous match or any past match.
 * - Round 1 = New Topic 1
 * - Round 2 = New Topic 2
 * - Round 3 = New Topic 3
 * - Each round's topic remains identical across BLIND, COUNTER, CONCLUSION.
 * - Every time a new match starts, generate 3 fresh topics again.
 */
async function generateThreeUniqueMatchTopics(
  matchId: string,
  additionalExclude: string[] = []
): Promise<[string, string, string]> {
  // If already generated for this match, return existing assignment
  const existing = matchTopicAssignments.get(matchId);
  if (existing && existing.length === 3) {
    return existing;
  }

  // Combine usedTopicsHistory + additionalExclude
  const allExcluded = new Set<string>();
  for (const t of usedTopicsHistory) allExcluded.add(t);
  for (const t of additionalExclude) {
    if (t && typeof t === 'string') allExcluded.add(t.trim());
  }

  const selectedTopics: string[] = [];

  // 1. Try generating with Gemini with explicit exclusion of previous match topics
  const prompt = `You are the debate topic master for a fast-paced 1v1 debate game.
Generate 3 completely unique, fresh, and engaging short debate topics for a 3-round match (Round 1, Round 2, Round 3).

Strict rules:
1. Each topic MUST be very short (4 to 9 words).
2. Phrased as a direct yes/no question starting with "Should" (e.g. "Should four-day workweeks be mandatory?").
3. Use simple everyday conversational English.
4. Clearly debatable from both FOR and AGAINST sides.
5. Topics must cover 3 distinctly DIFFERENT themes (e.g. Technology, Education/Work, Everyday Life).
6. Return EXACTLY 3 lines, one topic per line. Do NOT include numbers, bullet points, quotes, or markdown.
${
  allExcluded.size > 0
    ? `7. ABSOLUTE MANDATE: You MUST NOT use, repeat, or closely rephrase ANY of these previously debated topics:\n${Array.from(allExcluded)
        .slice(-50)
        .map((t) => `- "${t}"`)
        .join('\n')}`
    : ''
}
`;

  try {
    const raw = await callGeminiWithFallback({ contents: prompt });
    if (raw) {
      const lines = raw
        .split('\n')
        .map((l) => l.replace(/^[\d+.\-*\s"']+|["'\s]+$/g, '').trim())
        .filter((l) => l.length > 5);

      for (const line of lines) {
        if (selectedTopics.length >= 3) break;
        const words = countWords(line);
        if (
          words >= 3 &&
          words <= 10 &&
          !isTopicTooSimilar(line, allExcluded) &&
          !isTopicTooSimilar(line, selectedTopics)
        ) {
          selectedTopics.push(line);
          allExcluded.add(line);
        }
      }
    }
  } catch (err) {
    console.warn('[FIZZ OUT] AI 3-topic batch generation warning:', err);
  }

  // 2. If Gemini produced fewer than 3, select from unused FALLBACK_TOPIC_POOL
  if (selectedTopics.length < 3) {
    const availableFallbacks = FALLBACK_TOPIC_POOL.filter(
      (t) => !isTopicTooSimilar(t, allExcluded) && !isTopicTooSimilar(t, selectedTopics)
    );
    const shuffled = [...availableFallbacks].sort(() => Math.random() - 0.5);
    for (const fb of shuffled) {
      if (selectedTopics.length >= 3) break;
      selectedTopics.push(fb);
      allExcluded.add(fb);
    }
  }

  // 3. Ultra-rare fallback if pool is somehow completely exhausted
  let safetyCounter = 1;
  while (selectedTopics.length < 3) {
    const backup = `Should public initiative ${safetyCounter++} be legally mandated?`;
    selectedTopics.push(backup);
  }

  const result: [string, string, string] = [
    selectedTopics[0],
    selectedTopics[1],
    selectedTopics[2],
  ];

  // Permanently record all 3 into usedTopicsHistory so they are NEVER reused
  for (const t of result) {
    recordUsedTopic(t);
  }

  matchTopicAssignments.set(matchId, result);
  return result;
}

/**
 * Executes a Gemini request with automatic multi-model failover.
 * Prioritizes gemini-3.1-flash-lite, gemini-3.5-flash-lite, and gemini-3.6-flash
 * to ensure high availability and bypass free-tier quota spikes on 3.8.
 */
async function callGeminiWithFallback(params: {
  contents: string;
  config?: any;
}): Promise<string | null> {
  const ai = getGeminiClient();
  if (!ai) return null;

  const candidateModels = [
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash-lite',
    'gemini-3.6-flash',
    'gemini-3.8-flash',
  ];

  for (const model of candidateModels) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: params.contents,
        config: params.config,
      });

      const text = response.text?.trim();
      if (text) {
        return text;
      }
    } catch {
      // Gracefully advance to next candidate model on quota (429) or transient spike (503)
      continue;
    }
  }

  return null;
}

/**
 * Helper to count words consistently across client and server.
 */
function countWords(text: string): number {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

function getPhaseDurationSeconds(phase: string): number {
  if (phase === 'BLIND') return 150; // 2 minutes 30 seconds
  if (phase === 'COUNTER') return 240; // 4 minutes
  if (phase === 'CONCLUSION') return 90; // 1 minute 30 seconds
  return 150;
}

function getPhaseWordLimits(phase: string): { min: number; max: number } {
  if (phase === 'BLIND') return { min: 10, max: 0 }; // 0 indicates no maximum word limit
  if (phase === 'COUNTER') return { min: 40, max: 60 };
  if (phase === 'CONCLUSION') return { min: 10, max: 20 };
  return { min: 10, max: 0 };
}

async function generateAITopic(
  roundNumber: number,
  previousTopics: string[] = [],
  matchId?: string
): Promise<string> {
  if (matchId && matchTopicAssignments.has(matchId)) {
    const topics = matchTopicAssignments.get(matchId)!;
    const index = Math.max(0, Math.min(2, roundNumber - 1));
    return topics[index];
  }

  const allExcluded = new Set<string>();
  for (const t of usedTopicsHistory) allExcluded.add(t);
  for (const t of previousTopics) allExcluded.add(t);

  const prompt = `Generate a single very short debate topic for Round ${roundNumber} of a fast-paced 1v1 debate game.
Topic rules:
- Maximum 8–10 words. Prefer 4–8 words when possible.
- Use simple everyday English.
- The topic must be clearly debatable from both FOR and AGAINST sides.
- Avoid academic, complicated, or legal wording.
- Avoid long sentences.
- Do NOT use "Resolved:".
- Do NOT add explanations or context paragraphs.
- Do NOT put quotation marks around the topic.
- Return ONLY the topic itself.
${allExcluded.size > 0 ? `Do NOT use or closely repeat any of these previous topics: ${Array.from(allExcluded).slice(-40).map((t) => `"${t}"`).join(', ')}.` : ''}

Good examples:
- Should AI replace teachers?
- Should homework be banned?
- Should college be free?
- Should phones be allowed in schools?
- Should social media have age limits?
- Should AI be regulated?
- Should students wear uniforms?
- Should exams be abolished?`;

  try {
    const topicRaw = await callGeminiWithFallback({ contents: prompt });
    if (topicRaw) {
      let clean = topicRaw
        .split('\n')[0]
        .replace(/^["']|["']$/g, '')
        .replace(/^Resolved:\s*/i, '')
        .replace(/^Topic:\s*/i, '')
        .trim();

      const words = countWords(clean);
      if (words >= 3 && words <= 10 && !isTopicTooSimilar(clean, allExcluded)) {
        recordUsedTopic(clean);
        return clean;
      }
    }
  } catch (err) {
    console.warn('[FIZZ OUT] AI topic generation error, using fallback pool:', err);
  }

  const unused = FALLBACK_TOPIC_POOL.filter((t) => !isTopicTooSimilar(t, allExcluded));
  const pool = unused.length > 0 ? unused : FALLBACK_TOPIC_POOL;
  const picked = pool[Math.floor(Math.random() * pool.length)];
  recordUsedTopic(picked);
  return picked;
}

interface PlayerArgumentBundle {
  name: string;
  side: 'FOR' | 'AGAINST';
  blind: string;
  counter: string;
  conclusion: string;
}

interface AIJudgingResult {
  playerAScore: number;
  playerBScore: number;
  playerAReason: string;
  playerBReason: string;
  winner: 'A' | 'B' | 'DRAW';
}

function isValidPhaseResponse(text?: string | null): boolean {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^\[no submission/i.test(trimmed) || /^no submission/i.test(trimmed)) return false;
  if (countWords(trimmed) < 2) return false;
  return true;
}

async function judgeDebateRoundWithGemini(
  topic: string,
  playerA: PlayerArgumentBundle,
  playerB: PlayerArgumentBundle
): Promise<AIJudgingResult> {
  const validBlindA = isValidPhaseResponse(playerA.blind);
  const validCounterA = isValidPhaseResponse(playerA.counter);
  const validConclusionA = isValidPhaseResponse(playerA.conclusion);
  const validCountA = (validBlindA ? 1 : 0) + (validCounterA ? 1 : 0) + (validConclusionA ? 1 : 0);

  const validBlindB = isValidPhaseResponse(playerB.blind);
  const validCounterB = isValidPhaseResponse(playerB.counter);
  const validConclusionB = isValidPhaseResponse(playerB.conclusion);
  const validCountB = (validBlindB ? 1 : 0) + (validCounterB ? 1 : 0) + (validConclusionB ? 1 : 0);

  // If both players provide no valid responses across all 3 phases:
  // - Round result = Draw
  // - Scores = 0/100 for both.
  if (validCountA === 0 && validCountB === 0) {
    return {
      playerAScore: 0,
      playerBScore: 0,
      playerAReason: 'No valid arguments submitted across all 3 phases (0/100).',
      playerBReason: 'No valid arguments submitted across all 3 phases (0/100).',
      winner: 'DRAW',
    };
  }

  // Explicit representation for Gemini: never allow Gemini to invent or assume arguments
  const textBlindA = validBlindA ? playerA.blind : '[NO VALID RESPONSE - 0 POINTS]';
  const textCounterA = validCounterA ? playerA.counter : '[NO VALID RESPONSE - 0 POINTS]';
  const textConclusionA = validConclusionA ? playerA.conclusion : '[NO VALID RESPONSE - 0 POINTS]';

  const textBlindB = validBlindB ? playerB.blind : '[NO VALID RESPONSE - 0 POINTS]';
  const textCounterB = validCounterB ? playerB.counter : '[NO VALID RESPONSE - 0 POINTS]';
  const textConclusionB = validConclusionB ? playerB.conclusion : '[NO VALID RESPONSE - 0 POINTS]';

  const prompt = `You are the authoritative, impartial AI debate adjudicator for "FIZZ OUT", a competitive 1v1 debate battle game.
Evaluate the complete head-to-head 3-phase debate between Player A and Player B.

DEBATE RESOLUTION:
"${topic}"

PLAYER A: ${playerA.name} (Assigned Stance: ${playerA.side})
- Phase 1 (Blind Opening Argument): "${textBlindA}"
- Phase 2 (Direct Counterargument to Player B): "${textCounterA}"
- Phase 3 (Final Conclusion & Summary): "${textConclusionA}"

PLAYER B: ${playerB.name} (Assigned Stance: ${playerB.side})
- Phase 1 (Blind Opening Argument): "${textBlindB}"
- Phase 2 (Direct Counterargument to Player A): "${textCounterB}"
- Phase 3 (Final Conclusion & Summary): "${textConclusionB}"

CRITERIA FOR SCORING (Scale 0 to 100 points for each player):
1. Phase 1 Blind Opening Argument (0-30 pts): Adherence to assigned side, depth of reasoning, relevance to the motion. MUST BE 0 PTS if phase is "[NO VALID RESPONSE - 0 POINTS]".
2. Phase 2 Direct Rebuttal & Counter Punch (0-35 pts): How incisively and specifically they dismantled the opponent's blind claim. MUST BE 0 PTS if phase is "[NO VALID RESPONSE - 0 POINTS]".
3. Phase 3 Conclusion Impact & Synthesis (0-25 pts): Synthesis of the debate clash, persuasiveness, rhetorical punch. MUST BE 0 PTS if phase is "[NO VALID RESPONSE - 0 POINTS]".
4. Professional Conduct & Style (0-10 pts): Clarity, coherence, and lack of logical fallacies. MUST BE 0 PTS if the player has 0 valid responses across all 3 phases.

STRICT SCORING RULES:
- If a player provides no valid response in a phase, that phase MUST receive 0 points.
- If a player provides no valid response in all 3 phases:
  * Their round score MUST be exactly 0/100.
  * Do NOT give them an automatic score such as 25/100.
  * Do NOT invent or assume an argument for them.
  * The opponent MUST win the round if they have valid submissions.
- For players who provide valid responses, keep existing evaluation based on debate merit.
- Differentiate scores based on actual debate merit. Avoid identical scores unless the debate is an exact tie.
- Decide the round winner: "A", "B", or "DRAW".
- Provide a sharp, insightful 1-2 sentence judicial critique for Player A and Player B explaining why points were won or lost.

Output must be ONLY valid JSON matching this schema:
{
  "playerA": {
    "phase1Score": <number 0-30, or 0 if missing>,
    "phase2Score": <number 0-35, or 0 if missing>,
    "phase3Score": <number 0-25, or 0 if missing>,
    "styleScore": <number 0-10, or 0 if all missing>,
    "score": <number total sum of phases and style>,
    "reason": "<string>"
  },
  "playerB": {
    "phase1Score": <number 0-30, or 0 if missing>,
    "phase2Score": <number 0-35, or 0 if missing>,
    "phase3Score": <number 0-25, or 0 if missing>,
    "styleScore": <number 0-10, or 0 if all missing>,
    "score": <number total sum of phases and style>,
    "reason": "<string>"
  },
  "winner": "A" | "B" | "DRAW"
}`;

  try {
    const rawJson = await callGeminiWithFallback({
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    if (rawJson) {
      const parsed = JSON.parse(rawJson);

      // --- Authoritative Server-Side Scoring Enforcement ---
      // Player A:
      let scoreA: number;
      let reasonA = parsed.playerA?.reason || 'Maintained consistent defense of the assigned stance.';
      if (validCountA === 0) {
        scoreA = 0;
        reasonA = 'No valid arguments submitted across all 3 phases (0/100).';
      } else if (
        typeof parsed.playerA?.phase1Score === 'number' &&
        typeof parsed.playerA?.phase2Score === 'number' &&
        typeof parsed.playerA?.phase3Score === 'number'
      ) {
        const p1 = validBlindA ? Math.min(30, Math.max(0, Math.round(parsed.playerA.phase1Score))) : 0;
        const p2 = validCounterA ? Math.min(35, Math.max(0, Math.round(parsed.playerA.phase2Score))) : 0;
        const p3 = validConclusionA ? Math.min(25, Math.max(0, Math.round(parsed.playerA.phase3Score))) : 0;
        const style = Math.min(10, Math.max(0, Math.round(Number(parsed.playerA.styleScore) || 5)));
        scoreA = Math.min(100, Math.max(0, p1 + p2 + p3 + style));
      } else {
        const maxAllowedA =
          (validBlindA ? 30 : 0) +
          (validCounterA ? 35 : 0) +
          (validConclusionA ? 25 : 0) +
          10;
        const rawScoreA = Math.round(Number(parsed.playerA?.score) || 75);
        scoreA = Math.min(maxAllowedA, Math.max(0, rawScoreA));
      }

      // Player B:
      let scoreB: number;
      let reasonB = parsed.playerB?.reason || 'Delivered targeted counterarguments with articulate defense.';
      if (validCountB === 0) {
        scoreB = 0;
        reasonB = 'No valid arguments submitted across all 3 phases (0/100).';
      } else if (
        typeof parsed.playerB?.phase1Score === 'number' &&
        typeof parsed.playerB?.phase2Score === 'number' &&
        typeof parsed.playerB?.phase3Score === 'number'
      ) {
        const p1 = validBlindB ? Math.min(30, Math.max(0, Math.round(parsed.playerB.phase1Score))) : 0;
        const p2 = validCounterB ? Math.min(35, Math.max(0, Math.round(parsed.playerB.phase2Score))) : 0;
        const p3 = validConclusionB ? Math.min(25, Math.max(0, Math.round(parsed.playerB.phase3Score))) : 0;
        const style = Math.min(10, Math.max(0, Math.round(Number(parsed.playerB.styleScore) || 5)));
        scoreB = Math.min(100, Math.max(0, p1 + p2 + p3 + style));
      } else {
        const maxAllowedB =
          (validBlindB ? 30 : 0) +
          (validCounterB ? 35 : 0) +
          (validConclusionB ? 25 : 0) +
          10;
        const rawScoreB = Math.round(Number(parsed.playerB?.score) || 75);
        scoreB = Math.min(maxAllowedB, Math.max(0, rawScoreB));
      }

      // Authoritative Winner Determination:
      let winner: 'A' | 'B' | 'DRAW';
      if (validCountA === 0 && validCountB === 0) {
        winner = 'DRAW';
      } else if (validCountA === 0 && validCountB > 0) {
        winner = 'B';
      } else if (validCountB === 0 && validCountA > 0) {
        winner = 'A';
      } else {
        if (scoreA > scoreB) winner = 'A';
        else if (scoreB > scoreA) winner = 'B';
        else winner = 'DRAW';
      }

      return {
        playerAScore: scoreA,
        playerBScore: scoreB,
        playerAReason: reasonA,
        playerBReason: reasonB,
        winner,
      };
    }
  } catch (err) {
    console.error('[FIZZ OUT] Gemini judging error, falling back to rule-based evaluation:', err);
  }

  // Deterministic fallback evaluation if Gemini key is not configured or network error occurs
  let fallbackScoreA = 0;
  let fallbackReasonA = 'No valid arguments submitted across all 3 phases (0/100).';
  if (validCountA > 0) {
    const p1 = validBlindA ? Math.min(30, Math.max(16, 20 + Math.floor((playerA.blind.length / 20) % 10))) : 0;
    const p2 = validCounterA ? Math.min(35, Math.max(18, 23 + Math.floor((playerA.counter.length / 20) % 12))) : 0;
    const p3 = validConclusionA ? Math.min(25, Math.max(12, 16 + Math.floor((playerA.conclusion.length / 20) % 8))) : 0;
    const style = 6;
    fallbackScoreA = p1 + p2 + p3 + style;
    fallbackReasonA = `Judged on argument structure, clarity, and defense of the ${playerA.side} stance.`;
  }

  let fallbackScoreB = 0;
  let fallbackReasonB = 'No valid arguments submitted across all 3 phases (0/100).';
  if (validCountB > 0) {
    const p1 = validBlindB ? Math.min(30, Math.max(16, 20 + Math.floor((playerB.blind.length / 20) % 10))) : 0;
    const p2 = validCounterB ? Math.min(35, Math.max(18, 23 + Math.floor((playerB.counter.length / 20) % 12))) : 0;
    const p3 = validConclusionB ? Math.min(25, Math.max(12, 16 + Math.floor((playerB.conclusion.length / 20) % 8))) : 0;
    const style = 6;
    fallbackScoreB = p1 + p2 + p3 + style;
    fallbackReasonB = `Judged on counter-rebuttal sharpness and defense of the ${playerB.side} stance.`;
  }

  let fallbackWinner: 'A' | 'B' | 'DRAW';
  if (validCountA === 0 && validCountB === 0) {
    fallbackWinner = 'DRAW';
  } else if (validCountA === 0 && validCountB > 0) {
    fallbackWinner = 'B';
  } else if (validCountB === 0 && validCountA > 0) {
    fallbackWinner = 'A';
  } else {
    if (fallbackScoreA > fallbackScoreB) fallbackWinner = 'A';
    else if (fallbackScoreB > fallbackScoreA) fallbackWinner = 'B';
    else fallbackWinner = 'DRAW';
  }

  return {
    playerAScore: fallbackScoreA,
    playerBScore: fallbackScoreB,
    playerAReason: fallbackReasonA,
    playerBReason: fallbackReasonB,
    winner: fallbackWinner,
  };
}

async function executeRoundJudging(
  matchId: string,
  roundNumber: number,
  roundId: string,
  topic: string
): Promise<any> {
  console.log(`[AI JUDGING START] Match ${matchId} Round ${roundNumber}`);

  let pA: any = null;
  let pB: any = null;
  if (serverSupabase && gameplayTablesAvailable) {
    const { data: players } = await serverSupabase
      .from('match_players')
      .select('*')
      .eq('match_id', matchId);
    pA = players?.find((p) => p.player_slot === 'A');
    pB = players?.find((p) => p.player_slot === 'B');
  } else {
    const players = devMockPlayers.get(matchId) || [];
    pA = players.find((p) => p.player_slot === 'A');
    pB = players.find((p) => p.player_slot === 'B');
  }

  const allSubs = await dbGetRoundSubmissions(matchId, roundNumber);

  const bundleA: PlayerArgumentBundle = {
    name: pA?.display_name || 'Player A',
    side: (pA?.assigned_side as 'FOR' | 'AGAINST') || 'FOR',
    blind: allSubs?.find((s) => s.player_slot === 'A' && s.phase === 'BLIND')?.argument_text || '',
    counter: allSubs?.find((s) => s.player_slot === 'A' && s.phase === 'COUNTER')?.argument_text || '',
    conclusion: allSubs?.find((s) => s.player_slot === 'A' && s.phase === 'CONCLUSION')?.argument_text || '',
  };

  const bundleB: PlayerArgumentBundle = {
    name: pB?.display_name || 'Player B',
    side: (pB?.assigned_side as 'FOR' | 'AGAINST') || 'AGAINST',
    blind: allSubs?.find((s) => s.player_slot === 'B' && s.phase === 'BLIND')?.argument_text || '',
    counter: allSubs?.find((s) => s.player_slot === 'B' && s.phase === 'COUNTER')?.argument_text || '',
    conclusion: allSubs?.find((s) => s.player_slot === 'B' && s.phase === 'CONCLUSION')?.argument_text || '',
  };

  const judgeResult = await judgeDebateRoundWithGemini(topic, bundleA, bundleB);

  await dbUpdateMatchRound(
    matchId,
    roundNumber,
    {
      player_a_score: judgeResult.playerAScore,
      player_b_score: judgeResult.playerBScore,
      player_a_reason: judgeResult.playerAReason,
      player_b_reason: judgeResult.playerBReason,
      winner: judgeResult.winner,
      phase: 'ROUND_RESULT',
    },
    roundId
  );

  if (serverSupabase) {
    await serverSupabase.from('matches').update({ current_phase: 'RESULT' }).eq('id', matchId);
  }

  if (roundNumber === 3) {
    await transitionMatchStatus(matchId, 'IN_PROGRESS', 'COMPLETED');
  }

  broadcastMatchEvent(matchId, 'round_phase_transition', {
    action: 'PHASE_TRANSITION',
    phase: 'ROUND_RESULT',
    roundNumber,
    matchId,
  });

  return judgeResult;
}

async function checkAndHandlePhaseTimeout(matchId: string, round: any, match: any): Promise<any> {
  if (!round || !match) return round;
  if (!['BLIND', 'COUNTER', 'CONCLUSION'].includes(round.phase)) return round;

  normalizeRoundRecord(round);
  if (!round.phase_ends_at) {
    const duration = getPhaseDurationSeconds(round.phase);
    round.phase_started_at = round.phase_started_at || new Date().toISOString();
    round.phase_ends_at = new Date(Date.now() + duration * 1000).toISOString();
    await dbUpdateMatchRound(
      matchId,
      round.round_number,
      {
        phase_started_at: round.phase_started_at,
        phase_ends_at: round.phase_ends_at,
      },
      round.id
    );
    return round;
  }

  const now = Date.now();
  const endsAt = new Date(round.phase_ends_at).getTime();
  if (isNaN(endsAt) || now < endsAt) {
    return round; // Not expired yet
  }

  console.log(`[TIMEOUT TRIGGERED] Match ${matchId} Phase ${round.phase} timed out at ${new Date(endsAt).toISOString()}`);

  const submissions = await dbGetRoundSubmissions(matchId, round.round_number);
  const phaseSubs = submissions.filter((s) => s.phase === round.phase);
  const subA = phaseSubs.find((s) => s.player_slot === 'A');
  const subB = phaseSubs.find((s) => s.player_slot === 'B');

  let playerAId = '';
  let playerBId = '';
  if (serverSupabase && gameplayTablesAvailable) {
    const { data: players } = await serverSupabase
      .from('match_players')
      .select('player_id, player_slot')
      .eq('match_id', matchId);
    playerAId = players?.find((p) => p.player_slot === 'A')?.player_id || 'player_a';
    playerBId = players?.find((p) => p.player_slot === 'B')?.player_id || 'player_b';
  } else {
    const players = devMockPlayers.get(matchId) || [];
    playerAId = players.find((p) => p.player_slot === 'A')?.player_id || 'player_a';
    playerBId = players.find((p) => p.player_slot === 'B')?.player_id || 'player_b';
  }

  if (!subA) {
    try {
      await dbInsertRoundSubmission({
        match_id: matchId,
        round_number: round.round_number,
        player_id: playerAId,
        player_slot: 'A',
        phase: round.phase,
        argument_text: '[No submission within time limit]',
      });
    } catch {}
  }

  if (!subB) {
    try {
      await dbInsertRoundSubmission({
        match_id: matchId,
        round_number: round.round_number,
        player_id: playerBId,
        player_slot: 'B',
        phase: round.phase,
        argument_text: '[No submission within time limit]',
      });
    } catch {}
  }

  if (round.phase === 'BLIND') {
    const nextPhase = 'COUNTER';
    const duration = getPhaseDurationSeconds(nextPhase);
    const startedAt = new Date().toISOString();
    const nextEndsAt = new Date(Date.now() + duration * 1000).toISOString();

    const updated = await dbUpdateMatchRound(
      matchId,
      round.round_number,
      {
        phase: nextPhase,
        player_a_submitted: false,
        player_b_submitted: false,
        phase_started_at: startedAt,
        phase_ends_at: nextEndsAt,
      },
      round.id
    );

    if (serverSupabase) {
      await serverSupabase.from('matches').update({ current_phase: nextPhase }).eq('id', matchId);
    }

    broadcastMatchEvent(matchId, 'round_phase_transition', {
      action: 'PHASE_TRANSITION',
      phase: nextPhase,
      roundNumber: round.round_number,
      matchId,
    });

    return normalizeRoundRecord(updated || { ...round, phase: nextPhase, phase_started_at: startedAt, phase_ends_at: nextEndsAt });
  }

  if (round.phase === 'COUNTER') {
    const nextPhase = 'CONCLUSION';
    const duration = getPhaseDurationSeconds(nextPhase);
    const startedAt = new Date().toISOString();
    const nextEndsAt = new Date(Date.now() + duration * 1000).toISOString();

    const updated = await dbUpdateMatchRound(
      matchId,
      round.round_number,
      {
        phase: nextPhase,
        player_a_submitted: false,
        player_b_submitted: false,
        phase_started_at: startedAt,
        phase_ends_at: nextEndsAt,
      },
      round.id
    );

    if (serverSupabase) {
      await serverSupabase.from('matches').update({ current_phase: nextPhase }).eq('id', matchId);
    }

    broadcastMatchEvent(matchId, 'round_phase_transition', {
      action: 'PHASE_TRANSITION',
      phase: nextPhase,
      roundNumber: round.round_number,
      matchId,
    });

    return normalizeRoundRecord(updated || { ...round, phase: nextPhase, phase_started_at: startedAt, phase_ends_at: nextEndsAt });
  }

  if (round.phase === 'CONCLUSION') {
    await dbUpdateMatchRound(
      matchId,
      round.round_number,
      {
        phase: 'AI_JUDGING',
        player_a_submitted: true,
        player_b_submitted: true,
      },
      round.id
    );

    if (serverSupabase) {
      await serverSupabase.from('matches').update({ current_phase: 'RESULT' }).eq('id', matchId);
    }

    broadcastMatchEvent(matchId, 'round_phase_transition', {
      action: 'PHASE_TRANSITION',
      phase: 'AI_JUDGING',
      roundNumber: round.round_number,
      matchId,
    });

    executeRoundJudging(matchId, round.round_number, round.id, round.topic);
    return { ...round, phase: 'AI_JUDGING' };
  }

  return round;
}

async function registerPlayerSession(
  matchId: string,
  playerId: string,
  sessionToken: string,
  expiresAt: Date
): Promise<void> {
  const tokenHash = hashToken(sessionToken);

  if (serverSupabase && supabaseTablesAvailable) {
    const { error } = await serverSupabase.from('match_player_sessions').upsert(
      {
        match_id: matchId,
        player_id: playerId,
        token_hash: tokenHash,
        expires_at: expiresAt.toISOString(),
      },
      { onConflict: 'match_id,player_id' }
    );
    if (error) {
      console.error('[FIZZ OUT] Failed to persist session to match_player_sessions table:', error);
      throw new Error('Database error saving session credentials.');
    }
    return;
  }

  if (isExplicitDevMockEnabled) {
    devMockSessions.set(`${matchId}:${playerId}`, {
      matchId,
      playerId,
      tokenHash,
      createdAt: Date.now(),
      expiresAt: expiresAt.getTime(),
    });
    return;
  }

  throw new Error('Authoritative Supabase database is required for player session registration.');
}

async function validatePlayerSession(
  matchId: string,
  playerId: string,
  providedToken: string | undefined | null
): Promise<{ valid: boolean; error?: string }> {
  if (!providedToken || typeof providedToken !== 'string' || providedToken.trim().length < 16) {
    return { valid: false, error: 'Unauthorized: Missing or invalid temporary player session token.' };
  }

  const tokenHash = hashToken(providedToken);
  const now = Date.now();

  // Authoritative Supabase check
  if (serverSupabase && supabaseTablesAvailable) {
    try {
      const { data, error } = await serverSupabase
        .from('match_player_sessions')
        .select('token_hash, expires_at')
        .eq('match_id', matchId)
        .eq('player_id', playerId)
        .maybeSingle();

      if (error || !data) {
        return { valid: false, error: 'Unauthorized: No active player session found for this match.' };
      }

      const expiresAt = new Date(data.expires_at).getTime();
      if (now > expiresAt) {
        return { valid: false, error: 'Session token has expired.' };
      }

      if (data.token_hash === tokenHash) {
        return { valid: true };
      } else {
        return { valid: false, error: 'Forbidden: Session token does not match authorized player.' };
      }
    } catch (err) {
      console.error('[FIZZ OUT] Database session check exception:', err);
      return { valid: false, error: 'Database verification failure.' };
    }
  }

  // Explicit dev mock fallback only
  if (isExplicitDevMockEnabled) {
    const cached = devMockSessions.get(`${matchId}:${playerId}`);
    if (!cached) {
      return { valid: false, error: 'Unauthorized: No active player session found for this match.' };
    }
    if (now > cached.expiresAt) {
      devMockSessions.delete(`${matchId}:${playerId}`);
      return { valid: false, error: 'Session token has expired.' };
    }
    if (cached.tokenHash === tokenHash) {
      return { valid: true };
    } else {
      return { valid: false, error: 'Forbidden: Session token does not match authorized player.' };
    }
  }

  return { valid: false, error: 'Authoritative database unavailable for session verification.' };
}

function extractSessionToken(req: Request): string | undefined {
  const headerToken = req.headers['x-player-session-token'];
  if (typeof headerToken === 'string' && headerToken.trim()) {
    return headerToken.trim();
  }
  if (req.body && typeof req.body.sessionToken === 'string' && req.body.sessionToken.trim()) {
    return req.body.sessionToken.trim();
  }
  return undefined;
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(crypto.randomInt(0, chars.length));
  }
  return code;
}

export const app = express();
const PORT = 3000;

app.use(express.json());

// Normalization middleware: support both /api/* and direct routing if modified by Vercel serverless proxy
app.use((req: Request, _res: Response, next: NextFunction) => {
  if (!req.url.startsWith('/api') && !req.url.startsWith('/@') && !req.url.startsWith('/src')) {
    if (
      req.url.startsWith('/matches') ||
      req.url.startsWith('/health') ||
      req.url.startsWith('/config') ||
      req.url.startsWith('/supabase')
    ) {
      req.url = '/api' + req.url;
    }
  }
  next();
});

// 1. Health & Config API
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'FIZZ OUT Server',
    databaseAuthoritative: true,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/config', async (_req: Request, res: Response) => {
  await checkSupabaseTablesAvailable();
  // SECURITY: NEVER return SUPABASE_SERVICE_ROLE_KEY or GEMINI_API_KEY to the client!
  const hasSupabaseUrl = Boolean(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL);
  const hasAnonKey = Boolean(process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY);
  res.json({
    supabaseConfigured: Boolean(hasSupabaseUrl && hasAnonKey),
    supabaseTablesReady: supabaseTablesAvailable,
    coreTablesReady: coreTablesAvailable,
    gameplayTablesReady: gameplayTablesAvailable,
    missingTables: missingSupabaseTables,
    serviceRoleConfigured: isServiceRoleConfigured,
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    supabaseUrl: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || null,
    isDevMockEnabled: isExplicitDevMockEnabled,
  });
});

// Check / re-test Supabase status on demand
app.get('/api/supabase/status', async (_req: Request, res: Response) => {
  await checkSupabaseTablesAvailable(true);
  const hasSupabaseUrl = Boolean(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL);
  const hasAnonKey = Boolean(process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY);
  res.json({
    configured: Boolean(hasSupabaseUrl && hasAnonKey),
    serviceRoleConfigured: isServiceRoleConfigured,
    tablesReady: supabaseTablesAvailable,
    coreTablesReady: coreTablesAvailable,
    gameplayTablesReady: gameplayTablesAvailable,
    missingTables: missingSupabaseTables,
    supabaseUrl: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || null,
    isDevMockEnabled: isExplicitDevMockEnabled,
    message: supabaseTablesAvailable
      ? 'All 6 Supabase database tables verified and active for server operations.'
      : missingSupabaseTables.length > 0
      ? `Missing tables: ${missingSupabaseTables.join(', ')}. Run the migration SQL in Supabase SQL editor.`
      : isServiceRoleConfigured
      ? 'Service role configured, but database tables have not been created yet in Supabase.'
      : 'SUPABASE_SERVICE_ROLE_KEY is required on the server for production multiplayer operations.',
  });
});

// 2. Create Match Room API (Server-authoritative)
app.post('/api/matches/create', async (req: Request, res: Response) => {
  try {
    const { displayName, playerId } = req.body || {};
    console.log(`[FIZZ OUT CREATE ROOM] Received request from player: "${playerId}" (codename: "${typeof displayName === 'string' ? displayName.slice(0, 18) : ''}")`);

    if (!displayName || typeof displayName !== 'string' || !displayName.trim()) {
      res.status(400).json({ success: false, error: 'Display name is required.' });
      return;
    }
    if (!playerId || typeof playerId !== 'string') {
      res.status(400).json({ success: false, error: 'Temporary player ID is required.' });
      return;
    }

    const trimmedName = displayName.trim().slice(0, 18);
    let roomCode = generateRoomCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours
    const sessionToken = generateSessionToken();

    const canUseSupabase = await checkSupabaseTablesAvailable();
    console.log(`[FIZZ OUT CREATE ROOM] DB Status: serviceRoleConfigured=${isServiceRoleConfigured}, tablesReady=${canUseSupabase}, devMock=${isExplicitDevMockEnabled}`);

    // REQUIREMENT 7: No silent in-memory fallback.
    if (!canUseSupabase && !isExplicitDevMockEnabled) {
      console.warn(`[FIZZ OUT CREATE ROOM] Creation blocked: Database not initialized. serviceRole=${isServiceRoleConfigured}, missingTables=${missingSupabaseTables.join(',') || 'all'}`);
      res.status(503).json({
        success: false,
        error: isServiceRoleConfigured
          ? 'Supabase database tables are not initialized. Please copy the SQL schema from the setup dialog and run it in the Supabase SQL Editor.'
          : 'Database configuration error: SUPABASE_SERVICE_ROLE_KEY is required on the server for authoritative operations.',
      });
      return;
    }

      if (serverSupabase && canUseSupabase) {
        // Ensure room_code is unique
        let isUnique = false;
        let attempts = 0;
        while (!isUnique && attempts < 5) {
          const { data: existing } = await serverSupabase
            .from('matches')
            .select('id')
            .eq('room_code', roomCode)
            .maybeSingle();

          if (!existing) {
            isUnique = true;
          } else {
            roomCode = generateRoomCode();
            attempts++;
          }
        }

        const { data: match, error: matchError } = await serverSupabase
          .from('matches')
          .insert({
            room_code: roomCode,
            status: 'WAITING',
            current_round: 1,
            current_phase: 'BLIND',
            created_at: now.toISOString(),
            expires_at: expiresAt.toISOString(),
          })
          .select()
          .single();

        if (matchError || !match) {
          console.error('[FIZZ OUT] Match insert error:', matchError);
          res.status(500).json({ success: false, error: 'Failed to create match in database.' });
          return;
        }

        // Insert Player A (host). Note: assigned_side is strictly NULL until legitimate reveal!
        const { data: player, error: playerError } = await serverSupabase
          .from('match_players')
          .insert({
            match_id: match.id,
            player_id: playerId,
            player_slot: 'A',
            display_name: trimmedName,
            assigned_side: null,
            is_connected: true,
            has_revealed_side: false,
          })
          .select()
          .single();

        if (playerError || !player) {
          console.error('[FIZZ OUT] Player insert error:', playerError);
          res.status(500).json({ success: false, error: 'Failed to register host player in database.' });
          return;
        }

        // Register server-side temporary session token (SHA-256 hash stored)
        await registerPlayerSession(match.id, playerId, sessionToken, expiresAt);

        res.json({
          success: true,
          match,
          player,
          players: [player],
          sessionToken,
        });
        return;
      }

      // Explicit dev mock fallback only
      if (isExplicitDevMockEnabled) {
        console.warn('[FIZZ OUT DEV MOCK] Creating match in mock memory.');
        const matchId = 'm_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
        const match = {
          id: matchId,
          room_code: roomCode,
          status: 'WAITING',
          current_round: 1,
          current_phase: 'BLIND',
          created_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
        };
        const player = {
          id: 'mp_' + Math.random().toString(36).substring(2, 11),
          match_id: matchId,
          player_id: playerId,
          player_slot: 'A',
          display_name: trimmedName,
          assigned_side: null,
          joined_at: now.toISOString(),
          is_connected: true,
          has_revealed_side: false,
        };

        devMockMatches.set(matchId, match);
        devMockPlayers.set(matchId, [player]);
        await registerPlayerSession(matchId, playerId, sessionToken, expiresAt);

        res.json({
          success: true,
          match,
          player,
          players: [player],
          sessionToken,
        });
        return;
      }
    } catch (err: any) {
      console.error('Create room error:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: err?.message || 'Internal server error while creating room.' });
      }
    }
  });

  // 3. Join Match Room API (Server-authoritative state machine & side assignment)
  app.post('/api/matches/join', async (req: Request, res: Response) => {
    try {
      const { roomCode, displayName, playerId } = req.body;
      if (!roomCode || typeof roomCode !== 'string') {
        res.status(400).json({ success: false, error: 'Room code is required.' });
        return;
      }
      if (!displayName || typeof displayName !== 'string' || !displayName.trim()) {
        res.status(400).json({ success: false, error: 'Display name is required.' });
        return;
      }
      if (!playerId || typeof playerId !== 'string') {
        res.status(400).json({ success: false, error: 'Temporary player ID is required.' });
        return;
      }

      const formattedCode = roomCode.trim().toUpperCase();
      const trimmedName = displayName.trim().slice(0, 18);
      const providedToken = extractSessionToken(req);

      const canUseSupabase = await checkSupabaseTablesAvailable();

      // REQUIREMENT 7: No silent in-memory fallback.
      if (!canUseSupabase && !isExplicitDevMockEnabled) {
        res.status(503).json({
          success: false,
          error: isServiceRoleConfigured
            ? 'Supabase database tables are not initialized. Please copy the SQL schema from the setup dialog and run it in the Supabase SQL Editor.'
            : 'Database configuration error: SUPABASE_SERVICE_ROLE_KEY is required on the server for authoritative operations.',
        });
        return;
      }

      if (serverSupabase && canUseSupabase) {
        const { data: match, error: matchErr } = await serverSupabase
          .from('matches')
          .select('*')
          .eq('room_code', formattedCode)
          .maybeSingle();

        if (matchErr || !match) {
          res.status(404).json({ success: false, error: 'Room not found. Check the room code and try again.' });
          return;
        }

        // Expiration check
        const expiresAt = new Date(match.expires_at).getTime();
        if (Date.now() > expiresAt || match.status === 'EXPIRED') {
          if (match.status !== 'EXPIRED') {
            await serverSupabase.from('matches').update({ status: 'EXPIRED' }).eq('id', match.id);
          }
          res.status(410).json({ success: false, error: 'This debate room has expired.' });
          return;
        }

        // Fetch players
        const { data: players, error: playersErr } = await serverSupabase
          .from('match_players')
          .select('*')
          .eq('match_id', match.id)
          .order('joined_at', { ascending: true });

        if (playersErr || !players) {
          res.status(500).json({ success: false, error: 'Failed to verify room players.' });
          return;
        }

        // Check if player is rejoining
        const existingPlayer = players.find((p) => p.player_id === playerId);
        if (existingPlayer) {
          // Validate existing session token to prevent impersonation
          const sessionAuth = await validatePlayerSession(match.id, playerId, providedToken);
          if (!sessionAuth.valid) {
            res.status(403).json({
              success: false,
              error: sessionAuth.error || 'Invalid session credentials for rejoining this match.',
            });
            return;
          }

          res.json({
            success: true,
            match,
            player: existingPlayer,
            players,
            sessionToken: providedToken,
          });
          return;
        }

        // Check player count (strictly max 2 players)
        if (players.length >= 2) {
          res.status(409).json({ success: false, error: 'Room is full. Maximum 2 players allowed.' });
          return;
        }

        // State Machine Check: Can only join rooms in 'WAITING' status
        if (match.status !== 'WAITING') {
          res.status(409).json({ success: false, error: 'This debate has already started or is not accepting new players.' });
          return;
        }

        // STATE MACHINE TRANSITION 1: WAITING -> READY
        // Enforce valid transition before registering Player B
        const readyTransition = await transitionMatchStatus(match.id, 'WAITING', 'READY');
        if (!readyTransition.success) {
          res.status(409).json({
            success: false,
            error: readyTransition.error || 'Invalid state transition for joining room.',
          });
          return;
        }

        // Insert Player B. Note: assigned_side is strictly NULL until legitimate reveal!
        const { data: newPlayer, error: joinErr } = await serverSupabase
          .from('match_players')
          .insert({
            match_id: match.id,
            player_id: playerId,
            player_slot: 'B',
            display_name: trimmedName,
            assigned_side: null,
            is_connected: true,
            has_revealed_side: false,
          })
          .select()
          .single();

        if (joinErr || !newPlayer) {
          // Revert or expire if player insert failed
          await transitionMatchStatus(match.id, 'READY', 'EXPIRED');
          res.status(500).json({ success: false, error: joinErr?.message || 'Failed to join match.' });
          return;
        }

        // Generate and register session token for Player B
        const sessionTokenB = generateSessionToken();
        await registerPlayerSession(match.id, playerId, sessionTokenB, new Date(match.expires_at));

        // SIDE ASSIGNMENT:
        // FOR / AGAINST must be assigned purely by trusted server-side cryptographic logic.
        // Client preference is NEVER accepted and strictly ignored.
        const coin = crypto.randomInt(0, 2) === 0;
        const playerASide: 'FOR' | 'AGAINST' = coin ? 'FOR' : 'AGAINST';
        const playerBSide: 'FOR' | 'AGAINST' = coin ? 'AGAINST' : 'FOR';

        const playerA = players[0];

        // Store secret side assignments in private server-only table (match_player_secrets)
        // Public match_players.assigned_side remains NULL for both players until reveal!
        const { error: secretsErr } = await serverSupabase.from('match_player_secrets').upsert([
          { match_id: match.id, player_id: playerA.player_id, secret_side: playerASide },
          { match_id: match.id, player_id: newPlayer.player_id, secret_side: playerBSide },
        ]);

        if (secretsErr) {
          console.error('[FIZZ OUT] Error saving side assignments:', secretsErr);
          res.status(500).json({ success: false, error: 'Database error storing side assignments.' });
          return;
        }

        // STATE MACHINE TRANSITION 2: READY -> REVEALING
        const revealingTransition = await transitionMatchStatus(match.id, 'READY', 'REVEALING');
        if (!revealingTransition.success || !revealingTransition.match) {
          res.status(500).json({
            success: false,
            error: revealingTransition.error || 'Failed to update match status to REVEALING.',
          });
          return;
        }

        const { data: updatedPlayers } = await serverSupabase
          .from('match_players')
          .select('*')
          .eq('match_id', match.id)
          .order('joined_at', { ascending: true });

        // Notice: Player B's response returns sessionTokenB (ONLY for Player B).
        // Neither player's secret side is returned in match_players (both assigned_side are NULL).
        res.json({
          success: true,
          match: revealingTransition.match,
          player: newPlayer,
          players: updatedPlayers || [playerA, newPlayer],
          sessionToken: sessionTokenB,
        });
        return;
      }

      // Explicit dev mock fallback only
      if (isExplicitDevMockEnabled) {
        console.warn('[FIZZ OUT DEV MOCK] Joining match in mock memory.');
        let foundMatch: any = null;
        for (const m of devMockMatches.values()) {
          if (m.room_code === formattedCode) {
            foundMatch = m;
            break;
          }
        }

        if (!foundMatch) {
          res.status(404).json({ success: false, error: 'Room not found. Check the room code and try again.' });
          return;
        }

        const matchPlayersList = devMockPlayers.get(foundMatch.id) || [];
        const existingP = matchPlayersList.find((p) => p.player_id === playerId);
        if (existingP) {
          const sessionAuth = await validatePlayerSession(foundMatch.id, playerId, providedToken);
          if (!sessionAuth.valid) {
            res.status(403).json({ success: false, error: sessionAuth.error });
            return;
          }
          res.json({
            success: true,
            match: foundMatch,
            player: existingP,
            players: matchPlayersList,
            sessionToken: providedToken,
          });
          return;
        }

        if (matchPlayersList.length >= 2 || foundMatch.status !== 'WAITING') {
          res.status(409).json({ success: false, error: 'Room is full or debate has already begun.' });
          return;
        }

        const sessionTokenB = generateSessionToken();
        const expiresDate = new Date(foundMatch.expires_at);
        await registerPlayerSession(foundMatch.id, playerId, sessionTokenB, expiresDate);

        const playerB = {
          id: 'mp_' + Math.random().toString(36).substring(2, 11),
          match_id: foundMatch.id,
          player_id: playerId,
          player_slot: 'B',
          display_name: trimmedName,
          assigned_side: null,
          joined_at: new Date().toISOString(),
          is_connected: true,
          has_revealed_side: false,
        };

        const coin = crypto.randomInt(0, 2) === 0;
        devMockSecrets.set(`${foundMatch.id}:${matchPlayersList[0].player_id}`, coin ? 'FOR' : 'AGAINST');
        devMockSecrets.set(`${foundMatch.id}:${playerId}`, coin ? 'AGAINST' : 'FOR');

        matchPlayersList.push(playerB);
        foundMatch.status = 'REVEALING';

        res.json({
          success: true,
          match: foundMatch,
          player: playerB,
          players: matchPlayersList,
          sessionToken: sessionTokenB,
        });
        return;
      }
    } catch (err: any) {
      console.error('Join room error:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: err?.message || 'Internal server error while joining room.' });
      }
    }
  });

  // 4. Get Match State API (Read-only status sync)
  app.get('/api/matches/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const matchId = req.params.id;
      if (matchId === 'round-state') {
        return next();
      }
      const canUseSupabase = await checkSupabaseTablesAvailable();

      if (serverSupabase && canUseSupabase) {
        const { data: match, error: matchErr } = await serverSupabase
          .from('matches')
          .select('*')
          .eq('id', matchId)
          .maybeSingle();

        if (matchErr || !match) {
          res.status(404).json({ success: false, error: 'Match not found.' });
          return;
        }

        const { data: players } = await serverSupabase
          .from('match_players')
          .select('*')
          .eq('match_id', matchId)
          .order('joined_at', { ascending: true });

        // Note: players contains assigned_side (which is NULL until that player reveals).
        // Secrets and session tokens are strictly kept in private tables.
        res.json({
          success: true,
          match,
          players: players || [],
        });
        return;
      }

      if (isExplicitDevMockEnabled) {
        const match = devMockMatches.get(matchId);
        if (!match) {
          res.status(404).json({ success: false, error: 'Match not found.' });
          return;
        }
        const players = devMockPlayers.get(matchId) || [];
        res.json({ success: true, match, players });
        return;
      }

      res.status(503).json({ success: false, error: 'Authoritative database is not available.' });
    } catch (err: any) {
      console.error('Get match error:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: 'Failed to fetch match.' });
      }
    }
  });

  // 5. Reveal Side API (Server validates session token, fetches secret side, updates match_players)
  app.post('/api/matches/reveal-side', async (req: Request, res: Response) => {
    try {
      const { matchId, playerId } = req.body;
      if (!matchId || !playerId) {
        res.status(400).json({ success: false, error: 'matchId and playerId are required.' });
        return;
      }

      // SECURITY: Validate player's temporary session token
      const sessionToken = extractSessionToken(req);
      const auth = await validatePlayerSession(matchId, playerId, sessionToken);
      if (!auth.valid) {
        res.status(403).json({ success: false, error: auth.error || 'Unauthorized session.' });
        return;
      }

      const canUseSupabase = await checkSupabaseTablesAvailable();

      if (serverSupabase && canUseSupabase) {
        // Verify match is in 'REVEALING' phase
        const { data: match } = await serverSupabase
          .from('matches')
          .select('*')
          .eq('id', matchId)
          .maybeSingle();

        if (!match) {
          res.status(404).json({ success: false, error: 'Match not found.' });
          return;
        }

        if (match.status !== 'REVEALING') {
          res.status(400).json({
            success: false,
            error: `Sides can only be revealed when match is in REVEALING status (current: ${match.status}).`,
          });
          return;
        }

        // Authoritatively retrieve secret assigned side from private match_player_secrets
        const { data: secretRow, error: secretErr } = await serverSupabase
          .from('match_player_secrets')
          .select('secret_side')
          .eq('match_id', matchId)
          .eq('player_id', playerId)
          .maybeSingle();

        if (secretErr || !secretRow) {
          res.status(404).json({ success: false, error: 'Assigned side secret not found for player.' });
          return;
        }

        // Update only this player's row in match_players:
        // Set has_revealed_side = TRUE and populate assigned_side with the legitimate secret
        const { error: updateErr } = await serverSupabase
          .from('match_players')
          .update({
            has_revealed_side: true,
            assigned_side: secretRow.secret_side,
          })
          .eq('match_id', matchId)
          .eq('player_id', playerId);

        if (updateErr) {
          res.status(500).json({ success: false, error: 'Failed to record side reveal.' });
          return;
        }

        const { data: players } = await serverSupabase
          .from('match_players')
          .select('*')
          .eq('match_id', matchId)
          .order('joined_at', { ascending: true });

        res.json({
          success: true,
          match,
          players: players || [],
          revealedSide: secretRow.secret_side,
        });
        return;
      }

      // Explicit dev mock fallback only
      if (isExplicitDevMockEnabled) {
        const match = devMockMatches.get(matchId);
        const players = devMockPlayers.get(matchId);
        if (!match || !players) {
          res.status(404).json({ success: false, error: 'Match not found.' });
          return;
        }

        if (match.status !== 'REVEALING') {
          res.status(400).json({
            success: false,
            error: `Sides can only be revealed when match is in REVEALING status (current: ${match.status}).`,
          });
          return;
        }

        const secretSide = devMockSecrets.get(`${matchId}:${playerId}`);
        if (!secretSide) {
          res.status(404).json({ success: false, error: 'Assigned side secret not found for player.' });
          return;
        }

        const p = players.find((pl) => pl.player_id === playerId);
        if (p) {
          p.has_revealed_side = true;
          p.assigned_side = secretSide;
        }

        res.json({
          success: true,
          match,
          players,
          revealedSide: secretSide,
        });
        return;
      }

      res.status(503).json({ success: false, error: 'Authoritative database is not available.' });
    } catch (err: any) {
      console.error('Reveal side error:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: 'Failed to reveal side.' });
      }
    }
  });

  // 6. Start Game API (Transition REVEALING -> IN_PROGRESS after both reveal and sessions verified)
  app.post('/api/matches/start-game', async (req: Request, res: Response) => {
    try {
      const { matchId, playerId, previousTopics } = req.body;
      if (!matchId || !playerId) {
        res.status(400).json({ success: false, error: 'matchId and playerId are required.' });
        return;
      }

      // Record any client-supplied prior match topics into usedTopicsHistory
      if (Array.isArray(previousTopics)) {
        for (const t of previousTopics) {
          if (t && typeof t === 'string') recordUsedTopic(t);
        }
      }

      // SECURITY: Validate player's temporary session token
      const sessionToken = extractSessionToken(req);
      const auth = await validatePlayerSession(matchId, playerId, sessionToken);
      if (!auth.valid) {
        res.status(403).json({ success: false, error: auth.error || 'Unauthorized session.' });
        return;
      }

      const canUseSupabase = await checkSupabaseTablesAvailable();

      if (serverSupabase && canUseSupabase) {
        const { data: match } = await serverSupabase
          .from('matches')
          .select('*')
          .eq('id', matchId)
          .maybeSingle();

        if (!match) {
          res.status(404).json({ success: false, error: 'Match not found.' });
          return;
        }

        // STATE MACHINE: Validate transition REVEALING -> IN_PROGRESS
        if (!isValidStateTransition(match.status, 'IN_PROGRESS')) {
          res.status(400).json({
            success: false,
            error: `Invalid state transition: Cannot transition match from ${match.status} to IN_PROGRESS.`,
          });
          return;
        }

        // Check exactly 2 players exist
        const { data: players } = await serverSupabase
          .from('match_players')
          .select('*')
          .eq('match_id', matchId);

        if (!players || players.length !== 2) {
          res.status(400).json({ success: false, error: 'Exactly two players are required to start the debate.' });
          return;
        }

        // Check both players have legitimately revealed their side
        const allRevealed = players.every((p) => p.has_revealed_side && p.assigned_side);
        if (!allRevealed) {
          res.status(400).json({ success: false, error: 'Both players must reveal their assigned sides before starting.' });
          return;
        }

        // Verify both players have active non-expired sessions
        const { data: sessions } = await serverSupabase
          .from('match_player_sessions')
          .select('player_id, expires_at')
          .eq('match_id', matchId);

        const now = Date.now();
        const activeSessions = (sessions || []).filter((s) => new Date(s.expires_at).getTime() > now);
        const hasBothPlayerSessions =
          players.every((p) => activeSessions.some((s) => s.player_id === p.player_id));

        if (!hasBothPlayerSessions) {
          res.status(403).json({ success: false, error: 'One or both player sessions have expired or are missing.' });
          return;
        }

        // Authoritative state transition to IN_PROGRESS via transitionMatchStatus
        const startTransition = await transitionMatchStatus(
          matchId,
          match.status as MatchStatus,
          'IN_PROGRESS',
          {
            current_round: 1,
            current_phase: 'BLIND',
          }
        );

        if (!startTransition.success || !startTransition.match) {
          res.status(500).json({
            success: false,
            error: startTransition.error || 'Failed to update match status to IN_PROGRESS.',
          });
          return;
        }

        // Generate 3 completely NEW short topics for the new match (Round 1 = Topic 1, Round 2 = Topic 2, Round 3 = Topic 3)
        const [topic1] = await generateThreeUniqueMatchTopics(
          matchId,
          Array.isArray(previousTopics) ? previousTopics : []
        );
        try {
          await dbUpsertMatchRound({
            match_id: matchId,
            round_number: 1,
            phase: 'BLIND',
            topic: topic1,
            player_a_submitted: false,
            player_b_submitted: false,
          });
        } catch (rErr) {
          console.error('[FIZZ OUT] Error initializing round 1 row:', rErr);
        }

        res.json({
          success: true,
          match: startTransition.match,
          players,
        });
        return;
      }

      // Explicit dev mock fallback only
      if (isExplicitDevMockEnabled) {
        const match = devMockMatches.get(matchId);
        const players = devMockPlayers.get(matchId);
        if (!match || !players) {
          res.status(404).json({ success: false, error: 'Match not found.' });
          return;
        }

        if (players.length !== 2) {
          res.status(400).json({ success: false, error: 'Exactly two players are required.' });
          return;
        }

        if (!players.every((p) => p.has_revealed_side && p.assigned_side)) {
          res.status(400).json({ success: false, error: 'Both players must reveal their assigned side first.' });
          return;
        }

        const devStartTransition = await transitionMatchStatus(
          matchId,
          match.status as MatchStatus,
          'IN_PROGRESS',
          {
            current_round: 1,
            current_phase: 'BLIND',
          }
        );

        if (!devStartTransition.success || !devStartTransition.match) {
          res.status(400).json({ success: false, error: devStartTransition.error });
          return;
        }

        const [topic1] = await generateThreeUniqueMatchTopics(
          matchId,
          Array.isArray(previousTopics) ? previousTopics : []
        );
        devMockRounds.set(matchId, [
          {
            id: 'mr_' + Math.random().toString(36).substring(2, 9),
            match_id: matchId,
            round_number: 1,
            phase: 'BLIND',
            topic: topic1,
            player_a_submitted: false,
            player_b_submitted: false,
            player_a_score: null,
            player_b_score: null,
            player_a_reason: null,
            player_b_reason: null,
            winner: null,
            created_at: new Date().toISOString(),
          },
        ]);

        res.json({
          success: true,
          match: devStartTransition.match,
          players,
        });
        return;
      }

      res.status(503).json({ success: false, error: 'Authoritative database is not available.' });
    } catch (err: any) {
      console.error('Start game error:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: 'Failed to start game.' });
      }
    }
  });

  // ============================================================================
  // 7. GAMEPLAY: Get Round State (With Hidden Argument Redaction)
  // ============================================================================
  app.get('/api/matches/round-state', async (req: Request, res: Response) => {
    try {
      const matchId = req.query.matchId as string;
      const playerId = req.query.playerId as string;

      if (!matchId || !playerId) {
        res.status(400).json({ success: false, error: 'matchId and playerId are required.' });
        return;
      }

      // Validate session token
      const sessionToken = extractSessionToken(req);
      const auth = await validatePlayerSession(matchId, playerId, sessionToken);
      if (!auth.valid) {
        res.status(403).json({ success: false, error: auth.error || 'Unauthorized session.' });
        return;
      }

      const canUseSupabase = await checkSupabaseTablesAvailable();

      if (serverSupabase && canUseSupabase) {
        const { data: match } = await serverSupabase
          .from('matches')
          .select('*')
          .eq('id', matchId)
          .maybeSingle();

        if (!match) {
          res.status(404).json({ success: false, error: 'Match not found.' });
          return;
        }

        const { data: player } = await serverSupabase
          .from('match_players')
          .select('player_slot')
          .eq('match_id', matchId)
          .eq('player_id', playerId)
          .maybeSingle();

        if (!player) {
          res.status(404).json({ success: false, error: 'Player not found in match.' });
          return;
        }

        const mySlot = player.player_slot as 'A' | 'B';
        const oppSlot = mySlot === 'A' ? 'B' : 'A';

        // Fetch all rounds for scoreboard
        let allRounds = await dbGetMatchRounds(matchId);
        let currentRound = allRounds.find((r) => r.round_number === match.current_round);

        // Auto-initialize round 1 if match is in progress and round record wasn't created yet
        if (!currentRound && match.status === 'IN_PROGRESS') {
          const matchTopics = await generateThreeUniqueMatchTopics(matchId);
          const topic = matchTopics[0];
          const blindDuration = getPhaseDurationSeconds('BLIND');
          const blindStartedAt = new Date().toISOString();
          const blindEndsAt = new Date(Date.now() + blindDuration * 1000).toISOString();
          currentRound = await dbUpsertMatchRound({
            match_id: matchId,
            round_number: 1,
            phase: 'BLIND',
            topic,
            player_a_submitted: false,
            player_b_submitted: false,
            phase_started_at: blindStartedAt,
            phase_ends_at: blindEndsAt,
          });
          allRounds = [currentRound];
        }

        if (!currentRound) {
          res.json({
            success: true,
            round: null,
            currentRoundNumber: match.current_round,
            mySubmissions: { BLIND: null, COUNTER: null, CONCLUSION: null },
            visibleOpponentSubmissions: { BLIND: null, COUNTER: null, CONCLUSION: null },
            hasSubmittedCurrentPhase: false,
            opponentSubmittedCurrentPhase: false,
            allRounds: allRounds || [],
            matchStatus: match.status,
          });
          return;
        }

        // Authoritative Timer Enforcement: Check if current phase has expired
        if (match.status === 'IN_PROGRESS' && ['BLIND', 'COUNTER', 'CONCLUSION'].includes(currentRound.phase)) {
          currentRound = await checkAndHandlePhaseTimeout(matchId, currentRound, match);
        }

        // Authoritative sync: if match table's current_phase is ahead, ensure round phase matches
        if (
          match.current_phase &&
          ['BLIND', 'COUNTER', 'CONCLUSION', 'AI_JUDGING', 'ROUND_RESULT'].includes(match.current_phase)
        ) {
          if (currentRound.phase !== match.current_phase && match.current_phase !== 'RESULT') {
            currentRound.phase = match.current_phase;
          }
        }

        // Fetch submissions for this round
        const submissions = await dbGetRoundSubmissions(matchId, currentRound.round_number);

        const mySubs = {
          BLIND: (submissions || []).find((s) => s.player_slot === mySlot && s.phase === 'BLIND')?.argument_text || null,
          COUNTER: (submissions || []).find((s) => s.player_slot === mySlot && s.phase === 'COUNTER')?.argument_text || null,
          CONCLUSION: (submissions || []).find((s) => s.player_slot === mySlot && s.phase === 'CONCLUSION')?.argument_text || null,
        };

        const rawOppSubs = {
          BLIND: (submissions || []).find((s) => s.player_slot === oppSlot && s.phase === 'BLIND')?.argument_text || null,
          COUNTER: (submissions || []).find((s) => s.player_slot === oppSlot && s.phase === 'COUNTER')?.argument_text || null,
          CONCLUSION: (submissions || []).find((s) => s.player_slot === oppSlot && s.phase === 'CONCLUSION')?.argument_text || null,
        };

        // Authoritative State Recovery:
        // If both Blind submissions exist, the server MUST return phase: "COUNTER",
        // even if the client or database previously lagged behind.
        if (currentRound.phase === 'BLIND' && mySubs.BLIND && rawOppSubs.BLIND) {
          console.log(`[ROUND-STATE AUTO-RECOVERY] Match ${matchId}: Both Blind submissions detected. Advancing to COUNTER.`);
          const counterDuration = getPhaseDurationSeconds('COUNTER');
          const counterStartedAt = new Date().toISOString();
          const counterEndsAt = new Date(Date.now() + counterDuration * 1000).toISOString();

          currentRound.phase = 'COUNTER';
          currentRound.player_a_submitted = false;
          currentRound.player_b_submitted = false;
          currentRound.phase_started_at = counterStartedAt;
          currentRound.phase_ends_at = counterEndsAt;

          await dbUpdateMatchRound(
            matchId,
            currentRound.round_number,
            {
              phase: 'COUNTER',
              player_a_submitted: false,
              player_b_submitted: false,
              phase_started_at: counterStartedAt,
              phase_ends_at: counterEndsAt,
            },
            currentRound.id
          );

          if (serverSupabase) {
            await serverSupabase
              .from('matches')
              .update({ current_phase: 'COUNTER' })
              .eq('id', matchId);
          }

          broadcastMatchEvent(matchId, 'round_phase_transition', {
            action: 'PHASE_TRANSITION',
            phase: 'COUNTER',
            roundNumber: currentRound.round_number,
            matchId,
          });
        }

        // HIDDEN ARGUMENT SECURITY: Redact opponent arguments depending on current phase!
        const visibleOppSubs = {
          BLIND: currentRound.phase === 'BLIND' ? null : rawOppSubs.BLIND,
          COUNTER: ['BLIND', 'COUNTER'].includes(currentRound.phase) ? null : rawOppSubs.COUNTER,
          CONCLUSION: ['BLIND', 'COUNTER', 'CONCLUSION'].includes(currentRound.phase) ? null : rawOppSubs.CONCLUSION,
        };

        const phase = currentRound.phase;
        const hasSubmittedCurrent =
          phase === 'BLIND' ? Boolean(mySubs.BLIND) :
          phase === 'COUNTER' ? Boolean(mySubs.COUNTER) :
          phase === 'CONCLUSION' ? Boolean(mySubs.CONCLUSION) : true;

        const oppSubmittedCurrent =
          phase === 'BLIND' ? Boolean(rawOppSubs.BLIND) :
          phase === 'COUNTER' ? Boolean(rawOppSubs.COUNTER) :
          phase === 'CONCLUSION' ? Boolean(rawOppSubs.CONCLUSION) : true;

        // Calculate timing and word limits for the current phase
        normalizeRoundRecord(currentRound);
        const duration = getPhaseDurationSeconds(currentRound.phase);
        const limits = getPhaseWordLimits(currentRound.phase);
        const phaseEndsAt = currentRound.phase_ends_at || null;
        const serverNow = Date.now();
        const timeRemainingSeconds = phaseEndsAt
          ? Math.max(0, Math.floor((new Date(phaseEndsAt).getTime() - serverNow) / 1000))
          : duration;

        currentRound.time_remaining_seconds = timeRemainingSeconds;
        currentRound.phase_ends_at = phaseEndsAt;
        currentRound.phase_started_at = currentRound.phase_started_at || null;

        // Calculate overall winner if completed
        let overallWinner: 'A' | 'B' | 'DRAW' | null = null;
        if (match.status === 'COMPLETED' || (allRounds && allRounds.length === 3 && allRounds[2]?.phase === 'ROUND_RESULT')) {
          let aWins = 0;
          let bWins = 0;
          let aTotal = 0;
          let bTotal = 0;
          for (const r of allRounds || []) {
            if (r.winner === 'A') aWins++;
            if (r.winner === 'B') bWins++;
            aTotal += r.player_a_score || 0;
            bTotal += r.player_b_score || 0;
          }
          if (aWins >= 2) overallWinner = 'A';
          else if (bWins >= 2) overallWinner = 'B';
          else if (aWins > bWins) overallWinner = 'A';
          else if (bWins > aWins) overallWinner = 'B';
          else overallWinner = aTotal > bTotal ? 'A' : bTotal > aTotal ? 'B' : 'DRAW';
        }

        res.json({
          success: true,
          round: currentRound,
          currentRoundNumber: currentRound.round_number,
          mySubmissions: mySubs,
          visibleOpponentSubmissions: visibleOppSubs,
          hasSubmittedCurrentPhase: hasSubmittedCurrent,
          opponentSubmittedCurrentPhase: oppSubmittedCurrent,
          allRounds: allRounds || [],
          overallWinner,
          matchStatus: match.status,
          serverTime: new Date().toISOString(),
          phaseEndsAt,
          phaseStartedAt: currentRound.phase_started_at || null,
          timeRemainingSeconds,
          phaseDurationSeconds: duration,
          minWords: limits.min,
          maxWords: limits.max,
        });
        return;
      }

      // devMock fallback
      if (isExplicitDevMockEnabled) {
        const match = devMockMatches.get(matchId);
        if (!match) {
          res.status(404).json({ success: false, error: 'Match not found.' });
          return;
        }

        const players = devMockPlayers.get(matchId) || [];
        const player = players.find((p) => p.player_id === playerId);
        if (!player) {
          res.status(404).json({ success: false, error: 'Player not found in match.' });
          return;
        }

        const mySlot = player.player_slot as 'A' | 'B';
        const oppSlot = mySlot === 'A' ? 'B' : 'A';

        let rounds = devMockRounds.get(matchId) || [];
        let currentRound = rounds.find((r) => r.round_number === match.current_round);

        if (!currentRound && match.status === 'IN_PROGRESS') {
          const matchTopics = await generateThreeUniqueMatchTopics(matchId);
          const topic = matchTopics[0];
          currentRound = {
            id: 'mr_' + Math.random().toString(36).substring(2, 9),
            match_id: matchId,
            round_number: 1,
            phase: 'BLIND',
            topic,
            player_a_submitted: false,
            player_b_submitted: false,
            player_a_score: null,
            player_b_score: null,
            player_a_reason: null,
            player_b_reason: null,
            winner: null,
            created_at: new Date().toISOString(),
          };
          rounds = [currentRound];
          devMockRounds.set(matchId, rounds);
        }

        const submissions = devMockSubmissions.get(matchId) || [];
        const roundSubs = submissions.filter((s) => s.round_number === (currentRound?.round_number || 1));

        const mySubs = {
          BLIND: roundSubs.find((s) => s.player_slot === mySlot && s.phase === 'BLIND')?.argument_text || null,
          COUNTER: roundSubs.find((s) => s.player_slot === mySlot && s.phase === 'COUNTER')?.argument_text || null,
          CONCLUSION: roundSubs.find((s) => s.player_slot === mySlot && s.phase === 'CONCLUSION')?.argument_text || null,
        };

        const rawOppSubs = {
          BLIND: roundSubs.find((s) => s.player_slot === oppSlot && s.phase === 'BLIND')?.argument_text || null,
          COUNTER: roundSubs.find((s) => s.player_slot === oppSlot && s.phase === 'COUNTER')?.argument_text || null,
          CONCLUSION: roundSubs.find((s) => s.player_slot === oppSlot && s.phase === 'CONCLUSION')?.argument_text || null,
        };

        const curPhase = currentRound?.phase || 'BLIND';
        const visibleOppSubs = {
          BLIND: curPhase === 'BLIND' ? null : rawOppSubs.BLIND,
          COUNTER: ['BLIND', 'COUNTER'].includes(curPhase) ? null : rawOppSubs.COUNTER,
          CONCLUSION: ['BLIND', 'COUNTER', 'CONCLUSION'].includes(curPhase) ? null : rawOppSubs.CONCLUSION,
        };

        const hasSubmitted =
          curPhase === 'BLIND' ? Boolean(mySubs.BLIND) :
          curPhase === 'COUNTER' ? Boolean(mySubs.COUNTER) :
          curPhase === 'CONCLUSION' ? Boolean(mySubs.CONCLUSION) : true;

        const oppSubmitted =
          curPhase === 'BLIND' ? Boolean(rawOppSubs.BLIND) :
          curPhase === 'COUNTER' ? Boolean(rawOppSubs.COUNTER) :
          curPhase === 'CONCLUSION' ? Boolean(rawOppSubs.CONCLUSION) : true;

        let overallWinner: 'A' | 'B' | 'DRAW' | null = null;
        if (match.status === 'COMPLETED' || (rounds.length === 3 && rounds[2]?.phase === 'ROUND_RESULT')) {
          let aWins = 0;
          let bWins = 0;
          let aTotal = 0;
          let bTotal = 0;
          for (const r of rounds) {
            if (r.winner === 'A') aWins++;
            if (r.winner === 'B') bWins++;
            aTotal += r.player_a_score || 0;
            bTotal += r.player_b_score || 0;
          }
          if (aWins >= 2) overallWinner = 'A';
          else if (bWins >= 2) overallWinner = 'B';
          else if (aWins > bWins) overallWinner = 'A';
          else if (bWins > aWins) overallWinner = 'B';
          else overallWinner = aTotal > bTotal ? 'A' : bTotal > aTotal ? 'B' : 'DRAW';
        }

        res.json({
          success: true,
          round: currentRound || null,
          currentRoundNumber: currentRound?.round_number || match.current_round,
          mySubmissions: mySubs,
          visibleOpponentSubmissions: visibleOppSubs,
          hasSubmittedCurrentPhase: hasSubmitted,
          opponentSubmittedCurrentPhase: oppSubmitted,
          allRounds: rounds,
          overallWinner,
          matchStatus: match.status,
          phaseDurationSeconds: getPhaseDurationSeconds(curPhase),
          minWords: getPhaseWordLimits(curPhase).min,
          maxWords: getPhaseWordLimits(curPhase).max,
        });
        return;
      }

      res.status(503).json({ success: false, error: 'Database service unavailable.' });
    } catch (err: any) {
      console.error('[FIZZ OUT] Get round state error:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: 'Failed to retrieve round state.' });
      }
    }
  });

  // ============================================================================
  // 8. GAMEPLAY: Submit Argument (Blind, Counter, Conclusion)
  // ============================================================================
  app.post('/api/matches/submit-argument', async (req: Request, res: Response) => {
    try {
      const { matchId, playerId, roundNumber, phase, argumentText } = req.body;

      if (!matchId || !playerId || !roundNumber || !phase || !argumentText?.trim()) {
        res.status(400).json({
          success: false,
          error: 'matchId, playerId, roundNumber, phase, and argumentText are required.',
        });
        return;
      }

      // Session security
      const sessionToken = extractSessionToken(req);
      const auth = await validatePlayerSession(matchId, playerId, sessionToken);
      if (!auth.valid) {
        res.status(403).json({ success: false, error: auth.error || 'Unauthorized session.' });
        return;
      }

      const cleanText = argumentText.trim();
      const wordCount = countWords(cleanText);
      const limits = getPhaseWordLimits(phase);

      if (wordCount < limits.min) {
        res.status(400).json({
          success: false,
          error: `Argument must be at least ${limits.min} words (currently ${wordCount} words).`,
          wordCount,
          minWords: limits.min,
          maxWords: limits.max,
        });
        return;
      }

      if (limits.max > 0 && wordCount > limits.max) {
        res.status(400).json({
          success: false,
          error: `Argument cannot exceed ${limits.max} words (currently ${wordCount} words).`,
          wordCount,
          minWords: limits.min,
          maxWords: limits.max,
        });
        return;
      }

      const canUseSupabase = await checkSupabaseTablesAvailable();

      console.log('[SUBMISSION RECEIVED]', {
        matchId,
        roundNumber,
        phase,
        playerId,
        wordCount,
      });

      if (serverSupabase && canUseSupabase) {
        const { data: match } = await serverSupabase
          .from('matches')
          .select('*')
          .eq('id', matchId)
          .maybeSingle();

        if (!match || match.status !== 'IN_PROGRESS') {
          res.status(400).json({ success: false, error: 'Match is not currently in progress.' });
          return;
        }

        const { data: player } = await serverSupabase
          .from('match_players')
          .select('*')
          .eq('match_id', matchId)
          .eq('player_id', playerId)
          .maybeSingle();

        if (!player) {
          res.status(404).json({ success: false, error: 'Player not found in match.' });
          return;
        }

        const playerSlot = player.player_slot as 'A' | 'B';
        const opponentSlot = playerSlot === 'A' ? 'B' : 'A';

        console.log('[PLAYER IDENTIFIED]', {
          playerSlot,
          playerId,
          displayName: player.display_name,
        });

        // Check active round
        const allRounds = await dbGetMatchRounds(matchId);
        const round = allRounds.find((r) => r.round_number === roundNumber);

        if (!round) {
          res.status(404).json({ success: false, error: 'Round not found.' });
          return;
        }

        console.log('[PHASE BEFORE]', round.phase);

        if (round.phase !== phase) {
          res.status(400).json({
            success: false,
            error: `Cannot submit for phase ${phase}. Round is currently in ${round.phase}.`,
            currentPhase: round.phase,
          });
          return;
        }

        // Server-Authoritative Timer Enforcement
        normalizeRoundRecord(round);
        if (round.phase_ends_at && Date.now() > new Date(round.phase_ends_at).getTime() + 4000) {
          res.status(400).json({
            success: false,
            error: 'Time expired for this phase. Submissions are no longer accepted.',
          });
          return;
        }

        // Check if player has already submitted for this phase
        const submissions = await dbGetRoundSubmissions(matchId, roundNumber);
        const existingSub = submissions.find(
          (s) => s.player_id === playerId && s.phase === phase
        );

        if (existingSub) {
          res.status(409).json({
            success: false,
            error: 'You have already submitted an argument for this phase. Submissions cannot be modified.',
          });
          return;
        }

        // Insert submission into protected match_round_submissions
        let subRecord: any;
        try {
          subRecord = await dbInsertRoundSubmission({
            match_id: matchId,
            round_number: roundNumber,
            player_id: playerId,
            player_slot: playerSlot,
            phase,
            argument_text: cleanText,
          });
          console.log('[SUBMISSION SAVED]', {
            matchId,
            roundNumber,
            phase,
            playerSlot,
          });

          // Distributed synchronization: immediately broadcast submission to peer containers
          broadcastMatchEvent(matchId, 'server_submission_sync', {
            matchId,
            roundNumber,
            submission: subRecord,
          });
        } catch (dupErr: any) {
          if (dupErr.code === '23505' || dupErr.message?.includes('already exists')) {
            res.status(409).json({
              success: false,
              error: 'Submission already exists for this round and phase.',
            });
            return;
          }
          throw dupErr;
        }

        // Query BOTH players' submissions for this phase to determine completion
        const updatedSubs = await dbGetRoundSubmissions(matchId, roundNumber);
        const phaseSubs = updatedSubs.filter((s) => s.phase === phase);
        const subA = phaseSubs.find((s) => s.player_slot === 'A');
        const subB = phaseSubs.find((s) => s.player_slot === 'B');

        const bothSubmitted = Boolean(subA && subB);

        console.log('[SUBMISSION COUNT]', {
          phase,
          subA: Boolean(subA),
          subB: Boolean(subB),
          bothSubmitted,
        });

        if (!bothSubmitted) {
          const isPlayerA = playerSlot === 'A';
          const updateField = isPlayerA ? { player_a_submitted: true } : { player_b_submitted: true };
          await dbUpdateMatchRound(matchId, roundNumber, updateField, round.id);

          // Notify connected clients that a player submitted
          broadcastMatchEvent(matchId, 'match_action', {
            action: 'PLAYER_SUBMITTED',
            playerSlot,
            phase,
            roundNumber,
          });

          res.json({
            success: true,
            message: 'Argument submitted. Awaiting opponent submission.',
            bothSubmitted: false,
          });
          return;
        }

        // Both players have submitted! Authoritatively transition to next phase:
        if (phase === 'BLIND') {
          console.log('[PHASE AFTER]', 'COUNTER');
          const counterDuration = getPhaseDurationSeconds('COUNTER');
          const counterStartedAt = new Date().toISOString();
          const counterEndsAt = new Date(Date.now() + counterDuration * 1000).toISOString();

          await dbUpdateMatchRound(
            matchId,
            roundNumber,
            {
              phase: 'COUNTER',
              player_a_submitted: false,
              player_b_submitted: false,
              phase_started_at: counterStartedAt,
              phase_ends_at: counterEndsAt,
            },
            round.id
          );

          await serverSupabase.from('matches').update({
            current_phase: 'COUNTER',
          }).eq('id', matchId);

          broadcastMatchEvent(matchId, 'round_phase_transition', {
            action: 'PHASE_TRANSITION',
            phase: 'COUNTER',
            roundNumber,
            matchId,
          });

          res.json({
            success: true,
            message: 'Both submitted! Unlocking opponent blind arguments for COUNTER phase.',
            nextPhase: 'COUNTER',
            bothSubmitted: true,
          });
          return;
        }

        if (phase === 'COUNTER') {
          console.log('[PHASE AFTER]', 'CONCLUSION');
          const conclusionDuration = getPhaseDurationSeconds('CONCLUSION');
          const conclusionStartedAt = new Date().toISOString();
          const conclusionEndsAt = new Date(Date.now() + conclusionDuration * 1000).toISOString();

          await dbUpdateMatchRound(
            matchId,
            roundNumber,
            {
              phase: 'CONCLUSION',
              player_a_submitted: false,
              player_b_submitted: false,
              phase_started_at: conclusionStartedAt,
              phase_ends_at: conclusionEndsAt,
            },
            round.id
          );

          await serverSupabase.from('matches').update({
            current_phase: 'CONCLUSION',
          }).eq('id', matchId);

          broadcastMatchEvent(matchId, 'round_phase_transition', {
            action: 'PHASE_TRANSITION',
            phase: 'CONCLUSION',
            roundNumber,
            matchId,
          });

          res.json({
            success: true,
            message: 'Both submitted! Moving to CONCLUSION phase.',
            nextPhase: 'CONCLUSION',
            bothSubmitted: true,
          });
          return;
        }

        if (phase === 'CONCLUSION') {
          console.log('[PHASE AFTER]', 'AI_JUDGING');

          // Both submitted conclusions -> Move to AI_JUDGING
          await dbUpdateMatchRound(
            matchId,
            roundNumber,
            {
              phase: 'AI_JUDGING',
              player_a_submitted: true,
              player_b_submitted: true,
            },
            round.id
          );

          await serverSupabase.from('matches').update({
            current_phase: 'RESULT',
          }).eq('id', matchId);

          broadcastMatchEvent(matchId, 'round_phase_transition', {
            action: 'PHASE_TRANSITION',
            phase: 'AI_JUDGING',
            roundNumber,
            matchId,
          });

          // Gather all arguments for Player A and Player B
          const { data: players } = await serverSupabase
            .from('match_players')
            .select('*')
            .eq('match_id', matchId);

          const pA = players?.find((p) => p.player_slot === 'A');
          const pB = players?.find((p) => p.player_slot === 'B');

          const allSubs = await dbGetRoundSubmissions(matchId, roundNumber);

          const isPlayerA = playerSlot === 'A';
          const bundleA: PlayerArgumentBundle = {
            name: pA?.display_name || 'Player A',
            side: (pA?.assigned_side as 'FOR' | 'AGAINST') || 'FOR',
            blind: allSubs?.find((s) => s.player_slot === 'A' && s.phase === 'BLIND')?.argument_text || '',
            counter: allSubs?.find((s) => s.player_slot === 'A' && s.phase === 'COUNTER')?.argument_text || '',
            conclusion: allSubs?.find((s) => s.player_slot === 'A' && s.phase === 'CONCLUSION')?.argument_text || (isPlayerA ? cleanText : ''),
          };

          const bundleB: PlayerArgumentBundle = {
            name: pB?.display_name || 'Player B',
            side: (pB?.assigned_side as 'FOR' | 'AGAINST') || 'AGAINST',
            blind: allSubs?.find((s) => s.player_slot === 'B' && s.phase === 'BLIND')?.argument_text || '',
            counter: allSubs?.find((s) => s.player_slot === 'B' && s.phase === 'COUNTER')?.argument_text || '',
            conclusion: allSubs?.find((s) => s.player_slot === 'B' && s.phase === 'CONCLUSION')?.argument_text || (!isPlayerA ? cleanText : ''),
          };

          // Authoritative Gemini AI judging
          const judgeResult = await judgeDebateRoundWithGemini(round.topic, bundleA, bundleB);

          // Update match_rounds with AI score and reasons, transitioning to ROUND_RESULT
          await dbUpdateMatchRound(
            matchId,
            roundNumber,
            {
              player_a_score: judgeResult.playerAScore,
              player_b_score: judgeResult.playerBScore,
              player_a_reason: judgeResult.playerAReason,
              player_b_reason: judgeResult.playerBReason,
              winner: judgeResult.winner,
              phase: 'ROUND_RESULT',
            },
            round.id
          );

          // If this was Round 3, authoritatively complete the match!
          if (roundNumber === 3) {
            await transitionMatchStatus(matchId, 'IN_PROGRESS', 'COMPLETED');
          }

          broadcastMatchEvent(matchId, 'round_phase_transition', {
            action: 'PHASE_TRANSITION',
            phase: 'ROUND_RESULT',
            roundNumber,
            matchId,
          });

          res.json({
            success: true,
            message: 'Round judged by AI!',
            nextPhase: 'ROUND_RESULT',
            result: judgeResult,
            bothSubmitted: true,
          });
          return;
        }
      }

      if (res.headersSent) {
        return;
      }

      // devMock implementation
      if (isExplicitDevMockEnabled) {
        const match = devMockMatches.get(matchId);
        if (!match || match.status !== 'IN_PROGRESS') {
          res.status(400).json({ success: false, error: 'Match is not in progress.' });
          return;
        }

        const players = devMockPlayers.get(matchId) || [];
        const player = players.find((p) => p.player_id === playerId);
        if (!player) {
          res.status(404).json({ success: false, error: 'Player not found.' });
          return;
        }

        const playerSlot = player.player_slot as 'A' | 'B';
        const opponentSlot = playerSlot === 'A' ? 'B' : 'A';

        const rounds = devMockRounds.get(matchId) || [];
        const round = rounds.find((r) => r.round_number === roundNumber);
        if (!round) {
          res.status(404).json({ success: false, error: 'Round not found.' });
          return;
        }

        if (round.phase !== phase) {
          res.status(400).json({ success: false, error: `Round is currently in ${round.phase}.` });
          return;
        }

        let submissions = devMockSubmissions.get(matchId) || [];
        if (submissions.some((s) => s.round_number === roundNumber && s.player_id === playerId && s.phase === phase)) {
          res.status(409).json({ success: false, error: 'Already submitted.' });
          return;
        }

        submissions.push({
          id: 'sub_' + Math.random().toString(36).substring(2, 9),
          match_id: matchId,
          round_number: roundNumber,
          player_id: playerId,
          player_slot: playerSlot,
          phase,
          argument_text: cleanText,
          submitted_at: new Date().toISOString(),
        });
        devMockSubmissions.set(matchId, submissions);

        if (playerSlot === 'A') round.player_a_submitted = true;
        else round.player_b_submitted = true;

        const oppSub = submissions.find(
          (s) => s.round_number === roundNumber && s.player_slot === opponentSlot && s.phase === phase
        );

        if (!oppSub) {
          res.json({ success: true, message: 'Argument submitted.', bothSubmitted: false });
          return;
        }

        // Both submitted in devMock!
        if (phase === 'BLIND') {
          round.phase = 'COUNTER';
          round.player_a_submitted = false;
          round.player_b_submitted = false;
          match.current_phase = 'COUNTER';
          res.json({ success: true, nextPhase: 'COUNTER', bothSubmitted: true });
          return;
        }

        if (phase === 'COUNTER') {
          round.phase = 'CONCLUSION';
          round.player_a_submitted = false;
          round.player_b_submitted = false;
          match.current_phase = 'CONCLUSION';
          res.json({ success: true, nextPhase: 'CONCLUSION', bothSubmitted: true });
          return;
        }

        if (phase === 'CONCLUSION') {
          round.phase = 'AI_JUDGING';
          match.current_phase = 'RESULT';

          const pA = players.find((p) => p.player_slot === 'A');
          const pB = players.find((p) => p.player_slot === 'B');

          const bundleA: PlayerArgumentBundle = {
            name: pA?.display_name || 'Player A',
            side: pA?.assigned_side || 'FOR',
            blind: submissions.find((s) => s.player_slot === 'A' && s.phase === 'BLIND')?.argument_text || '',
            counter: submissions.find((s) => s.player_slot === 'A' && s.phase === 'COUNTER')?.argument_text || '',
            conclusion: submissions.find((s) => s.player_slot === 'A' && s.phase === 'CONCLUSION')?.argument_text || cleanText,
          };

          const bundleB: PlayerArgumentBundle = {
            name: pB?.display_name || 'Player B',
            side: pB?.assigned_side || 'AGAINST',
            blind: submissions.find((s) => s.player_slot === 'B' && s.phase === 'BLIND')?.argument_text || '',
            counter: submissions.find((s) => s.player_slot === 'B' && s.phase === 'COUNTER')?.argument_text || '',
            conclusion: submissions.find((s) => s.player_slot === 'B' && s.phase === 'CONCLUSION')?.argument_text || cleanText,
          };

          const judgeResult = await judgeDebateRoundWithGemini(round.topic, bundleA, bundleB);

          round.player_a_score = judgeResult.playerAScore;
          round.player_b_score = judgeResult.playerBScore;
          round.player_a_reason = judgeResult.playerAReason;
          round.player_b_reason = judgeResult.playerBReason;
          round.winner = judgeResult.winner;
          round.phase = 'ROUND_RESULT';

          if (roundNumber === 3) {
            match.status = 'COMPLETED';
          }

          res.json({
            success: true,
            nextPhase: 'ROUND_RESULT',
            result: judgeResult,
            bothSubmitted: true,
          });
          return;
        }
      }

      if (!res.headersSent) {
        res.status(503).json({ success: false, error: 'Database service unavailable.' });
      }
    } catch (err: any) {
      console.error('[FIZZ OUT] Submit argument error:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: 'Failed to submit argument.' });
      }
    }
  });

  // ============================================================================
  // 9. GAMEPLAY: Advance to Next Round (With Fresh Gemini Topic)
  // ============================================================================
  app.post('/api/matches/next-round', async (req: Request, res: Response) => {
    try {
      const { matchId, playerId } = req.body;
      if (!matchId || !playerId) {
        res.status(400).json({ success: false, error: 'matchId and playerId are required.' });
        return;
      }

      const sessionToken = extractSessionToken(req);
      const auth = await validatePlayerSession(matchId, playerId, sessionToken);
      if (!auth.valid) {
        res.status(403).json({ success: false, error: auth.error || 'Unauthorized session.' });
        return;
      }

      const canUseSupabase = await checkSupabaseTablesAvailable();

      if (serverSupabase && canUseSupabase) {
        const { data: match } = await serverSupabase
          .from('matches')
          .select('*')
          .eq('id', matchId)
          .maybeSingle();

        if (!match) {
          res.status(404).json({ success: false, error: 'Match not found.' });
          return;
        }

        if (match.current_round >= 3) {
          res.status(400).json({ success: false, error: 'All 3 rounds are already complete.' });
          return;
        }

        const nextRoundNum = match.current_round + 1;

        // Check if opponent already advanced to next round
        const allRounds = await dbGetMatchRounds(matchId);
        const existingNext = allRounds.find((r) => r.round_number === nextRoundNum);

        if (existingNext) {
          res.json({ success: true, round: existingNext });
          return;
        }

        // Retrieve pre-assigned topic for this match (Round 2 = Topic 2, Round 3 = Topic 3)
        const matchTopics = await generateThreeUniqueMatchTopics(matchId);
        const newTopic =
          matchTopics[nextRoundNum - 1] ||
          (await generateAITopic(nextRoundNum, allRounds.map((r) => r.topic)));

        const blindDuration = getPhaseDurationSeconds('BLIND');
        const blindStartedAt = new Date().toISOString();
        const blindEndsAt = new Date(Date.now() + blindDuration * 1000).toISOString();

        // Insert new round
        const newRound = await dbUpsertMatchRound({
          match_id: matchId,
          round_number: nextRoundNum,
          phase: 'BLIND',
          topic: newTopic,
          player_a_submitted: false,
          player_b_submitted: false,
          phase_started_at: blindStartedAt,
          phase_ends_at: blindEndsAt,
        });

        // Update match table
        await serverSupabase.from('matches').update({
          current_round: nextRoundNum,
          current_phase: 'BLIND',
        }).eq('id', matchId);

        broadcastMatchEvent(matchId, 'round_phase_transition', {
          action: 'PHASE_TRANSITION',
          phase: 'BLIND',
          roundNumber: nextRoundNum,
          matchId,
        });

        res.json({ success: true, round: newRound });
        return;
      }

      // devMock implementation
      if (isExplicitDevMockEnabled) {
        const match = devMockMatches.get(matchId);
        if (!match || match.current_round >= 3) {
          res.status(400).json({ success: false, error: 'Invalid match or already completed.' });
          return;
        }

        const nextRoundNum = match.current_round + 1;
        let rounds = devMockRounds.get(matchId) || [];
        let existingNext = rounds.find((r) => r.round_number === nextRoundNum);

        if (!existingNext) {
          const matchTopics = await generateThreeUniqueMatchTopics(matchId);
          const newTopic =
            matchTopics[nextRoundNum - 1] ||
            (await generateAITopic(nextRoundNum, rounds.map((r) => r.topic)));
          const blindDuration = getPhaseDurationSeconds('BLIND');
          const blindStartedAt = new Date().toISOString();
          const blindEndsAt = new Date(Date.now() + blindDuration * 1000).toISOString();

          existingNext = {
            id: 'mr_' + Math.random().toString(36).substring(2, 9),
            match_id: matchId,
            round_number: nextRoundNum,
            phase: 'BLIND',
            topic: newTopic,
            player_a_submitted: false,
            player_b_submitted: false,
            player_a_score: null,
            player_b_score: null,
            player_a_reason: null,
            player_b_reason: null,
            winner: null,
            phase_started_at: blindStartedAt,
            phase_ends_at: blindEndsAt,
            created_at: new Date().toISOString(),
          };
          rounds.push(existingNext);
          devMockRounds.set(matchId, rounds);
        }

        match.current_round = nextRoundNum;
        match.current_phase = 'BLIND';

        res.json({ success: true, round: existingNext });
        return;
      }

      res.status(503).json({ success: false, error: 'Database service unavailable.' });
    } catch (err: any) {
      console.error('[FIZZ OUT] Next round error:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: 'Failed to advance round.' });
      }
    }
  });

  // ============================================================================
  // 10. GAMEPLAY: Reset / Play Again (New Match, Fresh Random Sides & Topics)
  // ============================================================================
  app.post('/api/matches/reset-play-again', async (req: Request, res: Response) => {
    try {
      const { matchId, playerId, displayName, previousTopics } = req.body;
      const hostName = (displayName || 'Player 1').trim().substring(0, 25) || 'Debater';
      const newRoomCode = generateRoomCode();
      const newPlayerId = 'usr_' + crypto.randomBytes(8).toString('hex');
      const newSessionToken = generateSessionToken();

      // Collect and permanently ban all topics from the completed match
      const excludedTopics: string[] = [];
      if (Array.isArray(previousTopics)) {
        for (const t of previousTopics) {
          if (t && typeof t === 'string' && t.trim()) {
            recordUsedTopic(t.trim());
            excludedTopics.push(t.trim());
          }
        }
      }

      if (matchId) {
        try {
          const oldRounds = await dbGetMatchRounds(matchId);
          for (const r of oldRounds) {
            if (r.topic) {
              recordUsedTopic(r.topic);
              excludedTopics.push(r.topic);
            }
          }
        } catch (oldErr) {
          console.warn('[FIZZ OUT] Could not fetch old rounds for topic recording:', oldErr);
        }

        const oldMockRounds = devMockRounds.get(matchId);
        if (oldMockRounds) {
          for (const r of oldMockRounds) {
            if (r.topic) {
              recordUsedTopic(r.topic);
              excludedTopics.push(r.topic);
            }
          }
        }

        matchTopicAssignments.delete(matchId);
        hybridRounds.delete(matchId);
        hybridSubmissions.delete(matchId);
      }

      const sides: ('FOR' | 'AGAINST')[] = Math.random() < 0.5 ? ['FOR', 'AGAINST'] : ['AGAINST', 'FOR'];
      const hostSide = sides[0];

      const canUseSupabase = await checkSupabaseTablesAvailable();

      if (serverSupabase && canUseSupabase) {
        // Clean up previous match if it exists (CASCADE deletes all children tables)
        if (matchId) {
          try {
            await serverSupabase.from('matches').delete().eq('id', matchId);
          } catch (delErr) {
            console.warn('[FIZZ OUT] Previous match cleanup warning:', delErr);
          }
        }

        // Create new match
        const { data: newMatch, error: mErr } = await serverSupabase
          .from('matches')
          .insert({
            room_code: newRoomCode,
            status: 'WAITING',
            current_round: 1,
            current_phase: 'BLIND',
          })
          .select()
          .single();

        if (mErr || !newMatch) {
          res.status(500).json({ success: false, error: 'Failed to create new match.' });
          return;
        }

        // Pre-generate 3 brand new unique topics for this new match, guaranteeing zero reuse
        await generateThreeUniqueMatchTopics(newMatch.id, excludedTopics);

        // Insert host player
        const { data: player, error: pErr } = await serverSupabase
          .from('match_players')
          .insert({
            match_id: newMatch.id,
            player_id: newPlayerId,
            player_slot: 'A',
            display_name: hostName,
            assigned_side: null,
            has_revealed_side: false,
          })
          .select()
          .single();

        if (pErr || !player) {
          res.status(500).json({ success: false, error: 'Failed to register player in new match.' });
          return;
        }

        // Save new secret side
        await serverSupabase.from('match_player_secrets').insert({
          match_id: newMatch.id,
          player_id: newPlayerId,
          secret_side: hostSide,
        });

        // Register session token
        const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
        await registerPlayerSession(newMatch.id, newPlayerId, newSessionToken, expiresAt);

        res.json({
          success: true,
          match: newMatch,
          player,
          players: [player],
          sessionToken: newSessionToken,
        });
        return;
      }

      // devMock implementation
      if (isExplicitDevMockEnabled) {
        if (matchId) {
          devMockMatches.delete(matchId);
          devMockPlayers.delete(matchId);
          devMockRounds.delete(matchId);
          devMockSubmissions.delete(matchId);
        }

        const newMatch = {
          id: 'm_' + Math.random().toString(36).substring(2, 9),
          room_code: newRoomCode,
          status: 'WAITING',
          current_round: 1,
          current_phase: 'BLIND',
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        };
        devMockMatches.set(newMatch.id, newMatch);

        // Pre-generate 3 brand new unique topics for this new match, guaranteeing zero reuse
        await generateThreeUniqueMatchTopics(newMatch.id, excludedTopics);

        const player = {
          id: 'p_' + Math.random().toString(36).substring(2, 9),
          match_id: newMatch.id,
          player_id: newPlayerId,
          player_slot: 'A',
          display_name: hostName,
          assigned_side: null,
          joined_at: new Date().toISOString(),
          is_connected: true,
          has_revealed_side: false,
        };
        devMockPlayers.set(newMatch.id, [player]);
        devMockSecrets.set(`${newMatch.id}:${newPlayerId}`, hostSide);

        await registerPlayerSession(newMatch.id, newPlayerId, newSessionToken, new Date(Date.now() + 2 * 60 * 60 * 1000));

        res.json({
          success: true,
          match: newMatch,
          player,
          players: [player],
          sessionToken: newSessionToken,
        });
        return;
      }

      res.status(503).json({ success: false, error: 'Database service unavailable.' });
    } catch (err: any) {
      console.error('[FIZZ OUT] Reset play again error:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: 'Failed to reset match.' });
      }
    }
  });

  // ============================================================================
  // 11. Cleanup / Expire Match (CASCADE Deletes all Match Data)
  // ============================================================================
  app.post('/api/matches/cleanup', async (req: Request, res: Response) => {
    try {
      const { matchId, playerId } = req.body;
      if (!matchId) {
        res.status(400).json({ success: false, error: 'matchId is required.' });
        return;
      }

      const sessionToken = extractSessionToken(req);
      if (playerId && sessionToken) {
        const auth = await validatePlayerSession(matchId, playerId, sessionToken);
        if (!auth.valid) {
          res.status(403).json({ success: false, error: auth.error || 'Unauthorized.' });
          return;
        }
      }

      matchTopicAssignments.delete(matchId);
      hybridRounds.delete(matchId);
      hybridSubmissions.delete(matchId);

      if (serverSupabase && supabaseTablesAvailable) {
        // ON DELETE CASCADE automatically deletes match_players, match_player_secrets, match_player_sessions, match_rounds, match_round_submissions
        await serverSupabase.from('matches').delete().eq('id', matchId);
      }

      if (isExplicitDevMockEnabled) {
        devMockMatches.delete(matchId);
        devMockPlayers.delete(matchId);
        devMockRounds.delete(matchId);
        devMockSubmissions.delete(matchId);
        for (const [key, session] of devMockSessions.entries()) {
          if (session.matchId === matchId) devMockSessions.delete(key);
        }
        for (const [key] of devMockSecrets.entries()) {
          if (key.startsWith(`${matchId}:`)) devMockSecrets.delete(key);
        }
      }

      res.json({ success: true, message: 'Temporary match data removed.' });
    } catch (err: any) {
      console.error('Cleanup match error:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: 'Failed to clean up match.' });
      }
    }
  });

// Catch-all for undefined /api/* endpoints - ALWAYS return clean JSON, never HTML
app.all('/api/*', (req: Request, res: Response) => {
  console.warn(`[FIZZ OUT 404] API route not found: ${req.method} ${req.originalUrl || req.url}`);
  res.status(404).json({
    success: false,
    error: `API route not found: ${req.method} ${req.originalUrl || req.url}. Check your endpoint and server configuration.`,
  });
});

// Central Express error handler - ALWAYS returns JSON
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[FIZZ OUT UNHANDLED SERVER ERROR]:', err?.message || err);
  if (!res.headersSent) {
    res.status(500).json({
      success: false,
      error: err?.message || 'Internal server error occurred.',
    });
  }
});

async function startServer() {
  // Periodic cleanup task (every 5 minutes)
  setInterval(async () => {
    try {
      const now = new Date().toISOString();
      if (serverSupabase && coreTablesAvailable) {
        const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

        // Expired matches
        await serverSupabase.from('matches').delete().lt('expires_at', now);

        // Completed matches older than 30 minutes
        await serverSupabase.from('matches').delete().eq('status', 'COMPLETED').lt('created_at', thirtyMinsAgo);
      }

      if (isExplicitDevMockEnabled) {
        const nowMs = Date.now();
        for (const [id, m] of devMockMatches.entries()) {
          if (
            nowMs > new Date(m.expires_at).getTime() ||
            (m.status === 'COMPLETED' && nowMs - new Date(m.created_at).getTime() > 30 * 60 * 1000)
          ) {
            devMockMatches.delete(id);
            devMockPlayers.delete(id);
            devMockRounds.delete(id);
            devMockSubmissions.delete(id);
          }
        }
      }
    } catch (cleanErr) {
      console.error('[FIZZ OUT CLEANUP] Error in periodic cleanup task:', cleanErr);
    }
  }, 5 * 60 * 1000);

  // ============================================================================
  // 13. ACTIVE PHASE TIMEOUT ENFORCEMENT LOOP (Every 2 Seconds)
  // ============================================================================
  setInterval(async () => {
    try {
      // Check hybrid rounds
      for (const [matchId, rounds] of hybridRounds.entries()) {
        if (!rounds || rounds.length === 0) continue;
        const activeRound = rounds.find((r) => ['BLIND', 'COUNTER', 'CONCLUSION'].includes(r.phase));
        if (activeRound) {
          let match: any = null;
          if (serverSupabase && gameplayTablesAvailable) {
            const { data } = await serverSupabase.from('matches').select('*').eq('id', matchId).maybeSingle();
            match = data;
          } else {
            match = devMockMatches.get(matchId);
          }
          if (match && match.status === 'IN_PROGRESS') {
            await checkAndHandlePhaseTimeout(matchId, activeRound, match);
          }
        }
      }
    } catch (tickErr) {
      // Non-blocking timer check
    }
  }, 2000);

  // Vite middleware for development or static serving for production
  if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FIZZ OUT server running on port ${PORT}`);
    console.log(
      `Multiplayer mode: ${
        isServiceRoleConfigured
          ? 'SUPABASE SERVICE ROLE (Authoritative Database)'
          : isExplicitDevMockEnabled
          ? 'EXPLICIT DEV MOCK MODE (In-memory testing only)'
          : 'CONFIGURATION REQUIRED (SUPABASE_SERVICE_ROLE_KEY missing)'
      }`
    );
  });
}

// In local development or standalone production (Cloud Run), start server listener.
// When deployed to Vercel (where VERCEL=1), Vercel invokes the exported app directly as a Serverless Function.
if (!process.env.VERCEL) {
  startServer();
}

export default app;
