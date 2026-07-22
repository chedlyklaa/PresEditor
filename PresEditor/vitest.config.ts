import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // jsdom, not node: a few "pure" lib functions (e.g. lib/slideBackground.js's
    // readBgColorFromHtml/applyBgColorToHtml) build a scratch element via
    // document.createElement to parse an HTML fragment — real logic, not a
    // DOM-rendering concern, but it still needs a document to exist.
    environment: 'jsdom',
  },
});
