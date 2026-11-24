import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ToolCall, ToolExecutor, ToolSpec } from "./agent.js";

const policiesSchema = z.array(z.object({ id: z.string(), title: z.string(), keywords: z.array(z.string()), content: z.string() }));
const ordersSchema = z.array(z.object({ orderId: z.string(), email: z.string(), status: z.string(), carrier: z.string(), eta: z.string() }));
const searchSchema = z.strictObject({ query: z.string().min(1) });
const lookupSchema = z.strictObject({ order_id: z.string().min(1), email: z.email() });
const ticketSchema = z.strictObject({ order_id: z.string().min(1), email: z.email(), issue: z.string().min(5).max(500) });

export interface ApprovalProvider { approve(toolName: string, args: unknown): Promise<boolean> }
export interface SupportToolOptions { dataDir: string; ticketDir: string; approval: ApprovalProvider }
interface RegisteredTool { spec: ToolSpec; effect: "read" | "write"; parse(input: unknown): unknown; handler(input: unknown): Promise<unknown> }
const success = (data: unknown) => JSON.stringify({ ok: true, data });
const failure = (code: string, message: string) => JSON.stringify({ ok: false, error: { code, message } });

export class SupportTools implements ToolExecutor {
  private readonly definitions = new Map<string, RegisteredTool>();
  constructor(private readonly approval: ApprovalProvider) {}
  register<T>(name: string, description: string, effect: "read" | "write", schema: z.ZodType<T>, handler: (input: T) => Promise<unknown>): void {
    if (this.definitions.has(name)) throw new Error(`duplicate tool: ${name}`);
    this.definitions.set(name, {
      spec: { type: "function", function: { name, description, parameters: z.toJSONSchema(schema) as Record<string, unknown> } },
      effect, parse: (input) => schema.parse(input), handler: (input) => handler(input as T),
    });
  }
  specs(): readonly ToolSpec[] { return [...this.definitions.values()].map(({ spec }) => spec); }
  async execute(call: ToolCall): Promise<string> {
    const tool = this.definitions.get(call.function.name);
    if (!tool) return failure("unknown_tool", `Unknown tool: ${call.function.name}`);
    let input: unknown;
    try { input = tool.parse(JSON.parse(call.function.arguments) as unknown); }
    catch { return failure("invalid_arguments", "Tool arguments failed JSON or schema validation"); }
    if (tool.effect === "write") {
      let approved = false;
      try { approved = await this.approval.approve(call.function.name, input); }
      catch { /* 审批异常默认拒绝。 */ }
      if (!approved) return failure("permission_denied", "Ticket creation was not approved");
    }
    try { return success(await tool.handler(input)); }
    catch (error) { return failure("tool_error", error instanceof Error ? error.message : "Tool failed"); }
  }
}

export async function createSupportTools(options: SupportToolOptions): Promise<SupportTools> {
  const policies = policiesSchema.parse(JSON.parse(await readFile(join(options.dataDir, "policies.json"), "utf8")) as unknown);
  const orders = ordersSchema.parse(JSON.parse(await readFile(join(options.dataDir, "orders.json"), "utf8")) as unknown);
  const registry = new SupportTools(options.approval);
  registry.register("search_policy", "按问题检索演示店铺政策，返回政策 ID、标题和原文。", "read", searchSchema, async ({ query }) => {
    const normalized = query.toLowerCase();
    const matches = policies.filter((policy) => policy.keywords.some((keyword) => normalized.includes(keyword.toLowerCase())));
    return matches.length ? { matches: matches.map(({ id, title, content }) => ({ id, title, content })) } : { matches: [], note: "未找到匹配政策，不要编造规则。" };
  });
  registry.register("lookup_order", "用订单号和邮箱核对演示订单，只返回物流字段。", "read", lookupSchema, async ({ order_id, email }) => {
    const order = orders.find((item) => item.orderId === order_id && item.email.toLowerCase() === email.toLowerCase());
    return order ? { found: true, orderId: order.orderId, status: order.status, carrier: order.carrier, eta: order.eta } : { found: false, note: "订单号或邮箱不匹配。" };
  });
  registry.register("create_ticket", "经用户批准后为已核对的演示订单创建人工工单。", "write", ticketSchema, async ({ order_id, email, issue }) => {
    const order = orders.find((item) => item.orderId === order_id && item.email.toLowerCase() === email.toLowerCase());
    if (!order) throw new Error("order verification failed");
    await mkdir(options.ticketDir, { recursive: true });
    const key = createHash("sha256").update(`${order_id}\0${email.toLowerCase()}\0${issue.trim()}`).digest("hex");
    const path = join(options.ticketDir, `${key}.json`);
    try {
      const existing = JSON.parse(await readFile(path, "utf8")) as { ticketId: string };
      return { ticketId: existing.ticketId, status: "已存在", orderId: order_id };
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const ticket = { ticketId: `T-${randomUUID()}`, orderId: order_id, issue: issue.trim(), status: "待人工处理", createdAt: new Date().toISOString() };
    try { await writeFile(path, JSON.stringify(ticket, null, 2), { flag: "wx" }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = JSON.parse(await readFile(path, "utf8")) as { ticketId: string };
      return { ticketId: existing.ticketId, status: "已存在", orderId: order_id };
    }
    return { ticketId: ticket.ticketId, status: ticket.status, orderId: order_id };
  });
  return registry;
}
