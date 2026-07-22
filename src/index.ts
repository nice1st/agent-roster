import { startServer } from "./server";

if (import.meta.main) {
  const server = startServer({ port: 3000 });
  console.log(`agent-orchestra listening on ${server.url}`);
}
