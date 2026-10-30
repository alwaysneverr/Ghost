/**
 * Shared parser for the VN script's markdown table format:
 * |Line|(JP) Actor|(JP) Character Override|(JP) Dialogue|(EN) Character|(EN) Dialogue|(CN) Character|(CN) Dialogue|
 *
 * Used by both parse-and-index.js (RAG) and export-script-training-data.js
 * (fine-tuning data) so the two stay consistent.
 */
import { readdirSync } from 'fs';
import { character } from '../../src/character.js';

// Script files to read, skipping dotfiles and anything matched by
// character.excludeScripts.
export function listScriptFiles(dir) {
  const files = readdirSync(dir).filter(f => !f.startsWith('.'));
  const kept = files.filter(f => !character.excludeScripts?.test(f));
  if (kept.length < files.length) {
    console.log(`🚫 Excluding ${files.length - kept.length} file(s) matching ${character.excludeScripts}`);
  }
  return kept;
}

export function parseScriptFile(text) {
  const rows = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;

    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 8) continue;

    const [lineNo, jpActor, jpOverride, jpDialogue, enCharacter, enDialogue, cnCharacter, cnDialogue] = cells;

    if (lineNo === 'Line' || /^-+$/.test(lineNo)) continue; // header/separator row
    if (!/^\d+$/.test(lineNo)) continue;

    rows.push({
      line: Number(lineNo),
      jpActor, jpOverride, jpDialogue,
      enCharacter, enDialogue,
      cnCharacter, cnDialogue,
    });
  }
  return rows;
}

// Every name the target character is credited under in the script's EN
// column. SCRIPT_TARGET_ALIASES (comma-separated) overrides character.aliases.
export function targetAliases() {
  const raw = process.env.SCRIPT_TARGET_ALIASES?.split(',') ?? character.aliases;
  return raw.map(s => s.trim().toLowerCase()).filter(Boolean);
}

export function isTargetRow(row, aliases) {
  return aliases.includes((row.enCharacter || '').toLowerCase());
}

// ── Render rows into readable "Speaker: line" text (EN columns) ────────────
export function renderRows(rows) {
  const lines = rows
    .map(r => {
      if (!r.enDialogue) return null;
      return r.enCharacter ? `${r.enCharacter}: ${r.enDialogue}` : `(narration): ${r.enDialogue}`;
    })
    .filter(Boolean);

  return lines.length > 0 ? lines.join('\n') : null;
}

function stripQuotes(text) {
  const t = text.trim();
  for (const [open, close] of [['"', '"'], ['“', '”']]) {
    if (t.length >= 2 && t.startsWith(open) && t.endsWith(close)) return t.slice(1, -1).trim();
  }
  return t;
}

// ── Render the target's own lines as a plain chat reply ────────────────────
// No speaker name and no quote brackets, so fine-tuning teaches the model to
// answer the way the bot should on Discord — not 'Ghost: "..."'.
export function renderReply(rows) {
  const lines = rows.map(r => (r.enDialogue ? stripQuotes(r.enDialogue) : null)).filter(Boolean);

  return lines.length > 0 ? lines.join('\n') : null;
}
