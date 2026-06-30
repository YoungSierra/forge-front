# Game Technical Design Document — Template

> **What this is.** A reusable Game TDD template that Forge **distills automatically from a project's node outputs**. Every section maps to one or more Forge nodes (see §0.2 Source Mapping). Sections fed by nodes that have already run are populated from real approved output; sections whose source node has not run yet are shown as `[PROJECTED]` placeholder content so the structure stays complete.
>
> **How to read it.** This copy is populated as a **worked example** using project **`Miami Gang 2`** (`3392ee67-6f51-4344-90a4-56d55b68e876`). Strip the example content to get the blank template, or let Forge regenerate it for any project.

---

## 0.1 · Document Control

| Field | Value |
|---|---|
| **Game title** | Miami Gang 2 *(`{{project.name}}`)* |
| **Studio** | V57 Studio *(`{{project.studio_name}}`)* |
| **Document** | Game Technical Design Document |
| **Version** | v0.1 — distilled 2026-06-24 *(`{{generated_at}}`)* |
| **Source project** | `3392ee67-6f51-4344-90a4-56d55b68e876` *(`{{project.id}}`)* |
| **Phase reached** | Ideation ✅ · Concept 🟡 in progress |
| **Status** | Draft for the Unity team — projected sections pending Concept lock |
| **Owner** | *(`{{project.owner}}`)* |

## 0.2 · How Forge generates this document (Source Mapping)

Each TDD section is **distilled** from the approved output(s) of specific Forge nodes. This is the contract between the pipeline and the document: when a node is approved, its section fills in; until then it is `[PROJECTED]`.

| TDD section | Distilled from (Forge node → output) | State |
|---|---|---|
| §1 High Concept | `1.1 Concept Exploration → concept_seeds`, `2.1 Pitch Document → pitch` | 🟡 partial |
| §2 Game Overview | `1.2 Market & Competitive Research → market_gap_analysis`, `1.3 Audience & Positioning → positioning_statement` | ✅ real |
| §3 Core Gameplay | `1.1 Concept Exploration → concept_seeds`, `2.2 Concept Development → mechanics` | 🟡 partial |
| §4 Mechanics & Systems | `2.2 Concept Development → systems` | 🔵 projected |
| §5 Game Modes | `1.4 Concept Selection → selected_seeds` | ✅ real |
| §6 World & Level Design | `2.2 Concept Development`, `2.4 Visual Orientation` | 🔵 projected |
| §7 Narrative & Characters | `2.2 Concept Development` | 🔵 projected |
| §8 Art Direction | `2.4 Visual Orientation → visual_orientation` | 🔵 projected |
| §9 UI / UX | `2.2 Concept Development`, `2.4 Visual Orientation` | 🔵 projected |
| §10 Audio Direction | `2.4 Visual Orientation` | 🔵 projected |
| §11 Technical Design (Unity) | `2.2 Concept Development`, engine constraints | 🔵 projected |
| §12 Business Model | `1.2 Market Research`, `2.3 Business Model & Financials → business_model` | 🟡 partial |
| §13 Content Scope & Assets | `2.2 Concept Development`, `2.4 Visual Orientation` | 🔵 projected |
| §14 Production Roadmap | `2.3 Business Model & Financials`, `2.6 Strategic Review` | 🔵 projected |
| §15 Risks & Open Questions | `1.4 Concept Selection`, `2.6 Strategic Review → review` | ✅ real |

**Legend:** ✅ real = from approved node output · 🟡 partial = some sources approved · 🔵 projected = source node not run yet, content invented to complete the template.

---

# 1 · High Concept

> **Template guidance:** one-sentence hook, elevator pitch, and the single core fantasy. *Distilled from `1.1 Concept Exploration` + `2.1 Pitch Document`.*

**One-liner.** *Build a 1970s Miami criminal empire by coercing, flipping, and weaponizing people — not by outgunning them.*

**Elevator pitch.** Miami Gang 2 is a **social-stealth, territory-control strategy** where territory is a *social graph*, not a map. Every NPC on the strip is a living leverage point with a hidden vulnerability profile and a loyalty owner. Your core verb is **the Flip** — converting someone else's asset to yours through leverage, surveillance, and debt. You rise from street-level operator to untouchable capo through *coercion*, never body count.

**Core fantasy.** *The puppet-master kingpin*: read the room, find the weak link, own it.

**Pillars.**
1. **Coercion over combat** — the decisive skill is social reading, not aiming.
2. **People as systems** — every NPC has an exploitable vulnerability + loyalty meter.
3. **Territory = relationships** — control is a network you grow, not ground you hold.

---

# 2 · Game Overview

> *Distilled from `1.2 Market & Competitive Research` + `1.3 Audience & Positioning`. (Approved — real content.)*

| Attribute | Value |
|---|---|
| **Genre** | Criminal-empire strategy |
| **Sub-genre** | Social-stealth × territory-control (criminal management sim) |
| **Setting** | 1970s Miami — the strip, the marinas, the nightclubs |
| **Perspective** | Stylized isometric / 2.5D *(projected — see §8)* |
| **Primary platform** | PC (Steam) |
| **Secondary platform** | Console, 12–18 months post-launch |
| **Target audience** | PC strategy players, 25–40 |
| **Price band** | $19.99–$29.99 (mid-tier indie) |
| **Session length** | 30–60 min loops; 15–25 h campaign *(projected)* |

**Comparables / references.** *Hitman* (social reading), *Crusader Kings III* (leverage webs), *Desperados III* (tactical positioning), *Empire of Sin* (the gap we fill — combat-forward, shallow NPCs), *Disco Elysium* (literary/social ceiling), *Orwell* (surveillance loop).

**Unique Selling Points (USP).**
- Every NPC is a **coercible asset** with a hidden vulnerability profile — the exact vacancy *Empire of Sin* left.
- The primary verb is **coercion**, not combat — a defensible, under-served fantasy.
- Territory modeled as a **living social graph** rather than a conquest map.

**Positioning statement (verbatim from `1.3`).**
> For PC strategy players (25–40) who love *Hitman*'s social reading and *Crusader Kings III*'s leverage webs but find crime-management games too shallow or too combat-forward, **Miami Gang 2** is a social-stealth territory-control strategy that lets you build a 1970s Miami empire by coercing, flipping, and weaponizing people — not by outgunning rivals.

---

# 3 · Core Gameplay

> *Distilled from `1.1 Concept Exploration` (core verbs) + `2.2 Concept Development` (loop). 🟡 verbs real, loop projected.*

**Core verbs (real, from `1.1`).** Flip · Surveil · Leverage · Launder · Defer.

**Core gameplay loop (projected).**
```
OBSERVE  → read a venue's social topology (who defers to whom, who's afraid)
TARGET   → assign watchers; accumulate intel into a dossier
LEVERAGE → convert a dossier into a coercion play (debt, blackmail, favor)
FLIP     → turn the target into your asset; the social graph shifts
CONSOLIDATE → launder gains, manage loyalty decay, defend against rival flips
```

**Macro loop.** Operator → Lieutenant → Capo, gating new districts and NPC tiers as the network grows.

**Win / lose conditions (projected).**
- **Win:** reach *Untouchable* status — control the city's key leverage nodes without exposure.
- **Lose:** exposure meter maxes (law/rival heat) or your network bankrupts (loyalty cascade).

---

# 4 · Mechanics & Systems

> **🔵 PROJECTED** — *source `2.2 Concept Development` has not been generated yet. Content below is invented to complete the template and will be replaced when the node runs.*

Each system below is specced for engineering: purpose, key data, and dependencies.

### 4.1 NPC Leverage System *(core)*
- **Purpose.** Every NPC carries a hidden **vulnerability profile** (e.g. debt, addiction, secret, ambition) and a **loyalty owner**.
- **Data.** `NpcProfile { id, role, district, vulnerabilities[], loyaltyOwner, loyaltyValue (0–100), exposureRisk }`.
- **Dependencies.** Surveillance (feeds intel), Social Graph (stores ownership), Coercion (consumes leverage).

### 4.2 Social Graph / Territory
- **Purpose.** Territory is a runtime **directed graph** of NPCs and ownership edges; "control" = share of weighted nodes per district.
- **Data.** Nodes = NPCs; edges = `defers_to`, `owes`, `owned_by` with weights.

### 4.3 Surveillance & Dossiers
- **Purpose.** Assign watchers to targets; intel accumulates over time into a **dossier** that unlocks leverage plays.

### 4.4 Coercion Resolution
- **Purpose.** Spend leverage to attempt a Flip; outcome is a probability function of leverage strength vs. target loyalty + exposure cost.

### 4.5 Economy / Ledger
- **Purpose.** Debt-as-weapon; laundering converts dirty income into usable capital; missed payments trigger loyalty shifts.

### 4.6 Heat / Exposure
- **Purpose.** Law and rival attention; aggressive plays raise heat; heat enables counter-flips against the player.

---

# 5 · Game Modes

> *Distilled from `1.4 Concept Selection → selected_seeds`. (Approved — real content. These are the two advanced seeds = the canvas lanes.)*

### 5.1 South of Eighth *(Seed 001 — solo campaign)*
- **Fantasy.** Busboy-to-capo, single-player depth.
- **Hook.** One-read premise; coercion verb lands immediately.
- **Differentiator.** NPC-as-leverage-point — durable mechanical depth.
- **Status.** **ADVANCE.** Veto-level risk flagged: NPC simulation fidelity (see §15).

### 5.2 Calle Ocho Nights *(Seed 002 — async competitive)*
- **Fantasy.** "Living chess piece / shared board" — rival kingpins on one city.
- **Hook.** Async competitive framing, distinct from solo depth.
- **Differentiator.** Shared-board multiplayer rivalry.
- **Status.** **ADVANCE (refined).** Scope the multiplayer ambition explicitly before Concept lock.

---

# 6 · World & Level Design  🔵 PROJECTED
> *Source `2.2 Concept Development` / `2.4 Visual Orientation` pending.*

- **Structure.** City split into **districts** (South Beach strip, Calle Ocho, the marinas, Liberty City fringe). Each district is a cluster in the social graph.
- **"Rooms" (real seed M-04).** Set-piece venues — hotel lobby, nightclub, marina — each a readable social topology puzzle.
- **Progression.** Districts unlock by network reach; difficulty = NPC tier + rival presence.

---

# 7 · Narrative & Characters  🔵 PROJECTED
> *Source `2.2 Concept Development` pending.*

- **Tone.** Neo-noir, 1970s Miami; ambition and betrayal over gunfire.
- **Protagonist.** A silent operator the player molds through choices (no fixed dialogue tree).
- **Key NPC archetypes.** The Banker, The Lieutenant, The Informant, The Rival Capo, The Cop on the Take.

---

# 8 · Art Direction & Visual Style  🔵 PROJECTED
> *Source `2.4 Visual Orientation → visual_orientation` pending — this is exactly the node the Unity team should request next.*

- **Style.** Stylized isometric 2.5D; saturated 1970s pastel-neon palette (coral, teal, sunset orange) against night-time noir contrast.
- **Readability first.** Social state (loyalty, ownership, heat) must be legible at a glance via color/iconography, not realism.
- **References.** *Vice City* palette, *Disco Elysium* painterly UI, *Hitman* clean-readability HUD.

---

# 9 · UI / UX  🔵 PROJECTED
> *Source `2.2` / `2.4` pending.*

**Key screens.** Social Graph view (primary), Dossier view, District map, Ledger/economy panel, Coercion-play resolution modal.
**UX principle.** The player manipulates *information*, so the UI **is** the gameplay surface — clarity of the graph is the #1 usability requirement.

---

# 10 · Audio Direction  🔵 PROJECTED
> *Source `2.4` pending.*

- 1970s funk/disco diegetic score; tension stingers tied to heat; sparse, atmospheric ambience in "rooms."

---

# 11 · Technical Design (Unity)  🔵 PROJECTED
> *Source `2.2 Concept Development` + engine constraints. Drafted for the Unity team — to be confirmed against the Concept-locked systems.*

| Area | Decision (proposed) |
|---|---|
| **Engine** | Unity 2022 LTS+ (URP) |
| **Render** | Universal Render Pipeline — stylized isometric, no heavy realtime lighting |
| **Architecture** | Data-driven: NPC profiles, vulnerabilities, districts as **ScriptableObjects**; runtime social graph as a managed in-memory structure |
| **Core gameplay code** | Deterministic simulation tick (no twitch input) → eases testing & async multiplayer |
| **AI** | Utility-based NPC decision-making over the social graph; no navmesh-heavy combat AI |
| **Save system** | Serialized graph state + ledger; JSON/binary snapshots |
| **Multiplayer (Calle Ocho)** | **Async**, server-authoritative shared board — no realtime netcode; turn/tick reconciliation |
| **Target hardware** | PC mid-range (integrated-GPU friendly given 2.5D scope) |
| **Build targets** | Windows/Mac (Steam) first; console post-launch |
| **Third-party** | TBD (UI toolkit, localization, analytics) |

**Engineering implication.** The design deliberately avoids realtime action — the technical risk lives in **simulation fidelity** (NPC graph believability), not in rendering or netcode.

---

# 12 · Business Model  🟡 PARTIAL
> *Distilled from `1.2 Market Research` (real) + `2.3 Business Model & Financials` (pending).*

- **Model.** Premium, single purchase. **$19.99–$29.99** mid-tier indie (real, from market research).
- **No live-service / microtransactions** — out of category and out of team scope.
- **Post-launch.** Possible content packs (new districts/modes); console port as secondary revenue. *(projected)*

---

# 13 · Content Scope & Asset List  🔵 PROJECTED
> *Source `2.2` / `2.4` pending.*

| Category | First-pass scope estimate |
|---|---|
| Districts | 4–6 |
| Venues / "rooms" | 12–18 |
| NPC archetypes | 8–12 (data-driven variants on top) |
| Unique NPC portraits | 40–60 |
| UI screens | ~8 core |
| Music tracks | 10–14 |

---

# 14 · Production Roadmap  🔵 PROJECTED
> *Source `2.3` + `2.6` pending.*

1. **Vertical slice** — one district, NPC leverage + Flip loop end-to-end.
2. **Alpha** — South of Eighth campaign playable; all core systems online.
3. **Beta** — Calle Ocho Nights async mode; content-complete.
4. **Ship** — Steam launch; console port scoped for +12–18 mo.

---

# 15 · Risks & Open Questions

> *Distilled from `1.4 Concept Selection` + `2.6 Strategic Review`. (Concept-selection risk is real and explicit in the approved output.)*

| Risk | Severity | Note |
|---|---|---|
| **NPC simulation fidelity** | 🔴 Veto-level | Flagged at Concept Selection: the whole fantasy depends on believable NPC leverage. Must be scoped & gated at Concept stage. |
| **Multiplayer scope (Calle Ocho)** | 🟠 High | Shared-board async ambition must be scoped explicitly before commitment — the differentiator is the fantasy, not a feature list. |
| **Readability of the social graph** | 🟠 High | If players can't read the graph, the game is unplayable — UX is core, not polish. |
| **Setting saturation** | 🟡 Med | "Miami crime" is crowded; coercion-verb positioning is the defense. |

**Open questions for the Unity team.**
1. Is async server-authoritative the right call for Calle Ocho, or P2P turn-based?
2. ScriptableObject-driven NPC data vs. external data tables (CSV/JSON) for designer iteration?
3. Target min-spec — does integrated-GPU support shape the art budget?

---

## Appendix A · Provenance / Traceability

Every section is regenerable. For audit, Forge stamps each section with the `forge_session.id` and `forge_asset.id` it was distilled from. Sections marked 🔵 PROJECTED have **no source asset yet** — running the mapped node (see §0.2) replaces the invented content with approved output.

| Section | Source node | Source status |
|---|---|---|
| §1, §3 verbs | 1.1 Concept Exploration | approved |
| §2, §12 | 1.2 Market Research | approved |
| §2 positioning | 1.3 Audience & Positioning | approved |
| §5, §15 | 1.4 Concept Selection | approved |
| §4, §6, §7, §9, §11, §13 | 2.2 Concept Development | **pending** |
| §12 financials | 2.3 Business Model & Financials | **pending** |
| §8, §10 | 2.4 Visual Orientation | **pending** |
| §15 review | 2.6 Strategic Review | **pending** |

---

_Template v0.1 — generated by Forge. Replace `{{placeholders}}` and 🔵 PROJECTED blocks by running the mapped Concept-phase nodes, then re-distill._
