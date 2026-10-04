import fs from 'fs/promises';
import path from 'path';
import { JsonDatabase } from './database';
import { SqliteDatabase } from './sqlite';

/**
 * JSON ↔ SQLite 이관·검증·사본 내보내기.
 *
 * 이관은 한 방향(JSON → SQLite)으로 한 번만 하고, 이후에는 SQLite가 원본이다.
 * data/json/*.json은 **읽기용 사본**으로 남긴다 — 사람이 열어 보고, git에 운영 기록으로
 * 커밋하고, STORAGE_BACKEND=json으로 되돌릴 때 쓰기 위해서다. 사본을 고쳐도 DB에는 반영되지 않는다.
 */

/** 배열 컬렉션 (행 여러 개) */
export const COLLECTIONS = ['trades', 'decisions', 'positions', 'performance_history', 'llm_usage', 'pipeline_runs', 'cash_events', 'reports'];
/** 단일 문서 (객체 하나) */
export const DOCS = ['scheduler_state', 'screen_setups'];

/**
 * JSON 파일을 SQLite로 가져온다. 이미 데이터가 있는 컬렉션은 건드리지 않는다
 * (재시작할 때마다 낡은 JSON으로 DB를 덮어쓰는 사고 방지).
 * @returns 컬렉션별 가져온 건수 (건너뛴 것은 -1)
 */
export async function importJsonToSqlite(sqlite: SqliteDatabase, json = new JsonDatabase()): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const name of COLLECTIONS) {
    if (sqlite.count(name) > 0) { out[name] = -1; continue; }
    const rows = await json.read<any>(name).catch(() => []);
    if (!Array.isArray(rows) || rows.length === 0) { out[name] = 0; continue; }
    await sqlite.write(name, rows);
    out[name] = rows.length;
  }
  for (const name of DOCS) {
    if (await sqlite.getDoc(name)) { out[name] = -1; continue; }
    const doc = await json.getDoc<any>(name);
    if (doc) { await sqlite.setDoc(name, doc); out[name] = 1; } else out[name] = 0;
  }
  return out;
}

/**
 * SQLite 내용이 JSON 파일과 **완전히 같은지** 대조한다 (이관 직후 검증용).
 * 건수만 보지 않고 각 객체를 직렬화해 비교한다 — 필드 하나라도 빠지거나 순서가 바뀌면 잡힌다.
 * @returns 불일치 목록 (비어 있으면 일치)
 */
export async function verifyAgainstJson(sqlite: SqliteDatabase, json = new JsonDatabase()): Promise<string[]> {
  const problems: string[] = [];
  for (const name of COLLECTIONS) {
    const a = await json.read<any>(name).catch(() => []), b = await sqlite.read<any>(name);
    if (a.length !== b.length) { problems.push(`${name}: 건수 ${a.length} ≠ ${b.length}`); continue; }
    for (let i = 0; i < a.length; i++) {
      if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) { problems.push(`${name}[${i}]: 내용 불일치`); break; }
    }
  }
  for (const name of DOCS) {
    const a = await json.getDoc<any>(name), b = await sqlite.getDoc<any>(name);
    if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(`${name}: 문서 불일치`);
  }
  return problems;
}

/**
 * SQLite 내용을 data/json/*.json 사본으로 내보낸다.
 * 임시 파일에 쓰고 이름을 바꾸므로(원자적 교체) 내보내는 도중 읽어도 반쪽 파일을 보지 않는다.
 * @param dir 내보낼 폴더 (기본 data/json)
 * @returns 내보낸 파일 수
 */
export async function exportJsonMirror(sqlite: SqliteDatabase, dir = path.join(process.cwd(), 'data', 'json')): Promise<number> {
  await fs.mkdir(dir, { recursive: true });
  let n = 0;
  const put = async (name: string, value: unknown) => {
    const file = path.join(dir, `${name}.json`), tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
    await fs.rename(tmp, file);
    n++;
  };
  for (const name of COLLECTIONS) {
    const rows = await sqlite.read<any>(name);
    if (rows.length > 0) await put(name, rows);
  }
  for (const name of DOCS) {
    const doc = await sqlite.getDoc<any>(name);
    if (doc) await put(name, doc);
  }
  return n;
}

/**
 * 서버 시작 시 호출 — SQLite 백엔드면 **최초 1회만** JSON을 가져온다.
 *
 * "비어 있으면 가져온다"로 만들지 않는 이유: 어떤 컬렉션이 나중에 정당하게 비워지면
 * 재시작하는 순간 낡은 JSON 사본이 되살아난다. 이관 완료 표시(migration_meta)를 DB에 남기고,
 * 표시가 있으면 다시는 가져오지 않는다.
 * @returns 이번에 이관했으면 컬렉션별 건수, 이미 끝났거나 JSON 백엔드면 null
 */
export async function ensureMigrated(db: unknown): Promise<Record<string, number> | null> {
  if (!(db instanceof SqliteDatabase)) return null;
  if (await db.getDoc('migration_meta')) return null;
  const imported = await importJsonToSqlite(db);
  const problems = await verifyAgainstJson(db);
  if (problems.length > 0) {
    // 검증 실패 상태로 운영을 시작하지 않는다 — 표시를 남기지 않으므로 원인 해결 후 다시 시도된다
    throw new Error(`JSON → SQLite 이관 검증 실패: ${problems.join(' / ')}`);
  }
  await db.setDoc('migration_meta', { imported_at: new Date().toISOString(), imported });
  return imported;
}

let lastExportSignature = '';

/**
 * 내용이 바뀌었을 때만 JSON 사본을 내보낸다 (주기 호출용).
 * 컬렉션별 건수와 마지막 행을 지문으로 삼아, 변화가 없으면 파일을 건드리지 않는다.
 * @returns 내보냈으면 파일 수, 변화 없으면 0
 */
export async function exportJsonMirrorIfChanged(db: unknown): Promise<number> {
  if (!(db instanceof SqliteDatabase)) return 0;
  const parts: string[] = [];
  for (const name of COLLECTIONS) {
    const rows = await db.read<any>(name);
    parts.push(`${name}:${rows.length}:${rows.length ? JSON.stringify(rows[rows.length - 1]).length : 0}`);
  }
  for (const name of DOCS) parts.push(`${name}:${JSON.stringify(await db.getDoc(name) ?? null)}`);
  const sig = parts.join('|');
  if (sig === lastExportSignature) return 0;
  const n = await exportJsonMirror(db);
  lastExportSignature = sig;
  return n;
}
