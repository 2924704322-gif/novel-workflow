// prompts.ts 纯函数单测：extractJson 从模型输出中抽取 JSON 的鲁棒性。
import { describe, it, expect } from "vitest";
import { extractJson } from "./prompts";

describe("extractJson（从模型输出抽取 JSON）", () => {
  it("直接解析纯 JSON 字符串", () => {
    expect(extractJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it("剥离 ```json 围栏", () => {
    const text = "好的，结果是：\n```json\n{\"name\":\"苏沉\"}\n```\n以上。";
    expect(extractJson<{ name: string }>(text)).toEqual({ name: "苏沉" });
  });

  it("兼容无语言标注的 ``` 围栏", () => {
    const text = "```\n{\"ok\":true}\n```";
    expect(extractJson<{ ok: boolean }>(text)).toEqual({ ok: true });
  });

  it("容忍前后多余文本与换行", () => {
    const text = "思考过程……\n最终结果如下：\n{\"tags\":[\"a\",\"b\"],\"n\":2}\n请参考。";
    expect(extractJson<{ tags: string[]; n: number }>(text)).toEqual({
      tags: ["a", "b"],
      n: 2,
    });
  });

  it("取最外层对象（首 { 到末 }，支持嵌套）", () => {
    const text = '前缀 {"outer":{"inner":{"x":1}}} 后缀';
    // 设计上取第一个 { 到最后一个 }，即整个最外层对象
    expect(extractJson<{ outer: { inner: { x: number } } }>(text)).toEqual({
      outer: { inner: { x: 1 } },
    });
  });

  it("含转义引号与中文也能正确解析", () => {
    const text = '{"line":"他说：\\"你好\\"","who":"林惊蛰"}';
    expect(extractJson<{ line: string; who: string }>(text)).toEqual({
      line: '他说："你好"',
      who: "林惊蛰",
    });
  });

  it("无 JSON 时抛出可读错误", () => {
    expect(() => extractJson("这里没有任何 JSON 结构")).toThrow();
  });
});
