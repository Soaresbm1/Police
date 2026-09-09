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
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";

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
  // On mobile there isn't room for a permanent 256px side panel next to
  // the canvas — it becomes a toggled sheet instead, closed by default so
  // the board itself gets the full screen. Irrelevant at `lg+`, where the
  // panel is always visible regardless of this state (see the JSX below).
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  useBodyScrollLock(mobilePanelOpen);

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

  const panelContent = (
    <>
      <p className="field-label mb-2">Ajouter au tableau</p>
      <div className="flex flex-col gap-1">
        {availablePalette.map((item) => (
          <button
            key={`${item.kind}-${item.refId}`}
            onClick={() => {
              addFromPalette(item);
            }}
            className="min-h-11 border border-border-strong px-2 py-1.5 text-left text-xs text-foreground hover:border-accent"
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
        className="w-full border border-border-strong bg-surface-sunken p-2 text-base text-foreground sm:text-xs"
      />
      <button onClick={addNote} className="btn btn-primary mt-1 w-full">
        Ajouter la note
      </button>

      <p className="mt-4 text-xs text-muted">
        Glissez pour déplacer, tirez depuis le bord d&apos;un élément vers un autre pour les relier, sélectionnez et
        appuyez sur Suppr pour retirer.
      </p>
    </>
  );

  return (
    <div className="board-shell-height flex flex-col gap-2 lg:flex-row lg:gap-3">
      {/* Desktop: permanent left panel, unchanged from before. */}
      <div className="panel hidden w-64 shrink-0 overflow-y-auto p-3 lg:block">{panelContent}</div>

      {/* Mobile/tablet: a small toolbar instead of a permanent 256px
         panel — there's no room for both it and a usable canvas below
         `lg`. The panel itself becomes a bottom sheet, opened on demand,
         so the board defaults to the full width/height of the screen. */}
      <div className="flex items-center gap-2 lg:hidden">
        <button type="button" onClick={() => setMobilePanelOpen(true)} className="btn flex-1">
          Ajouter au tableau {availablePalette.length > 0 && `(${availablePalette.length})`}
        </button>
      </div>

      {mobilePanelOpen && (
        // Same fix as `MobileNav`'s drawer: `touch-none` on the backdrop
        // so it can never act as a pan surface, and the sheet shell below
        // is sized-only (not itself the scroll container) — only the
        // inner region scrolls.
        <div
          className="fixed inset-0 z-40 flex touch-none flex-col justify-end bg-background-deep/80 lg:hidden"
          onClick={() => setMobilePanelOpen(false)}
        >
          <div className="pb-sheet-safe-sm panel panel-bracketed flex max-h-[75dvh] flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex shrink-0 items-center justify-between px-3 pt-3 pb-2">
              <p className="field-label">Tableau des preuves</p>
              <button type="button" onClick={() => setMobilePanelOpen(false)} className="btn btn-ghost !px-2 !py-1 !text-xs" aria-label="Fermer">
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overflow-x-hidden overscroll-contain px-3 pb-3">{panelContent}</div>
          </div>
        </div>
      )}

      {/* `flex-1` only at `lg` — at that breakpoint the parent is a ROW,
         so flex-1 controls WIDTH (correct, matches the sidebar's own
         layout) via `align-items: stretch` for height. Below `lg` the
         parent is a COLUMN, where flex-1's flex-basis:0% would instead
         govern HEIGHT and silently override `board-canvas-height`
         entirely (confirmed empirically — even a `!important` inline
         height couldn't beat it) since the parent has no fixed height
         of its own to flex-grow into. */}
      <div className="board-canvas-height board-surface caseline-board min-h-[320px] touch-none border border-border lg:flex-1">
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
          <MiniMap pannable zoomable className="!hidden sm:!block" />
        </ReactFlow>
      </div>
    </div>
  );
}
