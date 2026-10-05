import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const stateFile = path.join(repository, "test-results", "compose-state.json");

/**
 * Run Docker with visible output when a setup step fails.
 * @param {string[]} args Arguments passed directly to the Docker program.
 * @param {NodeJS.ProcessEnv} env Environment shared by Docker and Compose.
 * @param {boolean} [allowFailure] Whether cleanup may continue after this command fails.
 */
function docker(args, env, allowFailure = false) {
  const result = spawnSync("docker", args, {
    cwd: repository,
    env,
    encoding: "utf8",
    stdio: allowFailure ? "pipe" : "inherit",
  });

  if (!allowFailure && result.status !== 0) {
    throw new Error(`docker ${args.join(" ")} failed with exit code ${result.status}`);
  }

  return result;
}

/** Start an isolated nginx and API stub before Playwright opens its browsers. */
export default async function globalSetup() {
  // Unique names prevent the smoke test from joining or deleting a developer's normal
  // workforce-ops network. Port 8080 remains fixed because it is the public contract.
  const suffix = randomBytes(4).toString("hex");
  const project = `workforce-ops-frontend-it-${suffix}`;
  const network = `${project}-shared`;
  const env = {
    ...process.env,
    FRONTEND_PORT: "8080",
    SHARED_NETWORK: network,
  };

  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify({ project, network }), "utf8");

  try {
    docker(["network", "create", network], env);
    docker(
      [
        "compose",
        "--project-name",
        project,
        "--profile",
        "integration",
        "up",
        "--detach",
        "--build",
        "--wait",
        "--wait-timeout",
        "180",
      ],
      env,
    );
  } catch (error) {
    // Logs make a failed CI start understandable without rerunning it locally.
    docker(["compose", "--project-name", project, "logs", "--no-color"], env, true);
    docker(["compose", "--project-name", project, "down", "--remove-orphans"], env, true);
    docker(["network", "rm", network], env, true);
    throw error;
  }
}
