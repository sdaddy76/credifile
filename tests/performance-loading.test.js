import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const projectFile = async path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('il lockfile include tutte le dipendenze dichiarate', async () => {
  const manifest = JSON.parse(await projectFile('package.json'));
  const lock = JSON.parse(await projectFile('package-lock.json'));
  for (const section of ['dependencies', 'devDependencies']) {
    assert.deepEqual(lock.packages[''][section], manifest[section]);
  }
});

test('la build pubblicata usa produzione mantenendo i messaggi di navigazione', async () => {
  const manifest = JSON.parse(await projectFile('package.json'));
  assert.equal(manifest.scripts.build, 'VITE_ENABLE_ROUTE_MESSAGING=true vite build');
});

test('le sezioni della pratica e le librerie PDF si caricano su richiesta', async () => {
  const source = await projectFile('src/pages/admin/PraticaDetailPage.tsx');
  for (const name of [
    'AnalisiFinanziariaTab', 'BancabilitaTab', 'ReputazioneTab', 'RelazioneTab',
    'EstrattoConto', 'AnalisiCostiBancari', 'AmlReportTab', 'DocumentCoherenceTab',
    'PracticeTimelineCalendar', 'Partecipogramma',
  ]) {
    assert.match(source, new RegExp(`const ${name} = lazy\\(\\(\\) => import\\('@/components/${name}'\\)`));
    assert.doesNotMatch(source, new RegExp(`import [^\\n]+ from '@/components/${name}'`));
  }
  assert.match(source, /<SectionContent \{\.\.\.props\}>[\s\S]*?<Suspense fallback=/);
  assert.match(source, /const pdfjs = await import\('pdfjs-dist'\)/);
  assert.match(source, /const \{ jsPDF \} = await import\('jspdf'\)/);
  assert.doesNotMatch(source, /import [^\n]+ from '(?:pdfjs-dist|jspdf)'/);
});

test('i vendor non trascinano dipendenze condivise e URL dei worker', async () => {
  const config = await projectFile('vite.config.ts');
  assert.match(config, /onlyExplicitManualChunks:\s*true/);
  assert.match(config, /if \(id\.includes\('\?url'\)\) return undefined;/);
  assert.ok(
    config.indexOf("id.includes('pdfjs-dist/legacy/')") <
    config.indexOf("id.includes('pdfjs-dist')"),
    'il lettore legacy deve restare separato dal lettore moderno',
  );
});
