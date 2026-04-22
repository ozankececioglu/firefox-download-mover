const STORAGE_KEY = "rulesText";
const DEBUG_KEY = "debug";
const textarea = document.getElementById("rules");
const status = document.getElementById("status");
const diagnostics = document.getElementById("diagnostics");
const debugCheckbox = document.getElementById("debug");

function showStatus(msg, isError = false) {
  status.textContent = msg;
  status.className = isError ? "err" : "ok";
  if (!isError) setTimeout(() => { status.textContent = ""; status.className = ""; }, 2000);
}

function validate(text) {
  const issues = [];
  const lines = text.split(/\r?\n/);
  let ok = 0;
  lines.forEach((raw, idx) => {
    const t = raw.trim();
    if (!t || t.startsWith("#")) return;
    const sep = t.indexOf("=>");
    if (sep < 0) {
      issues.push({ line: idx + 1, msg: "missing '=>'" });
      return;
    }
    const urlPattern = t.slice(0, sep).trim();
    const path = t.slice(sep + 2).trim();
    if (!urlPattern) { issues.push({ line: idx + 1, msg: "empty url pattern" }); return; }
    if (!path) { issues.push({ line: idx + 1, msg: "empty target path" }); return; }
    try {
      new RegExp(urlPattern);
      ok++;
    } catch (err) {
      issues.push({ line: idx + 1, msg: `invalid regex: ${err.message}` });
    }
  });
  return { ok, issues };
}

function renderDiagnostics(text) {
  diagnostics.innerHTML = "";
  const { ok, issues } = validate(text);
  const summary = document.createElement("li");
  summary.textContent = `${ok} valid rule(s)` + (issues.length ? `, ${issues.length} problem(s):` : ", no problems.");
  diagnostics.appendChild(summary);
  for (const i of issues) {
    const li = document.createElement("li");
    li.className = "issue";
    li.textContent = `line ${i.line}: ${i.msg}`;
    diagnostics.appendChild(li);
  }
}

async function load() {
  const result = await browser.storage.local.get([STORAGE_KEY, DEBUG_KEY]);
  textarea.value = result[STORAGE_KEY] ?? "";
  debugCheckbox.checked = !!result[DEBUG_KEY];
  renderDiagnostics(textarea.value);
}

debugCheckbox.addEventListener("change", async () => {
  await browser.storage.local.set({ [DEBUG_KEY]: debugCheckbox.checked });
  showStatus(debugCheckbox.checked ? "Verbose logging on" : "Verbose logging off");
});

textarea.addEventListener("input", () => renderDiagnostics(textarea.value));

document.getElementById("save").addEventListener("click", async () => {
  await browser.storage.local.set({ [STORAGE_KEY]: textarea.value });
  renderDiagnostics(textarea.value);
  showStatus("Saved ✓");
});

document.getElementById("export").addEventListener("click", () => {
  const blob = new Blob([textarea.value], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "download-mover-rules.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

const importInput = document.getElementById("import-input");
document.getElementById("import").addEventListener("click", () => importInput.click());
importInput.addEventListener("change", async () => {
  const file = importInput.files[0];
  if (!file) return;
  const text = await file.text();
  textarea.value = text;
  renderDiagnostics(text);
  showStatus("Imported — click Save to persist");
  importInput.value = "";
});

load();
