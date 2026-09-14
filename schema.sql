-- ============================================================================
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
END $$;
