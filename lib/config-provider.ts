// 云就绪接缝④（系统规范 §2）：配置 / 密钥 provider。
//
// 现在：模型密钥仍由客户端（localStorage）随请求 body 携带（沿用现有行为）。
//       本模块把“取得生效 ApiConfig”收敛为一个函数，供 Agent 运行时与工具统一调用。
// 未来上云：在此换成服务端每用户密钥库（按 ownerId 取密钥），
//           调用方无需改动——依旧调用 getEffectiveConfig。
//
// 归属：Sub A（后端）。

import type { ApiConfig } from "./types";
import { validateConfig } from "./llm";

// 取得本次请求生效的 ApiConfig。
// 当前：直接采用客户端携带的 config（可能不完整，由 assertConfig 兜底校验）。
// 未来：忽略/合并客户端 config，改从服务端按 ownerId 取密钥。
export function getEffectiveConfig(
  requestConfig?: Partial<ApiConfig>,
  _ownerId?: string
): ApiConfig {
  return { ...(requestConfig || {}) } as ApiConfig;
}

// 校验配置完整性；缺字段时抛出可读错误（供路由转成 400 / error 事件）。
export function assertConfig(cfg: Partial<ApiConfig>): ApiConfig {
  const err = validateConfig(cfg);
  if (err) throw new Error(err);
  return cfg as ApiConfig;
}
