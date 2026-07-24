// 云就绪接缝②③（系统规范 §2）：存储 Repository + ownerId 租户维度。
//
// 现在：FileSystemProjectRepository 内部沿用 lib/storage.ts 的既有逻辑，
//       ownerId="local" 时落盘路径与今天完全一致（旧数据零迁移）。
// 未来：换 DB / 对象存储实现，只需再实现一个 ProjectRepository。
//
// 契约冻结（阶段 0）——两个子会话（后端 / 客户端）都以此接口为准，勿改签名。
// Sub A（后端）负责：让 app/api 与工具层统一经此接口访问数据、加固实现。

import type { Project } from "./types";
import {
  listProjects as fsListProjects,
  getProject as fsGetProject,
  saveProject as fsSaveProject,
  deleteProject as fsDeleteProject,
} from "./storage";

// 本地单用户固定租户 id（接缝③）。未来上云换成真实登录用户 id。
export const LOCAL_OWNER = "local" as const;

export interface ProjectRepository {
  list(ownerId: string): Promise<Project[]>;
  get(ownerId: string, id: string): Promise<Project | null>;
  save(ownerId: string, project: Project): Promise<Project>;
  delete(ownerId: string, id: string): Promise<void>;
}

// 文件系统实现：当前唯一实现。ownerId="local" 直接命中现有 data/projects/*.json，
// 因此对现有桌面用户零数据迁移（系统规范 §6 硬约束）。
// 注意：ownerId 目前仅用于占位与鉴权前置；多租户隔离在上云时再落地。
export class FileSystemProjectRepository implements ProjectRepository {
  async list(_ownerId: string): Promise<Project[]> {
    return fsListProjects();
  }

  async get(_ownerId: string, id: string): Promise<Project | null> {
    return fsGetProject(id);
  }

  async save(_ownerId: string, project: Project): Promise<Project> {
    return fsSaveProject(project);
  }

  async delete(_ownerId: string, id: string): Promise<void> {
    return fsDeleteProject(id);
  }
}

// 默认仓库单例：服务端各处统一从这里取，未来上云在此处切换实现。
export const projectRepository: ProjectRepository = new FileSystemProjectRepository();
