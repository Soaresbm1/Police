# CASELINE — Fin de session

## Objectif

Faire évoluer le système d'art généré (Generated Art) de CASELINE, en production, à travers plusieurs volets :
- **Phase 5A** (avant ce volet Generated Art) : ajouter une couche d'observation post-crime immuable au moteur d'enquête (fondation pour une future mécanique de surveillance, Phase 5B — non commencée).
- **Generated Art V1** : auditer puis activer en production les portraits et décors de scène de crime générés (Cloudflare Workers AI), avec repli procédural garanti.
- **V2C-1** : corriger l'alignement visuel des hotspots de la scène de crime (bug de recadrage `object-cover`) + ancrage sémantique des zones.
- **V2A** : accélérer la génération (parallélisme borné) et faire apparaître les images automatiquement sans rafraîchissement manuel.
- **V2B** : créer un pool d'assets réutilisables **par utilisateur** (même portrait/décor réutilisé entre plusieurs affaires si compatible), avec garantie qu'aucune chaîne de réutilisation ne peut se former (source canonique unique).

## État actuel

- Tout est **commité et poussé** sur `origin/master`. Arbre de travail propre (`git status` vide).
- Dernier commit : `161ec99` — *feat: add reusable generated art pool*.
- Historique des commits de cette série :
  - `8e2aff6` — Phase 5A (couche d'observation post-crime)
  - `636051a` — V2C-1 (hotspots)
  - `00442c6` — V2A (performance)
  - `161ec99` — V2B (pool réutilisable + canonicalisation)
- **La migration Supabase `0004_generated_assets_reuse.sql` n'a PAS été appliquée** — l'utilisateur l'appliquera lui-même manuellement. Le code tolère déjà son absence (tout chemin de réutilisation se dégrade proprement vers une génération fraîche si les colonnes n'existent pas encore).
- 337 tests passent (1 skip pré-existant). Typecheck, lint et build de production sont propres à chaque étape validée.
- Les deux flags `AUTO_GENERATED_PORTRAITS_ENABLED` / `AUTO_GENERATED_CRIME_SCENES_ENABLED` doivent être positionnés à `true` sur Vercel (Production) pour activer réellement la génération automatique — voir rapport V1 pour les valeurs exactes à définir.

## Fichiers concernés

**Phase 5A**
- `lib/game-engine/types/case.ts`, `lib/game-engine/case-generator/case-truth.ts`
- `lib/game-engine/simulation/post-crime-observation.ts` (nouveau)
- Tests : `lib/game-engine/simulation/__tests__/post-crime-observation.test.ts`, `lib/game-engine/case-generator/__tests__/post-crime-isolation.test.ts`

**Generated Art (V1 → V2B)**
- Pipeline cœur : `lib/art/generation/pipeline.ts`, `asset-store.ts`, `types.ts`, `concurrency.ts` (nouveau), `reusable-descriptor.ts` (nouveau)
- Déclencheurs automatiques : `lib/art/generation/auto-portrait-trigger.ts`, `auto-scene-trigger.ts`
- Lecture pour affichage : `lib/art/generation/portrait-lookup.ts`, `scene-lookup.ts`
- Hotspots scène de crime : `lib/art/crime-scene-layouts.ts`, `lib/art/hotspot-layout.ts` (nouveau), `lib/game-session/crime-scene.ts`
- UI : `components/investigation/CrimeSceneScreen.tsx`, `ArtRefreshWatcher.tsx` (nouveau), et 8 pages sous `app/investigation/*` + `app/dossiers/[id]/page.tsx`
- Action serveur : `lib/game-session/actions.ts` (`startNewCase`)
- Supabase : `lib/supabase/database.types.ts`, migration `supabase/migrations/0004_generated_assets_reuse.sql` (non appliquée)
- Nombreux fichiers de tests sous `lib/art/generation/__tests__/`, `lib/art/__tests__/`, `lib/game-session/__tests__/`, `components/investigation/__tests__/`

## Ce qui a changé

- **Phase 5A** : nouvelle couche `postCrimeMovements` sur `CaseTruth` — activités ordinaires post-crime (réveil/travail/sommeil), RNG isolé, aucune influence sur la vérité de l'enquête, la solvabilité ou les preuves.
- **V1** : flags d'activation vérifiés, sélection automatique des portraits (victime + suspects + témoins importants, plafonnée), audit complet des points d'affichage — tout était déjà branché correctement.
- **V2C-1** : ajout d'ancres sémantiques (`SemanticAnchor`) sur chaque zone de décor, et transform mathématique `object-cover` pour garantir l'alignement des hotspots sur mobile (4:5) et desktop (16:9).
- **V2A** : génération de portraits en parallélisme borné (3 simultanés), garde-fou contre le dépassement de `MAX_ASSETS_PER_CASE` sous concurrence, génération portrait+scène concurrente, et `ArtRefreshWatcher` (rafraîchissement client borné à 2 tentatives) pour faire apparaître les images sans action du joueur.
- **V2B** : descripteurs "réutilisables" grossiers (traits visuels sans identité), clé de réutilisation par utilisateur, réutilisation same-user avec exclusion stricte de la même affaire, puis **durcissement** : `source_asset_id` garantit qu'une ligne réutilisée ne peut jamais elle-même redevenir une source (pas de chaîne A→B→C).

## Ce qui a été tenté

- Mesures de performance contrôlées (fournisseur simulé) pour objectiver les gains : ~10,5s → ~3,0s pour un lot de 6 portraits + 1 scène (V2A) ; réutilisation = 0 appel Cloudflare vs ~1,5s pour une génération réelle (V2B).
- Un vrai appel Cloudflare a été testé une fois (script jetable, supprimé après usage) pour valider les identifiants et la latence réelle (~1,3–1,7s/image).
- Piste de backfill pour les lignes générées avant V2B (`reuse_key = NULL`) explicitement écartée (risque de migration silencieuse à grande échelle) — décision : aucun backfill, le pool se construit uniquement à partir de la nouvelle activité.
- Audit du cycle de vie du stockage (suppression) : confirmé qu'aucun code de suppression n'existe actuellement pour `generated_assets` — invariant documenté pour le futur plutôt qu'implémenté.

## Prochaines étapes

1. **Appliquer manuellement** la migration `supabase/migrations/0004_generated_assets_reuse.sql` en production (action explicitement laissée à l'utilisateur).
2. Sur Vercel : positionner `AUTO_GENERATED_PORTRAITS_ENABLED=true` et `AUTO_GENERATED_CRIME_SCENES_ENABLED=true` (Production), puis redéployer.
3. Valider en conditions réelles : créer une nouvelle affaire et vérifier l'apparition des portraits/décor, le repli procédural, et l'absence de doublons visuels dans une même affaire.
4. Décision à prendre plus tard (non commencée) : **Phase 5B** (mécanique de surveillance) et **V2C-2** (ajustement des hotspots par analyse visuelle) — les deux ont été explicitement mises en attente jusqu'à nouvel ordre.
5. Surveiller le taux de réutilisation réel une fois en production (les chiffres actuels sont des projections, pas des mesures réelles).
