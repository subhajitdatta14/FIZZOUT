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
