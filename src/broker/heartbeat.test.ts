import { expect, test } from "bun:test";
import { runHeartbeatTasks } from "./heartbeat";

test("하트비트가 등록된 작업들을 주기마다 실행한다", () => {
  const calls: string[] = [];
  runHeartbeatTasks([() => calls.push("a"), () => calls.push("b")]);
  expect(calls).toEqual(["a", "b"]);
});

test("한 작업의 예외가 다른 작업 실행을 막지 않는다", () => {
  const calls: string[] = [];
  runHeartbeatTasks([
    () => calls.push("before"),
    () => {
      throw new Error("boom");
    },
    () => calls.push("after"),
  ]);
  expect(calls).toEqual(["before", "after"]);
});
