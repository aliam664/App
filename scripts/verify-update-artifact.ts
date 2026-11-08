import { readFile } from 'node:fs/promises';
import { verifyUpdateSignature } from './update-signature';
import updater from '../config/updater-public.json';
const [file, version] = process.argv.slice(2);
if (!file || !version) throw new Error('Installer path and actual built version required');
verifyUpdateSignature(
  await readFile(file),
  await readFile(`${file}.sig`, 'utf8'),
  updater.public_key,
  version,
);
console.log('Installer bytes, public key, trusted comment and signed version verified.');
