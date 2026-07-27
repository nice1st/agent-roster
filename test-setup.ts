import pkg from "./package.json";

// bun은 engines.bun을 강제하지 않는다 — 테스트 진입 시 직접 검증한다.
const expected = pkg.engines.bun;
if (Bun.version !== expected) {
  throw new Error(`Bun ${expected} 필요 — 현재 ${Bun.version}. package.json engines.bun 기준.`);
}
