"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import {
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type OnNodesDelete,
  type OnEdgesDelete,
} from "@xyflow/react";
import {
  addBoardEdgeAction,
  addBoardNodeAction,
  addBoardNoteAction,
  moveBoardNodeAction,
  removeBoardEdgeAction,
  removeBoardNodeAction,
} from "@/lib/game-session/actions";
import type { BoardEdge, BoardNode, BoardNodeKind } from "@/lib/game-session/types";
import type { BoardPaletteItem } from "@/lib/game-session/player-view";

const KIND_COLOR: Record<BoardNodeKind, { background: string; border: string }> = {
  person: { background: "#1a2620", border: "#6c9c72" },
  evidence: { background: "#241d10", border: "#bb8a42" },
  location: { background: "#141d26", border: "#5c8ab0" },
  note: { background: "#2b2510", border: "#c9a23d" },
};

const KIND_LABEL: Record<BoardNodeKind, string> = {
  person: "Personne",
  evidence: "Preuve",
  location: "Lieu",
  note: "Note",
};

function hashOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function toFlowNode(n: BoardNode): Node {
  const colors = KIND_COLOR[n.kind];
  const tilt = n.kind === "note" ? (hashOf(n.id) % 5) - 2 : 0;
  return {
    id: n.id,
    position: { x: n.x, y: n.y },
    data: {
      // The tilt is applied to this inner wrapper, never to the node's own
      // `style` — React Flow owns `transform` on the outer node element for
      // positioning, and setting it ourselves (even conditionally) clobbers
      // that and leaves every node stacked at the same screen position.
      label: (
        <div style={tilt ? { transform: `rotate(${tilt}deg)` } : undefined}>
          <div className="font-data mb-1 text-[9px] uppercase tracking-[0.14em]" style={{ color: colors.border }}>
            {KIND_LABEL[n.kind]}
          </div>
          <div className="font-medium leading-snug">{n.label}</div>
          {n.detail && <div className="mt-1 text-[10px] leading-snug text-muted">{n.detail.slice(0, 90)}</div>}
        </div>
      ),
      refId: n.refId,
    },
    style: {
      background: colors.background,
      border: `1px solid ${colors.border}`,
      borderTop: `3px solid ${colors.border}`,
      color: "#e8e6de",
      padding: 10,
      fontSize: 12,
      maxWidth: 220,
      boxShadow: "0 3px 8px rgba(0,0,0,0.4)",
    },
  };
}

function toFlowEdge(e: BoardEdge): Edge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label || undefined,
    style: { stroke: "#bb8a42", strokeWidth: 2 },
    labelStyle: { fill: "#e8e6de", fontSize: 11 },
    labelBgStyle: { fill: "#17191e" },
  };
}

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function EvidenceBoard({
  initialNodes,
  initialEdges,
  palette,
}: {
  initialNodes: BoardNode[];
  initialEdges: BoardEdge[];
  palette: BoardPaletteItem[];
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes.map(toFlowNode));
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges.map(toFlowEdge));
  const [, startTransition] = useTransition();
  const [noteText, setNoteText] = useState("");
  const [placedRefIds, setPlacedRefIds] = useState<Set<string>>(
    () => new Set(initialNodes.map((n) => n.refId).filter(Boolean)),
  );

  const availablePalette = useMemo(() => palette.filter((item) => !placedRefIds.has(item.refId)), [palette, placedRefIds]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const id = randomId("edge");
      const label = "";
      setEdges((eds) => addEdge({ ...connection, id, label }, eds));
      startTransition(() => {
        addBoardEdgeAction(id, connection.source!, connection.target!, label);
      });
    },
    [setEdges],
  );

  const onNodeDragStop = useCallback((_event: unknown, node: Node) => {
    startTransition(() => {
      moveBoardNodeAction(node.id, node.position.x, node.position.y);
    });
  }, []);

  const handleNodesDelete: OnNodesDelete = useCallback((deleted) => {
    setPlacedRefIds((prev) => {
      const next = new Set(prev);
      for (const node of deleted) {
        const refId = (node.data as { refId?: string }).refId;
        if (refId) next.delete(refId);
      }
      return next;
    });
    startTransition(() => {
      for (const node of deleted) removeBoardNodeAction(node.id);
    });
  }, []);

  const handleEdgesDelete: OnEdgesDelete = useCallback((deleted) => {
    startTransition(() => {
      for (const edge of deleted) removeBoardEdgeAction(edge.id);
    });
  }, []);

  // Cascading grid placement for newly-added nodes — deterministic (no
  // Math.random in an event handler) and avoids stacking new nodes exactly
  // on top of each other. Backed by a ref rather than `nodes.length`: two
  // additions fired in quick succession can both read the same pre-update
  // `nodes` snapshot (React batches the state updates), which previously
  // placed every new node at the same slot; a ref counter always advances.
  const placementCount = useRef(initialNodes.length);
  const nextPlacement = (): { x: number; y: number } => {
    const count = placementCount.current++;
    const column = count % 5;
    const row = Math.floor(count / 5);
    return { x: 60 + column * 200, y: 60 + row * 140 };
  };

  const addFromPalette = (item: BoardPaletteItem) => {
    const id = randomId("node");
    const { x, y } = nextPlacement();
    setNodes((nds) => [...nds, toFlowNode({ id, kind: item.kind, refId: item.refId, label: item.label, detail: item.detail, x, y })]);
    setPlacedRefIds((prev) => new Set(prev).add(item.refId));
    startTransition(() => {
      addBoardNodeAction(id, item.kind, item.refId, item.label, item.detail, x, y);
    });
  };

  const addNote = () => {
    if (!noteText.trim()) return;
    const id = randomId("node");
    const { x, y } = nextPlacement();
    setNodes((nds) => [...nds, toFlowNode({ id, kind: "note", refId: "", label: "Note", detail: noteText, x, y })]);
    startTransition(() => {
      addBoardNoteAction(id, noteText, x, y);
    });
    setNoteText("");
  };

  return (
    <div className="flex h-[calc(100vh-140px)] gap-3">
      <div className="panel w-64 shrink-0 overflow-y-auto p-3">
        <p className="field-label mb-2">Ajouter au tableau</p>
        <div className="flex flex-col gap-1">
          {availablePalette.map((item) => (
            <button
              key={`${item.kind}-${item.refId}`}
              onClick={() => addFromPalette(item)}
              className="border border-border-strong px-2 py-1.5 text-left text-xs text-foreground hover:border-accent"
              title={item.detail}
            >
              <span className="mr-1 border border-border-strong bg-surface-raised px-1 text-[10px] uppercase text-muted">
                {KIND_LABEL[item.kind]}
              </span>
              {item.label}
            </button>
          ))}
          {availablePalette.length === 0 && <p className="text-xs text-muted">Rien de plus à ajouter pour l&apos;instant.</p>}
        </div>

        <p className="field-label mb-2 mt-4">Ajouter une note</p>
        <textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          rows={3}
          placeholder="Votre hypothèse..."
          className="w-full border border-border-strong bg-surface-sunken p-2 text-xs text-foreground"
        />
        <button onClick={addNote} className="btn btn-primary mt-1 w-full">
          Ajouter la note
        </button>

        <p className="mt-4 text-xs text-muted">
          Glissez pour déplacer, tirez depuis le bord d&apos;un élément vers un autre pour les relier, sélectionnez et
          appuyez sur Suppr pour retirer.
        </p>
      </div>

      <div className="board-surface caseline-board flex-1 border border-border">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStop={onNodeDragStop}
          onNodesDelete={handleNodesDelete}
          onEdgesDelete={handleEdgesDelete}
          connectionRadius={32}
          colorMode="dark"
          fitView
        >
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </div>
  );
}
