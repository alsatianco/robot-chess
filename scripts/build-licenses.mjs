// Builds public/licenses.txt, the one text file with every licence the game must pass on: its own, and the licence of each package and data set it is built on. The bundler removes the licence comments from the code it packs, so without this file a built game would ship other people's work without their licence text. It runs after `npm install` and with `npm run licenses:build`. If a licence text is missing, it stops with an error and writes nothing.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ABOUT_CREDITS, LICENCES_FILE } from '../src/ui/about.js';

const RULE = '-'.repeat(78);
const LICENCE_FILE_NAME = /^(licen[cs]e|copying)(\.(txt|md))?$/i;

const INTRO = [
  'Robot Chess: licences',
  '',
  "The game's own code is under the MIT licence, which comes first. The parts listed after it are the free work of other people, and each one keeps its own licence.",
  '',
  'Stockfish, the chess engine, is a separate program. It runs in its own worker, the game talks to it only with text commands (the UCI protocol), and it stays under the GNU General Public License. Its source code is at the address in its section.',
].join('\n');

/** A repository address from a package.json as a plain https address, for example "git+https://host/name.git" becomes "https://host/name". */
function sourceAddress(repository) {
  const raw = typeof repository === 'string' ? repository : repository?.url;
  if (!raw) return null;
  return raw.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/\.git$/, '');
}

function section(titleLines, body) {
  // Only empty lines at the start and white space at the end are cut: the first line of a licence can be centered with spaces, and those are kept.
  return [RULE, ...titleLines, RULE, '', body.replace(/^(\s*\n)+/, '').trimEnd(), ''].join('\n');
}

/**
 * Make the text of the licence file.
 * @param {{root: string, credits: ReadonlyArray<{name: string, licence: string, packages: ReadonlyArray<string>, source?: string}>}} input `root` is the project folder, which holds LICENSE and node_modules. `credits` is the list of the About screen: each credit names its npm packages, or, for data that is not a package, its own `source` address.
 * @returns {string}
 * @throws {Error} When the game's LICENSE, a package, or the licence file of a package is missing. A missing text must stop the build, never be left out in silence.
 */
export function buildLicensesText({ root, credits }) {
  const ownPath = join(root, 'LICENSE');
  if (!existsSync(ownPath)) throw new Error(`The game's own LICENSE file is missing: ${ownPath}`);
  const parts = [INTRO, '', section(['Robot Chess', 'Licence: MIT'], readFileSync(ownPath, 'utf8'))];

  for (const credit of credits) {
    if (credit.packages.length === 0) {
      if (!credit.source) throw new Error(`The credit "${credit.name}" has no package and no source address, so there is nothing to say about where it comes from.`);
      parts.push(section([credit.name, `Licence: ${credit.licence}`, `Source: ${credit.source}`], `This work is under the ${credit.licence} licence. See the address above for the work and the full text of its licence.`));
      continue;
    }
    for (const name of credit.packages) {
      const folder = join(root, 'node_modules', name);
      const manifestPath = join(folder, 'package.json');
      if (!existsSync(manifestPath)) throw new Error(`The package "${name}" is not installed (looked for ${manifestPath}). Run npm install first.`);
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const file = readdirSync(folder).find((entry) => LICENCE_FILE_NAME.test(entry));
      if (!file) throw new Error(`The package "${name}" has no licence file in ${folder}. Its licence text must ship with the game.`);
      const source = sourceAddress(manifest.repository) ?? manifest.homepage ?? null;
      const title = [credit.name, `Package: ${name} ${manifest.version}`, `Licence: ${manifest.license ?? credit.licence}`];
      if (source) title.push(`Source code: ${source}`);
      parts.push(section(title, readFileSync(join(folder, file), 'utf8')));
    }
  }
  return parts.join('\n');
}

// Run as a script: write the file into public/, from where the build copies it next to the game.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const text = buildLicensesText({ root, credits: ABOUT_CREDITS });
    writeFileSync(join(root, 'public', LICENCES_FILE), text);
    console.log(`[licenses] Wrote public/${LICENCES_FILE} (${ABOUT_CREDITS.length} credits)`);
  } catch (error) {
    console.error(`[licenses] ${error.message}`);
    process.exit(1);
  }
}
