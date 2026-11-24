import { z } from "zod";
import type { ChatMessage, ModelClient, ToolCall, ToolSpec } from "./agent.js";

const toolCallSchema = z.object({ id: z.string(), type: z.literal("function"), function: z.object({ name: z.string(), arguments: z.string() }) });
const replySchema = z.object({ choices: z.array(z.object({ message: z.object({ role: z.literal("assistant"), content: z.string().nullable(), tool_calls: z.array(toolCallSchema).optional() }) })).length(1) });

export interface ModelSettings { baseUrl: string; apiKey: string; model: string }

// 实际模型请求边界，离线测试通过 ModelClient 替身隔离网络。
export class OpenAICompatibleModel implements ModelClient {
  constructor(private readonly settings: ModelSettings) {
    if (!/^https?:\/\//u.test(settings.baseUrl)) throw new Error("OPENAI_BASE_URL must be HTTP(S)");
    if (!settings.apiKey || !settings.model) throw new Error("model settings are incomplete");
  }
  async complete(messages: readonly ChatMessage[], tools: readonly ToolSpec[]): Promise<{ content: string | null; tool_calls?: ToolCall[] }> {
    const endpoint = `${this.settings.baseUrl.replace(/\/+$/u, "")}/chat/completions`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${this.settings.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: this.settings.model, messages, tools, tool_choice: "auto" }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`model request failed with HTTP ${response.status}`);
    const message = replySchema.parse(await response.json()).choices[0]!.message;
    return { content: message.content, ...(message.tool_calls === undefined ? {} : { tool_calls: message.tool_calls }) };
  }
}

// 固定演示只验证 Agent 工具链；不宣称具备真实模型推理能力。
export class DemoModel implements ModelClient {
  private turn = 0;
  async complete(messages: readonly ChatMessage[]): Promise<{ content: string | null; tool_calls?: ToolCall[] }> {
    this.turn += 1;
    if (this.turn === 1) return { content: null, tool_calls: [
      { id: "demo-policy", type: "function", function: { name: "search_policy", arguments: '{"query":"物流"}' } },
      { id: "demo-order", type: "function", function: { name: "lookup_order", arguments: '{"order_id":"DEMO-1001","email":"demo@example.com"}' } },
    ] };
    const policy = messages.find((m) => m.role === "tool" && m.tool_call_id === "demo-policy");
    const order = messages.find((m) => m.role === "tool" && m.tool_call_id === "demo-order");
    if (policy?.role !== "tool" || order?.role !== "tool") throw new Error("demo tool results are missing");
    const policyData = JSON.parse(policy.content) as { data?: { matches?: { id: string }[] } };
    const orderData = JSON.parse(order.content) as { data?: { found?: boolean; orderId?: string; status?: string; eta?: string } };
    if (!orderData.data?.found) return { content: "订单核对失败，请检查订单号与邮箱。" };
    const id = policyData.data?.matches?.[0]?.id ?? "无匹配政策";
    return { content: `订单 ${orderData.data.orderId} 当前${orderData.data.status}，预计送达 ${orderData.data.eta}。若超过预计日期仍未收到，可申请人工跟进。依据：${id}。` };
  }
}
