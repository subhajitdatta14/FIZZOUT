-- ============================================================================
-- FIZZ OUT: Hardened Supabase Database Schema & Multi-Layer Security Architecture
-- ============================================================================
-- Security Model:
-- 1. Anonymous / authenticated browser clients are STRICTLY restricted to SELECT on matches & match_players.
-- 2. No client can INSERT, UPDATE, or DELETE matches or match_players directly (Zero Client Write Access).
-- 3. Secret side assignments are quarantined in match_player_secrets (Zero Public Access - RLS Deny All).
-- 4. Ephemeral session hashes are stored in match_player_sessions (Zero Public Access - RLS Deny All).
-- 5. All mutations & state transitions are authoritatively handled by Node.js backend using SUPABASE_SERVICE_ROLE_KEY.
-- ============================================================================

-- 1. Matches Table (NO hardcoded topic; gameplay-free security foundation)
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
-- Note: assigned_side is strictly NULL until that player calls /api/matches/reveal-side!
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
-- Neither Player A nor Player B can query this table (Zero public RLS policies)!
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

-- 5. Safe Unique Constraints Migration Block
DO $$
BEGIN
    -- Constraints for match_players
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_match_player_slot') THEN
        ALTER TABLE public.match_players ADD CONSTRAINT unique_match_player_slot UNIQUE(match_id, player_slot);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_match_player_id') THEN
        ALTER TABLE public.match_players ADD CONSTRAINT unique_match_player_id UNIQUE(match_id, player_id);
    END IF;

    -- Constraint for match_player_secrets
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_match_player_secret') THEN
        ALTER TABLE public.match_player_secrets ADD CONSTRAINT unique_match_player_secret UNIQUE(match_id, player_id);
    END IF;

    -- Constraint for match_player_sessions
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_match_player_session') THEN
        ALTER TABLE public.match_player_sessions ADD CONSTRAINT unique_match_player_session UNIQUE(match_id, player_id);
    END IF;
END $$;

-- 6. Enable Row Level Security (RLS) on all 4 tables
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_player_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_player_sessions ENABLE ROW LEVEL SECURITY;

-- 7. Remove any previous insecure policies
DROP POLICY IF EXISTS "Allow anonymous read matches" ON public.matches;
DROP POLICY IF EXISTS "Allow anonymous insert matches" ON public.matches;
DROP POLICY IF EXISTS "Allow anonymous update matches" ON public.matches;
DROP POLICY IF EXISTS "Allow anonymous delete matches" ON public.matches;
DROP POLICY IF EXISTS "Allow anonymous read match_players" ON public.match_players;
DROP POLICY IF EXISTS "Allow anonymous insert match_players" ON public.match_players;
DROP POLICY IF EXISTS "Allow anonymous update match_players" ON public.match_players;
DROP POLICY IF EXISTS "Allow anonymous delete match_players" ON public.match_players;
DROP POLICY IF EXISTS "Allow anonymous select matches" ON public.matches;
DROP POLICY IF EXISTS "Allow anonymous select match_players" ON public.match_players;
DROP POLICY IF EXISTS "Allow anonymous select match_player_secrets" ON public.match_player_secrets;
DROP POLICY IF EXISTS "Allow anonymous select match_player_sessions" ON public.match_player_sessions;

-- 8. Restricted SELECT-only policies for public clients
-- Clients can read match status and observable player slots.
-- Zero write policies (INSERT/UPDATE/DELETE) exist for clients.
CREATE POLICY "Allow anonymous select matches" ON public.matches FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow anonymous select match_players" ON public.match_players FOR SELECT TO anon, authenticated USING (true);

-- Tables match_player_secrets and match_player_sessions deliberately have NO policies.
-- By PostgreSQL RLS default, all SELECT/INSERT/UPDATE/DELETE requests from anon or authenticated are REJECTED.
-- Only the Node.js server using SUPABASE_SERVICE_ROLE_KEY bypasses RLS authoritatively.

-- 9. Realtime Publication Configuration
-- Only matches, match_players, and match_rounds are published. Secrets, sessions, and submissions are NEVER published!
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'matches') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'match_players') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.match_players;
    END IF;
END $$;

-- ============================================================================
-- 10. Match Rounds Table (Publicly Observable Phase & Score State for 3 Rounds)
-- ============================================================================
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_match_rounds_lookup ON public.match_rounds(match_id, round_number);

-- ============================================================================
-- 11. Match Round Submissions Table (Server-Only: Hidden Argument Security)
-- ============================================================================
-- During BLIND phase, Player A must NEVER be able to read Player B's submission!
-- Therefore, this table has RLS Deny All (zero public policies).
-- Arguments are only revealed through server APIs at legitimate phase boundaries!
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

-- 12. Safe Unique Constraints for Gameplay
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_match_round') THEN
        ALTER TABLE public.match_rounds ADD CONSTRAINT unique_match_round UNIQUE(match_id, round_number);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_round_player_phase') THEN
        ALTER TABLE public.match_round_submissions ADD CONSTRAINT unique_round_player_phase UNIQUE(match_id, round_number, player_id, phase);
    END IF;
END $$;

-- 13. Enable RLS on Gameplay Tables
ALTER TABLE public.match_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_round_submissions ENABLE ROW LEVEL SECURITY;

-- 14. Policies for Gameplay Tables
DROP POLICY IF EXISTS "Allow anonymous select match_rounds" ON public.match_rounds;
CREATE POLICY "Allow anonymous select match_rounds" ON public.match_rounds FOR SELECT TO anon, authenticated USING (true);

-- match_round_submissions has NO policies for anon or authenticated.
-- Protected arguments can ONLY be accessed by the backend with SUPABASE_SERVICE_ROLE_KEY.

-- 15. Realtime for match_rounds
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'match_rounds') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.match_rounds;
    END IF;
END $$;

-- 16. Replica Identity for Realtime Payloads (guarantees full row delivery on UPDATE events)
ALTER TABLE public.matches REPLICA IDENTITY FULL;
ALTER TABLE public.match_players REPLICA IDENTITY FULL;
ALTER TABLE public.match_rounds REPLICA IDENTITY FULL;
