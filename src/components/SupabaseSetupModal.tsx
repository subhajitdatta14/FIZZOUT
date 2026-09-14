import React, { useState } from 'react';
import { X, Copy, Check, Database, Terminal, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';

interface SupabaseSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  isConfigured: boolean;
  tablesReady?: boolean;
  missingTables?: string[];
  onRecheck?: () => Promise<boolean | void>;
}

const SQL_GAMEPLAY_MIGRATION = `-- ============================================================================
-- FIZZ OUT: MIGRATION FOR MISSING GAMEPLAY TABLES (match_rounds & match_round_submissions)
-- Run this in Supabase SQL Editor to enable cross-device round synchronization!
-- ============================================================================

-- 1. Match Rounds Table (Publicly Observable Phase & Score State for 3 Rounds)
CREATE TABLE IF NOT EXISTS public.match_rounds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL,
    round_number INT NOT NULL CHECK (round_number BETWEEN 1 AND 3),
    phase VARCHAR(30) NOT NULL DEFAULT 'BLIND' CHECK (phase IN ('BLIND', 'COUNTER', 'CONCLUSION', 'AI_JUDGING', 'ROUND_RESULT')),
    topic TEXT NOT NULL DEFAULT '',
    player_a_submitted BOOLEAN NOT NULL DEFAULT FALSE,
    player_b_submitted BOOLEAN NOT NULL DEFAULT FALSE,
    player_a_score INT DEFAULT NULL,
    player_b_score INT DEFAULT NULL,
    player_a_reason TEXT DEFAULT NULL,
    player_b_reason TEXT DEFAULT NULL,
    winner VARCHAR(10) CHECK (winner IN ('A', 'B', 'DRAW') OR winner IS NULL),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_match_rounds_lookup ON public.match_rounds(match_id, round_number);

-- 2. Match Round Submissions Table (Server-Only: Hidden Argument Security)
CREATE TABLE IF NOT EXISTS public.match_round_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL,
    round_number INT NOT NULL CHECK (round_number BETWEEN 1 AND 3),
    player_id VARCHAR(64) NOT NULL,
    player_slot VARCHAR(2) NOT NULL CHECK (player_slot IN ('A', 'B')),
    phase VARCHAR(30) NOT NULL CHECK (phase IN ('BLIND', 'COUNTER', 'CONCLUSION')),
    argument_text TEXT NOT NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_match_round_submissions_lookup ON public.match_round_submissions(match_id, round_number, player_id, phase);

-- 3. Safe Foreign Keys to public.matches
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_match_rounds_matches') THEN
        ALTER TABLE public.match_rounds ADD CONSTRAINT fk_match_rounds_matches FOREIGN KEY (match_id) REFERENCES public.matches(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_match_round_submissions_matches') THEN
        ALTER TABLE public.match_round_submissions ADD CONSTRAINT fk_match_round_submissions_matches FOREIGN KEY (match_id) REFERENCES public.matches(id) ON DELETE CASCADE;
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- 4. Safe Unique Constraints for Gameplay
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_match_round') THEN
        ALTER TABLE public.match_rounds ADD CONSTRAINT unique_match_round UNIQUE(match_id, round_number);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_round_player_phase') THEN
        ALTER TABLE public.match_round_submissions ADD CONSTRAINT unique_round_player_phase UNIQUE(match_id, round_number, player_id, phase);
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- 5. Enable RLS on Gameplay Tables
ALTER TABLE public.match_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_round_submissions ENABLE ROW LEVEL SECURITY;

-- 6. Policies for Gameplay Tables
DROP POLICY IF EXISTS "Allow anonymous select match_rounds" ON public.match_rounds;
CREATE POLICY "Allow anonymous select match_rounds" ON public.match_rounds FOR SELECT TO anon, authenticated USING (true);

-- 7. Realtime publication & Replica Identity for match_rounds
DO $$
BEGIN
    IF to_regclass('public.match_rounds') IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'match_rounds') THEN
            EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.match_rounds';
        END IF;
        EXECUTE 'ALTER TABLE public.match_rounds REPLICA IDENTITY FULL';
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;`;

const SQL_SCHEMA = `-- ============================================================================
-- FIZZ OUT: Hardened Supabase Database Schema & Multi-Layer Security Architecture
-- ============================================================================
-- Security Model:
-- 1. Anonymous / authenticated browser clients are STRICTLY restricted to SELECT on matches, match_players, & match_rounds.
-- 2. No client can INSERT, UPDATE, or DELETE directly (Zero Client Write Access).
-- 3. Secret side assignments are quarantined in match_player_secrets (Zero Public Access - RLS Deny All).
-- 4. Ephemeral session hashes are stored in match_player_sessions (Zero Public Access - RLS Deny All).
-- 5. Arguments during BLIND phase are protected in match_round_submissions (Zero Public Access - RLS Deny All).
-- 6. All mutations & state transitions are authoritatively handled by Node.js backend using SUPABASE_SERVICE_ROLE_KEY.
-- ============================================================================

-- 1. Matches Table
CREATE TABLE IF NOT EXISTS public.matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_code VARCHAR(10) NOT NULL UNIQUE,
    status VARCHAR(30) NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING', 'READY', 'REVEALING', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED')),
    current_round INT NOT NULL DEFAULT 1,
    current_phase VARCHAR(30) NOT NULL DEFAULT 'BLIND' CHECK (current_phase IN ('BLIND', 'COUNTER', 'CONCLUSION', 'RESULT')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '2 hours')
);

-- Migration safety: Remove old matches.topic column if it exists from earlier schemas
ALTER TABLE public.matches DROP COLUMN IF EXISTS topic;

CREATE INDEX IF NOT EXISTS idx_matches_room_code ON public.matches(room_code);
CREATE INDEX IF NOT EXISTS idx_matches_status ON public.matches(status);

-- 2. Match Players Table (Publicly observable state for 2 players)
CREATE TABLE IF NOT EXISTS public.match_players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    player_id VARCHAR(64) NOT NULL,
    player_slot VARCHAR(2) NOT NULL CHECK (player_slot IN ('A', 'B')),
    display_name VARCHAR(30) NOT NULL,
    assigned_side VARCHAR(10) CHECK (assigned_side IN ('FOR', 'AGAINST') OR assigned_side IS NULL),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_connected BOOLEAN NOT NULL DEFAULT TRUE,
    has_revealed_side BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_match_players_match ON public.match_players(match_id);

-- 3. Match Player Secrets Table (Server-Only: Hidden Side Security)
CREATE TABLE IF NOT EXISTS public.match_player_secrets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    player_id VARCHAR(64) NOT NULL,
    secret_side VARCHAR(10) NOT NULL CHECK (secret_side IN ('FOR', 'AGAINST')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_match_player_secrets_lookup ON public.match_player_secrets(match_id, player_id);

-- 4. Match Player Sessions Table (Server-Only: Ephemeral SHA-256 Token Hashes)
CREATE TABLE IF NOT EXISTS public.match_player_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    player_id VARCHAR(64) NOT NULL,
    token_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_match_player_sessions_lookup ON public.match_player_sessions(match_id, player_id);

-- 5. Match Rounds Table (Publicly Observable Phase & Score State for 3 Rounds)
CREATE TABLE IF NOT EXISTS public.match_rounds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    round_number INT NOT NULL CHECK (round_number BETWEEN 1 AND 3),
    phase VARCHAR(30) NOT NULL DEFAULT 'BLIND' CHECK (phase IN ('BLIND', 'COUNTER', 'CONCLUSION', 'AI_JUDGING', 'ROUND_RESULT')),
    topic TEXT NOT NULL,
    player_a_submitted BOOLEAN NOT NULL DEFAULT FALSE,
    player_b_submitted BOOLEAN NOT NULL DEFAULT FALSE,
    player_a_score INT DEFAULT NULL,
    player_b_score INT DEFAULT NULL,
    player_a_reason TEXT DEFAULT NULL,
    player_b_reason TEXT DEFAULT NULL,
    winner VARCHAR(10) CHECK (winner IN ('A', 'B', 'DRAW') OR winner IS NULL),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    phase_started_at TIMESTAMPTZ DEFAULT NOW(),
    phase_ends_at TIMESTAMPTZ
);

ALTER TABLE public.match_rounds ADD COLUMN IF NOT EXISTS phase_started_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.match_rounds ADD COLUMN IF NOT EXISTS phase_ends_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_match_rounds_lookup ON public.match_rounds(match_id, round_number);

-- 6. Match Round Submissions Table (Server-Only: Hidden Argument Security)
CREATE TABLE IF NOT EXISTS public.match_round_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    round_number INT NOT NULL CHECK (round_number BETWEEN 1 AND 3),
    player_id VARCHAR(64) NOT NULL,
    player_slot VARCHAR(2) NOT NULL CHECK (player_slot IN ('A', 'B')),
    phase VARCHAR(30) NOT NULL CHECK (phase IN ('BLIND', 'COUNTER', 'CONCLUSION')),
    argument_text TEXT NOT NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_match_round_submissions_lookup ON public.match_round_submissions(match_id, round_number, player_id, phase);

-- 7. Safe Unique Constraints
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_match_player_slot') THEN
        ALTER TABLE public.match_players ADD CONSTRAINT unique_match_player_slot UNIQUE(match_id, player_slot);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_match_player_id') THEN
        ALTER TABLE public.match_players ADD CONSTRAINT unique_match_player_id UNIQUE(match_id, player_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_match_player_secret') THEN
        ALTER TABLE public.match_player_secrets ADD CONSTRAINT unique_match_player_secret UNIQUE(match_id, player_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_match_player_session') THEN
        ALTER TABLE public.match_player_sessions ADD CONSTRAINT unique_match_player_session UNIQUE(match_id, player_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_match_round') THEN
        ALTER TABLE public.match_rounds ADD CONSTRAINT unique_match_round UNIQUE(match_id, round_number);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_round_player_phase') THEN
        ALTER TABLE public.match_round_submissions ADD CONSTRAINT unique_round_player_phase UNIQUE(match_id, round_number, player_id, phase);
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- 8. Enable Row Level Security (RLS) on all 6 tables
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_player_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_player_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_round_submissions ENABLE ROW LEVEL SECURITY;

-- 9. Restricted SELECT-only policies for public clients
DROP POLICY IF EXISTS "Allow anonymous select matches" ON public.matches;
CREATE POLICY "Allow anonymous select matches" ON public.matches FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow anonymous select match_players" ON public.match_players;
CREATE POLICY "Allow anonymous select match_players" ON public.match_players FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Allow anonymous select match_rounds" ON public.match_rounds;
CREATE POLICY "Allow anonymous select match_rounds" ON public.match_rounds FOR SELECT TO anon, authenticated USING (true);

-- Note: match_player_secrets, match_player_sessions, and match_round_submissions
-- have ZERO public policies (Deny All for anon/authenticated).
-- They are only accessible by the backend with SUPABASE_SERVICE_ROLE_KEY.

-- 10. Realtime Publication Configuration (Safe dynamic execution)
DO $$
BEGIN
    IF to_regclass('public.matches') IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'matches') THEN
            EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.matches';
        END IF;
    END IF;

    IF to_regclass('public.match_players') IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'match_players') THEN
            EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.match_players';
        END IF;
    END IF;

    IF to_regclass('public.match_rounds') IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'match_rounds') THEN
            EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.match_rounds';
        END IF;
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- 11. Replica Identity for Realtime Payloads (guarantees full row delivery on UPDATE events)
DO $$
BEGIN
    IF to_regclass('public.matches') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.matches REPLICA IDENTITY FULL';
    END IF;
    IF to_regclass('public.match_players') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.match_players REPLICA IDENTITY FULL';
    END IF;
    IF to_regclass('public.match_rounds') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.match_rounds REPLICA IDENTITY FULL';
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;`;

export const SupabaseSetupModal: React.FC<SupabaseSetupModalProps> = ({
  isOpen,
  onClose,
  isConfigured,
  tablesReady = false,
  missingTables = [],
  onRecheck,
}) => {
  const [copiedSql, setCopiedSql] = useState(false);
  const [copiedGameplaySql, setCopiedGameplaySql] = useState(false);
  const [copiedEnv, setCopiedEnv] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [recheckMessage, setRecheckMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(SQL_SCHEMA);
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 2000);
    } catch {
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 2000);
    }
  };

  const handleCopyGameplaySql = async () => {
    try {
      await navigator.clipboard.writeText(SQL_GAMEPLAY_MIGRATION);
      setCopiedGameplaySql(true);
      setTimeout(() => setCopiedGameplaySql(false), 2000);
    } catch {
      setCopiedGameplaySql(true);
      setTimeout(() => setCopiedGameplaySql(false), 2000);
    }
  };

  const envSample = `VITE_SUPABASE_URL="https://your-project.supabase.co"\nVITE_SUPABASE_ANON_KEY="your-anon-key-here"`;

  const handleCopyEnv = async () => {
    try {
      await navigator.clipboard.writeText(envSample);
      setCopiedEnv(true);
      setTimeout(() => setCopiedEnv(false), 2000);
    } catch {
      setCopiedEnv(true);
      setTimeout(() => setCopiedEnv(false), 2000);
    }
  };

  const handleCheckConnection = async () => {
    if (!onRecheck) return;
    setIsChecking(true);
    setRecheckMessage(null);
    try {
      const res = await onRecheck();
      if (res === true) {
        setRecheckMessage('✅ All 6 Supabase database tables verified and live!');
      } else {
        setRecheckMessage('⚠️ Tables not detected yet in Supabase. Paste the SQL in SQL Editor and run it.');
      }
    } catch {
      setRecheckMessage('Checked connection status.');
    } finally {
      setIsChecking(false);
    }
  };

  const hasMissingGameplay = missingTables.some((t) => t === 'match_rounds' || t === 'match_round_submissions');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 select-none">
      <div className="bg-black border border-neutral-800 w-full max-w-2xl max-h-[90vh] p-6 sm:p-8 overflow-y-auto relative">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1.5 text-neutral-400 hover:text-white transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 bg-black border border-[#FA5A00]/50 flex items-center justify-center text-[#FA5A00]">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h2
              className="text-xl font-bold text-white uppercase tracking-wider"
              style={{ fontFamily: "'Chakra Petch', sans-serif" }}
            >
              Supabase Database Setup
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <span
                className={`w-2 h-2 rounded-full ${
                  tablesReady
                    ? 'bg-emerald-500'
                    : isConfigured
                    ? 'bg-[#FA5A00]'
                    : 'bg-neutral-500'
                }`}
              />
              <span className="text-xs text-neutral-400 font-medium" style={{ fontFamily: "'Outfit', sans-serif" }}>
                {tablesReady
                  ? 'All 6 Supabase Cloud Tables Active'
                  : isConfigured
                  ? 'Connected to Project (Action Needed to Sync Tables)'
                  : 'Running in Local Relay Mode'}
              </span>
            </div>
          </div>
        </div>

        {/* Missing Gameplay Tables Banner */}
        {hasMissingGameplay ? (
          <div className="mb-6 p-4 bg-black border border-[#FA5A00]/60 text-xs text-neutral-200 space-y-3">
            <div
              className="flex items-center gap-2 font-bold text-[#FA5A00] uppercase tracking-wider text-[11px]"
              style={{ fontFamily: "'Chakra Petch', sans-serif" }}
            >
              <AlertTriangle className="w-4 h-4 text-[#FA5A00] shrink-0" />
              <span>Multiplayer Round Tables Missing in Supabase</span>
            </div>
            <p className="leading-relaxed text-neutral-300">
              Your database is missing{' '}
              <strong className="text-white">
                {missingTables.filter((t) => t === 'match_rounds' || t === 'match_round_submissions').join(' and ')}
              </strong>
              . Without these tables in Postgres, round submissions fall back to distributed memory. Run the quick migration script below so both devices write to the same database!
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                onClick={handleCopyGameplaySql}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#FA5A00] hover:brightness-105 text-black font-extrabold text-xs transition-colors cursor-pointer"
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                {copiedGameplaySql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedGameplaySql ? 'Copied 10-Sec Migration!' : 'Copy Missing Tables SQL'}</span>
              </button>
              <button
                onClick={handleCheckConnection}
                disabled={isChecking}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-black border border-neutral-800 hover:border-neutral-700 text-neutral-200 font-bold text-xs transition-colors disabled:opacity-50 cursor-pointer"
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
                <span>{isChecking ? 'Checking...' : 'Re-check Tables'}</span>
              </button>
            </div>
            {recheckMessage && (
              <div className="mt-2 text-xs font-semibold text-[#FA5A00]">
                {recheckMessage}
              </div>
            )}
          </div>
        ) : isConfigured && !tablesReady ? (
          <div className="mb-6 p-4 bg-black border border-[#FA5A00]/40 text-xs text-neutral-300 space-y-2">
            <div
              className="flex items-center gap-2 font-bold text-[#FA5A00] uppercase tracking-wider text-[11px]"
              style={{ fontFamily: "'Chakra Petch', sans-serif" }}
            >
              <AlertTriangle className="w-4 h-4 text-[#FA5A00] shrink-0" />
              <span>Database Tables Needed in Supabase</span>
            </div>
            <p className="leading-relaxed">
              Your Supabase credentials are configured, but tables have not yet been created in PostgreSQL.
            </p>
            <div className="pt-2 flex items-center justify-between">
              <span className="text-[11px] text-neutral-400">Run the SQL script below, then re-check:</span>
              <button
                onClick={handleCheckConnection}
                disabled={isChecking}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#FA5A00] hover:brightness-105 text-black font-bold text-xs transition-colors disabled:opacity-50 cursor-pointer"
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
                <span>{isChecking ? 'Checking...' : 'Re-check Tables'}</span>
              </button>
            </div>
            {recheckMessage && (
              <div className="mt-2 text-xs font-semibold text-[#FA5A00]">
                {recheckMessage}
              </div>
            )}
          </div>
        ) : tablesReady ? (
          <div className="mb-6 p-4 bg-black border border-emerald-800 text-xs text-emerald-200 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <div
                className="font-bold text-emerald-300 uppercase tracking-wider mb-1"
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                All 6 Supabase Tables Verified & Active
              </div>
              <p className="text-neutral-300">
                Matches, players, rounds, and submissions are storing authoritatively in your cloud Supabase database and broadcasting over Supabase Realtime channels.
              </p>
            </div>
          </div>
        ) : null}

        {/* Steps */}
        <div className="space-y-4 text-sm text-neutral-300">
          {/* Step 1 */}
          <div className="p-4 bg-black border border-neutral-800">
            <div className="flex items-center justify-between mb-2">
              <div
                className="font-bold text-sm text-white uppercase tracking-wider flex items-center gap-2"
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                <span className="w-5 h-5 bg-[#FA5A00] text-black text-xs flex items-center justify-center font-bold">
                  1
                </span>
                <span>Full Database Schema (All 6 Tables)</span>
              </div>
              <button
                onClick={handleCopySql}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-black border border-neutral-800 hover:border-neutral-700 text-neutral-200 text-xs font-semibold transition-colors cursor-pointer"
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                {copiedSql ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedSql ? 'Copied Full Schema!' : 'Copy Full Schema'}</span>
              </button>
            </div>
            <p className="text-xs text-neutral-400 mb-2.5">
              Open your Supabase project dashboard, click <strong>SQL Editor</strong> on the left, create a new query, paste this schema, and click <strong>Run</strong>.
            </p>
            <pre className="p-3 bg-black border border-neutral-800 text-[11px] font-mono text-neutral-400 overflow-x-auto max-h-28">
              {SQL_SCHEMA}
            </pre>
          </div>

          {/* Step 1b: Quick Migration */}
          <div className="p-4 bg-black border border-[#FA5A00]/40">
            <div className="flex items-center justify-between mb-2">
              <div
                className="font-bold text-sm text-white uppercase tracking-wider flex items-center gap-2"
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                <span className="w-5 h-5 bg-[#FA5A00] text-black text-xs flex items-center justify-center font-bold">
                  1B
                </span>
                <span>Quick Migration: Missing Gameplay Tables</span>
              </div>
              <button
                onClick={handleCopyGameplaySql}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#FA5A00] hover:brightness-105 text-black text-xs font-bold transition-colors cursor-pointer"
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                {copiedGameplaySql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedGameplaySql ? 'Copied!' : 'Copy Migration SQL'}</span>
              </button>
            </div>
            <p className="text-xs text-neutral-400 mb-2.5">
              If you already have <code className="text-[#FA5A00]">matches</code> and <code className="text-[#FA5A00]">match_players</code>, paste this quick snippet into SQL Editor to add <code className="text-[#FA5A00]">match_rounds</code> and <code className="text-[#FA5A00]">match_round_submissions</code>.
            </p>
            <pre className="p-3 bg-black border border-neutral-800 text-[11px] font-mono text-[#FA5A00] overflow-x-auto max-h-28">
              {SQL_GAMEPLAY_MIGRATION}
            </pre>
          </div>

          {/* Step 2 */}
          <div className="p-4 bg-black border border-neutral-800">
            <div className="flex items-center justify-between mb-2">
              <div
                className="font-bold text-sm text-white uppercase tracking-wider flex items-center gap-2"
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                <span className="w-5 h-5 bg-[#FA5A00] text-black text-xs flex items-center justify-center font-bold">
                  2
                </span>
                <span>Environment Variables</span>
              </div>
              <button
                onClick={handleCopyEnv}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-black border border-neutral-800 hover:border-neutral-700 text-neutral-200 text-xs font-semibold transition-colors cursor-pointer"
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                {copiedEnv ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedEnv ? 'Copied!' : 'Copy Config'}</span>
              </button>
            </div>
            <p className="text-xs text-neutral-400 mb-2.5">
              Configured in your project settings:
            </p>
            <pre className="p-3 bg-black border border-neutral-800 text-[11px] font-mono text-[#FA5A00]">
              {envSample}
            </pre>
          </div>

          {/* Dual Window testing tip */}
          <div className="p-4 bg-black border border-neutral-800 text-xs text-neutral-300 flex items-start gap-3">
            <Terminal className="w-4 h-4 text-[#FA5A00] shrink-0 mt-0.5" />
            <div>
              <div
                className="font-bold text-white uppercase tracking-wider mb-1"
                style={{ fontFamily: "'Chakra Petch', sans-serif" }}
              >
                2-Player Real-time Testing
              </div>
              <div className="text-neutral-400 leading-relaxed">
                Open FIZZ OUT in two browser windows side-by-side. Create a room in Window 1, copy the 6-character room code, and join from Window 2. Both windows will immediately connect!
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-neutral-800 flex items-center justify-between">
          {onRecheck ? (
            <button
              onClick={handleCheckConnection}
              disabled={isChecking}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-black border border-neutral-800 hover:border-neutral-700 text-neutral-200 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
              style={{ fontFamily: "'Chakra Petch', sans-serif" }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
              <span>Re-check Database</span>
            </button>
          ) : <div />}
          <button
            onClick={onClose}
            className="px-5 py-2 bg-[#FA5A00] hover:brightness-105 text-black font-extrabold text-xs uppercase tracking-wider transition-colors cursor-pointer"
            style={{ fontFamily: "'Chakra Petch', sans-serif" }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
