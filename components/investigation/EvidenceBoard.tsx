"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useMemo, useState, useTransition } from "react";
import {
  Background,
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
  person: { background: "#1f2a1f", border: "#5fae76" },
  evidence: { background: "#2a2415", border: "#c8963f" },
  location: { background: "#1a232c", border: "#6fa8dc" },
  note: { background: "#241a2c", border: "#a97fd9" },
};

const KIND_LABEL: Record<BoardNodeKind, string> = {
  person: "Personne",
  evidence: "Preuve",
  location: "Lieu",
  note: "Note",
};

function toFlowNode(n: BoardNode): Node {
  const colors = KIND_COLOR[n.kind];
  return {
    id: n.id,
    position: { x: n.x, y: n.y },
    data: {
      label: (
        <div>
          <div className="font-medium">{n.label}</div>
          {n.detail && <div className="mt-0.5 text-[10px] text-muted">{n.detail.slice(0, 80)}</div>}
        </div>
      ),
      refId: n.refId,
    },
    style: {
      background: colors.background,
      border: `1px solid ${colors.border}`,
      color: "#dfe4ee",
      borderRadius: 6,
      padding: 8,
      fontSize: 12,
      maxWidth: 220,
    },
  };
}

function toFlowEdge(e: BoardEdge): Edge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label || undefined,
    style: { stroke: "#c8963f" },
    labelStyle: { fill: "#dfe4ee", fontSize: 11 },
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
  // on top of each other.
  const nextPlacement = (count: number): { x: number; y: number } => {
    const column = count % 5;
    const row = Math.floor(count / 5);
    return { x: 60 + column * 200, y: 60 + row * 140 };
  };

  const addFromPalette = (item: BoardPaletteItem) => {
    const id = randomId("node");
    const { x, y } = nextPlacement(nodes.length);
    setNodes((nds) => [...nds, toFlowNode({ id, kind: item.kind, refId: item.refId, label: item.label, detail: item.detail, x, y })]);
    setPlacedRefIds((prev) => new Set(prev).add(item.refId));
    startTransition(() => {
      addBoardNodeAction(id, item.kind, item.refId, item.label, item.detail, x, y);
    });
  };

  const addNote = () => {
    if (!noteText.trim()) return;
    const id = randomId("node");
    const { x, y } = nextPlacement(nodes.length);
    setNodes((nds) => [...nds, toFlowNode({ id, kind: "note", refId: "", label: "Note", detail: noteText, x, y })]);
    startTransition(() => {
      addBoardNoteAction(id, noteText, x, y);
    });
    setNoteText("");
  };

  return (
    <div className="flex h-[calc(100vh-140px)] gap-3">
      <div className="w-64 shrink-0 overflow-y-auto rounded border border-border bg-surface p-3">
        <p className="mb-2 text-xs uppercase tracking-wide text-muted">Ajouter au tableau</p>
        <div className="flex flex-col gap-1">
          {availablePalette.map((item) => (
            <button
              key={`${item.kind}-${item.refId}`}
              onClick={() => addFromPalette(item)}
              className="rounded border border-border-strong px-2 py-1.5 text-left text-xs text-foreground hover:border-accent"
              title={item.detail}
            >
              <span className="mr-1 rounded bg-surface-raised px-1 text-[10px] uppercase text-muted">{KIND_LABEL[item.kind]}</span>
              {item.label}
            </button>
          ))}
          {availablePalette.length === 0 && <p className="text-xs text-muted">Rien de plus à ajouter pour l&apos;instant.</p>}
        </div>

        <p className="mb-2 mt-4 text-xs uppercase tracking-wide text-muted">Ajouter une note</p>
        <textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          rows={3}
          placeholder="Votre hypothèse..."
          className="w-full rounded border border-border-strong bg-background p-2 text-xs text-foreground"
        />
        <button onClick={addNote} className="mt-1 w-full rounded bg-accent px-2 py-1 text-xs font-medium text-background hover:bg-accent-strong">
          Ajouter la note
        </button>

        <p className="mt-4 text-xs text-muted">
          Glissez pour déplacer, tirez depuis le bord d&apos;un élément vers un autre pour les relier, sélectionnez et
          appuyez sur Suppr pour retirer.
        </p>
      </div>

      <div className="flex-1 rounded border border-border bg-surface">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStop={onNodeDragStop}
          onNodesDelete={handleNodesDelete}
          onEdgesDelete={handleEdgesDelete}
          colorMode="dark"
          fitView
        >
          <Background gap={16} />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </div>
  );
}
