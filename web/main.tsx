import { createRoot } from "react-dom/client";
import { App } from "./app";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("root 엘리먼트가 없다 — index.html 확인");
}
createRoot(root).render(<App />);
