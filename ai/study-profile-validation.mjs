import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';

const skillRoot = fileURLToPath(new URL('./skills/caf-estudio-mercado/', import.meta.url));
const validatorPath = path.join(skillRoot, 'scripts/validar_entrega.py');
const schemaPath = path.join(skillRoot, 'references/CAF-esquema-salida.json');
// The executable code comes from the server package, never from the agent's workdir.
const runner = `import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('caf_profile',sys.argv[1])
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
packet=json.load(sys.stdin)
try:
 result=module.check(packet['payload'],packet.get('inventory'))
except (ValueError,KeyError,TypeError):
 sys.exit(2)
print(json.dumps(result,ensure_ascii=True))
`;

export async function validateStudyProfile(payload, inventory, {python = 'python3'} = {}) {
  const failure = (code, message) => Object.assign(new Error(message), {code});
  let hashes;
  try {
    hashes = Object.fromEntries([['validator', validatorPath], ['schema', schemaPath]].map(
      ([key, filename]) => [key, crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex')]));
  } catch {
    throw failure('STUDY_PROFILE_UNAVAILABLE', 'No esta disponible el perfil de validacion CAF del servidor.');
  }
  const input = JSON.stringify({payload, ...(inventory === undefined ? {} : {inventory})});
  return new Promise((resolve, reject) => {
    const child = execFile(python, ['-I', '-X', 'utf8', '-B', '-c', runner, validatorPath],
      {timeout: 10000, maxBuffer: 1048576, windowsHide: true}, (error, stdout) => {
        if (error) {
          return reject(error.code === 2
            ? failure('STUDY_PROFILE_REJECTED', 'La entrega no cumple el perfil CAF o no coincide con el inventario.')
            : failure('STUDY_PROFILE_UNAVAILABLE', 'No se pudo completar la validacion CAF del servidor.'));
        }
        let result;
        try { result = JSON.parse(stdout); } catch {}
        if (result?.schema_valid !== true || result.rows !== payload.items.length ||
            result.inventory_checked !== (inventory !== undefined) || !Array.isArray(result.signals)) {
          return reject(failure('STUDY_PROFILE_UNAVAILABLE', 'El validador CAF devolvio un resultado no verificable.'));
        }
        resolve({...result, profile_revision: '2.0-three-source-dev', profile_hashes: hashes});
      });
    // No filenames or executable content supplied by the researcher reach Python.
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
