import { redirect } from "next/navigation";

// Q7 深链兼容：旧 /project/[id] 工作台路由已废弃（Workspace 废弃，FT-03/Q6），
// 重定向到 Studio 的 ?book=<id> 形式，由 StudioShell 读取参数并打开该书详情。
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/?book=${encodeURIComponent(id)}`);
}
