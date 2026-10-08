import { execFile } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { sourceFrom } from "../lib/sources.js";
import { allFiles, findFile, loadSession, readJson, rebuild, sha256 } from "../lib/session.js";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "public");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};
const REVEAL_AFTER = 3;
const MIN_REFLECTION = 120;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const enc = (path) => encodeURIComponent(path);

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/**
 * Serves one session. Everything the game saves lives in the session dir; the only writes outside it
 * are the finished files, and those only land inside the project.
 *
 * Every /api request must carry the per-launch token (sent as X-LBL-Token) and a localhost Host header,
 * so other websites open in the same browser can't read the session or write files (CSRF, DNS rebinding).
 */
export function createGameServer({ sessionDir, projectDir, token = randomBytes(18).toString("base64url"), emit = (line) => console.log(line) }) {
  sessionDir = resolve(sessionDir);
  projectDir = resolve(projectDir);
  const session = loadSession(sessionDir);
  const target = sourceFrom(session.source, session.projectDir);
  const at = (...parts) => join(sessionDir, ...parts);
  const appliedFile = at("applied.json");
  const tokenBuf = Buffer.from(token);

  const realProject = realpathSync(projectDir);
  /**
   * Resolves a session path inside the project. Symlinks are followed for the parts that exist, so a
   * symlinked directory (or file) can't redirect a write outside the project.
   */
  const inProject = (path) => {
    const outside = () => new HttpError(400, `Refusing to touch ${path}: it's outside the project`);
    const full = resolve(projectDir, String(path));
    if (!full.startsWith(projectDir + sep) || full.startsWith(join(projectDir, ".line-by-line") + sep)) throw outside();
    // lstat, not exists: existsSync follows links, so a dangling symlink would look absent and then be
    // followed by the write.
    const present = (p) => {
      try {
        lstatSync(p);
        return true;
      } catch {
        return false;
      }
    };
    let existing = full;
    while (!present(existing)) existing = dirname(existing);
    if (existing === full && lstatSync(full).isSymbolicLink()) throw outside();
    let real;
    try {
      real = realpathSync(existing);
    } catch {
      throw outside();
    }
    if (real !== realProject && !real.startsWith(realProject + sep)) throw outside();
    if (real.startsWith(join(realProject, ".line-by-line") + sep)) throw outside();
    return full;
  };
  const diskHash = (path) => {
    const full = inProject(path);
    return existsSync(full) ? sha256(readFileSync(full)) : null;
  };
  const applied = () => readJson(appliedFile, {});
  const markApplied = (path, hash) => writeFileSync(appliedFile, JSON.stringify({ ...applied(), [path]: hash }, null, 2));

  /** Null when the file on disk is what the session expects, or what we wrote ourselves. */
  const conflictFor = (path, baseHash) => {
    const now = diskHash(path);
    if (now === (baseHash ?? null)) return null;
    const done = applied();
    if (path in done && now === done[path]) return null;
    return { path, expected: baseHash ?? null, found: now };
  };

  const write = (path, content) => {
    const full = inProject(path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
    markApplied(path, sha256(content));
    emit(`LBL file ${path}`);
  };
  const remove = (path) => {
    rmSync(inProject(path), { force: true });
    markApplied(path, null);
    emit(`LBL file ${path}`);
  };

  const requireFile = (path) => {
    const found = findFile(session, path);
    if (!found) throw new HttpError(400, `${path} isn't part of this session`);
    return found;
  };
  const requireStep = (stepId) => {
    const step = session.steps.find((s) => s.id === stepId);
    if (!step) throw new HttpError(400, `Unknown step ${stepId}`);
    return step;
  };
  const requireMode = (...modes) => {
    if (!modes.includes(session.mode)) throw new HttpError(403, `Not available in ${session.mode} sessions`);
  };

  const submissions = (path) => {
    const dir = at("submissions", enc(path));
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((n) => /^\d+\.json$/.test(n))
      .map((n) => ({ n: Number(n.split(".")[0]), ...readJson(join(dir, n), {}) }))
      .sort((a, b) => a.n - b.n);
  };
  const fileGrades = (path) => {
    const g = readJson(at("grades", "files", `${enc(path)}.json`), null);
    if (!g) return [];
    return Array.isArray(g) ? g : [g];
  };

  const readDir = (dir, parse) => {
    const out = {};
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir)) {
      const key = decodeURIComponent(name.replace(/\.(json|md)$/, ""));
      try {
        out[key] = parse(readFileSync(join(dir, name), "utf8"));
      } catch {
        out[key] = null;
      }
    }
    return out;
  };

  function isComplete() {
    if (session.mode === "review") return false;
    const done = applied();
    if (!allFiles(session).every(({ file }) => file.path in done)) return false;
    if (!session.steps.every((s) => (s.autoApplied ?? []).every((a) => a.path in done))) return false;
    if (session.mode === "type") return session.steps.every((s) => existsSync(at("reflections", `${s.id}.md`)));
    return true;
  }
  function maybeComplete() {
    if (existsSync(at("complete")) || !isComplete()) return;
    writeFileSync(at("complete"), new Date().toISOString());
    emit("LBL complete");
  }

  function state() {
    const files = {};
    for (const { file } of allFiles(session)) {
      const subs = submissions(file.path);
      files[file.path] = {
        submissions: subs.length,
        latest: subs.at(-1) ?? null,
        grades: fileGrades(file.path),
        hints: readJson(at("hints", `${enc(file.path)}.json`), []),
      };
    }
    const done = applied();
    const conflicts =
      session.mode === "review"
        ? []
        : allFiles(session)
            .filter(({ file }) => !(file.path in done) && conflictFor(file.path, file.baseHash))
            .map(({ file }) => file.path);
    return {
      progress: readJson(at("progress.json"), {}),
      reflections: readDir(at("reflections"), (s) => s),
      stepGrades: readDir(at("grades", "steps"), (s) => JSON.parse(s)),
      files,
      applied: done,
      reveals: readJson(at("reveals.json"), {}),
      conflicts,
      complete: existsSync(at("complete")),
    };
  }

  const routes = {
    "GET /api/session": () => session,

    "GET /api/state": () => state(),

    "PUT /api/progress": (body) => {
      writeFileSync(at("progress.json"), JSON.stringify(body, null, 2));
      return { ok: true };
    },

    /** What's on disk right now, for the conflict dialog's "Show diff". Session files only. */
    "GET /api/disk": (_body, url) => {
      const path = url.searchParams.get("path");
      requireFile(path);
      const full = inProject(path);
      return { path, content: existsSync(full) ? readFileSync(full, "utf8") : null };
    },

    /** Type mode: a file has been typed to the end (or its deletion confirmed). */
    "POST /api/file": ({ path, force }) => {
      requireMode("type");
      const { file } = requireFile(path);
      const conflict = force ? null : conflictFor(path, file.baseHash);
      if (conflict) throw new HttpError(409, `${path} changed on disk since the session was built`, { conflict });
      if (file.action === "delete") remove(path);
      else write(path, rebuild(file));
      maybeComplete();
      return { ok: true, path };
    },

    /** Conflict dialog → "Keep mine": leave the file as it is on disk and count it as done. */
    "POST /api/skip": ({ path }) => {
      requireMode("type", "learn");
      requireFile(path);
      markApplied(path, diskHash(path));
      emit(`LBL skip ${path}`);
      maybeComplete();
      return { ok: true, path };
    },

    /** Every file of a step is done: apply its lockfiles, binaries and other untyped changes. */
    "POST /api/step-done": ({ stepId }) => {
      requireMode("type", "learn");
      const step = requireStep(stepId);
      const results = [];
      for (const item of step.autoApplied ?? []) {
        if (item.path in applied()) {
          results.push({ path: item.path, ok: true });
          continue;
        }
        if (conflictFor(item.path, item.baseHash)) {
          results.push({ path: item.path, ok: false, reason: "changed on disk, skipped" });
          continue;
        }
        if (item.action === "delete") remove(item.path);
        else {
          const content = target.read(item.path);
          if (!content) {
            results.push({ path: item.path, ok: false, reason: "missing from the solution" });
            continue;
          }
          write(item.path, content);
        }
        results.push({ path: item.path, ok: true });
      }
      emit(`LBL step-done ${stepId}`);
      maybeComplete();
      return { ok: true, results };
    },

    "POST /api/reflection": ({ stepId, text, stats }) => {
      requireMode("type");
      const step = requireStep(stepId);
      if (typeof text !== "string" || text.trim().length < MIN_REFLECTION) throw new HttpError(400, "Reflection is too short");
      mkdirSync(at("reflections"), { recursive: true });
      const header = [
        `# Step ${session.steps.indexOf(step) + 1} · ${step.title}`,
        "",
        `Submitted: ${new Date().toISOString()}`,
        stats ? `Stats: ${Number(stats.wpm)} WPM · ${Number(stats.accuracy)}% accuracy · ${Number(stats.lines)} lines (${Number(stats.assisted ?? 0)} autocompleted)` : "",
        "",
        "## Reflection",
        "",
      ];
      writeFileSync(at("reflections", `${stepId}.md`), header.join("\n") + text.trim() + "\n");
      rmSync(at("grades", "steps", `${stepId}.json`), { force: true });
      emit(`LBL reflection ${stepId}`);
      maybeComplete();
      return { ok: true };
    },

    /** Learn mode: the user submits their version of a file for grading. */
    "POST /api/submit": ({ path, holes }) => {
      requireMode("learn");
      const { step, file } = requireFile(path);
      const ids = file.segments.filter((s) => s.kind === "hole").map((s) => s.id);
      if (!holes || typeof holes !== "object" || ids.some((id) => typeof holes[id] !== "string")) {
        throw new HttpError(400, "Every hole needs a value");
      }
      const n = submissions(path).length + 1;
      const dir = at("submissions", enc(path));
      mkdirSync(dir, { recursive: true });
      const clean = Object.fromEntries(ids.map((id) => [id, holes[id]]));
      writeFileSync(join(dir, `${n}.json`), JSON.stringify({ holes: clean, submittedAt: new Date().toISOString() }, null, 2));
      emit(`LBL submit ${step.id} ${path} ${n}`);
      return { ok: true, attempt: n };
    },

    /** Learn mode: write the latest submission once it passed (or the user accepts a partial). */
    "POST /api/apply": ({ path, force }) => {
      requireMode("learn");
      const { file } = requireFile(path);
      let content = null;
      if (file.action !== "delete") {
        if (!file.segments.some((s) => s.kind === "hole")) content = rebuild(file);
        else {
          const latest = submissions(path).at(-1);
          const grade = fileGrades(path).find((g) => g.attempt === latest?.n);
          if (!latest || !grade || !["pass", "partial"].includes(grade.verdict)) {
            throw new HttpError(400, "Only a submission graded pass or partial can be applied");
          }
          content = rebuild(file, (id) => latest.holes[id]);
        }
      }
      const conflict = force ? null : conflictFor(path, file.baseHash);
      if (conflict) throw new HttpError(409, `${path} changed on disk since the session was built`, { conflict });
      if (content === null) remove(path);
      else write(path, content);
      maybeComplete();
      return { ok: true, path };
    },

    "POST /api/hint": ({ path, holeId }) => {
      requireMode("learn");
      const { step, file } = requireFile(path);
      if (!file.segments.some((s) => s.kind === "hole" && s.id === holeId)) throw new HttpError(400, "Unknown hole");
      const requests = readJson(at("hint-requests.json"), []);
      writeFileSync(at("hint-requests.json"), JSON.stringify([...requests, { path, holeId, at: new Date().toISOString() }], null, 2));
      emit(`LBL hint ${step.id} ${path} ${holeId}`);
      return { ok: true };
    },

    /** Learn mode: show the reference for one hole, only after repeated failed attempts. */
    "POST /api/reveal": ({ path, holeId }) => {
      requireMode("learn");
      const { file } = requireFile(path);
      if (!file.segments.some((s) => s.kind === "hole" && s.id === holeId)) throw new HttpError(400, "Unknown hole");
      const failed = fileGrades(path).filter((g) => g.verdict !== "pass").length;
      if (failed < REVEAL_AFTER) throw new HttpError(403, `Reveal unlocks after ${REVEAL_AFTER} graded attempts`);
      const reference = readJson(at("private", "reference.json"), {});
      const reveals = readJson(at("reveals.json"), {});
      reveals[path] = [...new Set([...(reveals[path] ?? []), holeId])];
      writeFileSync(at("reveals.json"), JSON.stringify(reveals, null, 2));
      return { ok: true, text: reference[holeId] ?? "" };
    },
  };

  async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    try {
      return raw ? JSON.parse(raw) : {};
    } catch {
      throw new HttpError(400, "Body must be JSON");
    }
  }

  function send(res, status, body, type = "application/json; charset=utf-8") {
    res.writeHead(status, {
      "Content-Type": type,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  }

  const hostAllowed = (host = "") => LOCAL_HOSTS.has(host.replace(/:\d+$/, "").toLowerCase());
  const tokenOk = (value) => {
    const got = Buffer.from(String(value ?? ""));
    return got.length === tokenBuf.length && timingSafeEqual(got, tokenBuf);
  };

  const server = createServer(async (req, res) => {
    try {
      if (!hostAllowed(req.headers.host)) return send(res, 403, { error: "Bad host" });
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname.startsWith("/api/")) {
        if (!tokenOk(req.headers["x-lbl-token"])) return send(res, 403, { error: "Missing or wrong session token" });
        const route = routes[`${req.method} ${url.pathname}`];
        if (!route) return send(res, 404, { error: "Not found" });
        const body = req.method === "GET" ? {} : await readBody(req);
        return send(res, 200, await route(body, url));
      }
      if (req.method !== "GET") return send(res, 404, { error: "Not found" });
      const file = resolve(PUBLIC_DIR, "." + decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
      if (!file.startsWith(PUBLIC_DIR + sep) || !existsSync(file)) return send(res, 404, "Not found", "text/plain");
      send(res, 200, readFileSync(file), MIME[extname(file)] ?? "application/octet-stream");
    } catch (error) {
      if (error instanceof HttpError) return send(res, error.status, { error: error.message, ...error.extra });
      console.error(error);
      send(res, 500, { error: String(error?.message ?? error) });
    }
  });
  server.token = token;
  return server;
}

export function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  execFile(cmd, args, () => {});
}

/** Starts the game and prints the one machine-readable line Claude waits for: `LBL ready <url>`. */
export function serve({ sessionDir, projectDir, port = 0, open = true }) {
  const server = createGameServer({ sessionDir, projectDir });
  return new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => {
      // The token rides in the fragment, so it never reaches server logs or Referer headers.
      const url = `http://localhost:${server.address().port}/#t=${server.token}`;
      console.log(`LBL ready ${url}`);
      if (open) openBrowser(url);
      done({ server, url });
    });
  });
}
