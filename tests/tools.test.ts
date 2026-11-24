import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createSupportTools } from "../src/tools.js";
import type { ToolCall } from "../src/agent.js";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const call = (name: string, args: unknown): ToolCall => ({ id: "test", type: "function", function: { name, arguments: JSON.stringify(args) } });
async function setup(approved: boolean) {
  const dir = await mkdtemp(join(tmpdir(), "support-agent-test-")); dirs.push(dir);
  let approvals = 0;
  const tools = await createSupportTools({ dataDir: resolve("data"), ticketDir: join(dir, "tickets"), approval: { approve: async () => { approvals += 1; return approved; } } });
  return { tools, dir, approvals: () => approvals };
}
describe("客服工具", () => {
  test("政策有来源 ID，订单结果不暴露邮箱", async () => {
    const { tools } = await setup(false);
    expect(await tools.execute(call("search_policy", { query: "物流" }))).toContain("POL-SHIP-01");
    const result = await tools.execute(call("lookup_order", { order_id: "DEMO-1001", email: "demo@example.com" }));
    expect(result).toContain("运输中"); expect(result).not.toContain("demo@example.com");
  });
  test("无效参数在审批前拒绝", async () => {
    const { tools, dir, approvals } = await setup(true);
    const result = await tools.execute(call("create_ticket", { order_id: "DEMO-1001", email: "bad", issue: "物流延迟" }));
    expect(JSON.parse(result)).toMatchObject({ error: { code: "invalid_arguments" } });
    expect(approvals()).toBe(0);
    await expect(readdir(join(dir, "tickets"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  test("拒绝审批不写工单", async () => {
    const { tools, dir } = await setup(false);
    const result = await tools.execute(call("create_ticket", { order_id: "DEMO-1001", email: "demo@example.com", issue: "物流超过预计时间" }));
    expect(JSON.parse(result)).toMatchObject({ error: { code: "permission_denied" } });
    await expect(readdir(join(dir, "tickets"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  test("批准后持久化，同样请求复用工单", async () => {
    const { tools, dir } = await setup(true);
    const request = call("create_ticket", { order_id: "DEMO-1001", email: "demo@example.com", issue: "物流超过预计时间" });
    const first = JSON.parse(await tools.execute(request)) as { data: { ticketId: string } };
    const second = JSON.parse(await tools.execute(request)) as { data: { ticketId: string } };
    expect(second.data.ticketId).toBe(first.data.ticketId);
    const files = await readdir(join(dir, "tickets")); expect(files).toHaveLength(1);
    expect(await readFile(join(dir, "tickets", files[0]!), "utf8")).toContain(first.data.ticketId);
  });
});
