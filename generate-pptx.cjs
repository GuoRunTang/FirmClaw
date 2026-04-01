const pptxgen = require("pptxgenjs");

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.author = "FirmClaw Team";
pres.title = "FirmClaw 技术架构介绍";

const C = {
  bg: "0F172A",
  bg2: "1E293B",
  accent: "0EA5E9",
  accent2: "38BDF8",
  text: "F1F5F9",
  muted: "94A3B8",
  white: "FFFFFF",
  danger: "EF4444",
  warn: "F59E0B",
  safe: "22C55E",
};

const mkShadow = () => ({ type: "outer", blur: 6, offset: 2, angle: 135, color: "000000", opacity: 0.3 });

function darkSlide() {
  const s = pres.addSlide();
  s.background = { color: C.bg };
  return s;
}

function addPageNum(s, num, total) {
  s.addText(`${num} / ${total}`, { x: 8.5, y: 5.2, w: 1.2, h: 0.3, fontSize: 9, color: C.muted, align: "right" });
}

function addTitleBar(s, title) {
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.accent } });
  s.addText(title, { x: 0.6, y: 0.3, w: 8.8, h: 0.55, fontSize: 28, fontFace: "Georgia", color: C.text, bold: true, margin: 0 });
}

const TOTAL = 15;

// SLIDE 1: Cover
{
  const s = darkSlide();
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 5.625, fill: { color: C.bg2 } });
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 2.2, w: 10, h: 0.06, fill: { color: C.accent } });
  s.addText("FirmClaw", { x: 1, y: 1.0, w: 8, h: 0.9, fontSize: 48, fontFace: "Georgia", color: C.accent2, bold: true, align: "center", margin: 0 });
  s.addText("技术架构介绍", { x: 1, y: 1.9, w: 8, h: 0.7, fontSize: 32, fontFace: "Georgia", color: C.text, align: "center", margin: 0 });
  s.addShape(pres.shapes.RECTANGLE, { x: 3.5, y: 2.5, w: 3, h: 0.04, fill: { color: C.accent } });
  s.addText("本地优先的 AI 智能体框架", { x: 1, y: 2.8, w: 8, h: 0.5, fontSize: 18, color: C.muted, align: "center", margin: 0 });
  s.addText("v6.0.0  |  ReAct Architecture  |  TypeScript + Node.js", { x: 1, y: 4.3, w: 8, h: 0.4, fontSize: 12, color: C.muted, align: "center", margin: 0 });
  addPageNum(s, 1, TOTAL);
}

// SLIDE 2: TOC
{
  const s = darkSlide();
  addTitleBar(s, "目录");
  const items = [
    { num: "01", title: "项目概述", desc: "核心定位与组件优先级" },
    { num: "02", title: "架构概览", desc: "AI 生态位置与整体架构" },
    { num: "03", title: "Agent Loop", desc: "ReAct 循环核心解析" },
    { num: "04", title: "工具与模型层", desc: "工具系统与大模型适配" },
    { num: "05", title: "记忆与安全", desc: "记忆系统、安全审计、上下文管理" },
    { num: "06", title: "网关与总结", desc: "WebSocket 网关、技术选型、开发历程" },
  ];
  items.forEach((item, i) => {
    const y = 1.2 + i * 0.7;
    s.addShape(pres.shapes.RECTANGLE, { x: 0.6, y: y, w: 0.7, h: 0.5, fill: { color: C.accent }, shadow: mkShadow() });
    s.addText(item.num, { x: 0.6, y: y, w: 0.7, h: 0.5, fontSize: 20, fontFace: "Georgia", color: C.white, bold: true, align: "center", valign: "middle", margin: 0 });
    s.addText(item.title, { x: 1.5, y: y, w: 4, h: 0.3, fontSize: 18, fontFace: "Georgia", color: C.text, bold: true, margin: 0 });
    s.addText(item.desc, { x: 1.5, y: y + 0.3, w: 7, h: 0.25, fontSize: 12, color: C.muted, margin: 0 });
  });
  addPageNum(s, 2, TOTAL);
}

// SLIDE 3: Project Overview
{
  const s = darkSlide();
  addTitleBar(s, "项目概述");
  s.addText("FirmClaw 是一个从零搭建的本地优先 AI 智能体框架，核心采用 ReAct（Reasoning + Acting）架构。", { x: 0.6, y: 1.1, w: 8.8, h: 0.6, fontSize: 14, color: C.text, margin: 0 });
  s.addShape(pres.shapes.RECTANGLE, { x: 0.6, y: 1.8, w: 8.8, h: 0.04, fill: { color: C.accent, transparency: 60 } });
  const comps = [
    ["P1", "Agent Loop", "ReAct 循环：LLM 思考 → 调工具 → 观察 → 继续思考"],
    ["P2", "工具系统", "极简设计：read / write / edit / bash"],
    ["P3", "会话管理", "JSONL 持久化存储，记忆的骨架"],
    ["P4", "系统提示词", "动态组装 SOUL.md + 工具定义 + 记忆"],
    ["P5", "上下文压缩", "LLM 摘要 + token 裁剪，生存机制"],
    ["P6", "记忆系统", "结构化记忆 + BM25 全文搜索"],
    ["P7", "网关层", "WebSocket + 多客户端 + 子智能体编排"],
  ];
  comps.forEach((c, i) => {
    const y = 2.1 + i * 0.45;
    const bgColor = i % 2 === 0 ? C.bg2 : C.bg;
    s.addShape(pres.shapes.RECTANGLE, { x: 0.6, y: y, w: 8.8, h: 0.4, fill: { color: bgColor } });
    s.addText(c[0], { x: 0.7, y: y, w: 0.5, h: 0.4, fontSize: 11, fontFace: "Consolas", color: C.accent2, bold: true, valign: "middle", margin: 0 });
    s.addText(c[1], { x: 1.3, y: y, w: 1.8, h: 0.4, fontSize: 13, color: C.text, bold: true, valign: "middle", margin: 0 });
    s.addText(c[2], { x: 3.2, y: y, w: 6, h: 0.4, fontSize: 12, color: C.muted, valign: "middle", margin: 0 });
  });
  addPageNum(s, 3, TOTAL);
}

// SLIDE 4: AI Ecosystem
{
  const s = darkSlide();
  addTitleBar(s, "在 AI 生态中的位置");
  const layers = [
    { label: "应用 / 接口层", items: "CLI  |  Web UI  |  VS Code 插件  |  第三方客户端", color: "0EA5E9" },
    { label: "执行 / 框架层 — FirmClaw Agent Runtime", items: "任务规划 · 工具调度 · 会话管理 · 事件分发 · 多渠道接入", color: "38BDF8" },
    { label: "模型层 — 大语言模型 (LLM)", items: "Claude · GPT · DeepSeek · MiniMax · 通义千问 · 本地模型", color: "7DD3FC" },
  ];
  layers.forEach((l, i) => {
    const y = 1.3 + i * 1.3;
    s.addShape(pres.shapes.RECTANGLE, { x: 1, y: y, w: 8, h: 1.0, fill: { color: l.color }, shadow: mkShadow() });
    s.addText(l.label, { x: 1.2, y: y + 0.1, w: 7.6, h: 0.4, fontSize: 16, fontFace: "Georgia", color: "0F172A", bold: true, margin: 0 });
    s.addText(l.items, { x: 1.2, y: y + 0.5, w: 7.6, h: 0.4, fontSize: 13, color: "1E293B", margin: 0 });
    if (i < 2) {
      s.addText("▼", { x: 4.8, y: y + 1.0, w: 0.4, h: 0.3, fontSize: 14, color: C.muted, align: "center", margin: 0 });
    }
  });
  s.addText("FirmClaw 填补了模型与应用之间的空白，作为轻量级、可自部署的 Agent 运行时", { x: 0.6, y: 5.0, w: 8.8, h: 0.4, fontSize: 12, color: C.muted, italic: true, margin: 0 });
  addPageNum(s, 4, TOTAL);
}

// SLIDE 5: Architecture Overview
{
  const s = darkSlide();
  addTitleBar(s, "整体架构概览");
  s.addText("FirmClaw = 本地网关 + ReAct 循环 + 工具系统 + 持久化记忆", { x: 0.6, y: 1.1, w: 8.8, h: 0.4, fontSize: 14, color: C.accent2, bold: true, margin: 0 });
  const boxes = [
    { label: "多客户端接入", sub: "CLI / Web / VS Code", x: 3.2, y: 1.7, color: "0EA5E9" },
    { label: "Gateway 网关层", sub: "Auth + Router + ConnMgr", x: 3.2, y: 2.4, color: "0284C7" },
    { label: "AgentLoop (ReAct)", sub: "思考 → 行动 → 观察", x: 3.2, y: 3.1, color: "0369A1" },
    { label: "工具 + 记忆 + 安全", sub: "ToolRegistry / Memory / Audit", x: 3.2, y: 3.8, color: "075985" },
  ];
  boxes.forEach((b) => {
    s.addShape(pres.shapes.RECTANGLE, { x: b.x, y: b.y, w: 3.6, h: 0.6, fill: { color: b.color }, shadow: mkShadow() });
    s.addText(b.label, { x: b.x + 0.1, y: b.y, w: 3.4, h: 0.35, fontSize: 13, fontFace: "Georgia", color: C.white, bold: true, valign: "middle", margin: 0 });
    s.addText(b.sub, { x: b.x + 0.1, y: b.y + 0.3, w: 3.4, h: 0.25, fontSize: 10, color: "E0F2FE", margin: 0 });
  });
  const sideItems = [
    { label: "LLM Client", y: 1.8 },
    { label: "SubagentManager", y: 2.5 },
    { label: "SessionManager", y: 3.2 },
    { label: "SearchEngine", y: 3.9 },
  ];
  sideItems.forEach((si) => {
    s.addShape(pres.shapes.RECTANGLE, { x: 7.3, y: si.y, w: 2.2, h: 0.5, fill: { color: C.bg2 }, line: { color: C.accent, width: 1 } });
    s.addText(si.label, { x: 7.3, y: si.y, w: 2.2, h: 0.5, fontSize: 11, color: C.accent2, align: "center", valign: "middle", margin: 0 });
  });
  addPageNum(s, 5, TOTAL);
}

// SLIDE 6: Agent Loop
{
  const s = darkSlide();
  addTitleBar(s, "Agent Loop — ReAct 核心解析");
  s.addText("Agent Loop 是整个系统的心脏，实现经典的 ReAct 模式", { x: 0.6, y: 1.1, w: 8.8, h: 0.4, fontSize: 14, color: C.muted, margin: 0 });
  const steps = [
    { label: "Reason\n(思考)", desc: "LLM 分析任务\n制定行动计划", color: "0EA5E9", x: 0.8 },
    { label: "Act\n(行动)", desc: "调用工具执行\n搜索/读文件/命令", color: "0369A1", x: 3.8 },
    { label: "Observe\n(观察)", desc: "接收工具结果\n作为新上下文", color: "0284C7", x: 6.8 },
  ];
  steps.forEach((st) => {
    s.addShape(pres.shapes.RECTANGLE, { x: st.x, y: 1.8, w: 2.4, h: 2.2, fill: { color: C.bg2 }, shadow: mkShadow() });
    s.addShape(pres.shapes.RECTANGLE, { x: st.x, y: 1.8, w: 2.4, h: 0.06, fill: { color: st.color } });
    s.addText(st.label, { x: st.x + 0.15, y: 1.95, w: 2.1, h: 0.8, fontSize: 18, fontFace: "Georgia", color: st.color, bold: true, align: "center", valign: "middle", margin: 0 });
    s.addText(st.desc, { x: st.x + 0.15, y: 2.85, w: 2.1, h: 0.8, fontSize: 12, color: C.muted, align: "center", valign: "middle", margin: 0 });
  });
  s.addText("→", { x: 3.3, y: 2.5, w: 0.5, h: 0.5, fontSize: 28, color: C.accent, align: "center", valign: "middle", margin: 0 });
  s.addText("→", { x: 6.3, y: 2.5, w: 0.5, h: 0.5, fontSize: 28, color: C.accent, align: "center", valign: "middle", margin: 0 });
  s.addShape(pres.shapes.RECTANGLE, { x: 2.0, y: 4.2, w: 6, h: 0.04, fill: { color: C.muted, transparency: 50 } });
  s.addText("← 循环直到任务完成 →", { x: 2.5, y: 4.3, w: 5, h: 0.3, fontSize: 10, color: C.muted, align: "center", margin: 0 });
  const features = ["自主循环：不断迭代处理不确定性任务", "可解释性：思考过程实时输出", "错误自我修正：根据结果主动调整策略", "安全控制：危险操作需人工审批"];
  features.forEach((f, i) => {
    s.addText(f, { x: 0.6, y: 4.8 + i * 0.22, w: 8.8, h: 0.22, fontSize: 10, color: C.muted, bullet: true, margin: 0 });
  });
  addPageNum(s, 6, TOTAL);
}

// SLIDE 7: Execution Flow
{
  const s = darkSlide();
  addTitleBar(s, "典型执行流程");
  const flow = [
    { step: "1", title: "接收输入", desc: "readline 读取用户输入" },
    { step: "2", title: "构建系统提示词", desc: "SOUL.md + 工具定义 + 记忆" },
    { step: "3", title: "恢复历史消息", desc: "从 JSONL 加载会话历史" },
    { step: "4", title: "上下文压缩", desc: "LLM 摘要 + token 裁剪" },
    { step: "5", title: "ReAct 循环", desc: "LLM 推理 → 工具调用 → 观察" },
    { step: "6", title: "最终回复", desc: "输出结果给用户" },
  ];
  flow.forEach((f, i) => {
    const y = 1.2 + i * 0.7;
    s.addShape(pres.shapes.RECTANGLE, { x: 0.8, y: y, w: 0.5, h: 0.5, fill: { color: C.accent }, shadow: mkShadow() });
    s.addText(f.step, { x: 0.8, y: y, w: 0.5, h: 0.5, fontSize: 16, fontFace: "Georgia", color: C.white, bold: true, align: "center", valign: "middle", margin: 0 });
    s.addText(f.title, { x: 1.5, y: y, w: 3, h: 0.3, fontSize: 14, color: C.text, bold: true, valign: "middle", margin: 0 });
    s.addText(f.desc, { x: 1.5, y: y + 0.3, w: 7.5, h: 0.25, fontSize: 11, color: C.muted, margin: 0 });
    if (i < 5) {
      s.addText("▼", { x: 0.9, y: y + 0.5, w: 0.3, h: 0.2, fontSize: 10, color: C.accent, align: "center", margin: 0 });
    }
  });
  addPageNum(s, 7, TOTAL);
}

// SLIDE 8: Tool System
{
  const s = darkSlide();
  addTitleBar(s, "工具系统 — Agent 的手脚");
  const tools = [
    { name: "bash", desc: "执行终端命令", detail: "spawn() 流式输出\ncwd/timeout", color: "0EA5E9" },
    { name: "read_file", desc: "读取文件内容", detail: "offset/limit\n二进制检测", color: "0284C7" },
    { name: "write_file", desc: "创建/覆写文件", detail: "自动创建父目录\n输出写入字节数", color: "0369A1" },
    { name: "edit_file", desc: "精确编辑文件", detail: "查找替换\n唯一性校验", color: "075985" },
  ];
  tools.forEach((t, i) => {
    const x = 0.6 + i * 2.35;
    s.addShape(pres.shapes.RECTANGLE, { x: x, y: 1.3, w: 2.15, h: 3.0, fill: { color: C.bg2 }, shadow: mkShadow() });
    s.addShape(pres.shapes.RECTANGLE, { x: x, y: 1.3, w: 2.15, h: 0.06, fill: { color: t.color } });
    s.addText(t.name, { x: x + 0.1, y: 1.5, w: 1.95, h: 0.4, fontSize: 16, fontFace: "Consolas", color: t.color, bold: true, align: "center", margin: 0 });
    s.addText(t.desc, { x: x + 0.1, y: 2.0, w: 1.95, h: 0.3, fontSize: 12, color: C.text, bold: true, align: "center", margin: 0 });
    s.addText(t.detail, { x: x + 0.15, y: 2.5, w: 1.85, h: 1.2, fontSize: 10, color: C.muted, align: "center", valign: "middle", margin: 0 });
  });
  s.addText("权限策略", { x: 0.6, y: 4.6, w: 1.5, h: 0.3, fontSize: 13, fontFace: "Georgia", color: C.accent2, bold: true, margin: 0 });
  const perms = [
    { label: "LOW", items: "read / ls / git status", color: C.safe },
    { label: "MED", items: "write / edit / npm install", color: C.warn },
    { label: "HIGH", items: "rm / del — 需人工审批", color: C.danger },
  ];
  perms.forEach((p, i) => {
    const x = 2.3 + i * 2.6;
    s.addShape(pres.shapes.OVAL, { x: x, y: 4.55, w: 0.3, h: 0.3, fill: { color: p.color } });
    s.addText(p.label, { x: x + 0.35, y: 4.55, w: 0.6, h: 0.3, fontSize: 10, fontFace: "Consolas", color: p.color, bold: true, valign: "middle", margin: 0 });
    s.addText(p.items, { x: x + 0.35, y: 4.8, w: 2.2, h: 0.25, fontSize: 9, color: C.muted, margin: 0 });
  });
  addPageNum(s, 8, TOTAL);
}

// SLIDE 9: Tool Pipeline
{
  const s = darkSlide();
  addTitleBar(s, "工具执行流水线");
  const pipeline = [
    { step: "1", label: "参数校验", desc: "ajv JSON Schema" },
    { step: "2", label: "Before Hooks", desc: "可修改/拒绝" },
    { step: "3", label: "权限检查", desc: "白名单+黑名单" },
    { step: "4", label: "人工审批", desc: "高风险暂停" },
    { step: "5", label: "工具执行", desc: "实际操作" },
    { step: "6", label: "After Hooks", desc: "审计+处理" },
    { step: "7", label: "注入防护", desc: "REDACTED" },
  ];
  pipeline.forEach((p, i) => {
    const x = 0.3 + i * 1.37;
    s.addShape(pres.shapes.RECTANGLE, { x: x, y: 1.5, w: 1.17, h: 2.8, fill: { color: C.bg2 }, shadow: mkShadow() });
    s.addShape(pres.shapes.RECTANGLE, { x: x, y: 1.5, w: 1.17, h: 0.06, fill: { color: C.accent } });
    s.addText(p.step, { x: x, y: 1.65, w: 1.17, h: 0.4, fontSize: 22, fontFace: "Georgia", color: C.accent2, bold: true, align: "center", margin: 0 });
    s.addText(p.label, { x: x + 0.05, y: 2.15, w: 1.07, h: 0.4, fontSize: 11, color: C.text, bold: true, align: "center", valign: "middle", margin: 0 });
    s.addText(p.desc, { x: x + 0.05, y: 2.6, w: 1.07, h: 0.4, fontSize: 9, color: C.muted, align: "center", valign: "middle", margin: 0 });
    if (i < 6) {
      s.addText("→", { x: x + 1.17, y: 2.5, w: 0.2, h: 0.3, fontSize: 14, color: C.accent, align: "center", valign: "middle", margin: 0 });
    }
  });
  s.addText("ToolRegistry.execute() — 统一执行入口，所有工具调用都经过这 7 个步骤", { x: 0.6, y: 4.7, w: 8.8, h: 0.4, fontSize: 13, color: C.muted, italic: true, align: "center", margin: 0 });
  addPageNum(s, 9, TOTAL);
}

// SLIDE 10: LLM Layer
{
  const s = darkSlide();
  addTitleBar(s, "大模型层 — 统一适配");
  s.addText("采用 OpenAI 兼容格式，一套代码适配所有模型提供商", { x: 0.6, y: 1.1, w: 8.8, h: 0.4, fontSize: 14, color: C.accent2, bold: true, margin: 0 });
  const models = [
    { type: "云端 API", list: "MiniMax M2.7 / DeepSeek / Kimi\nClaude / GPT / 通义千问", feature: "性能强，即开即用", color: "0EA5E9" },
    { type: "本地私有", list: "Ollama + Qwen3.5-32B\nDeepSeek 本地部署", feature: "数据隐私，零成本", color: "0369A1" },
    { type: "混合调度", list: "简单任务 → 本地\n复杂任务 → 云端", feature: "智能路由", color: "0284C7" },
  ];
  models.forEach((m, i) => {
    const x = 0.6 + i * 3.1;
    s.addShape(pres.shapes.RECTANGLE, { x: x, y: 1.7, w: 2.9, h: 2.5, fill: { color: C.bg2 }, shadow: mkShadow() });
    s.addShape(pres.shapes.RECTANGLE, { x: x, y: 1.7, w: 2.9, h: 0.06, fill: { color: m.color } });
    s.addText(m.type, { x: x + 0.1, y: 1.85, w: 2.7, h: 0.35, fontSize: 16, fontFace: "Georgia", color: m.color, bold: true, align: "center", margin: 0 });
    s.addText(m.list, { x: x + 0.15, y: 2.3, w: 2.6, h: 1.0, fontSize: 11, color: C.muted, align: "center", valign: "middle", margin: 0 });
    s.addText(m.feature, { x: x + 0.15, y: 3.5, w: 2.6, h: 0.3, fontSize: 10, color: C.accent2, align: "center", margin: 0 });
  });
  s.addShape(pres.shapes.RECTANGLE, { x: 0.6, y: 4.5, w: 8.8, h: 0.8, fill: { color: "000000" } });
  s.addText("LLMClient.chat(messages, tools, onDelta?)  —  切换模型只需改配置", { x: 0.8, y: 4.5, w: 8.4, h: 0.8, fontSize: 12, fontFace: "Consolas", color: C.accent2, valign: "middle", margin: 0 });
  addPageNum(s, 10, TOTAL);
}

// SLIDE 11: Memory System
{
  const s = darkSlide();
  addTitleBar(s, "记忆系统");
  s.addShape(pres.shapes.RECTANGLE, { x: 0.6, y: 1.3, w: 4.2, h: 3.6, fill: { color: "000000" }, shadow: mkShadow() });
  s.addShape(pres.shapes.RECTANGLE, { x: 0.6, y: 1.3, w: 4.2, h: 0.06, fill: { color: C.accent } });
  s.addText("MEMORY.md 结构化记忆", { x: 0.7, y: 1.4, w: 4, h: 0.3, fontSize: 12, color: C.accent2, bold: true, margin: 0 });
  s.addText([
    { text: "# 长期记忆", options: { breakLine: true, fontSize: 9, fontFace: "Consolas", color: C.muted } },
    { text: "", options: { breakLine: true, fontSize: 6, color: C.muted } },
    { text: "## 偏好", options: { breakLine: true, fontSize: 9, fontFace: "Consolas", color: C.text } },
    { text: "[P001] 用户偏好 pnpm (2026-03-28)", options: { breakLine: true, fontSize: 9, fontFace: "Consolas", color: C.accent2 } },
    { text: "", options: { breakLine: true, fontSize: 6, color: C.muted } },
    { text: "## 技术决策", options: { breakLine: true, fontSize: 9, fontFace: "Consolas", color: C.text } },
    { text: "[T001] TypeScript strict 模式", options: { breakLine: true, fontSize: 9, fontFace: "Consolas", color: C.accent2 } },
    { text: "", options: { breakLine: true, fontSize: 6, color: C.muted } },
    { text: "## 待办", options: { breakLine: true, fontSize: 9, fontFace: "Consolas", color: C.text } },
    { text: "[D001] 实现向量搜索模块", options: { breakLine: true, fontSize: 9, fontFace: "Consolas", color: C.accent2 } },
    { text: "", options: { breakLine: true, fontSize: 6, color: C.muted } },
    { text: "## 知识", options: { breakLine: true, fontSize: 9, fontFace: "Consolas", color: C.text } },
    { text: "[K001] FirmClaw 使用 ReAct 架构", options: { fontSize: 9, fontFace: "Consolas", color: C.accent2 } },
  ], { x: 0.8, y: 1.8, w: 3.8, h: 3.0, valign: "top", margin: 0 });
  s.addShape(pres.shapes.RECTANGLE, { x: 5.2, y: 1.3, w: 4.2, h: 3.6, fill: { color: C.bg2 }, shadow: mkShadow() });
  s.addShape(pres.shapes.RECTANGLE, { x: 5.2, y: 1.3, w: 4.2, h: 0.06, fill: { color: C.accent } });
  s.addText("BM25 全文搜索", { x: 5.3, y: 1.4, w: 4, h: 0.3, fontSize: 12, color: C.accent2, bold: true, margin: 0 });
  const searchItems = ["纯 JS 实现，零原生依赖", "中文 bigram 分词", "索引覆盖会话 + 记忆", "搜索结果动态注入提示词", "支持跨会话信息引用"];
  searchItems.forEach((si, i) => {
    s.addText(si, { x: 5.4, y: 1.9 + i * 0.35, w: 3.8, h: 0.3, fontSize: 11, color: C.muted, bullet: true, margin: 0 });
  });
  s.addText("检索流程", { x: 5.3, y: 3.8, w: 4, h: 0.3, fontSize: 12, color: C.text, bold: true, margin: 0 });
  s.addText("用户输入 → SearchEngine.search() → 注入 {{memory}}", { x: 5.4, y: 4.1, w: 3.8, h: 0.5, fontSize: 10, fontFace: "Consolas", color: C.accent2, margin: 0 });
  addPageNum(s, 11, TOTAL);
}

// SLIDE 12: Security
{
  const s = darkSlide();
  addTitleBar(s, "安全与审计");
  const secCards = [
    { title: "人工审批", icon: "HITL", items: ["Promise + 回调异步等待", "Agent Loop 暂停", "CLI 用户输入恢复", "风险分级审批"], color: "EF4444" },
    { title: "Injection 防护", icon: "GUARD", items: ["正则匹配扫描结果", "系统提示词劫持检测", "角色扮演攻击拦截", "标记净化 [REDACTED]"], color: "F59E0B" },
    { title: "审计日志", icon: "AUDIT", items: ["全量操作 append-only", "~/.firmclaw/audit.jsonl", "支持查询与 CSV 导出", "记录参数/风险/耗时"], color: "0EA5E9" },
  ];
  secCards.forEach((card, i) => {
    const x = 0.6 + i * 3.1;
    s.addShape(pres.shapes.RECTANGLE, { x: x, y: 1.3, w: 2.9, h: 3.5, fill: { color: C.bg2 }, shadow: mkShadow() });
    s.addShape(pres.shapes.RECTANGLE, { x: x, y: 1.3, w: 2.9, h: 0.06, fill: { color: card.color } });
    s.addShape(pres.shapes.RECTANGLE, { x: x + 0.8, y: 1.55, w: 1.3, h: 0.4, fill: { color: card.color } });
    s.addText(card.icon, { x: x + 0.8, y: 1.55, w: 1.3, h: 0.4, fontSize: 11, fontFace: "Consolas", color: C.white, bold: true, align: "center", valign: "middle", margin: 0 });
    s.addText(card.title, { x: x + 0.1, y: 2.1, w: 2.7, h: 0.35, fontSize: 15, fontFace: "Georgia", color: C.text, bold: true, align: "center", margin: 0 });
    card.items.forEach((item, j) => {
      s.addText(item, { x: x + 0.2, y: 2.6 + j * 0.5, w: 2.5, h: 0.35, fontSize: 10, color: C.muted, bullet: true, margin: 0 });
    });
  });
  addPageNum(s, 12, TOTAL);
}

// SLIDE 13: Context Management
{
  const s = darkSlide();
  addTitleBar(s, "上下文管理 — 三级压缩策略");
  s.addText("长对话场景下的生存机制", { x: 0.6, y: 1.1, w: 8.8, h: 0.4, fontSize: 14, color: C.muted, margin: 0 });
  const strategies = [
    { level: "L1", title: "LLM 摘要压缩", effect: "50条消息 → ~2000 token", detail: "保留语义和关键决策，压缩比 93%", color: "0EA5E9" },
    { level: "L2", title: "工具结果截断", effect: "单条 > 500 token 截断", detail: "减少冗余输出，保留关键信息", color: "0369A1" },
    { level: "L3", title: "旧消息移除", effect: "整体超限时移除", detail: "从最早消息开始，确保窗口不溢出", color: "075985" },
  ];
  strategies.forEach((st, i) => {
    const y = 1.7 + i * 1.2;
    s.addShape(pres.shapes.RECTANGLE, { x: 0.6, y: y, w: 8.8, h: 1.0, fill: { color: C.bg2 }, shadow: mkShadow() });
    s.addShape(pres.shapes.RECTANGLE, { x: 0.6, y: y, w: 0.8, h: 1.0, fill: { color: st.color } });
    s.addText(st.level, { x: 0.6, y: y, w: 0.8, h: 0.5, fontSize: 22, fontFace: "Georgia", color: C.white, bold: true, align: "center", valign: "middle", margin: 0 });
    s.addText("优先级", { x: 0.6, y: y + 0.5, w: 0.8, h: 0.4, fontSize: 9, color: "E0F2FE", align: "center", margin: 0 });
    s.addText(st.title, { x: 1.6, y: y + 0.05, w: 3, h: 0.35, fontSize: 15, color: C.text, bold: true, valign: "middle", margin: 0 });
    s.addText(st.effect, { x: 1.6, y: y + 0.45, w: 3, h: 0.3, fontSize: 11, color: C.accent2, margin: 0 });
    s.addText(st.detail, { x: 5.0, y: y + 0.1, w: 4.2, h: 0.8, fontSize: 12, color: C.muted, valign: "middle", margin: 0 });
  });
  addPageNum(s, 13, TOTAL);
}

// SLIDE 14: Gateway & Subagent
{
  const s = darkSlide();
  addTitleBar(s, "网关层与子智能体");
  s.addText("WebSocket 服务器", { x: 0.6, y: 1.1, w: 4, h: 0.35, fontSize: 16, fontFace: "Georgia", color: C.accent2, bold: true, margin: 0 });
  s.addText("JSON-RPC 2.0 协议 | ws 库 | 事件推送", { x: 0.6, y: 1.5, w: 4.5, h: 0.3, fontSize: 11, color: C.muted, margin: 0 });
  const rpcMethods = ["agent.chat — 发送消息", "session.list / new / resume — 会话管理", "approval.respond — 响应审批", "agent.cancel — 取消执行"];
  rpcMethods.forEach((m, i) => {
    s.addText(m, { x: 0.8, y: 1.9 + i * 0.3, w: 4, h: 0.25, fontSize: 10, fontFace: "Consolas", color: C.muted, bullet: true, margin: 0 });
  });
  s.addShape(pres.shapes.RECTANGLE, { x: 5.2, y: 1.1, w: 4.2, h: 3.2, fill: { color: C.bg2 }, shadow: mkShadow() });
  s.addShape(pres.shapes.RECTANGLE, { x: 5.2, y: 1.1, w: 4.2, h: 0.06, fill: { color: C.accent } });
  s.addText("子智能体 (Subagent)", { x: 5.3, y: 1.2, w: 4, h: 0.3, fontSize: 14, fontFace: "Georgia", color: C.accent2, bold: true, margin: 0 });
  const subFeatures = ["复杂任务拆分并行执行", "独立 AgentLoop 实例", "默认只读（工具白名单）", "maxSubagents + timeoutMs 限制", "不共享父会话审批状态"];
  subFeatures.forEach((sf, i) => {
    s.addText(sf, { x: 5.4, y: 1.65 + i * 0.35, w: 3.8, h: 0.3, fontSize: 11, color: C.muted, bullet: true, margin: 0 });
  });
  s.addText("事件推送", { x: 0.6, y: 4.6, w: 2, h: 0.3, fontSize: 13, fontFace: "Georgia", color: C.text, bold: true, margin: 0 });
  const events = ["thinking_delta → 实时思考", "tool_start / tool_end → 工具状态", "approval_requested → 审批请求"];
  events.forEach((e, i) => {
    s.addText(e, { x: 2.8, y: 4.6 + i * 0.25, w: 6, h: 0.25, fontSize: 10, fontFace: "Consolas", color: C.accent2, margin: 0 });
  });
  addPageNum(s, 14, TOTAL);
}

// SLIDE 15: Summary
{
  const s = darkSlide();
  addTitleBar(s, "技术选型与总结");
  s.addText("仅 6 个外部依赖", { x: 0.6, y: 1.1, w: 4, h: 0.35, fontSize: 14, color: C.accent2, bold: true, margin: 0 });
  const deps = [
    ["openai", "LLM 接入"], ["ajv", "参数校验"], ["ws", "WebSocket"],
    ["dotenv", "环境变量"], ["tsx", "TS 运行"], ["typescript", "类型系统"],
  ];
  deps.forEach((d, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 0.6 + col * 1.5;
    const y = 1.6 + row * 0.5;
    s.addShape(pres.shapes.RECTANGLE, { x: x, y: y, w: 1.3, h: 0.4, fill: { color: C.bg2 }, line: { color: C.accent, width: 0.5 } });
    s.addText(d[0], { x: x, y: y, w: 1.3, h: 0.25, fontSize: 10, fontFace: "Consolas", color: C.accent2, bold: true, align: "center", margin: 0 });
    s.addText(d[1], { x: x, y: y + 0.2, w: 1.3, h: 0.2, fontSize: 8, color: C.muted, align: "center", margin: 0 });
  });
  s.addText("6 阶段渐进演进", { x: 5.2, y: 1.1, w: 4, h: 0.35, fontSize: 14, color: C.accent2, bold: true, margin: 0 });
  const phases = [
    ["P1 v1.0", "最小 ReAct"], ["P2 v1.6", "4 工具+权限"], ["P3 v2.4", "会话+上下文"],
    ["P4 v3.4", "记忆+搜索"], ["P5 v5.0", "安全+审计"], ["P6 v6.0", "网关+Web UI"],
  ];
  phases.forEach((p, i) => {
    const x = 5.2 + (i % 2) * 2.2;
    const y = 1.6 + Math.floor(i / 2) * 0.5;
    s.addShape(pres.shapes.OVAL, { x: x, y: y + 0.05, w: 0.22, h: 0.22, fill: { color: C.safe } });
    s.addText(p[0], { x: x + 0.3, y: y, w: 0.8, h: 0.3, fontSize: 9, fontFace: "Consolas", color: C.accent2, bold: true, valign: "middle", margin: 0 });
    s.addText(p[1], { x: x + 1.1, y: y, w: 1, h: 0.3, fontSize: 9, color: C.muted, valign: "middle", margin: 0 });
  });
  s.addShape(pres.shapes.RECTANGLE, { x: 0.6, y: 3.3, w: 8.8, h: 0.04, fill: { color: C.accent, transparency: 50 } });
  s.addText("核心架构", { x: 0.6, y: 3.5, w: 4, h: 0.35, fontSize: 15, fontFace: "Georgia", color: C.text, bold: true, margin: 0 });
  s.addText("一个基于 ReAct 循环的 LLM 工具调用引擎，以本地网关 + 工具系统 + 持久化记忆的组合作为标准蓝图。", { x: 0.6, y: 3.9, w: 8.8, h: 0.5, fontSize: 13, color: C.muted, italic: true, margin: 0 });
  const keywords = ["渐进式架构", "零外部依赖策略", "全面安全机制", "生产级可靠性"];
  keywords.forEach((kw, i) => {
    s.addShape(pres.shapes.RECTANGLE, { x: 0.6 + i * 2.35, y: 4.6, w: 2.15, h: 0.4, fill: { color: C.accent } });
    s.addText(kw, { x: 0.6 + i * 2.35, y: 4.6, w: 2.15, h: 0.4, fontSize: 11, color: C.white, bold: true, align: "center", valign: "middle", margin: 0 });
  });
  addPageNum(s, 15, TOTAL);
}

pres.writeFile({ fileName: "D:\\code\\FirmClaw\\FirmClaw技术架构.pptx" }).then(() => {
  console.log("PPTX generated successfully!");
}).catch(err => {
  console.error("Error:", err);
});
