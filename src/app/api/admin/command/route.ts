import { NextRequest, NextResponse } from "next/server";
import {
  getAgent,
  createOrder,
  updateOrder,
  getSystemConfig,
  setSystemConfig,
  createPromptVersion,
  createNewAgent,
  getAllAgents,
} from "@/lib/db/agents";
import { getEffectiveModel, buildGeneralContext, buildLieutenantContext } from "@/lib/agents/prompt-composer";

const FALLBACK_MODEL = "google/gemini-2.5-flash";

async function callOpenRouter(
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[],
  maxTokens: number,
  temperature: number
): Promise<{ content: string | null; error?: string }> {
  const doCall = async (m: string) => {
    return fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Agent Colosseum - Command Center",
      },
      body: JSON.stringify({ model: m, messages, max_tokens: maxTokens, temperature }),
    });
  };

  let res = await doCall(model);
  if (!res.ok && model !== FALLBACK_MODEL) {
    console.error(`Command: ${model} failed, falling back to ${FALLBACK_MODEL}`);
    res = await doCall(FALLBACK_MODEL);
    if (!res.ok) return { content: null, error: "Both models failed" };
    const data = await res.json();
    return { content: data.choices?.[0]?.message?.content ?? null };
  }
  if (!res.ok) return { content: null, error: "Model failed" };
  const data = await res.json();
  return { content: data.choices?.[0]?.message?.content ?? null };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, autoApprove: clientAutoApprove } = body as { message: string; autoApprove?: boolean };
    if (!message?.trim()) {
      return NextResponse.json({ error: "No message provided" }, { status: 400 });
    }

    const apiKey = process.env.OPENROUTER_API_KEY || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "No API key configured" }, { status: 500 });
    }

    // Persist auto_approve setting if provided
    if (clientAutoApprove !== undefined) {
      setSystemConfig("auto_approve", clientAutoApprove ? "true" : "false");
    }

    // Create order record
    const order = createOrder(message);

    // Step 1: Send to The General
    const general = getAgent("general");
    if (!general) {
      return NextResponse.json({ error: "General not found in database" }, { status: 500 });
    }

    const generalModel = getEffectiveModel("general");
    const dynamicContext = buildGeneralContext();
    const generalSystemPrompt = general.system_prompt + dynamicContext;
    console.log(`[command] Sending to General with model ${generalModel}, dynamic context: ${dynamicContext.length} chars`);
    const generalResult = await callOpenRouter(apiKey, generalModel, [
      { role: "system", content: generalSystemPrompt },
      { role: "user", content: `Commander's order: ${message}` },
    ], 1500, 0.7);

    if (!generalResult.content) {
      updateOrder(order.id, {
        general_response: "Failed to reach The General: " + (generalResult.error || "unknown error"),
        status: "rejected",
      });
      return NextResponse.json({
        orderId: order.id,
        commanderMessage: message,
        generalResponse: null,
        error: "Failed to reach The General",
        status: "rejected",
      });
    }

    updateOrder(order.id, { general_response: generalResult.content });

    // Step 2A: Check if General is proposing a new agent
    if (generalResult.content.includes("NEW AGENT PROPOSAL:")) {
      const proposalMatch = generalResult.content.match(/NEW AGENT PROPOSAL:[\s\S]*?NAME:\s*(.+?)(?:\n|$)[\s\S]*?RANK:\s*(.+?)(?:\n|$)[\s\S]*?PARENT:\s*(.+?)(?:\n|$)[\s\S]*?TYPE:\s*(.+?)(?:\n|$)[\s\S]*?DESCRIPTION:\s*(.+?)(?:\n|$)[\s\S]*?PROPOSED PROMPT:\s*([\s\S]*?)$/i);

      if (proposalMatch) {
        const proposedName = proposalMatch[1].trim();
        const proposedRank = proposalMatch[2].trim().toLowerCase();
        const proposedParent = proposalMatch[3].trim().toLowerCase().replace(/\s+/g, "_");
        const proposedType = proposalMatch[4].trim().toLowerCase().replace(/\s+/g, "_");
        const proposedDescription = proposalMatch[5].trim();
        const proposedPrompt = proposalMatch[6].trim();
        const proposedId = proposedName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

        updateOrder(order.id, {
          proposed_changes: JSON.stringify([{
            action: "create_agent",
            agent_id: proposedId,
            agent_name: proposedName,
            rank: proposedRank,
            type: proposedType,
            parent_id: proposedParent,
            description: proposedDescription,
            new_prompt: proposedPrompt,
          }]),
          status: "pending",
        });

        const autoApproveEnabled = clientAutoApprove ?? (getSystemConfig("auto_approve") === "true");
        if (autoApproveEnabled) {
          try {
            createNewAgent(proposedId, proposedName, proposedRank, proposedType, proposedParent, proposedDescription, proposedPrompt);
            updateOrder(order.id, { status: "executed", executed_at: new Date().toISOString(), affected_agents: JSON.stringify([proposedId]) });
            return NextResponse.json({
              orderId: order.id,
              commanderMessage: message,
              generalResponse: generalResult.content,
              delegation: null,
              lieutenantResponse: null,
              soldierUpdates: [{
                agentId: proposedId,
                agentName: proposedName,
                acknowledgment: `New agent "${proposedName}" created and deployed to the org chart.`,
                whatChanged: `Created new ${proposedRank} agent under ${proposedParent}`,
                oldPrompt: "",
                newPrompt: proposedPrompt,
              }],
              status: "executed",
              agentCreated: { id: proposedId, name: proposedName, rank: proposedRank, parentId: proposedParent },
            });
          } catch (err) {
            console.error("Auto-create agent failed:", err);
          }
        }

        return NextResponse.json({
          orderId: order.id,
          commanderMessage: message,
          generalResponse: generalResult.content,
          delegation: null,
          lieutenantResponse: null,
          soldierUpdates: [{
            agentId: proposedId,
            agentName: proposedName,
            acknowledgment: `The General proposes creating "${proposedName}" (${proposedRank}) under ${proposedParent}.`,
            whatChanged: `New agent proposal — awaiting Commander approval`,
            oldPrompt: "",
            newPrompt: proposedPrompt,
          }],
          status: "pending",
          agentProposal: { id: proposedId, name: proposedName, rank: proposedRank, type: proposedType, parentId: proposedParent, description: proposedDescription, prompt: proposedPrompt },
        });
      }
    }

    // Step 2B: Parse delegation from General's response
    const delegationMatch = generalResult.content.match(/DELEGATION:\s*(.+?)(?:\n|$)/i);
    const orderToLtMatch = generalResult.content.match(/ORDER TO LIEUTENANT:\s*([\s\S]*?)(?=EXPECTED OUTCOME:|$)/i);

    let lieutenantId: string | null = null;
    if (delegationMatch) {
      const delegation = delegationMatch[1].toLowerCase().trim();
      if (delegation.includes("trading")) lieutenantId = "trading_lt";
      else if (delegation.includes("market")) lieutenantId = "market_lt";
      else if (delegation.includes("analytics")) lieutenantId = "analytics_lt";
    }

    if (!lieutenantId) {
      const content = generalResult.content.toLowerCase();
      if (content.includes("trading") && (content.includes("momentum") || content.includes("contrarian") || content.includes("aggressive") || content.includes("strategy"))) {
        lieutenantId = "trading_lt";
      } else if (content.includes("market") || content.includes("news") || content.includes("stock selector")) {
        lieutenantId = "market_lt";
      }
    }

    if (!lieutenantId) {
      updateOrder(order.id, { status: "pending" });
      return NextResponse.json({
        orderId: order.id,
        commanderMessage: message,
        generalResponse: generalResult.content,
        delegation: null,
        lieutenantResponse: null,
        soldierUpdates: [],
        status: "pending",
        message: "General responded but no clear delegation was identified.",
      });
    }

    const lieutenant = getAgent(lieutenantId);
    if (!lieutenant) {
      return NextResponse.json({
        orderId: order.id,
        commanderMessage: message,
        generalResponse: generalResult.content,
        error: `Lieutenant ${lieutenantId} not found`,
      });
    }

    const ltOrder = orderToLtMatch?.[1]?.trim() || message;
    updateOrder(order.id, { lieutenant_id: lieutenantId, lieutenant_order: ltOrder });

    // Step 3: Send to Lieutenant with dynamic soldier context
    const ltModel = getEffectiveModel(lieutenantId);
    const ltContext = buildLieutenantContext(lieutenantId);
    const ltSystemPrompt = lieutenant.system_prompt + ltContext;
    console.log(`[command] Sending to ${lieutenant.name} with model ${ltModel}, dynamic context: ${ltContext.length} chars`);
    const ltResult = await callOpenRouter(apiKey, ltModel, [
      { role: "system", content: ltSystemPrompt },
      { role: "user", content: `Order from The General:\n\n${ltOrder}\n\nOriginal commander request: "${message}"\n\nGenerate the complete updated prompts for affected soldiers.` },
    ], 3000, 0.7);

    if (!ltResult.content) {
      updateOrder(order.id, {
        lieutenant_response: "Failed to reach Lieutenant: " + (ltResult.error || "unknown error"),
        status: "pending",
      });
      return NextResponse.json({
        orderId: order.id,
        commanderMessage: message,
        generalResponse: generalResult.content,
        delegation: { lieutenantId, lieutenantName: lieutenant.name, orderText: ltOrder },
        lieutenantResponse: null,
        soldierUpdates: [],
        error: "Failed to reach Lieutenant",
        status: "pending",
      });
    }

    updateOrder(order.id, { lieutenant_response: ltResult.content });

    // Step 4: Parse proposed changes from Lieutenant's response
    let proposedChanges: { agent_id: string; agent_name: string; what_changed: string; new_prompt: string }[] = [];
    try {
      const jsonMatch = ltResult.content.match(/\{[\s\S]*"changes"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed.changes)) {
          proposedChanges = parsed.changes.filter(
            (c: Record<string, unknown>) => c.agent_id && c.new_prompt
          );
        }
      }
    } catch {
      // Try structured text format
      const soldierBlocks = ltResult.content.split(/SOLDIER:\s*/i).slice(1);
      for (const block of soldierBlocks) {
        const nameMatch = block.match(/^(.+?)(?:\n|$)/);
        const promptMatch = block.match(/NEW PROMPT:\s*([\s\S]*?)(?=SOLDIER:|$)/i);
        const changesMatch = block.match(/CHANGES:\s*([\s\S]*?)(?=NEW PROMPT:|$)/i);
        if (nameMatch && promptMatch) {
          const name = nameMatch[1].trim();
          const idMap: Record<string, string> = {
            "momentum trader": "momentum_trader", "contrarian": "contrarian",
            "sector rotator": "sector_rotator", "value hunter": "value_hunter",
            "risk averse": "risk_averse", "custom wrapper": "custom_wrapper",
            "macro news": "macro_news", "company news": "company_news",
            "stock selector": "stock_selector", "market engine": "market_engine",
          };
          const agentId = idMap[name.toLowerCase()] || name.toLowerCase().replace(/\s+/g, "_");
          proposedChanges.push({
            agent_id: agentId, agent_name: name,
            what_changed: changesMatch?.[1]?.trim() || "Updated",
            new_prompt: promptMatch[1].trim(),
          });
        }
      }
    }

    // Step 5: Build soldier updates with old prompts + acknowledgments
    const allAgents = getAllAgents();
    const agentMap = new Map(allAgents.map(a => [a.id, a]));

    const soldierUpdates = proposedChanges.map((c) => {
      const agent = agentMap.get(c.agent_id);
      const oldPrompt = agent?.system_prompt || "(not found)";
      // Generate a template acknowledgment (no API call to save cost)
      const ack = `Copy that, Lieutenant. ${c.what_changed}. Prompt updated and ready for deployment.`;
      return {
        agentId: c.agent_id,
        agentName: c.agent_name || agent?.name || c.agent_id,
        acknowledgment: ack,
        whatChanged: c.what_changed,
        oldPrompt,
        newPrompt: c.new_prompt,
      };
    });

    const affectedAgentIds = proposedChanges.map((c) => c.agent_id);
    const changesWithOld = proposedChanges.map((c) => ({
      ...c,
      old_prompt: agentMap.get(c.agent_id)?.system_prompt || "(not found)",
    }));

    updateOrder(order.id, {
      affected_agents: JSON.stringify(affectedAgentIds),
      proposed_changes: JSON.stringify(changesWithOld),
      status: "pending",
    });

    // Step 6: Auto-approve if enabled
    const autoApproveEnabled = clientAutoApprove ?? (getSystemConfig("auto_approve") === "true");
    if (autoApproveEnabled && changesWithOld.length > 0) {
      for (const change of changesWithOld) {
        const notes = `Auto-approved via Order #${order.id} from ${lieutenant.name}`;
        createPromptVersion(change.agent_id, change.new_prompt, notes, lieutenantId);
      }
      updateOrder(order.id, {
        status: "executed",
        executed_at: new Date().toISOString(),
      });
    }

    const finalStatus = autoApproveEnabled && changesWithOld.length > 0 ? "executed" : "pending";

    return NextResponse.json({
      orderId: order.id,
      commanderMessage: message,
      generalResponse: generalResult.content,
      delegation: {
        lieutenantId,
        lieutenantName: lieutenant.name,
        orderText: ltOrder,
      },
      lieutenantResponse: ltResult.content,
      soldierUpdates,
      status: finalStatus,
    });
  } catch (error) {
    console.error("Command API error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
