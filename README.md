# 💥 Boom Boom Chips

A 1v1 web duel of nerve and sabotage.

You secretly plant **3 bombs** in your opponent's chips. They do the same to yours.
Then you take turns **eating from your own plate**, with no idea what they buried
there. Three bombs and you are out — **last one standing wins.**

```
        YOUR PLATE                    THEIR PLATE
   (they rigged this one)        (you rigged this one)

   +-----+-----+-----+            +-----+-----+-----+
   |  OK |  ?  |  ?  |            | BOMB|     |     |
   +-----+-----+-----+            +-----+-----+-----+
   |  ?  |BOOM!|  ?  |            |     | BOMB|  OK |
   +-----+-----+-----+            +-----+-----+-----+
   |  ?  |  ?  |  ?  |            |     |  OK | BOMB|
   +-----+-----+-----+            +-----+-----+-----+

   YOUR LIVES   * * o             THEIR LIVES   * * *
```

Plays in any modern browser — desktop, tablet, phone, portrait or landscape.

---

## Quick start

```bash
npm install
npm run dev          # client on :5173, server on :8080
```

Open <http://localhost:5173>. To test multiplayer, open a **second tab** — session
tickets are stored per tab, so two tabs are genuinely two players.

### Production

```bash
npm run build
BBC_CLIENT_DIR=client/dist npm start   # one process serves the game and the socket
```

---

## Rules as implemented

| Rule | Behaviour |
|---|---|
| Plate | 3×3, 9 chips in front of each player |
| Planting | you choose 3 cells **in your opponent's plate** — or hit **Randomise** |
| Your turn | you eat one chip **from your own plate** |
| Safe chip | nothing happens, and the turn passes |
| Bomb | it goes off and **costs you a life** — and the turn still passes |
| Lives | 3 each. Lose all three and you are eliminated |
| Winning | the last player still standing |
| Turn clock | 30 s in multiplayer (a random chip is eaten on timeout); none vs a bot |
| Setup clock | 90 s in multiplayer, then unplanted bombs are placed at random |
| Rematch | needs both players; **the winner eats first** as a handicap (see below) |
| Disconnect | 60 s grace period, then the match is awarded to the player still there |

**Why the winner moves first.** Both players eat at the same rate, so whoever bites
first reaches their third bomb first when the plates run equally badly. Eating first
is therefore the *weaker* seat, and handing it to the previous winner keeps a rematch
chain balanced without anyone having to think about it.

---

## Architecture

```
PLAYER -> CLIENT -> WEBSOCKET -> GAME SERVER -> ROOM -> ENGINE -> validated state
                                                          |
                                                toPlayerView(state, slot)
                                                          |
                                                only what you may know
```

```
boom-boom-chips/
├── shared/          # no React, no Node — pure rules, types and protocol
│   └── src/
│       ├── types/       core.ts · game.ts · result.ts
│       ├── game/        engine.ts · view.ts · rng.ts · events.ts
│       ├── protocol/    messages.ts · guards.ts · codes.ts · partyCode.ts
│       └── bot/         model.ts · strategies.ts · types.ts
├── server/          # authority: rooms, sockets, timers, sessions
│   └── src/
│       ├── net/         gateway.ts · wsServer.ts · connection.ts
│       ├── rooms/       room.ts · roomManager.ts · sessionToken.ts
│       ├── app.ts       assembled but not listening (so tests can boot it)
│       └── index.ts     the entry point
├── client/          # React 19 + Vite + Tailwind v4 + Motion + Zustand
│   └── src/
│       ├── screens/     one file per screen
│       ├── components/  chip/ · grid/ · hud/ · ui/
│       ├── state/       store.ts (presentation) · settings.ts
│       ├── net/         transport.ts
│       ├── audio/       audio.ts — every sound is synthesised at runtime
│       └── fx/          particles.ts · Backdrop.tsx
└── tests/           # vitest units + integration, playwright e2e
```

### Why it is built this way

**The engine is a pure function.** `shared/src/game/engine.ts` imports nothing but
types. It takes a state and an action, returns a new state and the public events it
produced. No clock of its own, no I/O. That is what makes 42 rules tests run in
120 ms and what lets the server be a thin shell around it.

**One exit door for secrets, and it points both ways.** The asymmetry is the whole
game: the bombs in *your* plate belong to your opponent and must stay invisible to
you, while the bombs you planted in *theirs* are yours to see. `toPlayerView` builds
its result out of explicitly permitted fields rather than deleting forbidden ones, so
a field added to `GameState` tomorrow cannot leak by accident. `tests/view.test.ts`
attacks both directions, including generating every one of the 84 possible layouts
and asserting the serialised payload is byte-identical across all of them.

**State + events.** Every server reply carries the receiver's *full* redacted view
plus the events that produced it. The view is the truth the client renders; the events
are only animation cues. A client that misses events still converges — which is what
makes reconnection and packet loss boring instead of catastrophic.

**Bot matches run on the server too.** Not for symmetry — because it is the only way
the bomb layout never enters the browser. There is deliberately no offline fallback:
an offline mode would have to put the bombs in client memory.

---

## The bot

```ts
interface BotStrategy {
  plantBombs(rng: Rng, memory: BotMemory): ChipIndex[];
  chooseMove(view: PlayerView, rng: Rng, memory: BotMemory): ChipIndex;
}
```

**The signature is the anti-cheat guarantee.** A strategy receives a `PlayerView` —
byte for byte the same redacted object a human client receives over the socket — and
has no route to `GameState`.

There is a real design constraint underneath the difficulty ladder: **with 3 bombs
among 9 chips and nothing eaten, every remaining chip is exactly equally likely.**
Board analysis alone therefore cannot make a bot safer. So the ladder is a ladder of
*opponent models*, applied through exact Bayesian inference over all 84
configurations — and it needs two distinct beliefs, because where a person *plants*
and where a person *reaches* are different instincts:

| | Model used to choose what to eat | Model used to choose where to plant |
|---|---|---|
| 🟢 **Easy** | none — uniform | uniform |
| 🟡 **Normal** | the human model, sampled loosely | loosely aimed at their appetite |
| 🔴 **Hard** | the human model, argmin risk | squarely where people reach |
| 🟣 **Expert** | Hard, plus this opponent's habits learned across rematches | adapts to how they snack |

Measured over 12,000 paired games against a human-like opponent, with the first bite
alternating so the handicap cancels out:

```
EASY    50.0%      vs a uniformly random opponent, every rung lands
NORMAL  53.0%      on 50% — no model can grip on noise, which is
HARD    58.6%      what "not cheating" looks like in numbers.
EXPERT  58.9%
```

Both halves of that are asserted in `tests/bot.test.ts`. A decomposition run showed
where the edge actually lives: choosing what to eat is worth about +8.5 points, while
choosing where to plant is worth about +1.9 — so the ladder is calibrated on the
former.

---

## Fairness and security

- The client is treated as hostile. Every inbound frame is size-capped, JSON-parsed
  defensively, and validated field by field before the server looks at it.
- The server owns the only `GameState`. Clients never decide who wins, whose turn it
  is, whether a chip is a bomb, or whether an action is legal.
- Bomb positions come from a CSPRNG with **rejection sampling**, not a modulo fold —
  a modulo bias is exactly the kind of thing a competitive player could exploit.
- The bombs waiting in your plate are never serialised to you. Both layouts open only
  once the match ends.
- Even the *timing* is uniform: a chip holds the same beat of tension before opening
  whether it is a bomb or not, because a longer pause before a bomb would leak the
  answer through the animation.
- Per-connection token bucket, per-address party and connection caps.
- Session tickets are HMAC-signed, expire, and are compared in constant time. A ticket
  names a seat and carries no game information.
- Party codes use a 26-symbol alphabet with every look-alike removed (no `O/0`, `I/1`,
  `S/5`, `B/8`, `Z/2`) and are matched case-insensitively, folding common mistypes.

---

## Testing

```bash
npm test         # 157 unit + integration tests (vitest)
npm run test:e2e # 43 browser tests across 3 viewports (playwright)
```

| Suite | What it proves |
|---|---|
| `engine.test.ts` | the rules: planting into the opposing plate, eating from your own, lives, elimination, timeouts, rematch, immutability |
| `view.test.ts` | the redaction boundary in both directions — key allowlist, information-content equality, brute force over all 84 layouts |
| `bot.test.ts` | legality, termination, the strength ladder, and that no difficulty beats the odds against a random opponent |
| `multiplayer.test.ts` | the real gateway and rooms: join errors, out-of-turn moves, races, disconnect, reconnect, rematch, room lifecycle |
| `botMatch.test.ts` | bot matches end to end through the protocol |
| `integration.test.ts` | a real HTTP server on a real port with real sockets |
| `e2e/game.spec.ts` | the built game in a browser, including **two browser contexts playing each other** |
| `e2e/responsive.spec.ts` | no overflow and ≥44px touch targets at 360/390/430/768 wide, both orientations |

Some bugs these tests and screenshots caught, for the record: chip faces rendering at
zero size (the wrapper spans were `display:inline`), a bomb selection surviving into a
rematch, an opponent-model term that zeroed the probability of every cell the player
had not yet touched, and a ladder comparison so noisy it hid a real 3-point gap until
the scenarios were paired.

---

## Configuration

All optional; the defaults are sensible for local development.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP and WebSocket port |
| `BBC_HOST` | `0.0.0.0` | bind address |
| `BBC_CLIENT_DIR` | *(unset)* | serve a built client from here |
| `BBC_SESSION_SECRET` | random per boot | **set this in production**, or reconnection breaks on every restart and across replicas |
| `BBC_ALLOWED_ORIGINS` | *(any)* | comma-separated origin allowlist for the socket |
| `BBC_DISCONNECT_GRACE_MS` | `60000` | how long a seat is held for a returning player |
| `BBC_SESSION_TTL_MS` | `1800000` | reconnection ticket lifetime |
| `BBC_EMPTY_PARTY_TTL_MS` | `900000` | how long an unjoined lobby survives |
| `BBC_RATE_BURST` / `BBC_RATE_PER_SECOND` | `24` / `12` | per-connection token bucket |
| `BBC_MAX_PARTIES_PER_IP` | `12` | anti-spam |

---

## Deployment

The server serves the built client, so this ships as **one process, one port, one
container**. It needs a host that supports persistent WebSocket connections — a normal
Node host (Render, Railway, Fly.io, a VPS, Coolify) rather than a serverless function
platform.

```bash
docker build -t boom-boom-chips .
docker run -p 8080:8080 -e BBC_SESSION_SECRET="$(openssl rand -hex 32)" boom-boom-chips
```

Behind a reverse proxy, forward the `Upgrade` and `Connection` headers and set
`X-Forwarded-For` so the per-address limits see real clients.

### Splitting the client onto a static host

Netlify, Vercel and friends can serve the client, but **not** the game server: it
holds WebSocket connections open and keeps room state in memory, which serverless
platforms do not do — and their proxy redirects do not forward WebSockets either.

A `netlify.toml` is included for that split. Set one build variable on the static
host and two on the Node host:

| Where | Variable | Value |
|---|---|---|
| static host | `VITE_WS_URL` | `wss://your-server.example.com/ws` |
| Node host | `BBC_SESSION_SECRET` | `openssl rand -hex 32` |
| Node host | `BBC_ALLOWED_ORIGINS` | `https://your-site.netlify.app` |

`VITE_WS_URL` is baked in at build time, so changing it needs a redeploy, and it must
be `wss://` or a browser on an HTTPS page will refuse the connection. Leave
`BBC_CLIENT_DIR` unset on the Node host so it does not also try to serve a client.

Running both halves from the single container above is simpler and avoids the
cross-origin setup entirely; the split is only worth it if you already have a domain
parked on the static host.

Rooms are held in memory: a restart ends live matches, and running more than one
replica requires sticky sessions (or a shared room store, which this does not have).
For a game of this size, one process handles a very large number of concurrent rooms.

---

## Accessibility

Keyboard playable throughout — arrow keys walk the plate, Enter eats. Every chip
carries a spoken label (`"Chip 5, safe"`, `"Chip 5, your bomb, not eaten yet"`).
Outcomes are never signalled by colour alone: a safe chip shows a check, a bomb shows
a bomb. Focus rings are visible and on-brand. **Reduced motion** is honoured from the
OS and can be overridden either way in Settings; it removes particles, screen shake
and the tension beat.

---

## Licence

MIT — see [LICENSE](LICENSE). All audio is synthesised at runtime from oscillators and
shaped noise, so there is no third-party audio in this repository.
