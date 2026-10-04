import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * 운영 데이터 보호 — 저장소 밖 스냅샷 + 감사 기록 역행 감지.
 *
 * 왜 필요한가: 실서버가 쓰는 데이터 파일(trades.json 등)이 git 작업 폴더 안에 있어서,
 * stash·reset·checkout 한 번이면 커밋 시점으로 조용히 되돌아간다.
 * 2026-10-01 20:27 `/teleport`가 자동 stash + reset을 실행했고(취소했지만 stash는 복원되지
 * 않았다), trades.json에서 9/28 ZETA 매도와 9/30 OKTA 2차 익절 매도가 사라졌다.
 * 서버는 되돌려진 파일 위에 계속 기록했고, 3일간 아무 경고가 없었다 — 실현 원장과
 * 주간 회고가 빠진 기록으로 돌았다. (stash에 남아 있어 병합 복구함)
 *
 * 대응은 두 겹이다:
 *  ① 스냅샷: git이 건드릴 수 없는 저장소 밖 위치에 주기적으로 복사해 둔다
 *  ② 역행 감지: 감사 기록은 늘어나기만 해야 한다. 건수나 최대 id가 줄면 즉시 드러낸다
 */

const ROOT = process.cwd();
/** 스냅샷 대상 — 토스가 모르는 정보(의도·기록)와 학습 산출물 */
const FILES = [
  'data/json/trades.json',
  'data/json/decisions.json',
  'data/json/positions.json',
  'data/json/performance_history.json',
  'data/json/llm_usage.json',
  'data/json/pipeline_runs.json',
  'data/report/manager_journal.md',
  'data/report/manager_playbook.md',
];
const KEEP_SNAPSHOTS = 40;

/** 스냅샷 위치 — 저장소 밖이어야 한다 (DATA_SNAPSHOT_DIR로 변경 가능) */
function snapshotRoot(): string {
  return process.env.DATA_SNAPSHOT_DIR
    || path.join(os.homedir(), 'Library', 'Application Support', 'nasdaq-autotrader', 'snapshots');
}

/**
 * 운영 데이터를 저장소 밖으로 복사한다. 실패해도 호출부를 막지 않는다.
 * @param reason 스냅샷 계기 (폴더 이름에 붙는다 — 예: 'pre-pipeline')
 * @returns 만든 스냅샷 경로 (실패 시 null)
 */
export async function snapshotData(reason: string): Promise<string | null> {
  try {
    const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).replace(/[-: ]/g, '').slice(0, 12);
    const dir = path.join(snapshotRoot(), `${stamp}_${reason.replace(/[^a-z0-9-]/gi, '')}`);
    await fs.mkdir(dir, { recursive: true });
    for (const f of FILES) {
      try { await fs.copyFile(path.join(ROOT, f), path.join(dir, path.basename(f))); } catch { /* 파일이 아직 없을 수 있다 */ }
    }
    // 오래된 스냅샷 정리
    const all = (await fs.readdir(snapshotRoot())).filter(n => /^\d{12}_/.test(n)).sort();
    for (const old of all.slice(0, Math.max(0, all.length - KEEP_SNAPSHOTS))) {
      await fs.rm(path.join(snapshotRoot(), old), { recursive: true, force: true });
    }
    return dir;
  } catch (e) {
    console.warn('⚠️ 데이터 스냅샷 실패(무시):', (e as Error).message);
    return null;
  }
}

/** 감사 기록의 최고 수위 (지금까지 본 최대 건수·최대 id) */
export interface TradesHighWater { count: number; maxId: number; at: string }

/**
 * trades.json이 역행했는지 검사한다 (감사 기록은 늘어나기만 해야 한다).
 * @param prev 이전에 기록한 최고 수위 (없으면 첫 검사)
 * @returns next: 갱신된 수위 / problem: 역행이면 사람이 읽을 설명 (정상은 null)
 */
export async function checkTradesIntegrity(prev: TradesHighWater | undefined): Promise<{ next: TradesHighWater; problem: string | null }> {
  const raw = JSON.parse(await fs.readFile(path.join(ROOT, 'data/json/trades.json'), 'utf-8')) as Array<{ id?: number }>;
  const count = raw.length;
  const maxId = raw.reduce((m, t) => Math.max(m, t.id ?? 0), 0);
  if (prev && (count < prev.count || maxId < prev.maxId)) {
    return {
      next: prev, // 수위를 낮추지 않는다 — 복구될 때까지 경고가 유지돼야 한다
      problem: `거래 기록이 줄었습니다: ${prev.count}건(최대 id ${prev.maxId}) → ${count}건(최대 id ${maxId}). ` +
        `git stash·reset·checkout 등으로 파일이 되돌려졌을 수 있습니다. 스냅샷: ${snapshotRoot()}`,
    };
  }
  return { next: { count, maxId, at: new Date().toISOString() }, problem: null };
}
