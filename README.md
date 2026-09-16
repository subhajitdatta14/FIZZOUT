# ⚡ FIZZ OUT

> **The high-stakes, fast-paced blind debate arena powered by AI adjudication and real-time multiplayer.**

```
   ███████╗██╗███████╗███████╗     ██████╗ ██╗   ██╗████████╗
   ██╔════╝██║╚══███╔╝╚══███╔╝    ██╔═══██╗██║   ██║╚══██╔══╝
   █████╗  ██║  ███╔╝   ███╔╝     ██║   ██║██║   ██║   ██║   
   ██╔══╝  ██║ ███╔╝   ███╔╝      ██║   ██║██║   ██║   ██║   
   ██║     ██║███████╗███████╗    ╚██████╔╝╚██████╔╝   ██║   
   ╚═╝     ╚═╝╚══════╝╚══════╝     ╚═════╝  ╚═════╝    ╚═╝   
```

---

## 🎯 What is FIZZ OUT?

**FIZZ OUT** is a real-time, 1-on-1 rhetorical duel where players are pitted against each other on absurd, spicy, or philosophical debate topics. 

The twist? **You don't know who is arguing which side until the blind phase closes.** Write fast, formulate lethal rebuttals, and face the impartial judgment of an AI Arbiter powered by **Google Gemini**.

---

## ⚔️ The Battle Loop

```
  [1. LOBBY]           [2. BLIND ROUND]           [3. COUNTER ROUND]           [4. THE VERDICT]
Room Code Join  ──►  Secret Side Assigned  ──►  Opponent Argument   ──►  Gemini AI Scores
Live Ready-Check      Blind Argument Pitch        Revealed & Rebuttal       Logic, Wit & Win
```

1. **Codename & Lobby**: Enter with an undercover codename, spin up a room with an auto-generated 6-character code, or jump into a friend's match.
2. **The Secret Assignment**: A fresh, non-repeating topic is drawn. Each player is covertly dealt their stance (*FOR* or *AGAINST*).
3. **Blind Phase**: Both contenders compose their opening salvo under the countdown timer without knowing their opponent's stance.
4. **Counter Phase**: The veil lifts! Read your rival’s argument and immediately craft a counter-argument under pressure.
5. **AI Adjudication**: Google Gemini evaluates both debaters on:
   - 🧠 **Logic & Coherence**
   - 🔥 **Rhetorical Wit & Persuasion**
   - 🎯 **Direct Rebuttal Precision**
6. **Leaderboard & Rematch**: Crown the round victor, review match summaries, and immediately run it back with new topics.

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend** | React 18, Vite, TypeScript | Ultra-responsive client SPA |
| **Styling** | Tailwind CSS, Lucide Icons | Dark neon-accented battlefield aesthetic |
| **Animation** | Motion (`motion/react`) | Fluid transitions and round phase cues |
| **Backend** | Node.js, Express.js | Authoritative room generation & game state rules |
| **Database** | Supabase (PostgreSQL) | Ephemeral matches, round states, sessions |
| **Realtime** | Supabase Realtime Channels | Instant two-player synchronization |
| **AI Arbiter** | Google Gemini API (`@google/genai`) | Debate prompt generation & multi-factor judging |
| **Deployment** | Vercel / Cloud Run | Dual support: Serverless function (`/api`) or standalone daemon |

---

## 📁 Architecture Overview

```
├── api/
│   └── index.ts                 # Vercel serverless function entrypoint
├── src/
│   ├── components/              # Lobby, Room Creation, Codename, Match Views
│   ├── services/
│   │   ├── gameService.ts       # Type-safe API client & defensive JSON parsing
│   │   └── supabase.ts          # Client-side Supabase Realtime connection
│   ├── utils/                   # Session tokens, timers, and storage helpers
│   ├── App.tsx                  # Primary game state manager & router
│   └── main.tsx                 # React entrypoint
├── server.ts                    # Authoritative Express game server & Gemini judge
├── vercel.json                  # Vercel SPA rewrites and /api route handling
└── .env.example                 # Config template
```

---

## 🚀 Quickstart & Local Development

### 1. Prerequisites
- **Node.js**: v18+ or v20+
- **Supabase Account**: A free Supabase project with Realtime enabled.
- **Google Gemini API Key**: From [Google AI Studio](https://aistudio.google.com/).

### 2. Clone and Install
```bash
git clone https://github.com/your-username/fizz-out.git
cd fizz-out
npm install
```

### 3. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Fill in your secrets:
```env
# Client-side Supabase credentials
VITE_SUPABASE_URL="https://your-project.supabase.co"
VITE_SUPABASE_ANON_KEY="your-anon-key"

# Server-side Supabase Service Role Key (NEVER expose to client)
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"

# Google Gemini API key for AI topic selection & debate judging
GEMINI_API_KEY="your-gemini-api-key"
```

### 4. Database Setup
Run the database migration SQL in your **Supabase Dashboard > SQL Editor** (available in the in-app Setup Dialog or migration files) to provision the following tables:
- `matches`
- `match_players`
- `match_player_secrets`
- `match_player_sessions`
- `match_rounds`
- `match_round_submissions`

### 5. Launch the Arena
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in two separate browser windows to test two-player live matchmaking!

---

## 🌐 Deploying to Vercel

1. **Import the repository** into Vercel.
2. Ensure the Framework Preset is set to **Vite**.
3. Add the following **Environment Variables** in Vercel Project Settings:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` *(Server-only)*
   - `GEMINI_API_KEY` *(Server-only)*
4. Hit **Deploy** — the included `vercel.json` and `api/index.ts` will automatically configure the static frontend and serverless API endpoints.

---

## 🔒 Security & Fair Play

- **Server-Authoritative Tokens**: Player identities are guarded by random session tokens passed via headers; players cannot spoof their opponent's submission.
- **Zero Client-Side Leaks**: Assigned debate stances and secret arguments are isolated in server storage until the reveal timestamp.
- **No API Key Exposure**: Both `GEMINI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` reside strictly on the server layer.

---

## 📜 License

MIT © [FIZZ OUT](https://ai.studio/build)
