"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getModelLabel } from "@/lib/utils/format";
import { ModelSelector } from "@/components/ModelSelector";

// ============================================================
// Types
// ============================================================

interface AgentTreeNode {
  id: string;
  name: string;
  rank: "general" | "lieutenant" | "soldier";
  type: string;
  description: string | null;
  effectiveModel: string;
  modelOverride: string | null;
  isActive: boolean;
  activeVersion: number;
  promptPreview: string;
  children: AgentTreeNode[];
}

interface SoldierUpdate {
  agentId: string;
  agentName: string;
  acknowledgment: string;
  whatChanged: string;
  oldPrompt: string;
  newPrompt: string;
}

interface OrderData {
  id: number;
  order_text: string;
  general_response: string | null;
  lieutenant_id: string | null;
  lieutenant_order: string | null;
  lieutenant_response: string | null;
  affected_agents: string | null;
  proposed_changes: string | null;
  status: string;
  created_at: string;
  executed_at: string | null;
}

interface LiveOrderState {
  step: "commander" | "general" | "lieutenant" | "soldiers" | "approval" | "done";
  commanderMessage: string;
  generalResponse: string | null;
  delegation: { lieutenantId: string; lieutenantName: string; orderText: string } | null;
  lieutenantResponse: string | null;
  soldierUpdates: SoldierUpdate[];
  orderId: number | null;
  status: string;
  error: string | null;
  activePath: string[];
  approvedAgents: Set<string>;
  flashGreen: Set<string>;
  flashRed: Set<string>;
}

interface PromptVersion {
  id: number;
  agent_id: string;
  version: number;
  prompt_text: string;
  notes: string | null;
  created_at: string;
  created_by: string;
  is_active: number;
}

interface EffectivePromptSection {
  agentId: string;
  agentName: string;
  rank: string;
  promptText: string;
}

// ============================================================
// Utility
// ============================================================

function getTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr + "Z").getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Flatten all tree nodes to compute majority model */
function flattenTreeNodes(nodes: AgentTreeNode[]): AgentTreeNode[] {
  const result: AgentTreeNode[] = [];
  for (const n of nodes) {
    if (n.isActive) result.push(n);
    result.push(...flattenTreeNodes(n.children));
  }
  return result;
}

function getMajorityModel(tree: AgentTreeNode[]): string {
  const all = flattenTreeNodes(tree);
  const counts = new Map<string, number>();
  for (const n of all) {
    const m = n.effectiveModel;
    counts.set(m, (counts.get(m) || 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  for (const [m, c] of Array.from(counts.entries())) {
    if (c > bestCount) { best = m; bestCount = c; }
  }
  return best;
}

// ============================================================
// Diff View
// ============================================================

function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const maxLen = Math.max(oldLines.length, newLines.length);

  return (
    <div className="font-[family-name:var(--font-geist-mono)] text-[11px] leading-relaxed overflow-x-auto max-h-60 overflow-y-auto">
      {Array.from({ length: maxLen }, (_, i) => {
        const ol = oldLines[i] ?? "";
        const nl = newLines[i] ?? "";
        if (ol === nl) {
          return (
            <div key={i} className="flex">
              <span className="w-8 text-right text-neutral-600 pr-2 select-none shrink-0">{i + 1}</span>
              <span className="text-neutral-400 flex-1 whitespace-pre-wrap">{ol}</span>
            </div>
          );
        }
        return (
          <div key={i}>
            {ol && (
              <div className="flex bg-red-500/5">
                <span className="w-8 text-right text-red-500/50 pr-2 select-none shrink-0">-</span>
                <span className="text-red-400/80 flex-1 whitespace-pre-wrap">{ol}</span>
              </div>
            )}
            {nl && (
              <div className="flex bg-green-500/5">
                <span className="w-8 text-right text-green-500/50 pr-2 select-none shrink-0">+</span>
                <span className="text-green-400/80 flex-1 whitespace-pre-wrap">{nl}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// SVG Org Chart
// ============================================================

const NODE_W = 180;
const NODE_H = 80;
const GAP_X = 24;
const GAP_Y = 56;

interface LayoutNode {
  node: AgentTreeNode;
  x: number;
  y: number;
  children: LayoutNode[];
}

function layoutTree(roots: AgentTreeNode[]): { nodes: LayoutNode[]; width: number; height: number } {
  if (roots.length === 0) return { nodes: [], width: 0, height: 0 };

  let nextX = 0;

  function layout(node: AgentTreeNode, depth: number): LayoutNode {
    if (node.children.length === 0) {
      const ln: LayoutNode = { node, x: nextX, y: depth * (NODE_H + GAP_Y), children: [] };
      nextX += NODE_W + GAP_X;
      return ln;
    }

    const childLayouts = node.children.map(c => layout(c, depth + 1));
    const minX = childLayouts[0].x;
    const maxX = childLayouts[childLayouts.length - 1].x;
    const cx = (minX + maxX) / 2;

    return { node, x: cx, y: depth * (NODE_H + GAP_Y), children: childLayouts };
  }

  const laid = roots.map(r => layout(r, 0));
  const allNodes = flatLayoutNodes(laid);
  const maxX = Math.max(...allNodes.map(n => n.x)) + NODE_W;
  const maxY = Math.max(...allNodes.map(n => n.y)) + NODE_H;

  return { nodes: laid, width: maxX, height: maxY };
}

function flatLayoutNodes(nodes: LayoutNode[]): LayoutNode[] {
  const result: LayoutNode[] = [];
  for (const n of nodes) {
    result.push(n);
    result.push(...flatLayoutNodes(n.children));
  }
  return result;
}

function OrgChart({
  tree, activePath, flashGreen, flashRed, onClickNode, majorityModel,
}: {
  tree: AgentTreeNode[];
  activePath: string[];
  flashGreen: Set<string>;
  flashRed: Set<string>;
  onClickNode: (id: string) => void;
  majorityModel: string;
}) {
  const { nodes, width, height } = layoutTree(tree);
  const activeSet = new Set(activePath);
  const PAD = 20;

  function renderEdges(ln: LayoutNode): React.ReactNode {
    return ln.children.map(child => {
      const x1 = ln.x + NODE_W / 2;
      const y1 = ln.y + NODE_H;
      const x2 = child.x + NODE_W / 2;
      const y2 = child.y;
      const midY = y1 + (y2 - y1) / 2;

      const isActive = activeSet.has(ln.node.id) && activeSet.has(child.node.id);

      return (
        <g key={`${ln.node.id}-${child.node.id}`}>
          <path
            d={`M ${x1 + PAD} ${y1 + PAD} L ${x1 + PAD} ${midY + PAD} L ${x2 + PAD} ${midY + PAD} L ${x2 + PAD} ${y2 + PAD}`}
            fill="none"
            stroke={isActive ? "#f59e0b" : "#333"}
            strokeWidth={isActive ? 2.5 : 1.5}

            className={isActive ? "animate-pulse" : ""}
          />
          {renderEdges(child)}
        </g>
      );
    });
  }

  function renderNodes(ln: LayoutNode): React.ReactNode {
    const n = ln.node;
    const borderColor = n.rank === "general" ? "#f59e0b" : n.rank === "lieutenant" ? "#3b82f6" : "#555";
    const isGlowing = activeSet.has(n.id);
    const isGreen = flashGreen.has(n.id);
    const isRed = flashRed.has(n.id);
    const rankIcon = n.rank === "general" ? "\u2605" : n.rank === "lieutenant" ? "\u25C6" : "\u25CF";
    const isDifferentModel = n.isActive && n.effectiveModel !== majorityModel;

    let glowFilter = "";
    if (isGreen) glowFilter = "drop-shadow(0 0 8px rgba(34,197,94,0.7))";
    else if (isRed) glowFilter = "drop-shadow(0 0 8px rgba(239,68,68,0.7))";
    else if (isGlowing) glowFilter = "drop-shadow(0 0 6px rgba(245,158,11,0.6))";

    return (
      <g key={n.id}>
        <foreignObject
          x={ln.x + PAD}
          y={ln.y + PAD}
          width={NODE_W}
          height={NODE_H}
          style={{ filter: glowFilter }}
        >
          <div
            onClick={() => onClickNode(n.id)}
            className="h-full rounded-lg border-2 px-3 py-2 cursor-pointer transition-all hover:scale-105"
            style={{
              borderColor: isGreen ? "#22c55e" : isRed ? "#ef4444" : borderColor,
              background: isGlowing ? "rgba(245,158,11,0.08)" : "rgba(23,23,23,0.95)",
            }}
          >
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className={`text-xs ${n.rank === "general" ? "text-amber-400" : n.rank === "lieutenant" ? "text-blue-400" : "text-neutral-400"}`}>
                {rankIcon}
              </span>
              <span className="text-[11px] font-bold text-neutral-200 truncate">{n.name}</span>
            </div>
            {/* Model display — highlight if different from majority */}
            <div className="text-[9px] truncate mb-0.5">
              {isDifferentModel ? (
                <span className="px-1 py-0.5 rounded bg-purple-500/15 text-purple-400 font-semibold">
                  {getModelLabel(n.effectiveModel)}
                </span>
              ) : (
                <span className="text-neutral-500">{getModelLabel(n.effectiveModel)}</span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`text-[8px] uppercase tracking-wider font-bold px-1 py-0.5 rounded ${
                n.rank === "general" ? "bg-amber-500/15 text-amber-400" :
                n.rank === "lieutenant" ? "bg-blue-500/15 text-blue-400" :
                "bg-neutral-700 text-neutral-400"
              }`}>{n.rank}</span>
              {n.rank === "soldier" && (
                <span className="text-[8px] text-neutral-600 font-[family-name:var(--font-geist-mono)]">v{n.activeVersion}</span>
              )}
            </div>
          </div>
        </foreignObject>
        {ln.children.map(child => renderNodes(child))}
      </g>
    );
  }

  if (nodes.length === 0) return <div className="text-neutral-600 text-sm p-8 text-center">No agents found.</div>;

  return (
    <div className="w-full overflow-x-auto">
      <svg width={width + PAD * 2} height={height + PAD * 2} className="mx-auto">
        {nodes.map(n => renderEdges(n))}
        {nodes.map(n => renderNodes(n))}
      </svg>
    </div>
  );
}

// ============================================================
// Bulk Model Confirmation Dialog
// ============================================================

function BulkModelDialog({
  modelId, onChangeAll, onChangeGeneral, onCancel,
}: {
  modelId: string;
  onChangeAll: () => void;
  onChangeGeneral: () => void;
  onCancel: () => void;
}) {
  const label = getModelLabel(modelId);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onCancel}>
      <div className="bg-neutral-900 border border-neutral-700 rounded-2xl max-w-md w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-5">
          <h3 className="text-sm font-bold text-neutral-100 mb-2">Change Agent Models</h3>
          <p className="text-xs text-neutral-400 leading-relaxed">
            Switch to <span className="text-amber-400 font-semibold">{label}</span>?
          </p>
          <p className="text-[10px] text-neutral-500 mt-1">
            Model ID: <span className="font-[family-name:var(--font-geist-mono)]">{modelId}</span>
          </p>
        </div>
        <div className="px-6 py-4 border-t border-neutral-800 flex flex-col gap-2">
          <button onClick={onChangeAll}
            className="w-full px-4 py-2.5 text-xs font-semibold rounded-lg bg-amber-500 text-black hover:bg-amber-400 transition-colors">
            Change All Agents
          </button>
          <button onClick={onChangeGeneral}
            className="w-full px-4 py-2.5 text-xs font-semibold rounded-lg bg-neutral-800 text-neutral-200 hover:bg-neutral-700 border border-neutral-700 transition-colors">
            Change General Only
          </button>
          <button onClick={onCancel}
            className="w-full px-4 py-2 text-xs text-neutral-500 hover:text-neutral-300 transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Live Command Chain — War Room
// ============================================================

function WarRoomThread({ live }: { live: LiveOrderState }) {
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [live.step, live.soldierUpdates.length]);

  return (
    <div ref={threadRef} className="space-y-3 max-h-[70vh] overflow-y-auto pr-2">
      {/* Commander */}
      <div className="rounded-xl border border-neutral-700 bg-neutral-900/80 p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm">{"👤"}</span>
          <span className="text-xs font-bold text-neutral-200 uppercase tracking-wider">Commander (You)</span>
        </div>
        <p className="text-sm text-neutral-300 italic">&ldquo;{live.commanderMessage}&rdquo;</p>
      </div>

      {live.step === "commander" && (
        <div className="flex items-center gap-2 text-neutral-500 text-xs pl-4 animate-pulse">
          <div className="w-2 h-2 bg-amber-500 rounded-full animate-ping" />
          Sending to The General...
        </div>
      )}

      {/* General */}
      {live.generalResponse && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-amber-400 text-sm">{"\u2605"}</span>
            <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">The General</span>
          </div>
          <pre className="text-xs text-neutral-300 whitespace-pre-wrap leading-relaxed">{live.generalResponse}</pre>
        </div>
      )}

      {live.generalResponse && live.delegation && live.step !== "commander" && (
        <div className="flex items-center gap-2 text-amber-500/70 text-[10px] pl-6 font-semibold uppercase tracking-wider">
          <span className="text-amber-500">{"\u2192"}</span> Delegated to {live.delegation.lieutenantName}
        </div>
      )}

      {live.step === "general" && live.delegation && (
        <div className="flex items-center gap-2 text-neutral-500 text-xs pl-4 animate-pulse">
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-ping" />
          Delegating to {live.delegation.lieutenantName}...
        </div>
      )}

      {/* No delegation warning */}
      {live.generalResponse && !live.delegation && live.step !== "commander" && !live.error && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-3">
          <p className="text-xs text-yellow-400">No delegation detected — the General may not have identified a Lieutenant to delegate to.</p>
        </div>
      )}

      {/* Lieutenant */}
      {live.lieutenantResponse && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-blue-400 text-sm">{"\u25C6"}</span>
            <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">{live.delegation?.lieutenantName || "Lieutenant"}</span>
          </div>
          <pre className="text-xs text-neutral-300 whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto">{live.lieutenantResponse}</pre>
        </div>
      )}

      {live.lieutenantResponse && live.soldierUpdates.length > 0 && (
        <div className="flex items-center gap-2 text-blue-500/70 text-[10px] pl-6 font-semibold uppercase tracking-wider">
          <span className="text-blue-500">{"\u2192"}</span> Pushed to {live.soldierUpdates.map(su => su.agentName).join(", ")}
        </div>
      )}

      {live.lieutenantResponse && live.soldierUpdates.length === 0 && live.step === "approval" && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-3">
          <p className="text-xs text-yellow-400">Lieutenant responded but no soldier prompt changes were detected. The response may not have used the expected JSON format.</p>
        </div>
      )}

      {live.step === "lieutenant" && (
        <div className="flex items-center gap-2 text-neutral-500 text-xs pl-4 animate-pulse">
          <div className="w-2 h-2 bg-neutral-400 rounded-full animate-ping" />
          Pushing updates to soldiers...
        </div>
      )}

      {/* Soldier updates */}
      {live.soldierUpdates.map((su) => (
        <SoldierUpdateCard key={su.agentId} update={su} live={live} />
      ))}

      {/* Error */}
      {live.error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
          <p className="text-xs text-red-400">{live.error}</p>
        </div>
      )}
    </div>
  );
}

function SoldierUpdateCard({ update, live }: { update: SoldierUpdate; live: LiveOrderState }) {
  const [showDiff, setShowDiff] = useState(false);
  const isApproved = live.approvedAgents.has(update.agentId);

  return (
    <div className={`rounded-xl border p-4 transition-all ${
      isApproved ? "border-green-500/30 bg-green-500/5" : "border-neutral-700 bg-neutral-900/80"
    }`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-neutral-400 text-sm">{"\u25CF"}</span>
        <span className="text-xs font-bold text-neutral-200 uppercase tracking-wider">{update.agentName}</span>
        {isApproved && <span className="text-[9px] text-green-400 font-bold">{"\u2713"} APPROVED</span>}
      </div>
      <p className="text-xs text-neutral-400 italic mb-2">&ldquo;{update.acknowledgment}&rdquo;</p>
      <div className="text-[10px] text-neutral-500 mb-2">Change: {update.whatChanged}</div>
      <button onClick={() => setShowDiff(!showDiff)} className="text-[10px] text-amber-400 hover:text-amber-300 mb-2">
        {showDiff ? "Hide Diff" : "View Diff"}
      </button>
      {showDiff && (
        <div className="rounded-lg border border-neutral-800 overflow-hidden p-2 bg-neutral-800/30">
          <DiffView oldText={update.oldPrompt} newText={update.newPrompt} />
        </div>
      )}
    </div>
  );
}

// ============================================================
// Approval Bar
// ============================================================

function ApprovalBar({
  live, onApproveAll, onRejectAll, onCherryPick,
}: {
  live: LiveOrderState;
  onApproveAll: () => void;
  onRejectAll: () => void;
  onCherryPick: (agentId: string) => void;
}) {
  if (live.step !== "approval" && live.step !== "soldiers") return null;
  if (live.soldierUpdates.length === 0) return null;
  if (live.status === "executed" || live.status === "rejected") return null;

  const allApproved = live.soldierUpdates.every(su => live.approvedAgents.has(su.agentId));

  return (
    <div className="rounded-xl border border-neutral-700 bg-neutral-900/90 p-5 mt-4">
      <div className="text-xs font-bold text-neutral-300 uppercase tracking-wider mb-3">
        Order Complete &mdash; {live.soldierUpdates.length} agent{live.soldierUpdates.length > 1 ? "s" : ""} updated
      </div>
      <div className="space-y-1.5 mb-4">
        {live.soldierUpdates.map(su => (
          <div key={su.agentId} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className={live.approvedAgents.has(su.agentId) ? "text-green-400" : "text-neutral-500"}>
                {live.approvedAgents.has(su.agentId) ? "\u2611" : "\u2610"}
              </span>
              <span className="text-neutral-300">{su.agentName}</span>
              <span className="text-neutral-600">&mdash; {su.whatChanged}</span>
            </div>
            {!live.approvedAgents.has(su.agentId) && (
              <button onClick={() => onCherryPick(su.agentId)}
                className="px-2 py-0.5 text-[10px] rounded bg-green-500/20 text-green-400 hover:bg-green-500/30">Approve</button>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        {!allApproved && (
          <button onClick={onApproveAll}
            className="px-5 py-2 text-xs font-semibold rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/20">
            Approve All & Execute
          </button>
        )}
        <button onClick={onRejectAll}
          className="px-5 py-2 text-xs font-semibold rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/20">
          Reject All
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Order History Card
// ============================================================

function OrderHistoryCard({ order }: { order: OrderData }) {
  const [expanded, setExpanded] = useState(false);
  const affected: string[] = order.affected_agents ? JSON.parse(order.affected_agents) : [];
  const timeAgo = getTimeAgo(order.created_at);
  const statusIcon = order.status === "executed" ? "\u2705" : order.status === "rejected" ? "\u274C" : "\u23F3";
  const statusLabel = order.status === "executed" ? "Executed" : order.status === "rejected" ? "Rejected" : "Pending";

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-neutral-800/20" onClick={() => setExpanded(!expanded)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[10px] text-neutral-500 mb-0.5">
            <span className="font-[family-name:var(--font-geist-mono)]">#{order.id}</span>
            <span>{timeAgo}</span>
            <span>{statusIcon} {statusLabel}</span>
            {affected.length > 0 && <span>{affected.length} agent{affected.length > 1 ? "s" : ""}</span>}
          </div>
          <p className="text-xs text-neutral-300 truncate">&ldquo;{order.order_text}&rdquo;</p>
        </div>
        <span className="text-neutral-600 text-[10px] ml-2">{expanded ? "\u25B2" : "\u25BC"}</span>
      </div>
      {expanded && (
        <div className="border-t border-neutral-800 px-4 py-3 space-y-3">
          {order.general_response && (
            <div>
              <div className="text-[9px] uppercase tracking-wider font-bold text-amber-500 mb-1">{"\u2605"} General</div>
              <pre className="text-[11px] text-neutral-400 whitespace-pre-wrap bg-neutral-800/30 rounded-lg p-2.5 max-h-40 overflow-y-auto">{order.general_response}</pre>
            </div>
          )}
          {order.lieutenant_response && (
            <div>
              <div className="text-[9px] uppercase tracking-wider font-bold text-blue-400 mb-1">
                {"\u25C6"} {order.lieutenant_id === "trading_lt" ? "Trading" : order.lieutenant_id === "market_lt" ? "Market" : "Analytics"} Lieutenant
              </div>
              <pre className="text-[11px] text-neutral-400 whitespace-pre-wrap bg-neutral-800/30 rounded-lg p-2.5 max-h-40 overflow-y-auto">{order.lieutenant_response}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Agent Detail Slide-out Panel (4 tabs)
// ============================================================

function AgentDetailPanel({
  agentId, onClose, onSaved, isAdmin,
}: {
  agentId: string; onClose: () => void; onSaved: () => void; isAdmin: boolean;
}) {
  const [agent, setAgent] = useState<{ name: string; rank: string; description: string; model_override: string | null; is_active: number } | null>(null);
  const [ownPrompt, setOwnPrompt] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [sections, setSections] = useState<EffectivePromptSection[]>([]);
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [relatedOrders, setRelatedOrders] = useState<OrderData[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState("");
  const [tab, setTab] = useState<"effective" | "edit" | "history" | "activity">("effective");
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [expandedVersion, setExpandedVersion] = useState<number | null>(null);
  const [compareVersions, setCompareVersions] = useState<[number, number] | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const [agentRes, epRes] = await Promise.all([
        fetch(`/api/agents/${agentId}`),
        fetch(`/api/agents/${agentId}/effective-prompt`),
      ]);
      const agentData = await agentRes.json();
      const epData = await epRes.json();
      setAgent(agentData.agent || null);
      const promptText = agentData.activePrompt?.prompt_text || agentData.agent?.system_prompt || "";
      setOwnPrompt(promptText);
      setEditPrompt(promptText);
      setSections(epData.sections || []);
      setVersions(agentData.history || []);
      setRelatedOrders(agentData.relatedOrders || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [agentId]);

  useEffect(() => { load(); }, [load]);

  const handleSavePrompt = async () => {
    setSaving(true);
    try {
      await fetch(`/api/admin/agents/${agentId}/prompt`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptText: editPrompt, notes: notes || "Manual edit from Command Center" }),
      });
      setNotes("");
      await load();
      onSaved();
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleActivateVersion = async (version: number) => {
    try {
      await fetch(`/api/admin/agents/${agentId}/prompt`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activateVersion: version }),
      });
      await load();
      onSaved();
    } catch { /* ignore */ }
  };

  const handleSaveModel = async (model: string) => {
    try {
      await fetch(`/api/admin/agents/${agentId}/model`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      setShowModelPicker(false);
      await load();
      onSaved();
    } catch { /* ignore */ }
  };

  const handleCopyFullPrompt = async () => {
    const fullPrompt = sections.map(s => s.promptText).join("\n\n---\n\n");
    await navigator.clipboard.writeText(fullPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const rankIcon = agent?.rank === "general" ? "\u2605" : agent?.rank === "lieutenant" ? "\u25C6" : "\u25CF";
  const rankColor = agent?.rank === "general" ? "text-amber-400" : agent?.rank === "lieutenant" ? "text-blue-400" : "text-neutral-400";
  const fullPrompt = sections.map(s => s.promptText).join("\n\n---\n\n");
  const totalTokens = estimateTokens(fullPrompt);

  const tabs = isAdmin
    ? (["effective", "edit", "history", "activity"] as const)
    : (["effective", "history", "activity"] as const);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-3xl bg-[#0d0d0d] border-l border-neutral-800 h-full overflow-hidden flex flex-col animate-slide-in-right" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-neutral-800 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className={`text-lg ${rankColor}`}>{rankIcon}</span>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-neutral-100">{agent?.name || agentId}</h3>
                  <span className={`text-[8px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${
                    agent?.rank === "general" ? "bg-amber-500/15 text-amber-400" :
                    agent?.rank === "lieutenant" ? "bg-blue-500/15 text-blue-400" :
                    "bg-neutral-700 text-neutral-400"
                  }`}>{agent?.rank}</span>
                  <span className={`w-2 h-2 rounded-full ${agent?.is_active ? "bg-green-500" : "bg-neutral-600"}`} />
                </div>
                {agent?.description && <p className="text-[10px] text-neutral-500 mt-0.5">{agent.description}</p>}
              </div>
            </div>
            <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300 text-xl">&times;</button>
          </div>
          {/* Model — direct per-agent model */}
          <div className="mt-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] text-neutral-500 font-semibold uppercase tracking-wider">Model:</span>
              <span className="text-xs text-neutral-200 font-medium">{getModelLabel(agent?.model_override || "")}</span>
              {isAdmin && !showModelPicker && (
                <button onClick={() => setShowModelPicker(true)}
                  className="text-[10px] text-amber-400 hover:text-amber-300 font-semibold ml-1">
                  Change
                </button>
              )}
            </div>
            {isAdmin && showModelPicker && (
              <div className="max-w-sm">
                <ModelSelector
                  value={agent?.model_override || "anthropic/claude-opus-4.6"}
                  onChange={handleSaveModel}
                  compact
                />
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-neutral-800 px-6 shrink-0">
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
                tab === t ? "border-amber-500 text-amber-400" : "border-transparent text-neutral-500 hover:text-neutral-300"
              }`}>
              {t === "effective" ? "Effective Prompt" : t === "edit" ? "Edit Prompt" : t === "history" ? "Version History" : "Activity"}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="text-neutral-500 text-sm animate-pulse">Loading...</div>
          ) : tab === "effective" ? (
            /* TAB 1: Effective Prompt */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-[10px] text-neutral-500">
                  Total: ~{totalTokens.toLocaleString()} tokens | {fullPrompt.length.toLocaleString()} chars | {sections.length} section{sections.length > 1 ? "s" : ""}
                </div>
                <button onClick={handleCopyFullPrompt}
                  className="text-[10px] px-2 py-1 rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500">
                  {copied ? "\u2713 Copied!" : "Copy Full Prompt"}
                </button>
              </div>
              {sections.map(s => {
                const isThis = s.agentId === agentId;
                const label = isThis ? "This Agent\u2019s Prompt" : `From ${s.agentName}`;
                return (
                  <div key={s.agentId}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className={`text-[9px] uppercase tracking-wider font-bold ${isThis ? "text-amber-400" : "text-neutral-600"}`}>{label}</span>
                        <span className="text-[9px] text-neutral-700">({s.rank})</span>
                      </div>
                      {isThis && isAdmin && (
                        <button onClick={() => setTab("edit")} className="text-[10px] text-amber-400 hover:text-amber-300">[Edit]</button>
                      )}
                    </div>
                    <pre className={`text-[11px] whitespace-pre-wrap rounded-lg p-4 leading-relaxed ${
                      isThis ? "text-neutral-200 bg-neutral-800/60 border border-neutral-700" : "text-neutral-500 bg-neutral-800/20 border border-neutral-800/50"
                    }`}>{s.promptText}</pre>
                  </div>
                );
              })}
            </div>
          ) : tab === "edit" && isAdmin ? (
            /* TAB 2: Edit Prompt */
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-[10px] uppercase tracking-wider font-bold text-amber-400">Edit This Agent&apos;s Prompt</h4>
                <div className="text-[10px] text-neutral-600">
                  {editPrompt.length.toLocaleString()} chars | ~{estimateTokens(editPrompt).toLocaleString()} tokens
                </div>
              </div>
              <div className="relative">
                <textarea
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  rows={24}
                  className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-3 text-xs text-neutral-200 font-[family-name:var(--font-geist-mono)] focus:border-amber-500 focus:outline-none resize-y leading-relaxed"
                  spellCheck={false}
                />
              </div>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What changed and why? (version notes)"
                className="w-full h-8 rounded border border-neutral-700 bg-neutral-800 px-3 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-amber-500 focus:outline-none"
              />
              <div className="flex gap-2">
                <button onClick={handleSavePrompt} disabled={saving || editPrompt === ownPrompt}
                  className="px-4 py-1.5 text-xs font-semibold rounded bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-40">
                  {saving ? "Saving..." : "Save as New Version"}
                </button>
                {editPrompt !== ownPrompt && (
                  <button onClick={() => setEditPrompt(ownPrompt)}
                    className="px-4 py-1.5 text-xs rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200">Reset</button>
                )}
                <button disabled className="px-4 py-1.5 text-xs rounded border border-neutral-700 text-neutral-600 cursor-not-allowed ml-auto">
                  Test This Prompt (coming soon)
                </button>
              </div>
            </div>
          ) : tab === "history" ? (
            /* TAB 3: Version History */
            <div className="space-y-3">
              {compareVersions && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 mb-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] uppercase tracking-wider font-bold text-amber-400">
                      Comparing v{compareVersions[0]} vs v{compareVersions[1]}
                    </span>
                    <button onClick={() => setCompareVersions(null)} className="text-[10px] text-neutral-400 hover:text-neutral-200">&times; Close</button>
                  </div>
                  <DiffView
                    oldText={versions.find(v => v.version === compareVersions[0])?.prompt_text || ""}
                    newText={versions.find(v => v.version === compareVersions[1])?.prompt_text || ""}
                  />
                </div>
              )}
              {versions.length === 0 ? (
                <div className="text-neutral-600 text-sm">No version history</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-neutral-600 text-left border-b border-neutral-800">
                        <th className="py-2 px-2 font-semibold">v</th>
                        <th className="py-2 px-2 font-semibold">Date</th>
                        <th className="py-2 px-2 font-semibold">Created By</th>
                        <th className="py-2 px-2 font-semibold">Notes</th>
                        <th className="py-2 px-2 font-semibold text-right">Active</th>
                        <th className="py-2 px-2 font-semibold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {versions.map(v => (
                        <tr key={v.id} className={`border-b border-neutral-800/50 ${v.is_active ? "bg-amber-500/5" : "hover:bg-neutral-800/20"}`}>
                          <td className="py-2 px-2 font-bold font-[family-name:var(--font-geist-mono)] text-neutral-300">v{v.version}</td>
                          <td className="py-2 px-2 text-neutral-500">{v.created_at ? getTimeAgo(v.created_at) : "-"}</td>
                          <td className="py-2 px-2 text-neutral-400">{v.created_by}</td>
                          <td className="py-2 px-2 text-neutral-500 max-w-48 truncate">{v.notes || "-"}</td>
                          <td className="py-2 px-2 text-right">
                            {v.is_active === 1 ? <span className="text-amber-500 font-bold">{"\u25CF"}</span> : <span className="text-neutral-700">{"\u25CB"}</span>}
                          </td>
                          <td className="py-2 px-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => setExpandedVersion(expandedVersion === v.version ? null : v.version)}
                                className="px-1.5 py-0.5 text-[10px] rounded text-neutral-400 hover:text-neutral-200">
                                {expandedVersion === v.version ? "Hide" : "View"}
                              </button>
                              {v.is_active !== 1 && isAdmin && (
                                <button onClick={() => handleActivateVersion(v.version)}
                                  className="px-1.5 py-0.5 text-[10px] rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30">Activate</button>
                              )}
                              {versions.length > 1 && v.version > 1 && (
                                <button onClick={() => setCompareVersions([v.version - 1, v.version])}
                                  className="px-1.5 py-0.5 text-[10px] rounded text-blue-400 hover:text-blue-300">Compare</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {expandedVersion && (
                <div className="rounded-lg border border-neutral-800 bg-neutral-800/20 p-3 mt-2">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-neutral-400">v{expandedVersion} — Full Text</span>
                    <button onClick={() => setExpandedVersion(null)} className="text-[10px] text-neutral-500 hover:text-neutral-300">&times;</button>
                  </div>
                  <pre className="text-[11px] text-neutral-300 whitespace-pre-wrap">{versions.find(v => v.version === expandedVersion)?.prompt_text || ""}</pre>
                </div>
              )}
            </div>
          ) : (
            /* TAB 4: Activity */
            <div className="space-y-4">
              <div className="rounded-xl border border-neutral-800 bg-neutral-800/20 p-6 text-center">
                <div className="text-sm font-semibold text-neutral-400 mb-1">Agent Activity Log &mdash; Coming Soon</div>
                <p className="text-[11px] text-neutral-600">
                  When this agent becomes autonomous, its actions will appear here in real time.
                </p>
              </div>
              {relatedOrders.length > 0 && (
                <div>
                  <h4 className="text-[10px] uppercase tracking-wider font-bold text-neutral-500 mb-2">Recent Orders Affecting This Agent</h4>
                  <div className="space-y-1.5">
                    {relatedOrders.map(order => (
                      <div key={order.id} className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
                        <div className="flex items-center gap-2 text-[10px] text-neutral-500 mb-1">
                          <span className="font-[family-name:var(--font-geist-mono)]">#{order.id}</span>
                          <span>{getTimeAgo(order.created_at)}</span>
                          <span>{order.status === "executed" ? "\u2705" : order.status === "rejected" ? "\u274C" : "\u23F3"} {order.status}</span>
                        </div>
                        <p className="text-xs text-neutral-300">&ldquo;{order.order_text}&rdquo;</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Main Page
// ============================================================

export default function CommandCenterPage() {
  const [tree, setTree] = useState<AgentTreeNode[]>([]);
  const [orders, setOrders] = useState<OrderData[]>([]);
  const [autoApprove, setAutoApprove] = useState(false);
  const [commandInput, setCommandInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [detailAgent, setDetailAgent] = useState<string | null>(null);
  const [live, setLive] = useState<LiveOrderState | null>(null);
  // Bulk model change
  const [bulkModelPending, setBulkModelPending] = useState<string | null>(null);
  const [bulkChanging, setBulkChanging] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [treeRes, ordersRes] = await Promise.all([
        fetch("/api/agents"),
        fetch("/api/admin/orders"),
      ]);
      const treeData = await treeRes.json();
      const ordersData = await ordersRes.json();
      setTree(treeData.tree || []);
      setOrders(ordersData.orders || []);
    } catch { /* ignore */ }
    setLoaded(true);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const majorityModel = getMajorityModel(tree);

  const handleSendCommand = async () => {
    if (!commandInput.trim() || sending) return;
    setSending(true);
    const msg = commandInput;
    setCommandInput("");

    setLive({
      step: "commander", commanderMessage: msg, generalResponse: null, delegation: null,
      lieutenantResponse: null, soldierUpdates: [], orderId: null, status: "pending",
      error: null, activePath: ["general"], approvedAgents: new Set(), flashGreen: new Set(), flashRed: new Set(),
    });

    try {
      await new Promise(r => setTimeout(r, 800));
      const res = await fetch("/api/admin/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, autoApprove }),
      });
      const data = await res.json();
      console.log("[WAR ROOM] API response:", { orderId: data.orderId, status: data.status, hasDelegation: !!data.delegation, soldierCount: data.soldierUpdates?.length || 0, error: data.error });

      // Show General's response
      setLive(prev => prev ? {
        ...prev, step: "general", generalResponse: data.generalResponse, delegation: data.delegation, orderId: data.orderId,
        activePath: data.delegation ? ["general", data.delegation.lieutenantId] : ["general"],
        error: !data.generalResponse ? (data.error || "The General failed to respond") : (data.error && !data.delegation ? data.error : null),
      } : null);

      if (data.delegation) {
        await new Promise(r => setTimeout(r, 1200));

        // Show Lieutenant's response
        const affectedSoldierIds = (data.soldierUpdates || []).map((su: SoldierUpdate) => su.agentId);
        setLive(prev => prev ? {
          ...prev, step: "lieutenant", lieutenantResponse: data.lieutenantResponse,
          activePath: [data.delegation.lieutenantId, ...affectedSoldierIds],
          error: !data.lieutenantResponse ? (data.error || "Lieutenant failed to respond") : null,
        } : null);

        await new Promise(r => setTimeout(r, 1000));

        if (data.soldierUpdates && data.soldierUpdates.length > 0) {
          // Animate soldier updates one by one
          const allSoldierIds = data.soldierUpdates.map((su: SoldierUpdate) => su.agentId);
          for (let i = 0; i < data.soldierUpdates.length; i++) {
            await new Promise(r => setTimeout(r, 600));
            const su = data.soldierUpdates[i];
            setLive(prev => {
              if (!prev) return null;
              const isLast = i === data.soldierUpdates.length - 1;
              return {
                ...prev, step: isLast ? "approval" : "soldiers",
                soldierUpdates: [...prev.soldierUpdates, su],
                activePath: isLast
                  ? [data.delegation.lieutenantId, ...allSoldierIds]
                  : [data.delegation.lieutenantId, su.agentId],
              };
            });
          }
        } else {
          // Lieutenant responded but no parseable soldier changes
          setLive(prev => prev ? {
            ...prev, step: "approval", activePath: [],
            error: data.lieutenantResponse ? "Lieutenant responded but no soldier prompt changes were detected. The response may not have used the expected JSON format." : prev.error,
          } : null);
        }
      } else if (!data.error) {
        // General responded but no delegation identified
        setLive(prev => prev ? {
          ...prev,
          error: "The General responded but did not delegate to a Lieutenant. This may mean the order was unclear or the General's response didn't use the expected DELEGATION format.",
        } : null);
      }

      if (data.status === "executed") {
        const allIds = (data.soldierUpdates || []).map((su: SoldierUpdate) => su.agentId);
        setLive(prev => prev ? {
          ...prev, status: "executed", step: "done",
          approvedAgents: new Set(allIds), flashGreen: new Set(allIds), activePath: [],
          error: null,
        } : null);
        await loadData();
        setTimeout(() => { setLive(prev => prev ? { ...prev, flashGreen: new Set() } : null); }, 2000);
      }
    } catch (err) {
      console.error("[WAR ROOM] Command failed:", err);
      setLive(prev => prev ? { ...prev, error: "Failed to send command. Check API key and try again.", step: "done", activePath: [] } : null);
    }
    setSending(false);
  };

  const handleApproveAll = async () => {
    if (!live?.orderId) return;
    try {
      await fetch(`/api/admin/orders/${live.orderId}/approve`, { method: "POST" });
      const allIds = live.soldierUpdates.map(su => su.agentId);
      setLive(prev => prev ? { ...prev, status: "executed", step: "done", approvedAgents: new Set(allIds), flashGreen: new Set(allIds), activePath: [] } : null);
      await loadData();
      setTimeout(() => { setLive(prev => prev ? { ...prev, flashGreen: new Set() } : null); }, 2000);
    } catch { /* ignore */ }
  };

  const handleRejectAll = async () => {
    if (!live?.orderId) return;
    try {
      await fetch(`/api/admin/orders/${live.orderId}/reject`, { method: "POST" });
      const allIds = live.soldierUpdates.map(su => su.agentId);
      setLive(prev => prev ? { ...prev, status: "rejected", step: "done", flashRed: new Set(allIds), activePath: [] } : null);
      await loadData();
      setTimeout(() => { setLive(prev => prev ? { ...prev, flashRed: new Set() } : null); }, 2000);
    } catch { /* ignore */ }
  };

  const handleCherryPick = async (agentId: string) => {
    if (!live?.orderId) return;
    try {
      await fetch(`/api/admin/orders/${live.orderId}/approve`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentIds: [agentId] }),
      });
      setLive(prev => {
        if (!prev) return null;
        const newApproved = new Set(prev.approvedAgents); newApproved.add(agentId);
        const newFlash = new Set(prev.flashGreen); newFlash.add(agentId);
        return { ...prev, approvedAgents: newApproved, flashGreen: newFlash };
      });
      await loadData();
      setTimeout(() => {
        setLive(prev => { if (!prev) return null; const nf = new Set(prev.flashGreen); nf.delete(agentId); return { ...prev, flashGreen: nf }; });
      }, 2000);
    } catch { /* ignore */ }
  };

  // Bulk model change handlers
  const handleBulkModelSelect = (model: string) => {
    setBulkModelPending(model);
  };

  const handleBulkChangeAll = async () => {
    if (!bulkModelPending) return;
    setBulkChanging(true);
    try {
      await fetch("/api/admin/agents/bulk-model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: bulkModelPending }),
      });
      await loadData();
    } catch { /* ignore */ }
    setBulkChanging(false);
    setBulkModelPending(null);
  };

  const handleBulkChangeGeneral = async () => {
    if (!bulkModelPending) return;
    setBulkChanging(true);
    try {
      await fetch("/api/admin/agents/general/model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: bulkModelPending }),
      });
      await loadData();
    } catch { /* ignore */ }
    setBulkChanging(false);
    setBulkModelPending(null);
  };

  // Count active agents
  const activeCount = flattenTreeNodes(tree).length;

  if (!loaded) {
    return (
      <main className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-neutral-500 animate-pulse">Loading Command Center...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0a0a0a] px-4 py-6">
      {/* Global Model Selector — CHANGE ALL AGENT MODELS */}
      <section className="max-w-6xl mx-auto mb-6">
        <div className="rounded-xl border border-amber-500/20 bg-gradient-to-r from-amber-500/5 to-transparent px-5 py-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-xs font-bold text-amber-400 uppercase tracking-wider">Change All Agent Models</div>
              <div className="text-[10px] text-neutral-500 mt-0.5">
                Currently {activeCount} active agents on <span className="text-neutral-300 font-medium">{getModelLabel(majorityModel)}</span>.
                Pick a model below to switch all agents or just The General.
              </div>
            </div>
          </div>
          <div className="max-w-md">
            <ModelSelector value={majorityModel} onChange={handleBulkModelSelect} compact />
          </div>
        </div>
      </section>

      {/* Org Chart */}
      <section className="max-w-6xl mx-auto mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-neutral-500 uppercase tracking-wider">Agent Hierarchy</h2>
          <div className="flex items-center gap-4 text-[10px] text-neutral-600">
            <span><span className="text-amber-400">{"\u2605"}</span> General</span>
            <span><span className="text-blue-400">{"\u25C6"}</span> Lieutenant</span>
            <span><span className="text-neutral-400">{"\u25CF"}</span> Soldier</span>
            <span className="border-l border-neutral-800 pl-4"><span className="px-1 py-0.5 rounded bg-purple-500/15 text-purple-400 font-semibold">Different Model</span></span>
          </div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 overflow-hidden">
          <OrgChart
            tree={tree}
            activePath={live?.activePath || []}
            flashGreen={live?.flashGreen || new Set()}
            flashRed={live?.flashRed || new Set()}
            onClickNode={setDetailAgent}
            majorityModel={majorityModel}
          />
        </div>
      </section>

      {/* Command Input */}
      <section className="max-w-4xl mx-auto mb-6">
        <div className="rounded-xl border border-amber-500/20 bg-gradient-to-b from-amber-500/5 to-transparent p-5">
          <div className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-3">Orders to The General</div>
          <textarea value={commandInput} onChange={(e) => setCommandInput(e.target.value)}
            placeholder='Give the General an order... e.g. "Make all trading agents pick at least 3 stocks per news event"'
            rows={3}
            className="w-full rounded-xl border border-neutral-700 bg-neutral-800/50 px-5 py-3 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-amber-500 focus:outline-none resize-none"
            onKeyDown={(e) => { if (e.key === "Enter" && e.metaKey) handleSendCommand(); }}
          />
          <div className="flex items-center justify-between mt-3">
            <label className="flex items-center gap-2 text-xs text-neutral-400 cursor-pointer select-none">
              <input type="checkbox" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)}
                className="rounded border-neutral-700 bg-neutral-800 text-amber-500 focus:ring-amber-500" />
              Auto-approve changes
            </label>
            <button onClick={handleSendCommand} disabled={sending || !commandInput.trim()}
              className="px-6 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-amber-500 to-amber-600 text-black hover:from-amber-400 hover:to-amber-500 disabled:opacity-40 transition-all flex items-center gap-2">
              {sending ? (
                <><div className="w-3 h-3 border-2 border-black/30 border-t-black rounded-full animate-spin" />Processing...</>
              ) : (
                <>Send Order {"\u25B6"}</>
              )}
            </button>
          </div>
        </div>
      </section>

      {/* Live War Room */}
      {live && (
        <section className="max-w-4xl mx-auto mb-8">
          <h2 className="text-sm font-semibold text-neutral-500 uppercase tracking-wider mb-3">
            {live.status === "executed" ? "\u2705 Order Executed" : live.status === "rejected" ? "\u274C Order Rejected" : "Live Command Chain"}
          </h2>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
            <WarRoomThread live={live} />
            <ApprovalBar live={live} onApproveAll={handleApproveAll} onRejectAll={handleRejectAll} onCherryPick={handleCherryPick} />
          </div>
        </section>
      )}

      {/* Order History */}
      <section className="max-w-4xl mx-auto">
        <h2 className="text-sm font-semibold text-neutral-500 uppercase tracking-wider mb-3">Order History</h2>
        {orders.length === 0 ? (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-8 text-center text-neutral-600">
            <p className="text-sm">No orders yet. Give The General a command above.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {orders.map(order => (<OrderHistoryCard key={order.id} order={order} />))}
          </div>
        )}
      </section>

      {/* Agent Detail Slide-out */}
      {detailAgent && (
        <AgentDetailPanel agentId={detailAgent} onClose={() => setDetailAgent(null)} onSaved={loadData} isAdmin={true} />
      )}

      {/* Bulk Model Confirmation Dialog */}
      {bulkModelPending && !bulkChanging && (
        <BulkModelDialog
          modelId={bulkModelPending}
          onChangeAll={handleBulkChangeAll}
          onChangeGeneral={handleBulkChangeGeneral}
          onCancel={() => setBulkModelPending(null)}
        />
      )}

      <style jsx global>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in-right {
          animation: slideInRight 0.3s ease-out;
        }
      `}</style>
    </main>
  );
}
