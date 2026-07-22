import { expect, test } from "bun:test";
import { createSseParser } from "./sse";

test("data 프레임을 JSON으로 돌려준다", () => {
  const parse = createSseParser();
  expect(parse('data: {"type":"registered","uuid":"abc"}\n\n')).toEqual([{ type: "registered", uuid: "abc" }]);
});

test("주석(keepalive) 프레임은 무시한다", () => {
  const parse = createSseParser();
  expect(parse(": keepalive\n\n")).toEqual([]);
});

test("프레임이 청크 경계에 걸쳐 나뉘어도 조립한다", () => {
  const parse = createSseParser();
  const first = parse('data: {"type":"regi');
  expect([...first, ...parse('stered","uuid":"abc"}\n\n')]).toEqual([{ type: "registered", uuid: "abc" }]);
});
