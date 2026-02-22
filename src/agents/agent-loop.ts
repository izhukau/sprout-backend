import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

export interface AgentTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  execute: (input: any) => Promise<string>;
}

export interface AgentLoopCallbacks {
  onToolCall?: (name: string, input: any) => void;
  onToolResult?: (name: string, result: string) => void;
  onThinking?: (text: string) => void;
}

export interface ToolCallRecord {
  name: string;
  input: any;
  result: string;
}

export interface AgentLoopResult {
  finalText: string;
  toolCalls: ToolCallRecord[];
}

export async function runAgentLoop(options: {
  model: string;
  systemPrompt: string;
  tools: AgentTool[];
  initialMessage?: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  maxIterations?: number;
  callbacks?: AgentLoopCallbacks;
}): Promise<AgentLoopResult> {
  const {
    model,
    systemPrompt,
    tools,
    initialMessage,
    conversationHistory,
    maxIterations = 15,
    callbacks,
  } = options;

  const toolDefs: Anthropic.Tool[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool.InputSchema,
  }));

  const toolMap = new Map(tools.map((t) => [t.name, t]));

  const messages: Anthropic.MessageParam[] = conversationHistory
    ? conversationHistory.map((m) => ({ role: m.role, content: m.content }))
    : [{ role: "user", content: initialMessage ?? "" }];

  const allToolCalls: ToolCallRecord[] = [];

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const response = await callWithRetry(() =>
      anthropic.messages.create({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        tools: toolDefs,
        messages,
      }),
    );

    // Collect tool_use blocks and emit reasoning text
    const toolUseBlocks: Array<{ type: "tool_use"; id: string; name: string; input: any }> = [];
    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) {
        callbacks?.onThinking?.(block.text);
      }
      if (block.type === "tool_use") {
        toolUseBlocks.push(block as any);
      }
    }

    // If no tool use, we're done — extract final text
    if (response.stop_reason === "end_turn" || toolUseBlocks.length === 0) {
      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text",
      );
      return {
        finalText: textBlock?.text ?? "",
        toolCalls: allToolCalls,
      };
    }

    // Add assistant response to messages
    messages.push({ role: "assistant", content: response.content as any });

    // Execute each tool call and collect results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      const tool = toolMap.get(toolUse.name);

      callbacks?.onToolCall?.(toolUse.name, toolUse.input);

      let result: string;
      if (!tool) {
        result = JSON.stringify({ error: `Unknown tool: ${toolUse.name}` });
      } else {
        try {
          result = await tool.execute(toolUse.input);
        } catch (err: any) {
          result = JSON.stringify({
            error: err.message ?? "Tool execution failed",
          });
        }
      }

      callbacks?.onToolResult?.(toolUse.name, result);

      allToolCalls.push({ name: toolUse.name, input: toolUse.input, result });

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result,
      });
    }

    // Feed tool results back to Claude
    messages.push({ role: "user", content: toolResults });
  }

  // Hit max iterations — return whatever text we have
  const lastAssistant = messages
    .filter((m) => m.role === "assistant")
    .pop();

  let finalText = "";
  if (lastAssistant && Array.isArray(lastAssistant.content)) {
    const textBlock = (lastAssistant.content as any[]).find(
      (block: any) => block.type === "text",
    );
    if (textBlock) finalText = textBlock.text;
  }

  return { finalText, toolCalls: allToolCalls };
}

async function callWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.status ?? err?.statusCode;
      if (status === 429 && attempt < maxRetries) {
        // Exponential backoff: 2s, 4s, 8s
        const delay = Math.pow(2, attempt + 1) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("callWithRetry: unreachable");
}
