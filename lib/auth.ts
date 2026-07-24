// 云就绪接缝⑤（系统规范 §2）：Auth 中间件接缝。
//
// 现在：no-op —— 直接放行本地单用户，并注入固定租户 ownerId="local"。
// 未来上云：在此换成真实鉴权（校验会话 / Token），解析出登录用户的 id，
//           下游 Repository 便据此做多租户隔离，业务代码无需改动。
//
// 归属：Sub A（后端）。所有需要 ownerId 的服务端入口（API 路由 / Agent 运行时）
//       都应经此函数取得鉴权上下文，而不是各自硬编码 "local"。

import { LOCAL_OWNER } from "./repository";

export interface AuthContext {
  ownerId: string;
}

// 解析请求的鉴权上下文。当前实现忽略请求内容，恒定返回本地租户。
// 保留 req 形参是为了上云时能从 header / cookie 中解析真实用户，签名不变。
export async function resolveAuth(_req?: Request): Promise<AuthContext> {
  return { ownerId: LOCAL_OWNER };
}
