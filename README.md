# Customer Support Agent｜电商售后客服 Agent

一个可独立运行的 TypeScript 作品项目：Agent 查询演示店铺政策、核对模拟订单，并在用户批准后创建人工工单。它基于 `learn-agent` 教程的 Agent Loop、工具注册和权限边界思路，针对客服场景重新实现；仓库不需要教程的 20 章快照即可运行。

> 所有政策、订单和工单都是演示数据。请勿输入真实客户信息，也不要把本项目直接接到生产订单系统。

## 30 秒离线演示

需要 Node.js 20.12+。在本项目根目录运行：

```powershell
npm ci
npm run demo
```

`demo` 使用固定的模拟模型回复，不需要 API Key，也不会发网络请求。它仍会经过真实的 Agent 循环和两个真实工具：`search_policy`、`lookup_order`。预期答案会包含模拟订单状态及政策来源 `POL-SHIP-01`。

## 真实模型模式

复制 `.env.example` 为 `.env`，填写兼容 Chat Completions 的服务根地址、密钥和模型名。不要提交 `.env`；它已列入 `.gitignore`。

```powershell
Copy-Item .env.example .env
# 编辑 .env 后：
npm run build
npm start -- --prompt "请查询订单 DEMO-1001 的物流，邮箱 demo@example.com"
```

`npm start` 使用 Node 的 `--env-file` 读取 `.env`。真实模型调用需要有效凭据和网络。项目没有在无凭据环境下声称通过真实模型烟测。

模拟订单位于 [`data/orders.json`](data/orders.json)，模拟政策位于 [`data/policies.json`](data/policies.json)。这些数据是公开演示用的，不含真实订单或客户信息。

## 关键流程

```text
用户问题
  → Agent Loop 向模型发送消息和工具定义
  → 工具参数经 Zod 校验
  → search_policy / lookup_order 查询本地演示数据
  → create_ticket 先请求终端批准，再创建工单
  → 工具结果按调用 ID 回填给模型
  → 模型给出最终回答
```

| 工具 | 输入 | 作用 |
| --- | --- | --- |
| `search_policy` | `query` | 按关键词查政策，返回政策 ID 和原文 |
| `lookup_order` | `order_id`, `email` | 双字段核对模拟订单，不回传邮箱 |
| `create_ticket` | `order_id`, `email`, `issue` | 批准后创建本地工单；相同请求复用工单 |

工具定义的 Zod schema 同时生成发给模型的 JSON Schema，并校验模型回传的参数。工单存到被忽略的 `runtime/tickets/`；参数无效或批准被拒绝时不会写入。没有交互终端时，工单创建默认拒绝。

## 项目结构

```text
src/agent.ts   有回合上限的 Agent Loop 与工具结果回填
src/model.ts   可替换的模型边界、真实 HTTP 客户端、离线模拟模型
src/tools.ts   三个客服工具、输入校验、审批和工单持久化
src/cli.ts     命令行入口与人工批准
data/          公开演示政策与订单
tests/         离线行为测试
```

## 验证

```powershell
npm run typecheck
npm test
npm run build
npm run demo
```

测试覆盖工具回填与调用 ID、回合上限、政策来源、订单字段过滤、无效参数、拒绝审批、工单持久化与重复请求。CI 使用相同的离线验证，不需要密钥。

## 当前边界

- `search_policy` 是可复现的关键词检索，并非向量检索；未匹配时返回“无匹配政策”。
- 系统提示要求模型只根据工具结果回答并引用政策 ID，但最终自然语言答案尚未经过程序化事实核验。
- 模拟订单使用公开邮箱，只用于展示核对流程；生产系统还需要正式身份认证、加密、访问控制与数据保留策略。
- 工单是本地文件，不是外部客服平台工单；适合单机演示，不适合多人并发生产使用。

项目由 [learn-agent 教程](https://github.com/ryzqi/learn-agent)的架构学习延伸而来。建议将此目录作为**独立 GitHub 仓库的根目录**发布，保留本 README、锁文件和测试。可直接使用 [RESUME.md](RESUME.md) 中经本项目验证的简历描述。
