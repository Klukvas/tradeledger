import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, ApplicationErrorBoundary } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Не найден корневой элемент приложения.");

createRoot(root).render(
  <StrictMode>
    <ApplicationErrorBoundary>
      <App />
    </ApplicationErrorBoundary>
  </StrictMode>,
);
