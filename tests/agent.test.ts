import { describe, expect, test } from "vitest";
import { runAgent } from "../src/agent.js";
import type { ModelClient, ToolCall, ToolExecutor } from "../src/agent.js";

const call: ToolCall = { id: "call-1", type: "function", function: { name: "search_policy", arguments: '{"query":"退款"}' } };
describe("Agent loop", () => {
  test("工具结果带调用 ID 回填，然后模型继续", async () => {
    let count = 0;
    const model: ModelClient = { async complete(messages) {
      count += 1;
      if (count === 2) expect(messages[3]).toMatchObject({ role: "tool", tool_call_id: "call-1" });
      return count === 1 ? { content: null, tool_calls: [call] } : { content: "依据 POL-RET-01 可申请退货。" };
    } };
    const tools: ToolExecutor = { specs: () => [], execute: async () => "POL-RET-01" };
    const result = await runAgent("退货政策", model, tools);
    expect(result.turns).toBe(2);
    expect(result.answer).toContain("POL-RET-01");
  });
  test("持续工具调用受回合上限限制", async () => {
    const model: ModelClient = { complete: async () => ({ content: null, tool_calls: [call] }) };
    const tools: ToolExecutor = { specs: () => [], execute: async () => "ok" };
    await expect(runAgent("查询", model, tools, 2)).rejects.toThrow("maxTurns=2");
  });
});
