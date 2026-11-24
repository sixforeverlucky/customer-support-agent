export interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
export interface ToolSpec { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }
export interface ModelClient {
  complete(messages: readonly ChatMessage[], tools: readonly ToolSpec[]): Promise<{ content: string | null; tool_calls?: ToolCall[] }>;
}
export interface ToolExecutor { specs(): readonly ToolSpec[]; execute(call: ToolCall): Promise<string> }
export interface RunResult { answer: string; turns: number; history: readonly ChatMessage[] }

const SYSTEM_PROMPT = [
  "你是演示电商店铺的客服 Agent。只根据工具返回的政策和订单数据回答，不编造政策或物流状态。",
  "引用政策时写出政策 ID。查订单需要订单号和邮箱；缺少信息时先询问用户。",
  "创建工单前调用 create_ticket；工具会要求用户批准。被拒绝时不得声称已创建。",
].join("\n");

// 单轮模型回复可以包含多个工具调用；每个调用都要回填相同 ID 的工具结果。
export async function runAgent(prompt: string, model: ModelClient, tools: ToolExecutor, maxTurns = 6): Promise<RunResult> {
  if (!prompt.trim()) throw new Error("prompt must not be empty");
  if (!Number.isInteger(maxTurns) || maxTurns <= 0) throw new Error("maxTurns must be positive");
  const history: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: prompt }];
  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const reply = await model.complete([...history], tools.specs());
    const calls = reply.tool_calls ?? [];
    history.push({ role: "assistant", content: reply.content, ...(calls.length ? { tool_calls: calls } : {}) });
    if (calls.length === 0) {
      if (!reply.content?.trim()) throw new Error("model stopped without an answer or tool calls");
      return { answer: reply.content, turns: turn, history };
    }
    for (const call of calls) {
      history.push({ role: "tool", tool_call_id: call.id, content: await tools.execute(call) });
    }
  }
  throw new Error(`agent exceeded maxTurns=${maxTurns}`);
}
