#!/usr/bin/env node
/**
 * verify-gate-workflow.mjs -- the shipped CI template, tested as shell.
 *
 * templates/github-workflows/pattern-gate.yml used to interpolate the changed
 * file list straight into `run:`. With more than one added file the shell ran
 * the 2nd..nth file name as COMMANDS ("Permission denied", exit 126), and a
 * hostile file name could inject shell. This runs the real `run:` block of the
 * verify step with a stub npx that records its arguments.
 *
 * Run: node scripts/verify-gate-workflow.mjs
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const check = (label, ok, detail = "") => { if (ok) console.log(`  ok: ${label}`); else { console.error(`  FAIL: ${label}${detail ? `\n${detail}` : ""}`); failures++; } };

const yml = readFileSync(join(root, "templates/github-workflows/pattern-gate.yml"), "utf8");
const lines = yml.split("\n");

console.log("static: no ${{ }} expression inside any run: block");
{
  const bad = [];
  let blockIndent = -1;
  lines.forEach((line, i) => {
    const indent = line.match(/^\s*/)[0].length;
    if (blockIndent >= 0 && line.trim() !== "" && indent <= blockIndent) blockIndent = -1;
    const inline = /^\s*(?:-\s+)?run:\s*(?![|>]\s*$)(.+)$/.exec(line);
    if (/^\s*(?:-\s+)?run:\s*[|>][+-]?\s*$/.test(line)) blockIndent = indent;
    else if ((inline && inline[1].includes("${{")) || (blockIndent >= 0 && indent > blockIndent && line.includes("${{"))) bad.push(`    line ${i + 1}: ${line.trim()}`);
  });
  check("expressions only appear in env:/if:/with:, never in a script", bad.length === 0, bad.join("\n"));
}

function stepRun(name) {
  const start = lines.findIndex((l) => l.includes(`name: ${name}`));
  const runAt = lines.findIndex((l, i) => i > start && /^\s*run:\s*\|\s*$/.test(l));
  const indent = lines[runAt].match(/^\s*/)[0].length;
  const body = [];
  for (let i = runAt + 1; i < lines.length && (lines[i].trim() === "" || lines[i].match(/^\s*/)[0].length > indent); i++) body.push(lines[i].slice(indent + 2));
  return body.join("\n");
}

console.log("verify step: run the real script with a stub npx");
{
  const run = stepRun("Run pattern-check-gate verify");
  const work = mkdtempSync(join(tmpdir(), "pattern-wf-"));
  const bin = join(work, "bin");
  spawnSync("mkdir", ["-p", bin]);
  const argsFile = join(work, "args.txt");
  writeFileSync(join(bin, "npx"), `#!/bin/bash\nprintf '%s\\n' "$@" > ${JSON.stringify(argsFile)}\n`, "utf8");
  chmodSync(join(bin, "npx"), 0o755);
  const exec = (files) => spawnSync("bash", ["-e", "-c", run], { cwd: work, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ADDED_FILES: files } });

  const many = exec(["src/A.tsx", ".github/workflows/pattern-gate.yml", ".pattern/receipts/x.json", "website/components/B.tsx"].join("\n"));
  const argv = existsSync(argsFile) ? readFileSync(argsFile, "utf8").trim().split("\n") : [];
  check("several added files: exits 0 (no 'Permission denied' / exit 126)", many.status === 0, many.stderr);
  check("each file name arrives as its own argument, after --files", argv.slice(-4).join("|") === "src/A.tsx|.github/workflows/pattern-gate.yml|.pattern/receipts/x.json|website/components/B.tsx" && argv[argv.indexOf("--files")] === "--files");
  check("passes -p pattern-mcp, the verify mode and --project-root", argv.slice(0, 5).join(" ") === "--yes -p pattern-mcp pattern-check-gate" || argv.join(" ").includes("-p pattern-mcp pattern-check-gate verify --project-root"));

  const pwned = join(work, "PWNED");
  const evil = exec([`src/a$(touch ${pwned}).tsx`, "src/b;touch " + pwned + ".tsx", "src/ok name.tsx"].join("\n"));
  const evilArgs = readFileSync(argsFile, "utf8").trim().split("\n");
  check("hostile file names are data, not shell (nothing executed)", !existsSync(pwned) && !existsSync(pwned + ".tsx"));
  check("a name with a space stays one argument", evilArgs.includes("src/ok name.tsx"));
  check("exits 0", evil.status === 0, evil.stderr);

  writeFileSync(argsFile, "UNCHANGED");
  exec("");
  check("empty list: npx is never called", readFileSync(argsFile, "utf8") === "UNCHANGED");
}

console.log("compute step: the base branch name is not interpolated into the script");
{
  const run = stepRun("Compute added files");
  check("uses the BASE_REF env var", run.includes("${BASE_REF}") && !run.includes("github.base_ref"));
  check("unique output delimiter (a file named EOF cannot truncate the list)", /DELIM=.*date/.test(run) && !/<<EOF/.test(run));
}

console.log(failures ? `${failures} failed` : "All checks passed.");
process.exit(failures ? 1 : 0);
