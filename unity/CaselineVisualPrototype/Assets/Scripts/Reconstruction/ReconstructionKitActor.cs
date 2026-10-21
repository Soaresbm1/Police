using UnityEngine;

namespace Caseline.Reconstruction
{
    /// <summary>Marks an actor built from the optional character kit (a Synty character). Such an actor keeps its own
    /// textured look, so the flat clothing-tone tint the blockout mannequin gets is not applied to it. (A MonoBehaviour
    /// must live in a file of its own name, which is why this is not next to <see cref="ReconstructionActorKit"/>.)</summary>
    public sealed class ReconstructionKitActor : MonoBehaviour
    {
    }
}
