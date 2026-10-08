import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const SESSION_DIR = ".line-by-line";
const WALK_IGNORE = new Set([".git", "node_modules", SESSION_DIR, ".DS_Store"]);

export function git(cwd, args, opts = {}) {
  return execFileSync("git", ["-C", cwd, ...args], { maxBuffer: 256 * 1024 * 1024, ...opts });
}

export function isGitRepo(dir) {
  try {
    return git(dir, ["rev-parse", "--is-inside-work-tree"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() === "true";
  } catch {
    return false;
  }
}

const notSessionData = (p) => p && p !== SESSION_DIR && !p.startsWith(SESSION_DIR + "/");

/** A directory on disk (the project, or a scratch worktree holding the solution). */
export function dirSource(dir) {
  return {
    kind: "dir",
    path: dir,
    list() {
      if (isGitRepo(dir)) {
        return git(dir, ["ls-files", "-co", "--exclude-standard", "-z"]).toString().split("\0").filter(notSessionData);
      }
      const out = [];
      const walk = (d) => {
        for (const entry of readdirSync(d, { withFileTypes: true })) {
          if (WALK_IGNORE.has(entry.name)) continue;
          const full = join(d, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.isFile()) out.push(relative(dir, full).split(sep).join("/"));
        }
      };
      walk(dir);
      return out;
    },
    read(path) {
      const full = join(dir, path);
      return existsSync(full) && statSync(full).isFile() ? readFileSync(full) : null;
    },
  };
}

/** A commit in a git repository (review mode: the merge-base and HEAD). */
export function gitSource(repo, ref) {
  const sha = git(repo, ["rev-parse", "--verify", `${ref}^{commit}`]).toString().trim();
  return {
    kind: "git",
    ref: sha,
    repo,
    list() {
      return git(repo, ["ls-tree", "-r", "-z", "--name-only", sha]).toString().split("\0").filter(notSessionData);
    },
    read(path) {
      try {
        return git(repo, ["show", `${sha}:${path}`], { stdio: ["ignore", "pipe", "ignore"] });
      } catch {
        return null;
      }
    },
  };
}

/** Paths that differ between two commits, without reading every file. */
export function changedBetween(from, to) {
  return git(from.repo, ["diff", "--name-only", "-z", "--no-renames", from.ref, to.ref]).toString().split("\0").filter(notSessionData);
}

/** Recreates a source from what session.json recorded about it. */
export function sourceFrom(spec, projectDir) {
  return spec.kind === "git" ? gitSource(projectDir, spec.ref) : dirSource(spec.path);
}

export function defaultBranch(repo) {
  try {
    return git(repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    for (const name of ["main", "master", "trunk", "develop"]) {
      try {
        git(repo, ["rev-parse", "--verify", "--quiet", name], { stdio: "ignore" });
        return name;
      } catch {}
    }
    throw new Error("Couldn't find the default branch. Pass --base <ref>.");
  }
}
