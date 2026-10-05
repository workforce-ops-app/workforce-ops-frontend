import { readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const stateFile = path.join(repository, "test-results", "compose-state.json");

/** Remove only the uniquely named containers and network created by global setup. */
export default async function globalTeardown() {
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  const env = { ...process.env, FRONTEND_PORT: "8080", SHARED_NETWORK: state.network };

  // Cleanup failures are reported, but both commands are attempted so a stopped
  // container cannot prevent removal of the test network on the next run.
  const down = spawnSync(
    "docker",
    ["compose", "--project-name", state.project, "down", "--remove-orphans"],
    { cwd: repository, env, encoding: "utf8", stdio: "inherit" },
  );
  const network = spawnSync("docker", ["network", "rm", state.network], {
    cwd: repository,
    env,
    encoding: "utf8",
    stdio: "inherit",
  });
  await rm(stateFile, { force: true });

  if (down.status !== 0 || network.status !== 0) {
    throw new Error("Playwright passed, but its Docker environment could not be removed");
  }
}
