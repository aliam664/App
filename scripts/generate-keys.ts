import { generateKeyPair, exportJWK } from 'jose';
import { mkdir, writeFile } from 'node:fs/promises';
import { b64 } from '../backend/src/crypto';
const dir='.local/operator-keys';await mkdir(dir,{recursive:true,mode:0o700});
const pair=await generateKeyPair('ES256',{extractable:true});const id=`uhm-${Date.now()}`;
await writeFile(`${dir}/${id}-private.json`,JSON.stringify(await exportJWK(pair.privateKey),null,2),{mode:0o600,flag:'wx'});
await writeFile(`${dir}/${id}-public.json`,JSON.stringify(await exportJWK(pair.publicKey),null,2),{mode:0o600,flag:'wx'});
await writeFile(`${dir}/${id}-pepper.txt`,b64(crypto.getRandomValues(new Uint8Array(32))),{mode:0o600,flag:'wx'});
console.log(`Keys written under ${dir}/${id}-*. Keep private material server-only; nothing was uploaded.`);
