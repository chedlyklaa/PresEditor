// Rewrites (or appends, if absent) a single CSS custom property inside the
// deck's own :root{} block — the mechanism behind Milestone 4's "theme
// tokens" panel. Live: since every slide's chrome already references these
// vars via var(--navy) etc., changing one here updates the whole deck the
// next time the iframe re-renders, no per-object changes needed.
export function setThemeTokenInStyleBlock(styleBlock, varName, value) {
  const block = styleBlock || '';
  const rootMatch = block.match(/:root\s*\{([^}]*)\}/);
  if (!rootMatch) {
    // No :root block yet (a from-scratch deck's generic stylesheet always
    // has one, but be defensive) — append a fresh one.
    return `${block}\n:root{ --${varName}: ${value}; }`;
  }
  const decls = rootMatch[1];
  const varRegex = new RegExp(`--${varName}\\s*:\\s*[^;]+;`);
  const newDecls = varRegex.test(decls)
    ? decls.replace(varRegex, `--${varName}: ${value};`)
    : `${decls.replace(/\s*$/, '')}\n  --${varName}: ${value};\n`;
  return block.slice(0, rootMatch.index) + `:root{${newDecls}}` + block.slice(rootMatch.index + rootMatch[0].length);
}

// Pulls actual color swatches out of the imported deck's own :root{} block
// (--navy, --blue, --bg-light, etc.) so the background-color picker offers
// exactly "the palette you have" instead of an invented one — works for any
// deck built on this project's engine, not just the current one.
export function extractPalette(styleBlock) {
  if (!styleBlock) return [];
  const rootMatch = styleBlock.match(/:root\s*{([^}]*)}/);
  if (!rootMatch) return [];
  const decls = Array.from(rootMatch[1].matchAll(/--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g));
  const seen = new Set();
  const swatches = [];
  for (const [, name, rawValue] of decls) {
    const value = rawValue.trim();
    const isColor = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) || /^rgba?\(/.test(value);
    if (!isColor) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    swatches.push({ name, value });
  }
  return swatches;
}
