using UnityEngine;

namespace Caseline.CCTV
{
    /// <summary>
    /// The optional office art kit as the surveillance cameras use it: real doors, ceiling lights and a few office
    /// furnishings in the corridor, and a textured person in place of the blockout mannequin. The same kit the crime
    /// reconstruction uses (<c>Resources/OfficeKit</c>, built by OfficeKitBuilder), installed locally only because the
    /// art's licence forbids redistributing it. Without it every environment and the mannequin are drawn exactly as
    /// before. This assembly deliberately does not reference the reconstruction one, so the few lines of loading and
    /// fitting it needs are repeated here.
    /// </summary>
    public static class CCTVOfficeKit
    {
        /// <summary>Set to false to force the plain blockout (tests that measure it use this).</summary>
        public static bool Enabled = true;

        private const string ResourceFolder = "OfficeKit/";
        private const string ProbePrefab = "SM_Bld_Door_01";

        public static GameObject Load(string prefabName)
        {
            return string.IsNullOrEmpty(prefabName) ? null : Resources.Load<GameObject>(ResourceFolder + prefabName);
        }

        public static bool IsAvailable => Enabled && Load(ProbePrefab) != null;

        /// <summary>Instantiates a kit piece under <paramref name="parent"/>, uniformly scaled so it is
        /// <paramref name="targetSize"/> tall (or, with <paramref name="fitFootprint"/>, so its longest horizontal side
        /// is), standing on <paramref name="bottomCenter"/> and turned <paramref name="yawDegrees"/>. Uses the renderers'
        /// real bounds, so it does not depend on where the pack put the pivot. Null when the piece is not in the kit.</summary>
        public static GameObject Place(Transform parent, string prefabName, string instanceName, Vector3 bottomCenter, float targetSize, float yawDegrees, bool fitFootprint = false)
        {
            var prefab = Load(prefabName);
            if (prefab == null || targetSize <= 0f) return null;

            var instance = Object.Instantiate(prefab, parent, false);
            instance.name = instanceName;
            instance.transform.localPosition = Vector3.zero;
            instance.transform.localRotation = Quaternion.Euler(0f, yawDegrees, 0f);
            instance.transform.localScale = Vector3.one;

            if (!TryMeasure(instance, out var bounds))
            {
                Discard(instance);
                return null;
            }
            var natural = fitFootprint ? Mathf.Max(bounds.size.x, bounds.size.z) : bounds.size.y;
            if (natural < 0.0001f)
            {
                Discard(instance);
                return null;
            }

            instance.transform.localScale = Vector3.one * (targetSize / natural);
            TryMeasure(instance, out bounds);
            var bottom = new Vector3(bounds.center.x, bounds.min.y, bounds.center.z);
            instance.transform.position += parent.TransformPoint(bottomCenter) - bottom;
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

        private static void Discard(Object target)
        {
            if (Application.isPlaying) Object.Destroy(target);
            else Object.DestroyImmediate(target);
        }
    }

    /// <summary>The kit's background furnishings along the corridor's far wall. Pure data: neutral office furniture only
    /// (no document, device, bottle, tool, weapon or anything that could read as evidence), kept off the walking lines
    /// (z = 0, 3, 6) and the doorway, so nothing here can ever stand in an actor's way.</summary>
    public static class CCTVOfficeDressing
    {
        public readonly struct Item
        {
            public readonly string Name;
            public readonly string Prefab;
            public readonly float X;
            public readonly float Height;

            public Item(string name, string prefab, float x, float height)
            {
                Name = name;
                Prefab = prefab;
                X = x;
                Height = height;
            }
        }

        /// <summary>Heights are each piece's own (the pack is modelled in metres), so they stand at scale 1.</summary>
        public static readonly Item[] CorridorItems =
        {
            new("CoatRack", "SM_Prop_CoatRack_01", -4.6f, 2.02f),
            new("Plant", "SM_Prop_Plant_04", -2.6f, 1.16f),
            new("Plant", "SM_Prop_Plant_02", 2.6f, 1.05f),
            new("Bin", "SM_Prop_Bin_01", 3.4f, 0.44f),
            new("WaterCooler", "SM_Prop_WaterCooler_01", 5.2f, 1.68f),
        };
    }

    /// <summary>
    /// Which kit character stands in for the CCTV mannequin. The footage carries no appearance and no person data, and
    /// every scenario has a single actor slot, so the choice is keyed on the CAMERA's id alone: a camera always shows the
    /// same kind of person, different cameras show different ones, and nothing about who is on screen can influence
    /// it. (Keying it on the actor's id would let a player recognise one anonymous figure across clips by their clothes,
    /// which the generic mannequin never allowed.) The pack's characters are each male or female, so the figure is not a
    /// likeness of whoever it stands for.
    /// </summary>
    public static class CCTVActorKit
    {
        /// <summary>Set to false to force the mannequin (tests that measure it use this).</summary>
        public static bool Enabled = true;

        private const string ResourceFolder = "OfficeKit/Actors/";

        // The same twelve office workers as the reconstruction table: no security guard, cleaner or boss outfit.
        public static readonly string[] Characters =
        {
            "SM_Chr_Developer_Male_01", "SM_Chr_Developer_Female_01", "SM_Chr_Developer_Male_02",
            "SM_Chr_Business_Male_01", "SM_Chr_Business_Female_01", "SM_Chr_Business_Male_02",
            "SM_Chr_Business_Male_03", "SM_Chr_Developer_Female_02", "SM_Chr_Business_Female_02",
            "SM_Chr_Business_Female_03", "SM_Chr_Business_Male_04", "SM_Chr_Business_Female_04",
        };

        /// <summary>The character for a camera id (FNV-1a, so it is stable across runs and platforms, unlike
        /// <see cref="string.GetHashCode"/>); the first one when the id is missing.</summary>
        public static string CharacterFor(string cameraId)
        {
            if (string.IsNullOrEmpty(cameraId)) return Characters[0];
            var hash = 2166136261u;
            foreach (var c in cameraId)
            {
                hash ^= c;
                hash *= 16777619u;
            }
            return Characters[(int)(hash % (uint)Characters.Length)];
        }

        /// <summary>A new kit actor for this camera, parentless and with its scripts removed (the CCTV actor controller
        /// drives it), or null (use the mannequin) when the kit is disabled or not installed.</summary>
        public static GameObject TryCreate(string cameraId)
        {
            if (!Enabled) return null;
            var prefab = Resources.Load<GameObject>(ResourceFolder + CharacterFor(cameraId) + "_Actor");
            if (prefab == null) return null;
            var instance = Object.Instantiate(prefab);
            instance.name = "KitActor";
            // The prefab is shared with the reconstruction, whose controller and marker are of no use here.
            foreach (var script in instance.GetComponents<MonoBehaviour>())
            {
                if (Application.isPlaying) Object.Destroy(script);
                else Object.DestroyImmediate(script);
            }
            return instance;
        }
    }
}
