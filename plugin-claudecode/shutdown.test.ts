import { expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { BrokerConnection } from "../client-core/broker-client";
import { createShutdown, wireShutdown } from "./server";

function setUp(conn: BrokerConnection | null) {
  const exit = mock((_code: number) => {});
  const stdin = new EventEmitter();
  const proc = new EventEmitter();
  const shutdown = createShutdown({ getConnection: () => conn, exit });
  wireShutdown(shutdown, stdin, proc);
  return { exit, stdin, proc };
}

function fakeConnection() {
  const close = mock(() => {});
  const conn: BrokerConnection = { uuid: "test-uuid", close };
  return { conn, close };
}

test("stdin end에서 connection close와 exit이 호출된다", () => {
  const { conn, close } = fakeConnection();
  const { exit, stdin } = setUp(conn);

  stdin.emit("end");

  expect(close).toHaveBeenCalledTimes(1);
  expect(exit).toHaveBeenCalledTimes(1);
  expect(exit).toHaveBeenCalledWith(0);
});

test("stdin close에서도 connection close와 exit이 호출된다", () => {
  const { conn, close } = fakeConnection();
  const { exit, stdin } = setUp(conn);

  stdin.emit("close");

  expect(close).toHaveBeenCalledTimes(1);
  expect(exit).toHaveBeenCalledTimes(1);
});

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
  test(`${signal} 시그널에서도 connection close와 exit이 호출된다`, () => {
    const { conn, close } = fakeConnection();
    const { exit, proc } = setUp(conn);

    proc.emit(signal);

    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });
}

test("중복으로 호출돼도 close·exit은 1회만 실행된다", () => {
  const { conn, close } = fakeConnection();
  const { exit, stdin, proc } = setUp(conn);

  stdin.emit("end");
  stdin.emit("close");
  proc.emit("SIGTERM");

  expect(close).toHaveBeenCalledTimes(1);
  expect(exit).toHaveBeenCalledTimes(1);
});

test("connection이 null이어도 exit은 호출된다", () => {
  const { exit, stdin } = setUp(null);

  stdin.emit("end");

  expect(exit).toHaveBeenCalledTimes(1);
  expect(exit).toHaveBeenCalledWith(0);
});
