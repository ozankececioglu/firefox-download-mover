const STORAGE_KEY = "rulesText";
const DEBUG_KEY = "debug";

let compiledRules = [];
let debugEnabled = false;

const LOG_PREFIX = "[download-mover]";
function info(...args) { console.log(LOG_PREFIX, ...args); }
function warn(...args) { console.warn(LOG_PREFIX, ...args); }
function error(...args) { console.error(LOG_PREFIX, ...args); }
function debug(...args) { if (debugEnabled) console.log(LOG_PREFIX, "[debug]", ...args); }

function parseRules(text) {
  const rules = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t || t.startsWith("#")) continue;
    const sep = t.indexOf("=>");
    if (sep < 0) {
      warn(`line ${i + 1}: missing '=>', skipped: ${t}`);
      continue;
    }
    const urlPattern = t.slice(0, sep).trim();
    const path = t.slice(sep + 2).trim();
    if (!urlPattern || !path) continue;
    let re;
    try {
      re = new RegExp(urlPattern);
    } catch (err) {
      warn(`line ${i + 1}: invalid regex '${urlPattern}': ${err.message}`);
      continue;
    }
    rules.push({ re, path, line: i + 1, urlPattern });
  }
  return rules;
}

async function reloadRules() {
  const result = await browser.storage.local.get([STORAGE_KEY, DEBUG_KEY]);
  const text = result[STORAGE_KEY] ?? "";
  debugEnabled = !!result[DEBUG_KEY];
  compiledRules = parseRules(text);
  info(`loaded ${compiledRules.length} rule(s), debug=${debugEnabled}`);
  if (debugEnabled) {
    for (const r of compiledRules) {
      debug(`  rule line ${r.line}: /${r.urlPattern}/ => ${r.path}`);
    }
  }
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[STORAGE_KEY] || changes[DEBUG_KEY]) reloadRules();
});

reloadRules();

function sanitizeSegment(s) {
  return String(s)
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .replace(/^\.+$/, "_")
    .trim();
}

function stripHomePrefix(p) {
  let out = p.replace(/\\/g, "/");
  out = out.replace(/^~\/Downloads\//i, "");
  out = out.replace(/^~\//, "");
  out = out.replace(/^\/+/, "");
  return out;
}

function substituteGroups(template, match) {
  let out = template;
  if (match.groups) {
    for (const [k, v] of Object.entries(match.groups)) {
      out = out.split(`{${k}}`).join(sanitizeSegment(v ?? ""));
    }
  }
  for (let i = 1; i < match.length; i++) {
    out = out.split(`{${i}}`).join(sanitizeSegment(match[i] ?? ""));
  }
  return out;
}

function basename(p) {
  if (!p) return p;
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1];
}

// Strip Firefox's collision suffix: `log(2).txt` -> `log.txt`, `file(3)` -> `file`.
function stripCollisionSuffix(name) {
  return name.replace(/\(\d+\)(\.[^.\\/]+)?$/, "$1");
}

function resolveFilename(item) {
  const candidates = [];
  if (item.url) candidates.push({ label: "url", value: item.url });
  if (item.referrer) candidates.push({ label: "referrer", value: item.referrer });
  const suggested = item.filename || "";
  debug(`resolving, candidates=${JSON.stringify(candidates)} suggestedFilename=${suggested}`);
  if (compiledRules.length === 0) {
    debug("  no rules loaded");
    return null;
  }
  for (const rule of compiledRules) {
    for (const cand of candidates) {
      const m = cand.value.match(rule.re);
      if (!m) {
        debug(`  rule line ${rule.line} vs ${cand.label} — no match`);
        continue;
      }
      debug(`  rule line ${rule.line} vs ${cand.label} — MATCH, groups=${JSON.stringify(m.groups ?? {})}`);
      let target = stripHomePrefix(rule.path);
      target = substituteGroups(target, m);
      if (!target) {
        debug(`  target empty after substitution, continuing`);
        continue;
      }
      if (!target.endsWith("/")) target += "/";
      const rawName = basename(suggested) || "download";
      const name = stripCollisionSuffix(rawName);
      if (name !== rawName) debug(`  stripped collision suffix: ${rawName} -> ${name}`);
      info(`rule line ${rule.line} matched ${cand.label}=${cand.value} -> ${target}${name}`);
      return target + name;
    }
  }
  debug(`  no rule matched`);
  return null;
}

// URLs we just re-issued, so we don't re-process our own downloads in a loop.
const rewrittenUrls = new Map();
const REWRITE_TTL_MS = 10000;

function markRewritten(url) {
  rewrittenUrls.set(url, Date.now());
}
function wasRecentlyRewritten(url) {
  const now = Date.now();
  for (const [u, t] of rewrittenUrls) {
    if (now - t > REWRITE_TTL_MS) rewrittenUrls.delete(u);
  }
  return rewrittenUrls.has(url);
}

browser.downloads.onCreated.addListener(async (item) => {
  debug(`onCreated id=${item && item.id} url=${item && item.url} filename=${item && item.filename} referrer=${item && item.referrer}`);
  if (!item || !item.url) { debug("  skipping: no url"); return; }
  if (wasRecentlyRewritten(item.url)) { debug("  skipping: already rewritten"); return; }

  const finalName = resolveFilename(item);
  if (!finalName) return;

  debug(`canceling id=${item.id} to re-issue as ${finalName}`);
  try {
    await browser.downloads.cancel(item.id);
  } catch (err) {
    warn(`cancel failed for id ${item.id}: ${err.message}`);
  }
  try {
    await browser.downloads.erase({ id: item.id });
  } catch (err) {
    warn(`erase failed for id ${item.id}: ${err.message}`);
  }

  markRewritten(item.url);
  try {
    const newId = await browser.downloads.download({
      url: item.url,
      filename: finalName,
      conflictAction: "uniquify",
      saveAs: false,
    });
    info(`re-issued as id=${newId} filename=${finalName}`);
  } catch (err) {
    error(`re-download failed: ${err.message}`);
  }
});
