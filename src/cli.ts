import { stdin, stderr, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { runAgent } from "./agent.js";
import { DemoModel, OpenAICompatibleModel } from "./model.js";
import { createSupportTools } from "./tools.js";

async function main(argv: readonly string[]): Promise<void> {
  const demo = argv[0] === "--demo";
  const promptIndex = argv.indexOf("--prompt");
  const prompt = demo ? "查询 DEMO-1001 的物流，邮箱 demo@example.com" : argv[promptIndex + 1];
  if (!prompt || (!demo && promptIndex < 0)) throw new Error("usage: --demo OR --prompt \"用户问题\"");
  const root = resolve(process.cwd());
  const tools = await createSupportTools({
    dataDir: resolve(root, "data"), ticketDir: resolve(root, "runtime", "tickets"),
    approval: { async approve(name, args) {
      if (!stdin.isTTY) return false;
      const terminal = createInterface({ input: stdin, output: stderr });
      try {
        const answer = await terminal.question(`批准 ${name} ${JSON.stringify(args)} ? [y/N] `);
        return ["y", "yes"].includes(answer.trim().toLowerCase());
      } finally { terminal.close(); }
    } },
  });
  const model = demo ? new DemoModel() : new OpenAICompatibleModel({
    baseUrl: process.env.OPENAI_BASE_URL ?? "",
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.OPENAI_MODEL ?? "",
  });
  const result = await runAgent(prompt, model, tools);
  stdout.write(`${result.answer}\n`);
}
main(process.argv.slice(2)).catch((error: unknown) => {
  stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
