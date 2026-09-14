using UnityEngine;

namespace Caseline.CCTV
{
    /// <summary>
    /// Builds the procedural, cosmetic-only 3D backdrop for one CCTV
    /// environment kind (Phase U2, req. 6/14) — the exact same kinds
    /// CASELINE's 2D renderer already draws (`CCTVEnvironmentKind`:
    /// corridor/parking/street/shop/generic). Every shape here is a plain
    /// primitive (floor, walls, a pillar, a counter, a few shelves/building
    /// blocks) — never a person, vehicle, weapon, bag, or any case-specific
    /// object, mirroring the same "cosmetic structural elements only" rule
    /// the 2D `drawEnvironment()` function follows.
    ///
    /// Reused by both the editor scene-builder (a one-time default "parking"
    /// look, so the scene isn't empty before Play) and, at runtime, by
    /// <see cref="CCTVSceneController"/> once it knows which kind the loaded
    /// scenario actually asked for — <see cref="Build"/> always clears any
    /// previous geometry first, so calling it again with a different kind
    /// is safe and fully deterministic (no randomness anywhere in this
    /// class).
    /// </summary>
    public class CCTVEnvironmentController : MonoBehaviour
    {
        private const float FloorSize = 30f;
        private const float WallHeight = 5f;

        private Material floorMat;
        private Material wallMat;
        private Material detailMat;
        private Material lineMat;

        public void Build(string environmentKind)
        {
            ClearChildren();
            EnsureMaterials();

            BuildFloor();
            BuildPerimeterWalls();
            BuildCeiling();

            switch (environmentKind)
            {
                case "parking":
                    BuildParkingDetails();
                    break;
                case "corridor":
                    BuildCorridorDetails();
                    break;
                case "street":
                    BuildStreetDetails();
                    break;
                case "shop":
                    BuildShopDetails();
                    break;
                default:
                    // "generic" (or any unrecognized kind) — a neutral
                    // structural shell (Phase U4: a low interior partition
                    // + overhead fixtures, still nothing case-specific),
                    // matching the 2D renderer's own "generic draws nothing
                    // evidentiary" rule.
                    BuildGenericDetails();
                    break;
            }

            ApplyLightingForKind(environmentKind);
        }

        /// <summary>Phase U4 — per-environment lighting mood (req. 14),
        /// applied to whatever Directional Light already exists in the
        /// scene (built once by CCTVPrototypeBuilder.BuildLighting() and
        /// never destroyed between scenario reloads) plus the flat ambient
        /// term. Purely cosmetic: every value here is a fixed constant
        /// keyed only by `environmentKind`, never derived from case data.</summary>
        private static void ApplyLightingForKind(string environmentKind)
        {
            var light = Object.FindFirstObjectByType<Light>();
            if (light == null || light.type != LightType.Directional) return;

            switch (environmentKind)
            {
                case "corridor":
                    light.color = new Color(0.82f, 0.88f, 1f); // cool overhead fluorescent
                    light.intensity = 1.0f;
                    RenderSettings.ambientLight = new Color(0.22f, 0.23f, 0.26f);
                    break;
                case "parking":
                    light.color = new Color(0.88f, 0.92f, 0.8f); // harsh industrial/sodium-ish
                    light.intensity = 0.9f;
                    RenderSettings.ambientLight = new Color(0.16f, 0.16f, 0.15f);
                    break;
                case "shop":
                    light.color = new Color(1f, 0.98f, 0.9f); // brighter commercial ceiling lighting
                    light.intensity = 1.25f;
                    RenderSettings.ambientLight = new Color(0.3f, 0.3f, 0.29f);
                    break;
                case "street":
                    light.color = new Color(1f, 0.98f, 0.95f); // neutral daylight
                    light.intensity = 1.15f;
                    RenderSettings.ambientLight = new Color(0.32f, 0.32f, 0.34f);
                    break;
                default:
                    light.color = new Color(1f, 0.98f, 0.92f); // generic neutral practical
                    light.intensity = 1.1f;
                    RenderSettings.ambientLight = new Color(0.24f, 0.24f, 0.26f);
                    break;
            }
        }

        private void ClearChildren()
        {
            for (var i = transform.childCount - 1; i >= 0; i--)
            {
                SafeDestroy(transform.GetChild(i).gameObject);
            }
        }

        /// <summary>`Destroy` is runtime-only and `DestroyImmediate` is the
        /// edit-mode equivalent — this class is invoked from both an editor
        /// script (the one-time default scene look) and runtime code
        /// (rebuilding for a loaded scenario), so it must pick correctly.</summary>
        private static void SafeDestroy(Object obj)
        {
            if (Application.isPlaying) Destroy(obj);
            else DestroyImmediate(obj);
        }

        private Material fixtureMat;
        private Material glassMat;

        private void EnsureMaterials()
        {
            if (floorMat != null) return;
            floorMat = MakeMaterial(new Color(0.42f, 0.42f, 0.42f));
            wallMat = MakeMaterial(new Color(0.55f, 0.55f, 0.57f));
            detailMat = MakeMaterial(new Color(0.35f, 0.35f, 0.36f));
            lineMat = MakeMaterial(new Color(0.85f, 0.78f, 0.35f));
            fixtureMat = MakeMaterial(new Color(0.9f, 0.9f, 0.86f));
            glassMat = MakeMaterial(new Color(0.5f, 0.58f, 0.6f));
        }

        private void BuildFloor()
        {
            var floor = CreatePrimitive(PrimitiveType.Plane, "Floor");
            floor.transform.localScale = new Vector3(FloorSize / 10f, 1f, FloorSize / 10f);
            floor.GetComponent<MeshRenderer>().sharedMaterial = floorMat;
        }

        private void BuildPerimeterWalls()
        {
            var half = FloorSize / 2f;
            AddWall(new Vector3(0, WallHeight / 2f, half), new Vector3(FloorSize, WallHeight, 0.5f));
            AddWall(new Vector3(0, WallHeight / 2f, -half), new Vector3(FloorSize, WallHeight, 0.5f));
            AddWall(new Vector3(half, WallHeight / 2f, 0), new Vector3(0.5f, WallHeight, FloorSize));
            AddWall(new Vector3(-half, WallHeight / 2f, 0), new Vector3(0.5f, WallHeight, FloorSize));
        }

        /// <summary>Phase U4.2 — the U4.2 camera retune brought every
        /// preset noticeably closer/lower to raise actor frame occupancy,
        /// and the steeper resulting angles put the top of frame above
        /// the far wall's silhouette for several presets — with no
        /// ceiling, that meant looking straight into the empty
        /// background/skybox instead of an enclosed space (a "floating
        /// room" look no real indoor CCTV camera would ever show). A
        /// plain flat ceiling at wall height closes that gap. Rotated 180°
        /// on X so its visible face (a Plane's front, by default facing
        /// +Y and culled from below) points down into the room, since the
        /// camera only ever looks up at its underside.</summary>
        private void BuildCeiling()
        {
            var ceiling = CreatePrimitive(PrimitiveType.Plane, "Ceiling");
            ceiling.transform.position = new Vector3(0, WallHeight, 0);
            ceiling.transform.rotation = Quaternion.Euler(180f, 0f, 0f);
            ceiling.transform.localScale = new Vector3(FloorSize / 10f, 1f, FloorSize / 10f);
            ceiling.GetComponent<MeshRenderer>().sharedMaterial = detailMat;
        }

        private void AddWall(Vector3 position, Vector3 scale)
        {
            var wall = CreatePrimitive(PrimitiveType.Cube, "Wall");
            wall.transform.position = position;
            wall.transform.localScale = scale;
            wall.GetComponent<MeshRenderer>().sharedMaterial = wallMat;
        }

        private void BuildParkingDetails()
        {
            var pillarPositions = new[] { new Vector3(-6f, 1.5f, 6f), new Vector3(6f, 1.5f, 6f), new Vector3(-6f, 1.5f, -3f) };
            foreach (var pos in pillarPositions)
            {
                var pillar = CreatePrimitive(PrimitiveType.Cube, "Pillar");
                pillar.transform.position = pos;
                pillar.transform.localScale = new Vector3(0.8f, 3f, 0.8f);
                pillar.GetComponent<MeshRenderer>().sharedMaterial = detailMat;
            }

            for (var i = 0; i < 4; i++)
            {
                var line = CreatePrimitive(PrimitiveType.Cube, "ParkingLine");
                line.transform.position = new Vector3(-9f + i * 3f, 0.01f, 2f);
                line.transform.localScale = new Vector3(0.08f, 0.01f, 6f);
                line.GetComponent<MeshRenderer>().sharedMaterial = lineMat;
            }

            // Overhead pipe run + a low entrance barrier — cheap readability
            // cues that this is a covered structure, not an open lot.
            for (var i = -1; i <= 1; i += 2)
            {
                var pipe = CreatePrimitive(PrimitiveType.Cube, "CeilingPipe");
                pipe.transform.position = new Vector3(i * 4f, WallHeight - 0.4f, 0f);
                pipe.transform.localScale = new Vector3(0.25f, 0.25f, FloorSize - 2f);
                pipe.GetComponent<MeshRenderer>().sharedMaterial = fixtureMat;
            }

            var barrier = CreatePrimitive(PrimitiveType.Cube, "Barrier");
            barrier.transform.position = new Vector3(0f, 0.45f, FloorSize / 2f - 1.5f);
            barrier.transform.localScale = new Vector3(2.4f, 0.12f, 0.1f);
            barrier.GetComponent<MeshRenderer>().sharedMaterial = lineMat;
        }

        private void BuildCorridorDetails()
        {
            // A doorway-like recess (frame + a slightly inset leaf) on the
            // far wall and a couple of floor guide lines — never anything
            // resembling a person or object.
            var doorFrame = CreatePrimitive(PrimitiveType.Cube, "DoorFrame");
            doorFrame.transform.position = new Vector3(0f, 1.2f, FloorSize / 2f - 0.3f);
            doorFrame.transform.localScale = new Vector3(1.6f, 2.4f, 0.1f);
            doorFrame.GetComponent<MeshRenderer>().sharedMaterial = detailMat;

            var doorLeaf = CreatePrimitive(PrimitiveType.Cube, "DoorLeaf");
            doorLeaf.transform.position = new Vector3(0f, 1.15f, FloorSize / 2f - 0.35f);
            doorLeaf.transform.localScale = new Vector3(1.3f, 2.2f, 0.06f);
            doorLeaf.GetComponent<MeshRenderer>().sharedMaterial = fixtureMat;

            for (var i = -1; i <= 1; i += 2)
            {
                var guide = CreatePrimitive(PrimitiveType.Cube, "FloorGuide");
                guide.transform.position = new Vector3(i * 3f, 0.01f, 0f);
                guide.transform.localScale = new Vector3(0.06f, 0.01f, FloorSize - 4f);
                guide.GetComponent<MeshRenderer>().sharedMaterial = lineMat;
            }

            // Wall trim (baseboard) along both long walls, plus overhead
            // ceiling light fixtures for readable scale/lighting cues.
            for (var side = -1; side <= 1; side += 2)
            {
                var trim = CreatePrimitive(PrimitiveType.Cube, "WallTrim");
                trim.transform.position = new Vector3(side * (FloorSize / 2f - 0.02f), 0.12f, 0f);
                trim.transform.localScale = new Vector3(0.06f, 0.24f, FloorSize - 0.5f);
                trim.GetComponent<MeshRenderer>().sharedMaterial = detailMat;
            }

            for (var i = -1; i <= 1; i++)
            {
                var fixture = CreatePrimitive(PrimitiveType.Cube, "CeilingLight");
                fixture.transform.position = new Vector3(0f, WallHeight - 0.1f, i * 4f);
                fixture.transform.localScale = new Vector3(0.7f, 0.08f, 0.25f);
                fixture.GetComponent<MeshRenderer>().sharedMaterial = fixtureMat;
            }

            // A plain, unreadable signage block near the door — reads as
            // "there is a sign here" without ever encoding actual text.
            var sign = CreatePrimitive(PrimitiveType.Cube, "Signage");
            sign.transform.position = new Vector3(1.4f, 1.9f, FloorSize / 2f - 0.28f);
            sign.transform.localScale = new Vector3(0.35f, 0.2f, 0.03f);
            sign.GetComponent<MeshRenderer>().sharedMaterial = lineMat;
        }

        private void BuildStreetDetails()
        {
            // Low building-block silhouettes along the back wall, each with
            // a couple of window-strip insets for readability, plus a curb,
            // a sidewalk slab and a streetlight.
            var x = -FloorSize / 2f + 2f;
            var i = 0;
            while (x < FloorSize / 2f - 2f)
            {
                var w = 3f + (i % 3);
                var h = 2f + (i % 2) * 1.5f;
                var block = CreatePrimitive(PrimitiveType.Cube, "Building");
                block.transform.position = new Vector3(x, h / 2f, FloorSize / 2f - 1f);
                block.transform.localScale = new Vector3(w, h, 2f);
                block.GetComponent<MeshRenderer>().sharedMaterial = detailMat;

                // A couple of plain window-strip insets — never readable
                // text, just a generic rectangle to break up the facade.
                for (var wi = 0; wi < 2; wi++)
                {
                    var window = CreatePrimitive(PrimitiveType.Cube, "Window");
                    window.transform.position = new Vector3(x - w / 4f + wi * (w / 2f), h * 0.6f, FloorSize / 2f - 0.4f);
                    window.transform.localScale = new Vector3(w * 0.3f, h * 0.25f, 0.04f);
                    window.GetComponent<MeshRenderer>().sharedMaterial = glassMat;
                }

                x += w + 1.5f;
                i++;
            }

            var sidewalk = CreatePrimitive(PrimitiveType.Cube, "Sidewalk");
            sidewalk.transform.position = new Vector3(0, 0.03f, -2.5f);
            sidewalk.transform.localScale = new Vector3(FloorSize - 2f, 0.06f, 3f);
            sidewalk.GetComponent<MeshRenderer>().sharedMaterial = detailMat;

            var curb = CreatePrimitive(PrimitiveType.Cube, "Curb");
            curb.transform.position = new Vector3(0, 0.05f, -1f);
            curb.transform.localScale = new Vector3(FloorSize - 2f, 0.1f, 0.3f);
            curb.GetComponent<MeshRenderer>().sharedMaterial = lineMat;

            for (var pole = -1; pole <= 1; pole += 2)
            {
                var post = CreatePrimitive(PrimitiveType.Cube, "Streetlight");
                post.transform.position = new Vector3(pole * 8f, 1.6f, -4f);
                post.transform.localScale = new Vector3(0.12f, 3.2f, 0.12f);
                post.GetComponent<MeshRenderer>().sharedMaterial = detailMat;

                var head = CreatePrimitive(PrimitiveType.Cube, "Streetlight");
                head.transform.position = new Vector3(pole * 8f, 3.15f, -4f);
                head.transform.localScale = new Vector3(0.4f, 0.15f, 0.2f);
                head.GetComponent<MeshRenderer>().sharedMaterial = fixtureMat;
            }
        }

        private void BuildShopDetails()
        {
            var counter = CreatePrimitive(PrimitiveType.Cube, "Counter");
            counter.transform.position = new Vector3(-2f, 0.4f, 5f);
            counter.transform.localScale = new Vector3(5f, 0.8f, 1f);
            counter.GetComponent<MeshRenderer>().sharedMaterial = detailMat;

            // Two full aisles (three shelf rows each) instead of one lone
            // row — reads as an actual shop floor rather than a single
            // prop against the wall.
            for (var aisle = 0; aisle < 2; aisle++)
            {
                var aisleX = -FloorSize / 2f + 1f + aisle * 3f;
                for (var i = 0; i < 3; i++)
                {
                    var shelf = CreatePrimitive(PrimitiveType.Cube, "AisleShelf");
                    shelf.transform.position = new Vector3(aisleX, 1f, -6f + i * 2.5f);
                    shelf.transform.localScale = new Vector3(0.4f, 2f, 1.2f);
                    shelf.GetComponent<MeshRenderer>().sharedMaterial = detailMat;
                }
            }

            for (var i = -1; i <= 1; i++)
            {
                var fixture = CreatePrimitive(PrimitiveType.Cube, "CeilingLight");
                fixture.transform.position = new Vector3(i * 5f, WallHeight - 0.1f, 0f);
                fixture.transform.localScale = new Vector3(1.4f, 0.08f, 0.3f);
                fixture.GetComponent<MeshRenderer>().sharedMaterial = fixtureMat;
            }
        }

        /// <summary>Phase U4 — "generic" used to be a bare box; a single
        /// low partition and a couple of overhead fixtures give it some
        /// spatial interest while staying deliberately anonymous (no
        /// case-specific silhouette one could mistake for a real place).</summary>
        private void BuildGenericDetails()
        {
            var partition = CreatePrimitive(PrimitiveType.Cube, "Partition");
            partition.transform.position = new Vector3(-3f, 1.1f, 2f);
            partition.transform.localScale = new Vector3(0.2f, 2.2f, 4f);
            partition.GetComponent<MeshRenderer>().sharedMaterial = detailMat;

            for (var i = -1; i <= 1; i += 2)
            {
                var fixture = CreatePrimitive(PrimitiveType.Cube, "CeilingLight");
                fixture.transform.position = new Vector3(i * 4f, WallHeight - 0.1f, 0f);
                fixture.transform.localScale = new Vector3(1f, 0.08f, 0.3f);
                fixture.GetComponent<MeshRenderer>().sharedMaterial = fixtureMat;
            }
        }

        private static Mesh cubeMesh;
        private static Mesh planeMesh;

        /// <summary>Builds a GameObject from a baked mesh asset
        /// (`Resources/CCTVMeshes/`) via `MeshFilter`/`MeshRenderer`
        /// directly — deliberately NOT `GameObject.CreatePrimitive`, whose
        /// own internal "attach a Collider" step is what breaks under
        /// WebGL's managed-code stripping (see this class's doc comment
        /// and `CCTVPrototypeBuilder.BakePrimitiveMeshes`). No Collider is
        /// ever added, which is fine — this environment never needs
        /// physics/raycasts.</summary>
        private GameObject CreatePrimitive(PrimitiveType type, string name)
        {
            var go = new GameObject(name);
            go.transform.SetParent(transform, false);
            go.AddComponent<MeshFilter>().sharedMesh = GetBakedMesh(type);
            go.AddComponent<MeshRenderer>();
            return go;
        }

        private static Mesh GetBakedMesh(PrimitiveType type)
        {
            if (type == PrimitiveType.Plane)
            {
                if (planeMesh == null) planeMesh = Resources.Load<Mesh>("CCTVMeshes/Plane");
                return planeMesh;
            }
            if (cubeMesh == null) cubeMesh = Resources.Load<Mesh>("CCTVMeshes/Cube");
            return cubeMesh;
        }

        /// <summary>Phase U4 — desaturated, low-glossiness by default
        /// (req. 13): Standard's own default (Glossiness=0.5) reads as
        /// noticeably shiny/plastic for concrete, drywall or shelving under
        /// a single strong directional light.</summary>
        private static Material MakeMaterial(Color color)
        {
            var shader = Shader.Find("Standard") ?? Shader.Find("Universal Render Pipeline/Lit");
            var mat = new Material(shader) { color = color };
            if (mat.HasProperty("_Glossiness")) mat.SetFloat("_Glossiness", 0.15f);
            if (mat.HasProperty("_Smoothness")) mat.SetFloat("_Smoothness", 0.15f);
            if (mat.HasProperty("_Metallic")) mat.SetFloat("_Metallic", 0f);
            return mat;
        }
    }
}
