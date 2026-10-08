// PreToolUse guard: while a type or learn session's game server is running, solution code should reach
// the project only through the game. A Write/Edit into the project (outside .line-by-line/) is escalated
// to the user instead of happening silently. Everything else passes through untouched.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const SESSION_DIR = ".line-by-line";

function activeSessions(root) {
  const base = join(root, SESSION_DIR);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      try {
        const { pid } = JSON.parse(readFileSync(join(base, d.name, "ACTIVE"), "utf8"));
        process.kill(pid, 0); // throws if the server is gone, so a crashed session never blocks anything
        return d.name;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

let input = "";
for await (const chunk of process.stdin) input += chunk;
try {
  const event = JSON.parse(input);
  const root = resolve(process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd());
  const target = event.tool_input?.file_path ?? event.tool_input?.notebook_path;
  if (target) {
    const full = isAbsolute(target) ? target : resolve(event.cwd || root, target);
    const rel = relative(root, full);
    const inProject = rel && !rel.startsWith("..") && !isAbsolute(rel);
    const inSessionData = rel === SESSION_DIR || rel.startsWith(SESSION_DIR + sep);
    const sessions = inProject && !inSessionData ? activeSessions(root) : [];
    if (sessions.length) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "ask",
            permissionDecisionReason:
              `A line-by-line session (${sessions.join(", ")}) is running: the user is writing this code themselves, ` +
              `and finished files reach the project through the game. Claude should work in .line-by-line/<session>/worktree instead. ` +
              `Approve only if you asked for this edit.`,
          },
        }),
      );
    }
  }
} catch {
  // Never break the user's session over a guard problem.
}
