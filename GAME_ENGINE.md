# Game Engine

This document explains how the simulation actually works, mechanism by
mechanism. For the high-level pipeline, see `CASE_GENERATION.md`.

## Time

All in-case time is an integer count of minutes since "Day 0, 00:00" for that
case (`GameMinutes`, `lib/game-engine/types/time.ts`). This keeps interval
math (duration, travel time, overlap) as plain integer arithmetic instead of
`Date` bookkeeping, and keeps a case's internal calendar independent of the
real-world date it was generated on.

## The town

`world/world-generator.ts` builds a small fixed-size grid town (8km × 8km,
abstract coordinates) out of a fixed set of location *templates*
(`world/data.ts`): one police station, a couple of restaurants, a bar, a
bank, a hospital, gas stations, shops, a hotel, a park, a warehouse, parking
lots, office buildings. Each instantiated location gets randomized (but
seed-deterministic) coordinates, camera/wifi/badge presence, and opening
hours. Homes are created separately, one per person, sized (apartment vs.
house) by that person's wealth.

Travel time between any two coordinates is `travelMinutes(a, b, mode)` in
`types/location.ts`: walking at 5 km/h, driving at 35 km/h, rounded up to at
least 1 minute. This single function is used both to *generate* travel
events and, independently, by the validator to check that no one was asked
to move faster than physically possible — see "No teleportation" below.

## Population and relationships

`case-generator/population.ts` creates every person in the cast (victim +
suspects + witnesses, sized by difficulty) with a full personality vector
(intelligence, impulsivity, sociability, aggressiveness, honesty, loyalty,
fearfulness — each 0–1), a home, an optional workplace matched to their
profession, a phone number, and maybe a vehicle.

`case-generator/relationships.ts` then builds a social graph over that cast:
family clusters, couples, ex-partners, affairs, colleagues/bosses, debts,
neighbors, friends/acquaintances. Each relationship carries directional
attributes (trust, affection, hatred, jealousy, fear, dependency, debt in
CHF) and an optional `secret`.

## Victim and motive selection

This is the part that keeps the case from being unsolvable-by-construction.
`case-generator/motive.ts`:

1. For **every** person in the cast, it runs the same motive-derivation rules
   that will later produce the culprit's actual motive, and only victims with
   at least one real candidate are eligible (`selectVictim`).
2. `deriveMotiveCandidates(victim, ...)` walks every relationship the victim
   has and maps it to a `MotiveType` (jealousy, revenge, debt,
   fear_of_denunciation, inheritance, professional_conflict, rivalry,
   secret_exposure, ...) with a strength derived from the relationship's own
   attributes — never chosen freely. It also checks one level of network
   structure: if a candidate is having a secret affair with someone whose
   spouse is the victim, that's a `secret_exposure` motive grounded in *two*
   relationships at once.
3. `pickCulprit` picks among candidates weighted by strength (favoring, but
   not always choosing, the strongest motive — for replayability across
   seeds), which keeps the same relationship graph capable of producing
   different outcomes without ever picking someone with zero motive.

## Timeline simulation

`simulation/schedule.ts` + `simulation/timeline-engine.ts` build the day:

- **Baseline** (`generateDailyBaseline`): wake up, commute, work, commute
  home — for everyone, including the victim and culprit.
- **Evening** (`generateEveningBlock`): for everyone *except* the victim and
  culprit, either stay home or go out (with an optional companion pulled from
  friend/family/spouse relationships). A `processed` set prevents anyone from
  being double-booked as two different people's evening companion, and
  companions are only offered to people who are actually free by then.
- **The crime** (`simulateCaseDay`'s main body): built as a **strictly
  forward-scheduled** sequence — a premeditation purchase (if applicable),
  a lure message/call (if the victim needs to travel to the meeting point),
  travel for whichever party needs to move, then the confrontation. Each step
  is placed *after* the previous one actually finishes for that specific
  person; the meeting only starts once both cursors say both people have
  arrived. `crimeTimestamp` is a **derived** value (when the argument ends),
  never a fixed anchor worked backward from — this is what makes the
  sequence robust to any combination of random rolls.
- **Aftermath**: the culprit flees (a real `travel()` call — this is where a
  route waypoint, e.g. a gas station's camera or wifi, can pick them up, see
  below); a discoverer (someone connected to the victim, not the culprit) is
  chosen and finds the body 9–14 hours later. If the discoverer's own
  independent evening was still running when the call comes, it's trimmed or
  dropped rather than left to silently overlap — see "No teleportation".

### The waypoint mechanic

`simulation/geo.ts#findRouteWaypoint` checks whether a straight line between
two points in a `travel()` call passes near a location with a camera or wifi
(within 0.6km). If so, a short extra event is inserted there. This is what
produces the flagship "his phone connected to the gas station wifi on the
route between the crime scene and his home" clue (the driving design goal —
see project brief §50) as a physically grounded consequence of geography,
not a scripted narrative beat.

## No teleportation

`validator/case-validator.ts#checkTimelinePhysicality` builds, per person, a
list of "occupancy" intervals from every event where they're the actor or
merely present, **excluding** `travel` and the momentary waypoint `other`
events (which represent motion itself, not being stationary somewhere).
Consecutive stationary intervals for the same person are checked two ways:

- Overlapping intervals at different locations → impossible (flagged as
  "présence simultanée").
- Non-overlapping but too close together → the elapsed time between their
  start times must be at least `travelMinutes(locA, locB, "car")` — car
  speed is used as the most permissive (fastest) floor, so only genuine
  impossibilities are flagged, never a false positive from someone happening
  to walk instead of drive.

## Evidence

`evidence/evidence-generator.ts` never invents evidence independently of the
timeline: every `TimelineEvent` carries `evidenceSourceTags` (e.g. `camera`,
`phone_wifi`, `dna`, `card_payment`) chosen at the moment the event is
created, and the evidence generator maps each tag to a concrete `Evidence`
record with a family (physical/digital/video/financial/testimonial), a
reliability roll (small chance of `contaminated`), and — for physical
evidence — a required lab analysis type with a fixed duration
(`LAB_ANALYSIS_DURATION_MINUTES`). Evidence only becomes discoverable once
the case is "opened" (the body is found), never before.

Red herrings (`generateRedHerrings`) are deliberately attached to *other*
motive candidates (people who had a real, if weaker, reason to want the
victim gone) rather than to arbitrary people — so a red herring is always a
plausible alternate suspect, never noise.

## Witnesses: perception, memory, and knowledge

`witness/perception.ts` computes, per observed event and observer, a
`perceptionQuality` (intelligence, stress, time of day, glance-vs-sustained)
and a `memoryQuality` (decayed further by the time the investigation asks).
`witness/knowledge-graph.ts` turns every observable event into one
`KnowledgeFact` per present person; a `shouldCorrupt` roll decides whether
that fact is a genuine, non-malicious memory/perception error (e.g. a
witness who didn't recognize the driver misremembering the car's color —
the canonical example from the design brief). One hop of gossip propagation
(`propagateSecondHandKnowledge`) lets facts spread through
friend/family/spouse ties before the case opens, always *after* the source
actually knew it.

`witness/testimony-generator.ts` converts facts into what a person would
actually say if asked: the culprit lies about their own incriminating
movements (using their `Alibi`'s claim, for consistency); people with a
strong bond to the culprit sometimes protect them (omission/vagueness); an
honest witness who happened to misremember something still reports it
"truthfully" — they're not lying, they're wrong, and the game distinguishes
the two (design brief §21).

## Alibis

`case-generator/alibis.ts` derives each suspect's *true* location at the
crime-time window directly from the timeline, then decides what they
*claim*. The culprit's claim is false whenever their real location differs
from home; a small fraction of innocent suspects also lie about an unrelated
secret (never the murder itself), which is what creates alibi red herrings.
`computeAlibiSupport` cross-references the claim against the evidence pool
generically (does discoverable evidence about this person, in this time
window, point at the claimed location or somewhere else?) — the same
function works for both true and false alibis.

## Validator and solvability

`validator/case-validator.ts#validateCase` checks core facts (motive
actually points from culprit to victim, etc.), timeline physicality (above),
the knowledge graph (nobody knows something before its source event
happened, or before whoever told them knew it themselves), alibi
consistency, and finally solvability.

`validator/solvability.ts#computeSolvability` counts independent "channels"
of proof against the true culprit: motive, physical evidence, video,
digital, financial, a contradicted alibi, a caught lie. A case is only valid
if at least `MIN_INDEPENDENT_CHANNELS` (3) of these converge — this is the
direct implementation of the design mandate "never a single fragile clue".

## What's deliberately not modeled yet

- Accomplices (`accompliceIds` exists on `CaseTruth` and is always `[]` for
  now — single-culprit homicide only, per the "build one excellent mechanic
  first" directive).
- Crime types other than homicide (`CrimeType` is a union of one value).
- A live, player-time-driven memory decay (testimony is generated once, as
  of when the case opens — see `ROADMAP.md`).
