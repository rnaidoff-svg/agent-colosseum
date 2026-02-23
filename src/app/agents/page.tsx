"use client";

import { useState, useEffect, useCallback } from "react";
import { getModelLabel } from "@/lib/utils/format";

// ============================================================
// Types (shared with admin page)
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

interface EffectivePromptSection {
  agentId: string;
  agentName: string;
  rank: string;
  promptText: string;
}

interface PromptVersion {
  id: number;
  version: number;
  prompt_text: string;
  notes: string | null;
  created_at: string;
  created_by: string;
  is_active: number;
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

// ============================================================
// Utility
// ============================================================

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

// ============================================================
// Diff View (read-only)
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
// SVG Org Chart (read-only)
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
    const cx = (childLayouts[0].x + childLayouts[childLayouts.length - 1].x) / 2;
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
  for (const n of nodes) { result.push(n); result.push(...flatLayoutNodes(n.children)); }
  return result;
}

function OrgChart({ tree, onClickNode, majorityModel }: { tree: AgentTreeNode[]; onClickNode: (id: string) => void; majorityModel: string }) {
  const { nodes, width, height } = layoutTree(tree);
  const PAD = 20;

  function renderEdges(ln: LayoutNode): React.ReactNode {
    return ln.children.map(child => {
      const x1 = ln.x + NODE_W / 2;
      const y1 = ln.y + NODE_H;
      const x2 = child.x + NODE_W / 2;
      const y2 = child.y;
      const midY = y1 + (y2 - y1) / 2;
      return (
        <g key={`${ln.node.id}-${child.node.id}`}>
          <path d={`M ${x1 + PAD} ${y1 + PAD} L ${x1 + PAD} ${midY + PAD} L ${x2 + PAD} ${midY + PAD} L ${x2 + PAD} ${y2 + PAD}`}
            fill="none" stroke="#333" strokeWidth={1.5} />
          {renderEdges(child)}
        </g>
      );
    });
  }

  function renderNodes(ln: LayoutNode): React.ReactNode {
    const n = ln.node;
    const borderColor = n.rank === "general" ? "#f59e0b" : n.rank === "lieutenant" ? "#3b82f6" : "#555";
    const rankIcon = n.rank === "general" ? "\u2605" : n.rank === "lieutenant" ? "\u25C6" : "\u25CF";
    const isDifferentModel = n.isActive && n.effectiveModel !== majorityModel;
    return (
      <g key={n.id}>
        <foreignObject x={ln.x + PAD} y={ln.y + PAD} width={NODE_W} height={NODE_H}>
          <div onClick={() => onClickNode(n.id)}
            className="h-full rounded-lg border-2 px-3 py-2 cursor-pointer transition-all hover:scale-105"
            style={{ borderColor, background: "rgba(23,23,23,0.95)" }}>
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className={`text-xs ${n.rank === "general" ? "text-amber-400" : n.rank === "lieutenant" ? "text-blue-400" : "text-neutral-400"}`}>{rankIcon}</span>
              <span className="text-[11px] font-bold text-neutral-200 truncate">{n.name}</span>
            </div>
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
                n.rank === "general" ? "bg-amber-500/15 text-amber-400" : n.rank === "lieutenant" ? "bg-blue-500/15 text-blue-400" : "bg-neutral-700 text-neutral-400"
              }`}>{n.rank}</span>
              {n.rank === "soldier" && <span className="text-[8px] text-neutral-600 font-[family-name:var(--font-geist-mono)]">v{n.activeVersion}</span>}
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
// Agent Detail Panel (read-only — no edit, no model change)
// ============================================================

function AgentDetailPanel({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const [agent, setAgent] = useState<{ name: string; rank: string; description: string; model_override: string | null; is_active: number } | null>(null);
  const [sections, setSections] = useState<EffectivePromptSection[]>([]);
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [relatedOrders, setRelatedOrders] = useState<OrderData[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"effective" | "edit" | "history" | "activity">("effective");
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
      setSections(epData.sections || []);
      setVersions(agentData.history || []);
      setRelatedOrders(agentData.relatedOrders || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [agentId]);

  useEffect(() => { load(); }, [load]);

  const handleCopy = async () => {
    const full = sections.map(s => s.promptText).join("\n\n---\n\n");
    await navigator.clipboard.writeText(full);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const rankIcon = agent?.rank === "general" ? "\u2605" : agent?.rank === "lieutenant" ? "\u25C6" : "\u25CF";
  const rankColor = agent?.rank === "general" ? "text-amber-400" : agent?.rank === "lieutenant" ? "text-blue-400" : "text-neutral-400";
  const fullPrompt = sections.map(s => s.promptText).join("\n\n---\n\n");
  const totalTokens = estimateTokens(fullPrompt);
  const ownPrompt = sections.find(s => s.agentId === agentId)?.promptText || "";

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
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[10px] text-neutral-500 font-semibold uppercase tracking-wider">Model:</span>
            <span className="text-[10px] text-neutral-200 font-medium">{getModelLabel(agent?.model_override || "")}</span>
          </div>
        </div>

        {/* Tabs — includes "edit" tab (read-only) */}
        <div className="flex border-b border-neutral-800 px-6 shrink-0">
          {(["effective", "edit", "history", "activity"] as const).map(t => (
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
                <button onClick={handleCopy}
                  className="text-[10px] px-2 py-1 rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500">
                  {copied ? "\u2713 Copied!" : "Copy Full Prompt"}
                </button>
              </div>
              {sections.map(s => {
                const isThis = s.agentId === agentId;
                const label = isThis ? "This Agent\u2019s Prompt" : `From ${s.agentName}`;
                return (
                  <div key={s.agentId}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`text-[9px] uppercase tracking-wider font-bold ${isThis ? "text-amber-400" : "text-neutral-600"}`}>{label}</span>
                      <span className="text-[9px] text-neutral-700">({s.rank})</span>
                    </div>
                    <pre className={`text-[11px] whitespace-pre-wrap rounded-lg p-4 leading-relaxed ${
                      isThis ? "text-neutral-200 bg-neutral-800/60 border border-neutral-700" : "text-neutral-500 bg-neutral-800/20 border border-neutral-800/50"
                    }`}>{s.promptText}</pre>
                  </div>
                );
              })}
            </div>
          ) : tab === "edit" ? (
            /* TAB 2: Edit Prompt (READ-ONLY for public page) */
            <div className="space-y-3">
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                <p className="text-xs text-amber-400">Editing is available in the Command Center.</p>
                <p className="text-[10px] text-neutral-500 mt-1">This is a read-only view of the agent&apos;s current prompt.</p>
              </div>
              <div className="flex items-center justify-between">
                <h4 className="text-[10px] uppercase tracking-wider font-bold text-neutral-500">Current Prompt</h4>
                <div className="text-[10px] text-neutral-600">
                  {ownPrompt.length.toLocaleString()} chars | ~{estimateTokens(ownPrompt).toLocaleString()} tokens
                </div>
              </div>
              <pre className="text-[11px] whitespace-pre-wrap rounded-lg p-4 leading-relaxed text-neutral-300 bg-neutral-800/60 border border-neutral-700 max-h-[60vh] overflow-y-auto">
                {ownPrompt || "(No prompt)"}
              </pre>
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
                    <span className="text-[10px] font-bold text-neutral-400">v{expandedVersion} &mdash; Full Text</span>
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
                <p className="text-[11px] text-neutral-600">When agents become autonomous, their live actions will stream here.</p>
              </div>
              {relatedOrders.length > 0 && (
                <div>
                  <h4 className="text-[10px] uppercase tracking-wider font-bold text-neutral-500 mb-2">Orders Affecting This Agent</h4>
                  <div className="space-y-1.5">
                    {relatedOrders.map(order => (
                      <OrderHistoryCard key={order.id} order={order} />
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
// Order History Card (full chain view)
// ============================================================

interface SoldierChange {
  agent_id: string;
  agent_name: string;
  what_changed: string;
  new_prompt: string;
  old_prompt?: string;
}

function OrderHistoryCard({ order }: { order: OrderData }) {
  const [expanded, setExpanded] = useState(false);
  const [showDiffs, setShowDiffs] = useState<Set<string>>(new Set());
  const affected: string[] = order.affected_agents ? JSON.parse(order.affected_agents) : [];
  const changes: SoldierChange[] = order.proposed_changes ? JSON.parse(order.proposed_changes) : [];
  const timeAgo = getTimeAgo(order.created_at);
  const statusIcon = order.status === "executed" ? "\u2705" : order.status === "rejected" ? "\u274C" : "\u23F3";
  const statusLabel = order.status === "executed" ? "Executed" : order.status === "rejected" ? "Rejected" : "Pending";

  const toggleDiff = (agentId: string) => {
    setShowDiffs(prev => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId); else next.add(agentId);
      return next;
    });
  };

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-neutral-800/20" onClick={() => setExpanded(!expanded)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[10px] text-neutral-500 mb-0.5">
            <span className="font-[family-name:var(--font-geist-mono)]">#{order.id}</span>
            <span>{timeAgo}</span>
            <span className={order.status === "executed" ? "text-green-400" : order.status === "rejected" ? "text-red-400" : "text-amber-400"}>
              {statusIcon} {statusLabel}
            </span>
            {affected.length > 0 && <span>{affected.length} agent{affected.length > 1 ? "s" : ""}</span>}
          </div>
          <p className="text-xs text-neutral-300 truncate">&ldquo;{order.order_text}&rdquo;</p>
        </div>
        <span className="text-neutral-600 text-[10px] ml-2">{expanded ? "\u25B2" : "\u25BC"}</span>
      </div>
      {expanded && (
        <div className="border-t border-neutral-800 px-4 py-3 space-y-3">
          {/* Commander */}
          <div>
            <div className="text-[9px] uppercase tracking-wider font-bold text-neutral-400 mb-1">{"👤"} Commander</div>
            <p className="text-[11px] text-neutral-400 italic">&ldquo;{order.order_text}&rdquo;</p>
          </div>

          {/* General */}
          {order.general_response && (
            <div>
              <div className="text-[9px] uppercase tracking-wider font-bold text-amber-500 mb-1">{"\u2605"} The General</div>
              <pre className="text-[11px] text-neutral-400 whitespace-pre-wrap bg-neutral-800/30 rounded-lg p-2.5 max-h-40 overflow-y-auto">{order.general_response}</pre>
            </div>
          )}

          {/* Delegation indicator */}
          {order.lieutenant_id && (
            <div className="flex items-center gap-2 text-amber-500/70 text-[10px] pl-4 font-semibold uppercase tracking-wider">
              <span className="text-amber-500">{"\u2192"}</span> Delegated to {order.lieutenant_id === "trading_lt" ? "Trading Operations" : order.lieutenant_id === "market_lt" ? "Market Operations" : "Analytics"} Lieutenant
            </div>
          )}

          {/* Lieutenant */}
          {order.lieutenant_response && (
            <div>
              <div className="text-[9px] uppercase tracking-wider font-bold text-blue-400 mb-1">
                {"\u25C6"} {order.lieutenant_id === "trading_lt" ? "Trading" : order.lieutenant_id === "market_lt" ? "Market" : "Analytics"} Lieutenant
              </div>
              <pre className="text-[11px] text-neutral-400 whitespace-pre-wrap bg-neutral-800/30 rounded-lg p-2.5 max-h-40 overflow-y-auto">{order.lieutenant_response}</pre>
            </div>
          )}

          {/* Soldier updates with diffs */}
          {changes.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-wider font-bold text-neutral-500 mb-2">{"\u25CF"} Soldier Updates</div>
              <div className="space-y-2">
                {changes.map(c => (
                  <div key={c.agent_id} className="rounded-lg border border-neutral-800 bg-neutral-800/20 p-3">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-neutral-200">{c.agent_name || c.agent_id}</span>
                        <span className="text-[9px] text-neutral-500">{c.what_changed}</span>
                      </div>
                      <button onClick={() => toggleDiff(c.agent_id)}
                        className="text-[10px] text-amber-400 hover:text-amber-300">
                        {showDiffs.has(c.agent_id) ? "Hide Diff" : "View Diff"}
                      </button>
                    </div>
                    {showDiffs.has(c.agent_id) && c.old_prompt && (
                      <div className="rounded-lg border border-neutral-800 overflow-hidden p-2 bg-neutral-800/30 mt-2">
                        <DiffView oldText={c.old_prompt} newText={c.new_prompt} />
                      </div>
                    )}
                    {showDiffs.has(c.agent_id) && !c.old_prompt && (
                      <pre className="text-[10px] text-neutral-400 whitespace-pre-wrap bg-neutral-800/30 rounded-lg p-2 mt-2 max-h-40 overflow-y-auto">{c.new_prompt}</pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Status badge */}
          <div className="flex items-center gap-2 pt-1 border-t border-neutral-800/50">
            <span className={`text-[10px] font-semibold uppercase tracking-wider ${
              order.status === "executed" ? "text-green-400" : order.status === "rejected" ? "text-red-400" : "text-amber-400"
            }`}>
              {statusIcon} {statusLabel}
            </span>
            {order.executed_at && (
              <span className="text-[10px] text-neutral-600">{getTimeAgo(order.executed_at)}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Main Public Page
// ============================================================

export default function AgentsPage() {
  const [tree, setTree] = useState<AgentTreeNode[]>([]);
  const [orders, setOrders] = useState<OrderData[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
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
    }
    load();
  }, []);

  const countAgents = (nodes: AgentTreeNode[]): number => {
    let total = 0;
    for (const n of nodes) {
      total++;
      total += countAgents(n.children);
    }
    return total;
  };
  const agentCount = countAgents(tree);
  const majorityModel = getMajorityModel(tree);

  if (!loaded) {
    return (
      <main className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-neutral-500 animate-pulse">Loading agent architecture...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0a0a0a] px-4 py-8">
      {/* Header */}
      <div className="text-center mb-8 max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold">Agent Architecture</h1>
        <p className="mt-2 text-neutral-400">Full Transparency &mdash; Every AI Decision Visible</p>
        <p className="mt-1 text-sm text-neutral-600">
          {agentCount} agents on <span className="text-neutral-400 font-medium">{getModelLabel(majorityModel)}</span>. Click any agent to inspect its full prompt chain, version history, and activity.
        </p>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 mb-6">
        <div className="flex items-center gap-1.5">
          <span className="text-amber-400">{"\u2605"}</span>
          <span className="text-xs text-neutral-400">General</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-blue-400">{"\u25C6"}</span>
          <span className="text-xs text-neutral-400">Lieutenant</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-neutral-400">{"\u25CF"}</span>
          <span className="text-xs text-neutral-400">Soldier</span>
        </div>
        <div className="flex items-center gap-1.5 border-l border-neutral-800 pl-6">
          <span className="px-1 py-0.5 rounded bg-purple-500/15 text-purple-400 font-semibold text-[10px]">Different Model</span>
        </div>
      </div>

      {/* Org Chart */}
      <section className="max-w-6xl mx-auto mb-10">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 overflow-hidden">
          <OrgChart tree={tree} onClickNode={setSelectedAgent} majorityModel={majorityModel} />
        </div>
      </section>

      {/* Command History — full transparency */}
      <section className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-neutral-500 uppercase tracking-wider">Command History</h2>
          <span className="text-[10px] text-neutral-600">{orders.length} order{orders.length !== 1 ? "s" : ""}</span>
        </div>
        <p className="text-[11px] text-neutral-600 mb-3">
          Full transparency &mdash; every AI decision, every prompt change, visible to all. Commander {"\u2192"} General {"\u2192"} Lieutenant {"\u2192"} Soldiers.
        </p>
        {orders.length === 0 ? (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-8 text-center text-neutral-600">
            <p className="text-sm">No commands have been issued yet.</p>
            <p className="text-[11px] mt-1 text-neutral-700">Orders from the Command Center will appear here with full conversation chains.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {orders.map(order => (<OrderHistoryCard key={order.id} order={order} />))}
          </div>
        )}
      </section>

      {/* Agent Detail Slide-out (read-only) */}
      {selectedAgent && (
        <AgentDetailPanel agentId={selectedAgent} onClose={() => setSelectedAgent(null)} />
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
