const { execFileSync, spawn } = require("node:child_process");
const electron = require("electron");

if (process.platform === "win32") {
  try {
    execFileSync("chcp.com", ["65001"], { stdio: "ignore" });
  } catch {
    // The app can still start when no console is attached.
  }
}

const vitePort = process.env.PORT || "5173";
const viteUrl = `http://127.0.0.1:${vitePort}`;

const vite = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", vitePort], {
  shell: true,
  stdio: "inherit",
});

let electronProcess;
let started = false;

const timer = setInterval(async () => {
  if (started) {
    return;
  }

  try {
    const response = await fetch(viteUrl);
    if (!response.ok) {
      return;
    }
  } catch {
    return;
  }

  started = true;
  clearInterval(timer);
  electronProcess = spawn(electron, ["."], {
    env: { ...process.env, VITE_DEV_SERVER_URL: viteUrl },
    stdio: "inherit",
  });
  electronProcess.on("exit", (code) => {
    vite.kill();
    process.exit(code ?? 0);
  });
}, 500);

function shutdown() {
  clearInterval(timer);
  electronProcess?.kill();
  vite.kill();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
