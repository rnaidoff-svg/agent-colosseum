import { getAllAgents, getActivePrompt, getSystemConfig, getOrders, type AgentRow } from "../db/agents";

// ============================================================
// Prompt Composition Utility
// ============================================================

export interface AgentTreeNode {
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

export interface EffectivePromptSection {
  agentId: string;
  agentName: string;
  rank: string;
  promptText: string;
}

/**
 * Get the effective model for an agent.
 * Every agent owns its own model directly via model_override.
 * Falls back to system_model config only if model_override is somehow null.
 */
export function getEffectiveModel(agentId: string): string {
  try {
    const agents = getAllAgents();
    const agent = agents.find((a) => a.id === agentId);
    if (agent?.model_override) return agent.model_override;
    return getSystemConfig("system_model") || "anthropic/claude-opus-4.6";
  } catch (err) {
    console.warn(`[prompt-composer] WARNING: getEffectiveModel failed for ${agentId}, using fallback:`, err);
    return "anthropic/claude-opus-4.6";
  }
}

/**
 * Get the effective prompt — composed from the agent chain.
 * Returns individual sections for display.
 */
export function getEffectivePrompt(agentId: string): {
  composed: string;
  sections: EffectivePromptSection[];
} {
  try {
    const agents = getAllAgents();
    const agentMap = new Map(agents.map((a) => [a.id, a]));

    // Walk up the parent chain
    const chain: AgentRow[] = [];
    let current = agentMap.get(agentId);
    while (current) {
      chain.unshift(current); // prepend so General is first
      if (!current.parent_id) break;
      current = agentMap.get(current.parent_id);
    }

    const sections: EffectivePromptSection[] = chain.map((a) => {
      const prompt = getActivePrompt(a.id);
      return {
        agentId: a.id,
        agentName: a.name,
        rank: a.rank,
        promptText: prompt?.prompt_text || a.system_prompt,
      };
    });

    const composed = sections.map((s) => s.promptText).join("\n\n---\n\n");

    return { composed, sections };
  } catch (err) {
    console.warn(`[prompt-composer] WARNING: getEffectivePrompt failed for ${agentId}, returning empty:`, err);
    return { composed: "", sections: [] };
  }
}

/**
 * Build the full agent tree for display.
 * Each agent's model comes directly from its own model_override field.
 */
export function getAgentTree(): AgentTreeNode[] {
  try {
    const agents = getAllAgents();
    const fallbackModel = getSystemConfig("system_model") || "anthropic/claude-opus-4.6";

    const nodeMap = new Map<string, AgentTreeNode>();

    for (const a of agents) {
      const prompt = getActivePrompt(a.id);
      // Each agent owns its own model — use model_override directly
      const effectiveModel = a.model_override || fallbackModel;

      nodeMap.set(a.id, {
        id: a.id,
        name: a.name,
        rank: a.rank as AgentTreeNode["rank"],
        type: a.type,
        description: a.description,
        effectiveModel,
        modelOverride: a.model_override,
        isActive: a.is_active === 1,
        activeVersion: prompt?.version ?? 1,
        promptPreview: (prompt?.prompt_text || a.system_prompt).slice(0, 100) + "...",
        children: [],
      });
    }

    // Build tree
    const roots: AgentTreeNode[] = [];
    for (const a of agents) {
      const node = nodeMap.get(a.id)!;
      if (a.parent_id && nodeMap.has(a.parent_id)) {
        nodeMap.get(a.parent_id)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  } catch (err) {
    console.warn("[prompt-composer] WARNING: getAgentTree failed, returning empty:", err);
    return [];
  }
}

/**
 * Build dynamic context for The General — live hierarchy + recent orders.
 * Appended to the General's static system prompt so it always has an accurate view.
 */
export function buildGeneralContext(): string {
  try {
    const agents = getAllAgents();
    const fallbackModel = getSystemConfig("system_model") || "anthropic/claude-opus-4.6";

    const lieutenants = agents.filter((a) => a.rank === "lieutenant");
    const soldiers = agents.filter((a) => a.rank === "soldier");

    let context = "\n\nYOUR CURRENT CHAIN OF COMMAND:\n";
    context += "(This is your LIVE org chart — it reflects the actual agents in the system right now)\n\n";

    for (const lt of lieutenants) {
      const ltModel = lt.model_override || fallbackModel;
      context += `LIEUTENANT: ${lt.name} (id: ${lt.id})\n`;
      context += `  Model: ${ltModel}\n`;
      context += `  Purpose: ${lt.description || "No description"}\n`;
      context += `  Soldiers:\n`;

      const ltSoldiers = soldiers.filter((s) => s.parent_id === lt.id);
      for (const s of ltSoldiers) {
        const sModel = s.model_override || fallbackModel;
        const sPrompt = getActivePrompt(s.id);
        const sVersion = sPrompt?.version ?? 1;
        context += `  - ${s.name} (id: ${s.id}) — ${s.description || "No description"} — v${sVersion} — model: ${sModel}\n`;
      }
      if (ltSoldiers.length === 0) {
        context += `  - (no soldiers)\n`;
      }
      context += "\n";
    }

    const activeCount = agents.filter((a) => a.is_active === 1).length;
    context += `TOTAL ACTIVE AGENTS: ${activeCount}\n\n`;

    // Recent orders
    try {
      const orders = getOrders(5);
      if (orders.length > 0) {
        context += "RECENT ORDERS:\n";
        for (const o of orders) {
          context += `- Order #${o.id}: "${o.order_text}" (${o.status})\n`;
        }
      }
    } catch {
      // Orders table might not exist yet
    }

    return context;
  } catch (err) {
    console.warn("[prompt-composer] WARNING: buildGeneralContext failed, returning empty:", err);
    return "";
  }
}

/**
 * Build dynamic context for a Lieutenant — live info about its soldiers.
 * Includes each soldier's current prompt so the Lieutenant can modify them intelligently.
 */
export function buildLieutenantContext(lieutenantId: string): string {
  try {
    const agents = getAllAgents();
    const fallbackModel = getSystemConfig("system_model") || "anthropic/claude-opus-4.6";
    const soldiers = agents.filter((a) => a.parent_id === lieutenantId && a.rank === "soldier");

    if (soldiers.length === 0) return "\n\nYOUR CURRENT SOLDIERS:\n(none)\n";

    let context = "\n\nYOUR CURRENT SOLDIERS:\n\n";

    for (const s of soldiers) {
      const sModel = s.model_override || fallbackModel;
      const sPrompt = getActivePrompt(s.id);
      const sVersion = sPrompt?.version ?? 1;
      const promptText = sPrompt?.prompt_text || s.system_prompt;

      context += `SOLDIER: ${s.name} (id: ${s.id})\n`;
      context += `  Model: ${sModel}\n`;
      context += `  Description: ${s.description || "No description"}\n`;
      context += `  Current Prompt Version: v${sVersion}\n`;
      context += `  CURRENT PROMPT:\n`;
      context += `  """\n`;
      context += `  ${promptText}\n`;
      context += `  """\n\n`;
    }

    return context;
  } catch (err) {
    console.warn("[prompt-composer] WARNING: buildLieutenantContext failed, returning empty:", err);
    return "";
  }
}
