/**
 * Shared parser for the VN script's markdown table format:
 * |Line|(JP) Actor|(JP) Character Override|(JP) Dialogue|(EN) Character|(EN) Dialogue|(CN) Character|(CN) Dialogue|
 *
 * Used by both parse-and-index.js (RAG) and export-script-training-data.js
 * (fine-tuning data) so the two stay consistent.
 */
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