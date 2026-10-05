// The shell scripts she runs must work whatever language her Mac is set to.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

// With a non-English locale (a Swedish Mac: sv_SE.UTF-8), the bash 3.2 that ships with macOS reads a
// non-ASCII character right after $VAR as part of the variable name, so "$DEST…" fails as unbound.
test('the installer and the launcher are pure ASCII', () => {
  for (const file of ['../../../install.sh', '../Start Recorder.command']) {
    const lines = fs.readFileSync(new URL(file, import.meta.url), 'utf8').split('\n');
    const bad = lines.flatMap((l, i) => (/[^\x00-\x7f]/.test(l) ? [`${i + 1}: ${l.trim()}`] : []));
    assert.deepEqual(bad, [], `${file} has non-ASCII lines`);
  }
});
