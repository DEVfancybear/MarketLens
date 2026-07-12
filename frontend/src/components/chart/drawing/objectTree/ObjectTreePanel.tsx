"use client";

import { useMemo, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Folder,
  FolderMinus,
  FolderPlus,
  Lock,
  LockOpen,
  MoveDown,
  MoveUp,
  Pencil,
  Globe2,
} from "lucide-react";
import type { Drawing, DrawingSyncMode } from "@/types";
import {
  drawingsAtom,
  selectedDrawingIdsAtom,
  setSelectedDrawingIdsAtom,
  updateDrawingAtom,
  drawingLayoutIdAtom,
  drawingChartIdAtom,
  symbolAtom,
} from "@/store/chartStore";
import { cn } from "@/utils/cn";
import {
  BatchPropertyChangeCommand,
  PropertyChangeCommand,
  drawingCommandManager,
} from "../history/CommandManager";
import {
  buildDrawingObjectTree,
  createDrawingGroup,
  drawingObjectLabel,
  normalizeDrawingObjectName,
  reorderDrawingObjectTree,
} from "./drawingObjectTree";
import {
  DRAWING_SYNC_MODE_OPTIONS,
  canGroupDrawingsBySyncMode,
  drawingSyncBinding,
  drawingSyncMode,
} from "../persistence/drawingSyncScope";

type RenameTarget = { kind: "drawing" | "group"; id: string; value: string };

export function ObjectTreePanel() {
  const drawings = useAtomValue(drawingsAtom);
  const selected = useAtomValue(selectedDrawingIdsAtom);
  const setSelected = useSetAtom(setSelectedDrawingIdsAtom);
  const updateDrawing = useSetAtom(updateDrawingAtom);
  const layoutId = useAtomValue(drawingLayoutIdAtom);
  const chartId = useAtomValue(drawingChartIdAtom);
  const symbol = useAtomValue(symbolAtom);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [rename, setRename] = useState<RenameTarget | null>(null);
  const [syncMenu, setSyncMenu] = useState<string | null>(null);
  const tree = useMemo(() => buildDrawingObjectTree(drawings), [drawings]);

  const executeBatch = (
    targets: readonly Drawing[],
    patch: (drawing: Drawing) => Partial<Drawing>,
    oldPatch: (drawing: Drawing) => Partial<Drawing>,
    label: string,
  ) => {
    if (targets.length === 0) return;
    drawingCommandManager.execute(
      new BatchPropertyChangeCommand(
        updateDrawing,
        targets.map((drawing) => ({
          id: drawing.id,
          newProps: patch(drawing),
          oldProps: oldPatch(drawing),
        })),
        label,
      ),
    );
  };

  const commitRename = () => {
    if (!rename) return;
    const value = normalizeDrawingObjectName(rename.value);
    if (rename.kind === "drawing") {
      const drawing = drawings.find((item) => item.id === rename.id);
      if (drawing && value !== drawing.name) {
        drawingCommandManager.execute(
          new PropertyChangeCommand(
            updateDrawing,
            drawing.id,
            { name: value },
            { name: drawing.name },
          ),
        );
      }
    } else if (value) {
      const members = drawings.filter((item) => item.group?.id === rename.id);
      executeBatch(
        members,
        (drawing) => ({ group: { id: rename.id, name: value } }),
        (drawing) => ({ group: drawing.group }),
        "Rename Group",
      );
    }
    setRename(null);
  };

  const groupSelected = () => {
    const members = drawings.filter((drawing) => selected.has(drawing.id));
    if (!canGroupDrawingsBySyncMode(members)) return;
    const group = createDrawingGroup(drawings);
    executeBatch(members, () => ({ group }), (drawing) => ({ group: drawing.group }), "Group Objects");
  };

  const setSyncMode = (members: readonly Drawing[], mode: DrawingSyncMode) => {
    const groupId = members[0]?.group?.id;
    const targets = groupId
      ? drawings.filter((drawing) => drawing.group?.id === groupId)
      : members;
    const context = { symbol, layoutId, chartId };
    executeBatch(
      targets,
      () => ({ sync: drawingSyncBinding(mode, context) }),
      (drawing) => ({ sync: drawing.sync }),
      "Change Drawing Sync",
    );
    setSyncMenu(null);
  };

  const ungroupSelected = () => {
    const members = drawings.filter((drawing) => selected.has(drawing.id) && drawing.group);
    executeBatch(members, () => ({ group: undefined }), (drawing) => ({ group: drawing.group }), "Ungroup Objects");
  };

  const moveNode = (nodeId: string, direction: "up" | "down") => {
    const zIndices = reorderDrawingObjectTree(drawings, nodeId, direction);
    const targets = drawings.filter((drawing) => zIndices.has(drawing.id));
    executeBatch(
      targets,
      (drawing) => ({ zIndex: zIndices.get(drawing.id) }),
      (drawing) => ({ zIndex: drawing.zIndex }),
      direction === "up" ? "Move Object Up" : "Move Object Down",
    );
  };

  const renameInput = (target: RenameTarget) => (
    <input
      autoFocus
      value={rename?.value ?? target.value}
      onChange={(event) => setRename({ ...target, value: event.target.value })}
      onBlur={commitRename}
      onKeyDown={(event) => {
        if (event.key === "Enter") commitRename();
        if (event.key === "Escape") setRename(null);
      }}
      onClick={(event) => event.stopPropagation()}
      aria-label={`Rename ${target.kind}`}
      className="min-w-0 flex-1 rounded border border-brand bg-terminal-bg px-1 py-0.5 text-xs text-ink outline-none"
    />
  );

  const rowActions = (
    members: readonly Drawing[],
    nodeId: string,
    startRename: () => void,
  ) => {
    const visible = members.some((drawing) => drawing.visible !== false);
    const locked = members.length > 0 && members.every((drawing) => drawing.locked);
    const mode = drawingSyncMode(members[0]);
    return (
      <div className="ml-auto flex shrink-0 items-center">
        <TreeButton label="Rename" onClick={startRename}><Pencil size={12} /></TreeButton>
        <TreeButton label={visible ? "Hide" : "Show"} onClick={() => executeBatch(members, () => ({ visible: !visible }), (drawing) => ({ visible: drawing.visible }), visible ? "Hide Objects" : "Show Objects")}>{visible ? <Eye size={13} /> : <EyeOff size={13} />}</TreeButton>
        <TreeButton label={locked ? "Unlock" : "Lock"} onClick={() => executeBatch(members, () => ({ locked: !locked }), (drawing) => ({ locked: drawing.locked }), locked ? "Unlock Objects" : "Lock Objects")}>{locked ? <Lock size={12} /> : <LockOpen size={12} />}</TreeButton>
        <div className="relative">
          <TreeButton label={`Sync: ${mode}`} onClick={() => setSyncMenu(syncMenu === nodeId ? null : nodeId)}><Globe2 size={12} /></TreeButton>
          {syncMenu === nodeId && (
            <div className="absolute right-0 top-full z-50 mt-1 w-40 rounded border border-terminal-border bg-terminal-panel-2 p-1 shadow-xl">
              {DRAWING_SYNC_MODE_OPTIONS.map((option) => (
                <button key={option.id} type="button" aria-label={`${option.label} ${nodeId}`} onClick={(event) => { event.stopPropagation(); setSyncMode(members, option.id); }} className={cn("w-full rounded px-2 py-1.5 text-left text-[10px] hover:bg-terminal-hover", mode === option.id ? "text-brand" : "text-ink")}>{option.label}</button>
              ))}
            </div>
          )}
        </div>
        <TreeButton label="Move up" onClick={() => moveNode(nodeId, "up")}><MoveUp size={12} /></TreeButton>
        <TreeButton label="Move down" onClick={() => moveNode(nodeId, "down")}><MoveDown size={12} /></TreeButton>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-terminal-panel" data-object-tree>
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-terminal-border px-2">
        <span className="mr-auto text-sm font-semibold text-ink">Drawings</span>
        <TreeButton label="Group selected" disabled={!canGroupDrawingsBySyncMode(drawings.filter((drawing) => selected.has(drawing.id)))} onClick={groupSelected}><FolderPlus size={15} /></TreeButton>
        <TreeButton label="Ungroup selected" disabled={!drawings.some((drawing) => selected.has(drawing.id) && drawing.group)} onClick={ungroupSelected}><FolderMinus size={15} /></TreeButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {tree.length === 0 && <div className="px-3 py-8 text-center text-xs text-ink-faint">No drawings on this chart</div>}
        {tree.map((node) => {
          if (node.kind === "drawing") {
            const active = selected.has(node.drawing.id);
            return (
              <div key={node.drawing.id} className={cn("group flex h-8 items-center gap-1 px-2 text-xs hover:bg-terminal-hover", active && "bg-brand/15 text-brand")} onClick={(event) => setSelected(event.ctrlKey || event.metaKey ? toggleId(selected, node.drawing.id) : [node.drawing.id])} data-object-id={node.drawing.id}>
                <span className="w-4 text-center text-ink-faint">•</span>
                {rename?.kind === "drawing" && rename.id === node.drawing.id ? renameInput(rename) : <span className="min-w-0 flex-1 truncate text-ink">{drawingObjectLabel(node.drawing)}</span>}
                {rowActions([node.drawing], node.drawing.id, () => setRename({ kind: "drawing", id: node.drawing.id, value: node.drawing.name ?? "" }))}
              </div>
            );
          }
          const isCollapsed = collapsed.has(node.id);
          const groupSelectedState = node.drawings.every((drawing) => selected.has(drawing.id));
          return (
            <div key={node.id} data-object-group={node.id}>
              <div className={cn("group flex h-8 items-center gap-1 px-2 text-xs hover:bg-terminal-hover", groupSelectedState && "bg-brand/15")} onClick={() => setSelected(node.drawings.map((drawing) => drawing.id))}>
                <button type="button" aria-label={isCollapsed ? "Expand group" : "Collapse group"} onClick={(event) => { event.stopPropagation(); setCollapsed(toggleId(collapsed, node.id)); }} className="text-ink-muted">{isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button>
                <Folder size={14} className="shrink-0 text-brand" />
                {rename?.kind === "group" && rename.id === node.id ? renameInput(rename) : <span className="min-w-0 flex-1 truncate font-semibold text-ink">{node.name}</span>}
                {rowActions(node.drawings, node.id, () => setRename({ kind: "group", id: node.id, value: node.name }))}
              </div>
              {!isCollapsed && node.drawings.map((drawing) => (
                <div key={drawing.id} className={cn("group ml-5 flex h-8 items-center gap-1 border-l border-terminal-border px-2 text-xs hover:bg-terminal-hover", selected.has(drawing.id) && "bg-brand/10")} onClick={(event) => { event.stopPropagation(); setSelected(event.ctrlKey || event.metaKey ? toggleId(selected, drawing.id) : [drawing.id]); }} data-object-id={drawing.id}>
                  <span className="w-3 text-center text-ink-faint">•</span>
                  {rename?.kind === "drawing" && rename.id === drawing.id ? renameInput(rename) : <span className="min-w-0 flex-1 truncate text-ink">{drawingObjectLabel(drawing)}</span>}
                  {rowActions([drawing], drawing.id, () => setRename({ kind: "drawing", id: drawing.id, value: drawing.name ?? "" }))}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function toggleId(values: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(values);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function TreeButton({ label, children, ...props }: { label: string; children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" title={label} aria-label={label} className="flex h-7 w-7 items-center justify-center rounded text-ink-muted hover:bg-terminal-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-30" {...props}>{children}</button>;
}
