import fs from 'fs';
import path from 'path';

/**
 * SQLite 저장소 백엔드 (Node 내장 `node:sqlite` — 외부 패키지·네이티브 빌드 없음).
 *
 * JsonDatabase와 **같은 메서드**를 제공해 호출부를 바꾸지 않고 교체한다.
 *
 * 왜 옮기는가 (2026-10-05):
 *  - JSON은 한 건을 추가해도 파일 전체를 다시 쓴다. 쓰는 도중 프로세스가 죽으면 파일이 깨진다.
 *  - 운영 데이터가 git 작업 파일이라 stash·reset에 조용히 되돌아갔다 (2026-10-01 /teleport 사고:
 *    매도 2건 소실, 3일간 무경고). DB 파일은 gitignore라 git 명령의 영향을 받지 않는다.
 *
 * 저장 방식: 컬렉션마다 테이블 하나. 각 행은 원본 객체를 `data`(JSON)에 **그대로** 보관하고,
 * 자주 쓰는 필드는 생성 열(generated column)로 꺼내 인덱스·SQL 조회에 쓴다.
 * 열로 풀어 저장하지 않는 이유: 객체에 필드가 추가될 때(예: positions의 peak_price, setup)
 * 스키마에 없는 필드가 조용히 버려지는 사고를 구조적으로 막기 위해서다. 원본이 항상 온전하다.
 */

// @types/node 20에는 node:sqlite 타입이 없어 필요한 부분만 선언한다
interface Stmt { run(...p: unknown[]): { changes: number | bigint }; get(...p: unknown[]): any; all(...p: unknown[]): any[] }
interface Sqlite { exec(sql: string): void; prepare(sql: string): Stmt; close(): void }

/** 컬렉션별 생성 열 정의 — [열 이름, SQLite 타입, JSON 경로] */
const SCHEMA: Record<string, Array<[string, string, string]>> = {
  trades: [['id', 'INTEGER', '$.id'], ['traded_at', 'TEXT', '$.traded_at'], ['symbol', 'TEXT', '$.symbol'],
           ['side', 'TEXT', '$.side'], ['qty', 'REAL', '$.qty'], ['price', 'REAL', '$.price']],
  decisions: [['report_id', 'TEXT', '$.report_id'], ['decided_at', 'TEXT', '$.decided_at'], ['executed_at', 'TEXT', '$.executed_at']],
  positions: [['symbol', 'TEXT', '$.symbol'], ['status', 'TEXT', '$.status'], ['shares', 'REAL', '$.shares']],
  performance_history: [['date', 'TEXT', '$.date'], ['current_value_krw', 'REAL', '$.current_value_krw'],
                        ['initial_capital_krw', 'REAL', '$.initial_capital_krw'], ['usd_to_krw', 'REAL', '$.usd_to_krw']],
  llm_usage: [['at', 'TEXT', '$.at'], ['role', 'TEXT', '$.role'], ['model', 'TEXT', '$.model'],
              ['input', 'INTEGER', '$.input'], ['output', 'INTEGER', '$.output']],
  pipeline_runs: [['started_at', 'TEXT', '$.started_at'], ['report_id', 'TEXT', '$.report_id'], ['ok', 'INTEGER', '$.ok']],
};
/** 인덱스 — [테이블, 열, UNIQUE 여부] */
const INDEXES: Array<[string, string, boolean]> = [
  ['trades', 'id', true], ['trades', 'traded_at', false], ['trades', 'symbol', false],
  ['decisions', 'report_id', false], ['positions', 'symbol', false], ['performance_history', 'date', false],
  ['llm_usage', 'at', false], ['pipeline_runs', 'started_at', false],
];

/** 스키마에 없는 컬렉션 이름이 테이블 이름으로 쓰여도 안전하도록 영숫자·밑줄만 허용 */
function tableOf(name: string): string {
  if (!/^[a-z][a-z0-9_]*$/i.test(name)) throw new Error(`잘못된 컬렉션 이름: ${name}`);
  return name;
}

export class SqliteDatabase {
  private sql: Sqlite;
  private ready = new Set<string>();
  readonly file: string;

  /** @param file DB 파일 경로 (기본 data/db/autotrader.sqlite, SQLITE_PATH로 변경 가능) */
  constructor(file: string = process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'db', 'autotrader.sqlite')) {
    this.file = file;
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DatabaseSync } = require('node:sqlite');
    this.sql = new DatabaseSync(file) as Sqlite;
    // WAL: 읽기와 쓰기가 서로 막지 않는다. synchronous=FULL: 커밋된 거래 기록은 전원이 나가도 남는다
    // (감사 기록이라 속도보다 내구성을 택한다 — 쓰기는 하루 수십 건 수준).
    this.sql.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    this.sql.exec('CREATE TABLE IF NOT EXISTS docs (name TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)');
  }

  /** 컬렉션 테이블을 (없으면) 만든다. 처음 쓰는 이름도 자동으로 생긴다 */
  private ensure(name: string): string {
    const t = tableOf(name);
    if (this.ready.has(t)) return t;
    const gen = (SCHEMA[t] || []).map(([col, type, p]) =>
      `, "${col}" ${type} GENERATED ALWAYS AS (json_extract(data, '${p}')) VIRTUAL`).join('');
    this.sql.exec(`CREATE TABLE IF NOT EXISTS "${t}" (seq INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL${gen})`);
    for (const [tbl, col, uniq] of INDEXES) {
      if (tbl === t) this.sql.exec(`CREATE ${uniq ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS "idx_${t}_${col}" ON "${t}"("${col}")`);
    }
    this.ready.add(t);
    return t;
  }

  /** 여러 문장을 하나의 트랜잭션으로 — 중간에 실패하면 전부 되돌린다 */
  private tx<T>(fn: () => T): T {
    this.sql.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.sql.exec('COMMIT'); return r; }
    catch (e) { this.sql.exec('ROLLBACK'); throw e; }
  }

  /** 초기화 (JsonDatabase 호환 — 생성자에서 이미 열려 있다) */
  async initialize(): Promise<void> {
    console.log(`✅ SQLite 데이터베이스 초기화 완료: ${this.file}`);
  }

  // 컬렉션별 직렬화 락 — 각 SQL은 원자적이지만 호출부의 "읽고 → 고치고 → 쓰기" 묶음은
  // await를 사이에 두므로 여전히 겹칠 수 있다 (watcher 매도와 executor 집행이 같은 분에 겹치는 경우)
  private locks = new Map<string, Promise<unknown>>();

  /**
   * 컬렉션 단위 임계 구역 실행 — 같은 컬렉션에 대한 fn들을 순차 실행
   * @param name 컬렉션 이름 / @param fn 임계 구역 (read-modify-write 묶음)
   */
  async withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(name) || Promise.resolve();
    const run = prev.then(fn, fn);
    this.locks.set(name, run.catch(() => undefined));
    return run;
  }

  /** 컬렉션 전체를 넣은 순서대로 읽는다 (없으면 빈 배열) */
  async read<T>(name: string): Promise<T[]> {
    const t = this.ensure(name);
    return this.sql.prepare(`SELECT data FROM "${t}" ORDER BY seq`).all().map(r => JSON.parse(r.data) as T);
  }

  /** 컬렉션 전체를 교체한다 — 하나의 트랜잭션이라 중간 상태가 남지 않는다 */
  async write<T>(name: string, data: T[]): Promise<void> {
    const t = this.ensure(name);
    this.tx(() => {
      this.sql.exec(`DELETE FROM "${t}"`);
      const ins = this.sql.prepare(`INSERT INTO "${t}" (data) VALUES (?)`);
      for (const item of data) ins.run(JSON.stringify(item));
    });
  }

  /** 한 건 추가 — id가 없으면 숫자 id를 자동 부여 (기존 최대값 + 1) */
  async insert<T extends { id?: string | number; [key: string]: any }>(name: string, item: T): Promise<T> {
    return this.withLock(name, async () => {
      const t = this.ensure(name);
      this.tx(() => {
        if (!item.id) {
          const row = this.sql.prepare(
            `SELECT MAX(CAST(json_extract(data, '$.id') AS INTEGER)) AS m FROM "${t}" WHERE json_type(data, '$.id') = 'integer'`).get();
          (item as any).id = (row?.m ?? 0) + 1;
        }
        this.sql.prepare(`INSERT INTO "${t}" (data) VALUES (?)`).run(JSON.stringify(item));
      });
      return item;
    });
  }

  /** keyField가 같은 행이 있으면 병합 갱신, 없으면 추가 */
  async upsert<T extends { [key: string]: any }>(name: string, item: T, keyField: string = 'id'): Promise<T> {
    return this.withLock(name, async () => {
      const t = this.ensure(name);
      if (!/^[a-z_][a-z0-9_]*$/i.test(keyField)) throw new Error(`잘못된 키 필드: ${keyField}`);
      this.tx(() => {
        const row = this.sql.prepare(`SELECT seq, data FROM "${t}" WHERE json_extract(data, '$.${keyField}') = ? ORDER BY seq LIMIT 1`).get(item[keyField]);
        if (row) {
          this.sql.prepare(`UPDATE "${t}" SET data = ? WHERE seq = ?`).run(JSON.stringify({ ...JSON.parse(row.data), ...item }), row.seq);
        } else {
          this.sql.prepare(`INSERT INTO "${t}" (data) VALUES (?)`).run(JSON.stringify(item));
        }
      });
      return item;
    });
  }

  /** 조건에 맞는 항목 조회 (조건 없으면 전체) */
  async find<T>(name: string, condition?: (item: T) => boolean): Promise<T[]> {
    const data = await this.read<T>(name);
    return condition ? data.filter(condition) : data;
  }

  /** 조건에 맞는 첫 항목 (없으면 null) */
  async findOne<T>(name: string, condition: (item: T) => boolean): Promise<T | null> {
    const r = await this.find(name, condition);
    return r.length > 0 ? r[0] : null;
  }

  /** 조건에 맞는 항목 삭제 — 삭제한 건수 반환 */
  async delete<T>(name: string, condition: (item: T) => boolean): Promise<number> {
    const t = this.ensure(name);
    return this.tx(() => {
      const rows = this.sql.prepare(`SELECT seq, data FROM "${t}" ORDER BY seq`).all();
      const del = this.sql.prepare(`DELETE FROM "${t}" WHERE seq = ?`);
      let n = 0;
      for (const r of rows) if (condition(JSON.parse(r.data) as T)) { del.run(r.seq); n++; }
      return n;
    });
  }

  /** 컬렉션에 데이터가 있는지 (JsonDatabase의 '파일 존재'에 대응) */
  async exists(name: string): Promise<boolean> {
    const t = this.ensure(name);
    return (this.sql.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get()?.c ?? 0) > 0;
  }

  /** 단일 문서 읽기 — 배열이 아닌 객체 하나짜리 데이터 (스케줄러 상태, 셋업 태그 등) */
  async getDoc<T>(name: string): Promise<T | null> {
    const row = this.sql.prepare('SELECT data FROM docs WHERE name = ?').get(name);
    return row ? JSON.parse(row.data) as T : null;
  }

  /** 단일 문서 쓰기 (통째로 교체) */
  async setDoc<T>(name: string, value: T): Promise<void> {
    this.sql.prepare('INSERT INTO docs (name, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
      .run(name, JSON.stringify(value), new Date().toISOString());
  }

  /** 컬렉션 건수 (검증·상태 표시용) */
  count(name: string): number {
    const t = this.ensure(name);
    return this.sql.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get()?.c ?? 0;
  }

  /**
   * 일관된 백업 파일을 만든다 (VACUUM INTO — 쓰기 중에도 안전한 스냅샷).
   * @param dest 백업 파일 경로 (이미 있으면 덮어쓴다)
   */
  backupTo(dest: string): void {
    if (fs.existsSync(dest)) fs.rmSync(dest);
    this.sql.prepare('VACUUM INTO ?').run(dest);
  }
}
