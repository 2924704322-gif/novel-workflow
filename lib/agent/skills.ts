// Skill 模块：预置技能注册表（系统规范 §4 阶段三）。
//
// Skill = 智能提示策略：一组约束（系统提示 + 工具白名单 + 用户参数模板），
// 注入现有 Agent 运行时即可——不新建执行引擎。触发后 Agent 在约束内自主
// 编排工具链；无 Skill 约束时 Agent 也可自由多步编排。写操作仍走确认流。

// ---- 类型定义 ---------------------------------------------------------------

export interface SkillParam {
  name: string; // 参数 key（如 "chapterId"）
  label: string; // UI 显示名（如 "目标章节"）
  type: "string" | "select"; // select = 从项目数据动态枚举
  required?: boolean;
  source?: "volumes" | "chapters" | "codex"; // select 时的数据源
}

export interface AgentSkill {
  id: string; // 唯一标识（如 "write-chapter"）
  name: string; // 显示名（如 "一键续写"）
  description: string; // 简述（呈现给用户选择）
  group: "writing" | "planning" | "maintenance"; // 分类
  systemPromptOverride: string; // 注入的指令（追加到默认 system prompt 之后）
  toolWhitelist?: string[]; // 只暴露这些工具给模型；空/undefined = 全部
  params?: SkillParam[]; // 用户需填入的参数
  initialInstruction: (params: Record<string, string>) => string; // 用户参数 → 首条指令
}

// ---- 内置技能 ---------------------------------------------------------------

const writeChapter: AgentSkill = {
  id: "write-chapter",
  name: "一键续写",
  description: "为指定章节自动组装上下文、生成正文并保存。",
  group: "writing",
  toolWhitelist: [
    "get_project",
    "build_chapter_context",
    "generate_chapter",
    "save_project",
  ],
  params: [
    {
      name: "chapterId",
      label: "目标章节",
      type: "select",
      required: true,
      source: "chapters",
    },
  ],
  systemPromptOverride: [
    "你现在执行「一键续写」技能。请严格按以下顺序操作：",
    "1. 调用 build_chapter_context 组装目标章节的三层记忆上下文",
    "2. 调用 generate_chapter 传入 chapterId 生成正文",
    "3. 调用 save_project(fromGenerated:['chapter']) 保存生成结果",
    "不要跳步或增加额外操作。完成后简短告知用户结果（章节标题、字数）。",
  ].join("\n"),
  initialInstruction: (p) =>
    `请为章节 ${p.chapterId} 执行一键续写。`,
};

const writeAndDigest: AgentSkill = {
  id: "write-and-digest",
  name: "续写+归档",
  description: "续写正文后自动提炼摘要并折回设定库。",
  group: "writing",
  toolWhitelist: [
    "get_project",
    "build_chapter_context",
    "generate_chapter",
    "save_project",
    "digest_chapter",
    "apply_digest",
  ],
  params: [
    {
      name: "chapterId",
      label: "目标章节",
      type: "select",
      required: true,
      source: "chapters",
    },
  ],
  systemPromptOverride: [
    "你现在执行「续写+归档」技能。请严格按以下顺序操作：",
    "1. 调用 build_chapter_context 组装目标章节的三层记忆上下文",
    "2. 调用 generate_chapter 生成正文",
    "3. 调用 save_project(fromGenerated:['chapter']) 保存正文",
    "4. 调用 digest_chapter 对该章进行归档提炼",
    "5. 调用 apply_digest 把归档结果折回作品",
    "不要跳步或增加额外操作。完成后简短告知用户结果。",
  ].join("\n"),
  initialInstruction: (p) =>
    `请为章节 ${p.chapterId} 执行续写并归档。`,
};

const planVolumes: AgentSkill = {
  id: "plan-volumes",
  name: "生成分卷",
  description: "根据故事设定集生成全书分卷脉络。",
  group: "planning",
  toolWhitelist: ["get_project", "generate_volumes", "save_project"],
  params: [
    {
      name: "direction",
      label: "调整方向（可空）",
      type: "string",
      required: false,
    },
  ],
  systemPromptOverride: [
    "你现在执行「生成分卷」技能。请严格按以下顺序操作：",
    "1. 调用 get_project 获取当前作品数据",
    "2. 调用 generate_volumes 生成分卷脉络（若用户提供了 direction 则传入）",
    "3. 调用 save_project(fromGenerated:['volumes']) 保存分卷",
    "不要跳步或增加额外操作。完成后简短告知用户结果（卷数、各卷标题）。",
  ].join("\n"),
  initialInstruction: (p) =>
    p.direction
      ? `请生成分卷脉络，调整方向：${p.direction}`
      : "请生成分卷脉络。",
};

const planVolumeDetail: AgentSkill = {
  id: "plan-volume-detail",
  name: "细化单卷",
  description: "将某一卷细化为章节脉络。",
  group: "planning",
  toolWhitelist: ["get_project", "generate_volume", "save_project"],
  params: [
    {
      name: "volumeId",
      label: "目标卷",
      type: "select",
      required: true,
      source: "volumes",
    },
  ],
  systemPromptOverride: [
    "你现在执行「细化单卷」技能。请严格按以下顺序操作：",
    "1. 调用 get_project 获取当前作品数据",
    "2. 调用 generate_volume 传入 volumeId 细化该卷的章节脉络",
    "3. 调用 save_project(fromGenerated:['volume']) 保存结果",
    "不要跳步或增加额外操作。完成后简短告知用户结果（章数、各章标题）。",
  ].join("\n"),
  initialInstruction: (p) =>
    `请细化卷 ${p.volumeId} 的章节脉络。`,
};

const reconcileDownstream: AgentSkill = {
  id: "reconcile-downstream",
  name: "一致性校正",
  description: "上游重生后审阅下游并给出最小必要的一致性校正。",
  group: "maintenance",
  toolWhitelist: ["get_project", "reconcile", "apply_reconcile"],
  params: [
    {
      name: "changeDescription",
      label: "变更描述",
      type: "string",
      required: true,
    },
  ],
  systemPromptOverride: [
    "你现在执行「一致性校正」技能。请严格按以下顺序操作：",
    "1. 调用 get_project 获取当前作品数据",
    "2. 调用 reconcile 传入变更描述，审阅下游并计算最小校正",
    "3. 调用 apply_reconcile 把校正结果折回作品",
    "不要跳步或增加额外操作。完成后简短告知用户校正了哪些内容。",
  ].join("\n"),
  initialInstruction: (p) =>
    `请对以下变更执行一致性校正：${p.changeDescription}`,
};

const generateRecap: AgentSkill = {
  id: "generate-recap",
  name: "滚动前情",
  description: "生成分卷概述或全书 storySoFar 滚动前情。",
  group: "maintenance",
  toolWhitelist: ["get_project", "generate_recap", "save_project"],
  params: [
    {
      name: "mode",
      label: "模式",
      type: "select",
      required: true,
    },
    {
      name: "volumeId",
      label: "目标卷（volume模式）",
      type: "select",
      required: false,
      source: "volumes",
    },
  ],
  systemPromptOverride: [
    "你现在执行「滚动前情」技能。请严格按以下顺序操作：",
    "1. 调用 get_project 获取当前作品数据",
    "2. 调用 generate_recap 生成前情（传入 mode 和 volumeId）",
    "3. 调用 save_project(fromGenerated:['recap']) 保存结果",
    "不要跳步或增加额外操作。完成后简短告知用户前情概要。",
  ].join("\n"),
  initialInstruction: (p) =>
    p.mode === "book"
      ? "请生成全书滚动前情（mode=book）。"
      : `请生成卷 ${p.volumeId} 的滚动前情（mode=volume）。`,
};

// ---- 注册表 -----------------------------------------------------------------

export const SKILLS_REGISTRY: AgentSkill[] = [
  writeChapter,
  writeAndDigest,
  planVolumes,
  planVolumeDetail,
  reconcileDownstream,
  generateRecap,
];

export const SKILLS_BY_ID: Record<string, AgentSkill> = Object.fromEntries(
  SKILLS_REGISTRY.map((s) => [s.id, s])
);
