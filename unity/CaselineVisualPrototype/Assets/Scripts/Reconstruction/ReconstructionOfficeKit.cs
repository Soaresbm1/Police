using System.Collections.Generic;
using UnityEngine;

namespace Caseline.Reconstruction
{
    /// <summary>
    /// How a piece of generic architecture is dressed by the optional office kit (Synty POLYGON Office, installed
    /// locally and never committed: see OfficeKitBuilder). <see cref="Prefab"/> null with <see cref="Hide"/> true means
    /// "the kit supplies this elsewhere, draw nothing for the box".
    /// </summary>
    public readonly struct OfficeKitSkin
    {
        public readonly string Prefab;
        public readonly float Yaw;
        public readonly bool Hide;
        public readonly OfficeFit Fit;

        public OfficeKitSkin(string prefab, float yaw, bool hide = false, OfficeFit fit = OfficeFit.Height)
        {
            Prefab = prefab;
            Yaw = yaw;
            Hide = hide;
            Fit = fit;
        }
    }

    /// <summary>Which dimension of the target box the kit piece is scaled to match (always uniformly, so proportions are
    /// the artist's): the box's height for upright pieces, its longest horizontal side for flat ones such as a ceiling
    /// panel.</summary>
    public enum OfficeFit
    {
        Height,
        Footprint,
    }

    /// <summary>
    /// Loads the curated office kit from <c>Resources/OfficeKit</c> and fits its pieces into the exact bounds the
    /// environment's occlusion model already knows about. The kit is OPTIONAL: the repository is public and the art's
    /// licence forbids redistributing it, so a fresh clone has no kit and every environment stays exactly the box
    /// blockout the tests were written against. Nothing here reads a seed, case, role or evidence; the kit only changes
    /// how fixed, generic geometry looks, never where it is.
    /// </summary>
    public static class ReconstructionOfficeKit
    {
        private const string ResourceFolder = "OfficeKit/";
        private const string ProbePrefab = "SM_Bld_Door_01";

        private static readonly Dictionary<string, GameObject> Cache = new();

        public static GameObject Load(string prefabName)
        {
            if (string.IsNullOrEmpty(prefabName)) return null;
            if (!Cache.TryGetValue(prefabName, out var prefab) || prefab == null)
            {
                prefab = Resources.Load<GameObject>(ResourceFolder + prefabName);
                Cache[prefabName] = prefab;
            }
            return prefab;
        }

        /// <summary>True when the kit is installed on this machine / shipped in this build.</summary>
        public static bool IsAvailable => Load(ProbePrefab) != null;

        /// <summary>Fits <paramref name="prefabName"/> into <paramref name="target"/> (a box in <paramref name="parent"/>'s
        /// space): uniformly scaled to its height or longest horizontal side, standing on the bottom centre of the box and
        /// turned <paramref name="yawDegrees"/> about the vertical axis. Uses the renderers' real bounds, so it does not
        /// depend on where the pack put the pivot. Returns null (and draws nothing) when the piece is not in the kit.</summary>
        public static GameObject Place(Transform parent, string prefabName, string instanceName, Bounds target, OfficeFit fit, float yawDegrees)
        {
            var prefab = Load(prefabName);
            var targetSize = fit == OfficeFit.Height ? target.size.y : Mathf.Max(target.size.x, target.size.z);
            if (prefab == null || targetSize <= 0f) return null;
            var targetBottom = new Vector3(target.center.x, target.min.y, target.center.z);

            var instance = Object.Instantiate(prefab, parent, false);
            instance.name = instanceName;
            instance.transform.localPosition = Vector3.zero;
            instance.transform.localRotation = Quaternion.Euler(0f, yawDegrees, 0f);
            instance.transform.localScale = Vector3.one;

            var natural = 0f;
            if (TryMeasure(instance, out var bounds))
            {
                natural = fit == OfficeFit.Height ? bounds.size.y : Mathf.Max(bounds.size.x, bounds.size.z);
            }
            if (natural < 0.0001f)
            {
                Destroy(instance);
                return null;
            }

            instance.transform.localScale = Vector3.one * (targetSize / natural);
            TryMeasure(instance, out bounds);

            // Measure again after scaling (renderer bounds are in world space and the parent is at the origin), then slide
            // the piece so the bottom centre of its bounds lands on the requested point.
            var bottom = new Vector3(bounds.center.x, bounds.min.y, bounds.center.z);
            instance.transform.position += parent.TransformPoint(targetBottom) - bottom;
            return instance;
        }

        private static bool TryMeasure(GameObject instance, out Bounds bounds)
        {
            var renderers = instance.GetComponentsInChildren<Renderer>();
            bounds = default;
            if (renderers.Length == 0) return false;
            bounds = renderers[0].bounds;
            for (var i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
            return true;
        }

        private static void Destroy(Object target)
        {
            if (Application.isPlaying) Object.Destroy(target);
            else Object.DestroyImmediate(target);
        }
    }

    /// <summary>
    /// Which kit piece dresses which box of the fixed architecture. Pure data keyed by environment kind and piece name
    /// (plus the piece's order among same-named pieces, so a row of doors varies without any randomness).
    /// </summary>
    public static class ReconstructionOfficeSkins
    {
        // The pack models face +z. The corridor's far wall is at +z with the camera on the open -z side, so wall pieces
        // turn to face -z; the west end wall faces +x.
        private const float FacingMinusZ = 180f;
        private const float FacingPlusX = 90f;

        private static readonly string[] CorridorDoors =
        {
            "SM_Bld_Door_02", "SM_Bld_Door_04", "SM_Bld_Door_01",
        };

        /// <summary>The skin for the <paramref name="occurrence"/>-th piece called <paramref name="pieceName"/> in
        /// <paramref name="environment"/>, or null to keep the plain box.</summary>
        public static OfficeKitSkin? For(string environment, string pieceName, int occurrence)
        {
            if (environment != "corridor") return null;
            switch (pieceName)
            {
                case "Door":
                    return new OfficeKitSkin(CorridorDoors[occurrence % CorridorDoors.Length], FacingMinusZ);
                case "DoorFrame":
                    return new OfficeKitSkin(null, 0f, hide: true); // the kit door carries its own frame
                case "EndDoor":
                    return new OfficeKitSkin("SM_Bld_Door_05", FacingPlusX);
                case "EndDoorFrame":
                    return new OfficeKitSkin(null, 0f, hide: true);
                case "CeilingPanel":
                    return new OfficeKitSkin("SM_Bld_Ceiling_Panel_Light_01", 0f, fit: OfficeFit.Footprint);
                default:
                    return null;
            }
        }
    }

    /// <summary>One background item of office dressing. <see cref="Footprint"/> is its full-height box: it is what the
    /// occlusion and quiet-zone tests measure, whether or not the kit is installed.</summary>
    public readonly struct OfficeDressingItem
    {
        public readonly string Name;
        public readonly string Prefab;
        public readonly Bounds Footprint;
        public readonly float Yaw;

        public OfficeDressingItem(string name, string prefab, Bounds footprint, float yaw)
        {
            Name = name;
            Prefab = prefab;
            Footprint = footprint;
            Yaw = yaw;
        }
    }

    /// <summary>
    /// A handful of neutral office furnishings along the corridor's far wall, in the stretches the fixed cameras do not
    /// look at (the plain wall directly behind the beat, x -3.2 to 2.0, stays empty). Only things any office has: no
    /// document, device, bottle, tool, weapon or anything that could read as evidence. Drawn only when the kit is
    /// installed, but always counted by the occlusion model so the tests hold with or without it.
    /// </summary>
    public static class ReconstructionOfficeDressing
    {
        private const float FarWallInnerZ = 2.45f;
        private const float FacingMinusZ = 180f;

        public static readonly string[] AllowedNames = { "Plant", "WaterCooler", "CoatRack", "Bin", "ExitSign" };

        public static IReadOnlyList<OfficeDressingItem> Items(string environment)
        {
            if (environment != "corridor") return System.Array.Empty<OfficeDressingItem>();
            return new[]
            {
                // Footprints are each piece's own size (the pack is modelled in metres), so the kit is placed at scale 1.
                new OfficeDressingItem("CoatRack", "SM_Prop_CoatRack_01", Footprint(-4.6f, 0.74f, 0.74f, 2.02f), FacingMinusZ),
                new OfficeDressingItem("Plant", "SM_Prop_Plant_02", Footprint(-3.7f, 0.50f, 0.43f, 1.05f), FacingMinusZ),
                new OfficeDressingItem("Plant", "SM_Prop_Plant_04", Footprint(2.6f, 0.75f, 0.58f, 1.16f), FacingMinusZ),
                new OfficeDressingItem("Bin", "SM_Prop_Bin_01", Footprint(3.3f, 0.45f, 0.46f, 0.44f), FacingMinusZ),
                new OfficeDressingItem("WaterCooler", "SM_Prop_WaterCooler_01", Footprint(5.6f, 0.57f, 0.47f, 1.68f), FacingMinusZ),
                new OfficeDressingItem("ExitSign", "SM_Prop_Sign_Exit_01", new Bounds(new Vector3(7.0f, 2.55f, FarWallInnerZ - 0.08f), new Vector3(0.43f, 0.21f, 0.06f)), FacingMinusZ),
            };
        }

        // A footprint of width x depth standing against the far wall, from the floor up to `height`.
        private static Bounds Footprint(float centreX, float width, float depth, float height) =>
            new(new Vector3(centreX, height / 2f, FarWallInnerZ - 0.05f - depth / 2f), new Vector3(width, height, depth));
    }
}
