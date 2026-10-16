import { createRoot } from "react-dom/client";
import { App } from "./App.js";

const root = document.getElementById("root");
if (!root) throw new Error("PIE root element missing");
createRoot(root).render(<App />);
