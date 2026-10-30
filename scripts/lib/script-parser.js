/**
 * Shared parser for the VN script's markdown table format:
 * |Line|(JP) Actor|(JP) Character Override|(JP) Dialogue|(EN) Character|(EN) Dialogue|(CN) Character|(CN) Dialogue|
 *
 * Used by both parse-and-index.js (RAG) and export-script-training-data.js
 * (fine-tuning data) so the two stay consistent.
 */
import { character } from '../../src/character.js';

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

// ── Render rows into readable "Speaker: line" text in ONE language ─────────
export function renderRows(rows, lang) {
  const lines = rows
    .map(r => {
      let speaker, text;
      if (lang === 'en') { speaker = r.enCharacter; text = r.enDialogue; }
      else if (lang === 'ja') { speaker = r.jpActor; text = r.jpDialogue; }
      else if (lang === 'zh') { speaker = r.cnCharacter; text = r.cnDialogue; }
      else return null;

      if (!text) return null;
      return speaker ? `${speaker}: ${text}` : `(narration): ${text}`;
    })
    .filter(Boolean);

  return lines.length > 0 ? lines.join('\n') : null;
}