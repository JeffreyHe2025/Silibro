// Minimal .env loader (no dependency). Reads KEY=VALUE lines from ./.env into
// process.env without overwriting anything already set in the real environment.
const fs = require("fs");
const path = require("path");

function loadEnv(file) {
  const p = file || path.join(__dirname, "..", ".env");
  let text;
  try { text = fs.readFileSync(p, "utf8"); } catch (e) { return; } // no .env is fine
  text.split(/\r?\n/).forEach((line) => {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) return;                       // skip blanks/comments
    const key = m[1];
    let val = m[2];
    if (/^".*"$/.test(val) || /^'.*'$/.test(val)) val = val.slice(1, -1); // strip quotes
    if (process.env[key] === undefined) process.env[key] = val;
  });
}

module.exports = { loadEnv };
