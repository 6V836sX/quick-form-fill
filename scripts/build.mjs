import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'dist/quick-form-fill');
fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(root, 'extension'), out, { recursive: true });
for (const file of ['LICENSE', 'NOTICE.md']) fs.copyFileSync(path.join(root, file), path.join(out, file));
console.log(`加载已解压的扩展程序：${out}`);
