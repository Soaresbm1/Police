# CASELINE — Fin de session

## Objectif

Rendre la reconstitution 3D post-enquête (Unity) lisible et juste, phase par phase, sans jamais toucher à la vérité du
cas :

- **U5.4** (terminé, en Production) : rythme de présentation (« Plus tard… », ~41 s médian au lieu de ~37 min) et un
  geste abstrait par méthode de crime (7 méthodes).
- **U5.5** (en cours, en attente d'approbation) : caméras déterministes « action-aware ». Limitation connue de U5.4 :
  les attaques paraissaient trop petites dans les environnements larges.

La série Generated Art (V1 → V2B) et la Phase 5A sont terminées depuis. Voir GENERATED_ART.md et l'historique git.

## État actuel

- **Production / master : `a46d5d6`** (U5.4). Non modifié pendant U5.5.
- **Branche `unity/reconstruction-action-camera-u5-5`** poussée, **non mergée** :
  - `93b53de` : feat: add deterministic reconstruction action cameras
  - `f2e7ad7` : test: validate reconstruction camera framing matrix
  - `b5e58fc` : chore: refresh shared Unity WebGL build (U5.5)
  - un commit docs (ce fichier, UNITY_RECONSTRUCTION.md, ARCHITECTURE.md, ROADMAP.md, README.md)
- **Preview Vercel (U5.5)** : https://police-6hdc661db-soares-2.vercel.app, QA complète faite.
- **Tests Unity** : 235/235 (reconstruction 163/163, CCTV 72/72).
- **Tests CASELINE** : 773 réussis, 1 ignoré. Tests TS de reconstruction : 153/153. Typecheck, lint et build propres.
- **Build Brotli partagée** : 5 250 678 octets (U5.4 : 5 253 827). Hash décodés identiques entre le commit et le Preview.
- **README.md** : un changement de formatage du tableau « Scripts », antérieur à la session et appartenant à
  l'utilisateur, reste volontairement **non commité**.

## Fichiers concernés (U5.5)

- Runtime Unity (`unity/CaselineVisualPrototype/Assets/Scripts/Reconstruction/`) :
  - `ReconstructionCameraPresets.cs` (nouveau) : toutes les valeurs de caméra, en une table
  - `ReconstructionCameraDirector.cs` (nouveau) : choix du plan et règle de coupe, fonction pure
  - `ReconstructionCameraController.cs` : applique le plan et le réinitialise à chaque scénario
  - `ReconstructionSceneController.cs`, `ReconstructionActorTimeline.cs` (`WalkStartTime`)
  - `ReconstructionEnvironmentController.cs` : piliers du parking déplacés
  - `ReconstructionFramingMeasurement.cs` : mesure multi-acteurs
- Éditeur :
  - `ReconstructionSceneBuilder.cs`, `ReconstructionFramingReport.cs`
  - `ReconstructionCameraMatrix.cs` (nouveau) : matrice 7 × 5 et baseline U5.4 figée
  - `ReconstructionCameraQaStills.cs` (nouveau) : planches contact rendues par Unity
- Tests :
  - `ReconstructionCameraControllerTests.cs`
  - `ReconstructionActionCameraMatrixTests.cs` (nouveau)
  - `ReconstructionFramingMeasurementTests.cs`
  - `CaselineEmbedModeControllerTests.cs`
- Scènes : `CaselineEmbed.unity`, `ReconstructionPrototype.unity`. Build : `public/unity/cctv/Build/*`.
- Aucun fichier TypeScript, Supabase, projecteur, schéma de scénario ou CCTV n'a été modifié.

## Ce qui a changé

- **4 plans fixes** :
  - Overview : inchangé depuis U5.2.
  - Interaction : discussion, empoisonnement, surdose mise en scène, mise en scène.
  - PhysicalAttack : coup, arme blanche, strangulation, arme à feu, poussée.
  - Discovery : le corps et la personne qui le découvre.

  Chaque plan est visé sur le slot sémantique de l'événement dans l'environnement courant, avec une distance, un
  angle et un FOV fixes. La caméra se place du côté éclairé : silhouettes éclairées sur murs éclairés, et le geste va
  vers l'autre personne à l'écran.
- **Entrées du choix** : uniquement l'environnement, le type d'événement, `safeVisualAction`, le slot, les horodatages
  et le début de la marche de départ. Aucun rôle, identité, mobile ou preuve, aucun hasard, aucun champ ajouté au
  scénario.
- **Règle de coupe** :
  - discussion et découverte coupent à l'horodatage ;
  - attaque et mise en scène coupent 1 s avant, pour que le cadre soit posé avant le geste ;
  - le départ coupe au début de la marche vers la sortie ;
  - jamais pendant le geste ou la chute précédents.
- **Mesures au moment de l'attaque** (projection, pas de captures d'écran) :
  - la plus petite silhouette passe de 19,9–25,2 % à 30,5 % de la hauteur d'image ;
  - les deux ensemble passent de 21,5–28,0 % à 34,3 % ;
  - la largeur de décor visible passe de 10,6–13,7 m à 8,7 m.
- **Matrice** : 945 échantillons synthétiques et 63 échantillons sur les fixtures réelles, 0 échec. Contrôles : rognage,
  occultation, étiquettes, séparation des silhouettes, corps entier à la découverte.
- **Parking** : piliers déplacés au fond. Au premier plan, l'un masquait une tierce personne pendant la discussion (déjà
  vrai en U5.4).

## Ce qui a été tenté

- Première version côté ouest (comme U5.4) : conforme numériquement. Mais les planches contact montraient des
  silhouettes sombres sur le mur non éclairé, et des gestes pointant à l'opposé de la victime. Inversion vers l'est
  retenue après comparaison visuelle.
- La caméra d'attaque plus serrée filmait l'auteur marchant vers l'objectif en quittant la scène. Corrigé en faisant
  commencer le plan de départ au début de la marche.
- Dans le panneau navigateur intégré, le rendu tourne à ~2 fps : la durée réelle de lecture n'y est pas mesurable. Le
  rythme a donc été vérifié par la séquence des « Plus tard… » (5 s, 665,5 s, 845 s, identiques à U5.4) et par les
  tests. Les planches visuelles exactes sont rendues directement par Unity (`ReconstructionCameraQaStills`).

## Prochaines étapes

1. **Attendre l'approbation explicite** de U5.5 avant tout merge sur master ou tout déploiement Production.
2. Si approuvé : merge (fast-forward si possible), attente du déploiement Production, vérification Brotli, smoke test
   Production (comme pour U5.4).
3. Limites restantes, non traitées volontairement :
   - acteurs toujours côte à côte, face à +z ;
   - bâtiment décoratif de la rue parfois derrière le plan de discussion ;
   - redémarrage Unity (~5 s) en passant de Caméras au rapport.
4. Ne pas commencer U5.6, ni refonte d'environnements ou de modèles d'acteurs, sans nouvelle demande.
