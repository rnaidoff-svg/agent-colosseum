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

const FALLBACK_MODEL = "anthropic/claude-opus-4.6";

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
    console.log(`[DEBUG STEP 0] Order #${order.id} created for: "${message}"`);

    // Step 1: Send to The General
    const general = getAgent("general");
    if (!general) {
      console.error(`[DEBUG STEP 1] FAILED — General not found in database`);
      return NextResponse.json({ error: "General not found in database" }, { status: 500 });
    }

    const generalModel = getEffectiveModel("general");
    const dynamicContext = buildGeneralContext();
    const generalSystemPrompt = general.system_prompt + dynamicContext;
    console.log(`[DEBUG STEP 1] Sending to General — model: ${generalModel}, system prompt: ${generalSystemPrompt.length} chars, dynamic context: ${dynamicContext.length} chars`);
    const generalResult = await callOpenRouter(apiKey, generalModel, [
      { role: "system", content: generalSystemPrompt },
      { role: "user", content: `Commander's order: ${message}` },
    ], 1500, 0.7);

    if (!generalResult.content) {
      console.error(`[DEBUG STEP 1] FAILED — General returned no content: ${generalResult.error}`);
      updateOrder(order.id, {
        general_response: "Failed to reach The General: " + (generalResult.error || "unknown error"),
        status: "rejected",
      });
      return NextResponse.json({
        orderId: order.id,
        commanderMessage: message,
        generalResponse: null,
        error: "Failed to reach The General: " + (generalResult.error || "unknown error"),
        status: "rejected",
      });
    }

    console.log(`[DEBUG STEP 1] General responded (${generalResult.content.length} chars):`);
    console.log(generalResult.content.slice(0, 500));
    updateOrder(order.id, { general_response: generalResult.content });

    // Step 2A: Check if General is proposing a new agent
    console.log(`[DEBUG STEP 2A] Checking for NEW AGENT PROPOSAL...`);
    if (generalResult.content.includes("NEW AGENT PROPOSAL:")) {
      console.log(`[DEBUG STEP 2A] Found NEW AGENT PROPOSAL in General's response`);
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
    console.log(`[DEBUG STEP 2] Parsing delegation from General's response...`);
    const delegationMatch = generalResult.content.match(/DELEGATION:\s*(.+?)(?:\n|$)/i);
    const orderToLtMatch = generalResult.content.match(/ORDER TO LIEUTENANT:\s*([\s\S]*?)(?=EXPECTED OUTCOME:|$)/i);

    let lieutenantId: string | null = null;
    let delegationSource = "none";
    if (delegationMatch) {
      const delegation = delegationMatch[1].toLowerCase().trim();
      console.log(`[DEBUG STEP 2] Found DELEGATION keyword: "${delegationMatch[1].trim()}"`);
      if (delegation.includes("trading") || delegation.includes("trading_lt")) {
        lieutenantId = "trading_lt";
        delegationSource = "explicit DELEGATION keyword (trading)";
      } else if (delegation.includes("market") || delegation.includes("market_lt")) {
        lieutenantId = "market_lt";
        delegationSource = "explicit DELEGATION keyword (market)";
      } else if (delegation.includes("analytics") || delegation.includes("analytics_lt")) {
        lieutenantId = "analytics_lt";
        delegationSource = "explicit DELEGATION keyword (analytics)";
      } else {
        console.log(`[DEBUG STEP 2] DELEGATION keyword found but value didn't match any lieutenant: "${delegation}"`);
      }
    } else {
      console.log(`[DEBUG STEP 2] No DELEGATION keyword found in General's response`);
    }

    // Fallback: infer from content
    if (!lieutenantId) {
      console.log(`[DEBUG STEP 2] Attempting content-based inference...`);
      const content = generalResult.content.toLowerCase();
      if (content.includes("trading_lt") || content.includes("trading operations lieutenant")) {
        lieutenantId = "trading_lt";
        delegationSource = "inferred from trading_lt/Trading Operations Lieutenant mention";
      } else if (content.includes("market_lt") || content.includes("market operations lieutenant")) {
        lieutenantId = "market_lt";
        delegationSource = "inferred from market_lt/Market Operations Lieutenant mention";
      } else if (content.includes("trading") && (content.includes("momentum") || content.includes("contrarian") || content.includes("aggressive") || content.includes("strategy") || content.includes("trader") || content.includes("position") || content.includes("buy") || content.includes("sell") || content.includes("long") || content.includes("short"))) {
        lieutenantId = "trading_lt";
        delegationSource = "inferred from trading-related keywords";
      } else if (content.includes("market") || content.includes("news") || content.includes("stock selector") || content.includes("price") || content.includes("sector")) {
        lieutenantId = "market_lt";
        delegationSource = "inferred from market-related keywords";
      } else {
        // Last resort: default to trading_lt since most orders relate to trading
        lieutenantId = "trading_lt";
        delegationSource = "fallback default (no clear keywords matched)";
        console.log(`[DEBUG STEP 2] WARNING: No keywords matched, defaulting to trading_lt`);
      }
    }
    console.log(`[DEBUG STEP 2] Delegation resolved: ${lieutenantId} (${delegationSource})`);

    if (!lieutenantId) {
      console.error(`[DEBUG STEP 2] FAILED — No lieutenant identified`);
      updateOrder(order.id, { status: "pending" });
      return NextResponse.json({
        orderId: order.id,
        commanderMessage: message,
        generalResponse: generalResult.content,
        delegation: null,
        lieutenantResponse: null,
        soldierUpdates: [],
        status: "pending",
        error: "General responded but no clear delegation was identified. The General may not have used the DELEGATION: format.",
      });
    }

    const lieutenant = getAgent(lieutenantId);
    if (!lieutenant) {
      console.error(`[DEBUG STEP 2] FAILED — Lieutenant ${lieutenantId} not found in database`);
      return NextResponse.json({
        orderId: order.id,
        commanderMessage: message,
        generalResponse: generalResult.content,
        delegation: null,
        lieutenantResponse: null,
        soldierUpdates: [],
        error: `Lieutenant ${lieutenantId} not found in database`,
        status: "pending",
      });
    }

    const ltOrder = orderToLtMatch?.[1]?.trim() || message;
    console.log(`[DEBUG STEP 2] Order to Lieutenant: "${ltOrder.slice(0, 200)}..."`);
    updateOrder(order.id, { lieutenant_id: lieutenantId, lieutenant_order: ltOrder });

    // Step 3: Send to Lieutenant with dynamic soldier context
    const ltModel = getEffectiveModel(lieutenantId);
    const ltContext = buildLieutenantContext(lieutenantId);
    const ltSystemPrompt = lieutenant.system_prompt + ltContext;
    console.log(`[DEBUG STEP 3] Sending to ${lieutenant.name} (${lieutenantId}) — model: ${ltModel}, system prompt: ${ltSystemPrompt.length} chars, soldier context: ${ltContext.length} chars`);
    const ltResult = await callOpenRouter(apiKey, ltModel, [
      { role: "system", content: ltSystemPrompt },
      { role: "user", content: `Order from The General:\n\n${ltOrder}\n\nOriginal commander request: "${message}"\n\nGenerate the complete updated prompts for affected soldiers.` },
    ], 3000, 0.7);

    if (!ltResult.content) {
      console.error(`[DEBUG STEP 3] FAILED — Lieutenant returned no content: ${ltResult.error}`);
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
        error: "Failed to reach Lieutenant: " + (ltResult.error || "unknown error"),
        status: "pending",
      });
    }

    console.log(`[DEBUG STEP 3] Lieutenant responded (${ltResult.content.length} chars):`);
    console.log(ltResult.content.slice(0, 500));
    updateOrder(order.id, { lieutenant_response: ltResult.content });

    // Step 4: Parse proposed changes from Lieutenant's response
    console.log(`[DEBUG STEP 4] Parsing proposed changes from Lieutenant's response...`);
    let proposedChanges: { agent_id: string; agent_name: string; what_changed: string; new_prompt: string }[] = [];
    let parseMethod = "none";
    try {
      const jsonMatch = ltResult.content.match(/\{[\s\S]*"changes"[\s\S]*\}/);
      if (jsonMatch) {
        console.log(`[DEBUG STEP 4] Found JSON block with "changes" key (${jsonMatch[0].length} chars)`);
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed.changes)) {
          proposedChanges = parsed.changes.filter(
            (c: Record<string, unknown>) => c.agent_id && c.new_prompt
          );
          parseMethod = "JSON";
          console.log(`[DEBUG STEP 4] Parsed ${proposedChanges.length} changes via JSON format`);
        } else {
          console.log(`[DEBUG STEP 4] JSON parsed but "changes" is not an array: ${typeof parsed.changes}`);
        }
      } else {
        console.log(`[DEBUG STEP 4] No JSON block with "changes" found, trying structured text...`);
        throw new Error("No JSON match, try text fallback");
      }
    } catch (parseErr) {
      // Try structured text format
      console.log(`[DEBUG STEP 4] JSON parse failed (${parseErr instanceof Error ? parseErr.message : "unknown"}), trying SOLDIER: block format...`);
      const soldierBlocks = ltResult.content.split(/SOLDIER:\s*/i).slice(1);
      console.log(`[DEBUG STEP 4] Found ${soldierBlocks.length} SOLDIER: blocks`);
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
            "custom strategy wrapper": "custom_wrapper",
            "macro news": "macro_news", "macro news agent": "macro_news",
            "company news": "company_news", "company news agent": "company_news",
            "stock selector": "stock_selector", "market engine": "market_engine",
          };
          const agentId = idMap[name.toLowerCase()] || name.toLowerCase().replace(/\s+/g, "_");
          proposedChanges.push({
            agent_id: agentId, agent_name: name,
            what_changed: changesMatch?.[1]?.trim() || "Updated",
            new_prompt: promptMatch[1].trim(),
          });
          parseMethod = "structured text";
        }
      }
      if (proposedChanges.length > 0) {
        console.log(`[DEBUG STEP 4] Parsed ${proposedChanges.length} changes via structured text format`);
      }
    }

    // If still no changes, try one more fallback: look for agent_id mentions in any JSON-like structure
    if (proposedChanges.length === 0) {
      console.log(`[DEBUG STEP 4] WARNING: No changes parsed from Lieutenant. Trying additional fallback patterns...`);
      // Try to find any JSON objects with new_prompt
      const jsonObjects = ltResult.content.match(/\{[^{}]*"(?:new_prompt|newPrompt)"[^{}]*\}/g);
      if (jsonObjects) {
        for (const jsonStr of jsonObjects) {
          try {
            const obj = JSON.parse(jsonStr);
            const agentId = obj.agent_id || obj.agentId;
            const newPrompt = obj.new_prompt || obj.newPrompt;
            if (agentId && newPrompt) {
              proposedChanges.push({
                agent_id: agentId,
                agent_name: obj.agent_name || obj.agentName || agentId,
                what_changed: obj.what_changed || obj.whatChanged || "Updated",
                new_prompt: newPrompt,
              });
              parseMethod = "individual JSON objects";
            }
          } catch { /* skip malformed */ }
        }
        if (proposedChanges.length > 0) {
          console.log(`[DEBUG STEP 4] Parsed ${proposedChanges.length} changes via individual JSON objects`);
        }
      }
    }

    if (proposedChanges.length === 0) {
      console.log(`[DEBUG STEP 4] WARNING: Could not parse any soldier changes from Lieutenant's response`);
      console.log(`[DEBUG STEP 4] Lieutenant response preview: ${ltResult.content.slice(0, 300)}`);
    }
    proposedChanges.forEach((c, i) => {
      console.log(`[DEBUG STEP 4] Change ${i + 1}: ${c.agent_id} (${c.agent_name}) — ${c.what_changed} — prompt: ${c.new_prompt.length} chars`);
    });

    // Step 5: Build soldier updates with old prompts + acknowledgments
    console.log(`[DEBUG STEP 5] Building soldier updates for ${proposedChanges.length} changes...`);
    const allAgents = getAllAgents();
    const agentMap = new Map(allAgents.map(a => [a.id, a]));

    const soldierUpdates = proposedChanges.map((c) => {
      const agent = agentMap.get(c.agent_id);
      const oldPrompt = agent?.system_prompt || "(not found)";
      if (!agent) {
        console.log(`[DEBUG STEP 5] WARNING: Agent "${c.agent_id}" not found in database — soldier update will show "(not found)"`);
      }
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

    console.log(`[DEBUG STEP 5] Built ${soldierUpdates.length} soldier updates: [${soldierUpdates.map(su => su.agentName).join(", ")}]`);

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
    console.log(`[DEBUG STEP 6] Auto-approve: ${autoApproveEnabled}, changes: ${changesWithOld.length}`);
    if (autoApproveEnabled && changesWithOld.length > 0) {
      console.log(`[DEBUG STEP 6] Auto-approving ${changesWithOld.length} changes...`);
      for (const change of changesWithOld) {
        const notes = `Auto-approved via Order #${order.id} from ${lieutenant.name}`;
        createPromptVersion(change.agent_id, change.new_prompt, notes, lieutenantId);
        console.log(`[DEBUG STEP 6] Created new prompt version for ${change.agent_id}`);
      }
      updateOrder(order.id, {
        status: "executed",
        executed_at: new Date().toISOString(),
      });
    }

    const finalStatus = autoApproveEnabled && changesWithOld.length > 0 ? "executed" : "pending";
    console.log(`[DEBUG COMPLETE] Order #${order.id} finished — status: ${finalStatus}, delegation: ${lieutenantId} (${delegationSource}), parse: ${parseMethod}, soldiers: ${soldierUpdates.length}`);

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
