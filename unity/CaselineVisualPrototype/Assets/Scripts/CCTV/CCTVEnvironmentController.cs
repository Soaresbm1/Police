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
                    // "generic" (or any unrecognized kind) — the plain
                    // floor + walls shell already built above is the safe
                    // fallback, matching the 2D renderer's own "generic
                    // draws nothing extra" rule.
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

        private void EnsureMaterials()
        {
            if (floorMat != null) return;
            floorMat = MakeMaterial(new Color(0.42f, 0.42f, 0.42f));
            wallMat = MakeMaterial(new Color(0.55f, 0.55f, 0.57f));
            detailMat = MakeMaterial(new Color(0.35f, 0.35f, 0.36f));
            lineMat = MakeMaterial(new Color(0.85f, 0.78f, 0.35f));
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
        }

        private void BuildCorridorDetails()
        {
            // A doorway-like recess on the far wall and a couple of floor
            // guide lines — never anything resembling a person or object.
            var doorFrame = CreatePrimitive(PrimitiveType.Cube, "DoorFrame");
            doorFrame.transform.position = new Vector3(0f, 1.2f, FloorSize / 2f - 0.3f);
            doorFrame.transform.localScale = new Vector3(1.6f, 2.4f, 0.1f);
            doorFrame.GetComponent<MeshRenderer>().sharedMaterial = detailMat;

            for (var i = -1; i <= 1; i += 2)
            {
                var guide = CreatePrimitive(PrimitiveType.Cube, "FloorGuide");
                guide.transform.position = new Vector3(i * 3f, 0.01f, 0f);
                guide.transform.localScale = new Vector3(0.06f, 0.01f, FloorSize - 4f);
                guide.GetComponent<MeshRenderer>().sharedMaterial = lineMat;
            }
        }

        private void BuildStreetDetails()
        {
            // Low building-block silhouettes along the back wall, plus a curb.
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
                x += w + 1.5f;
                i++;
            }

            var curb = CreatePrimitive(PrimitiveType.Cube, "Curb");
            curb.transform.position = new Vector3(0, 0.05f, -2f);
            curb.transform.localScale = new Vector3(FloorSize - 2f, 0.1f, 0.3f);
            curb.GetComponent<MeshRenderer>().sharedMaterial = lineMat;
        }

        private void BuildShopDetails()
        {
            var counter = CreatePrimitive(PrimitiveType.Cube, "Counter");
            counter.transform.position = new Vector3(-2f, 0.4f, 5f);
            counter.transform.localScale = new Vector3(5f, 0.8f, 1f);
            counter.GetComponent<MeshRenderer>().sharedMaterial = detailMat;

            for (var i = 0; i < 3; i++)
            {
                var shelf = CreatePrimitive(PrimitiveType.Cube, "Shelf");
                shelf.transform.position = new Vector3(-FloorSize / 2f + 1f, 1f, -6f + i * 2.5f);
                shelf.transform.localScale = new Vector3(0.4f, 2f, 1.2f);
                shelf.GetComponent<MeshRenderer>().sharedMaterial = detailMat;
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

        private static Material MakeMaterial(Color color)
        {
            var shader = Shader.Find("Standard") ?? Shader.Find("Universal Render Pipeline/Lit");
            return new Material(shader) { color = color };
        }
    }
}
