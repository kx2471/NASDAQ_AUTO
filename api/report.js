/**
 * Vercel Serverless Function - 보고서 생성 트리거 API
 *
 * POST /api/report - GitHub Actions 워크플로우 트리거
 * GET /api/report - 최신 보고서 조회
 */

/**
 * GitHub API 클라이언트 생성
 */
async function createOctokit(token) {
  const { Octokit } = await import('@octokit/rest');
  return new Octokit({
    auth: token
  });
}

/**
 * GitHub Actions 워크플로우 트리거
 */
async function triggerWorkflow(octokit, workflowId, ref = 'dev') {
  try {
    await octokit.actions.createWorkflowDispatch({
      owner: 'kx2471',
      repo: 'NASDAQ_AUTO',
      workflow_id: workflowId,
      ref: ref,
      inputs: {}
    });
    return true;
  } catch (error) {
    console.error(`Failed to trigger workflow ${workflowId}:`, error);
    throw error;
  }
}

/**
 * 최신 보고서 파일 목록 조회
 */
async function getLatestReports(octokit) {
  try {
    // data/report 폴더의 파일 목록 조회
    const { data } = await octokit.repos.getContent({
      owner: 'kx2471',
      repo: 'NASDAQ_AUTO',
      path: 'data/report',
      ref: 'dev'
    });

    // .md 파일만 필터링하고 최신순 정렬
    const reports = data
      .filter(file => file.name.endsWith('.md') && file.type === 'file')
      .map(file => ({
        name: file.name,
        path: file.path,
        url: file.download_url,
        size: file.size
      }))
      .sort((a, b) => b.name.localeCompare(a.name)); // 최신순

    // 보고서 종류별로 분류
    const weekly = reports.filter(r => r.name.includes('weekly_agent'));
    const manager = reports.filter(r => r.name.includes('manager_final'));

    return {
      weekly: weekly.slice(0, 5), // 최근 5개
      manager: manager.slice(0, 5), // 최근 5개
      all: reports.slice(0, 10) // 전체 최근 10개
    };
  } catch (error) {
    console.error('Failed to get reports:', error);
    return { weekly: [], manager: [], all: [] };
  }
}

/**
 * 보고서 내용 읽기
 */
async function readReport(octokit, filePath) {
  try {
    const { data } = await octokit.repos.getContent({
      owner: 'kx2471',
      repo: 'NASDAQ_AUTO',
      path: filePath,
      ref: 'dev'
    });

    const content = Buffer.from(data.content, 'base64').toString('utf8');
    return content;
  } catch (error) {
    console.error(`Failed to read report ${filePath}:`, error);
    throw new Error('보고서를 읽을 수 없습니다.');
  }
}

/**
 * API Handler
 */
module.exports = async (req, res) => {
  // CORS 헤더 설정
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');

  // OPTIONS 요청 처리
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // 인증 토큰 확인
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Authorization header required',
        message: 'Authorization: Bearer YOUR_GITHUB_TOKEN'
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const octokit = await createOctokit(token);

    // POST - 보고서 생성 트리거
    if (req.method === 'POST') {
      const { type } = req.body;

      if (!type || !['weekly', 'manager'].includes(type)) {
        return res.status(400).json({
          error: 'Invalid type',
          message: 'type must be "weekly" or "manager"'
        });
      }

      // 워크플로우 파일명
      const workflowFile = type === 'weekly'
        ? 'daily-report.yml'
        : 'manager-report.yml';

      await triggerWorkflow(octokit, workflowFile, 'dev');

      return res.status(200).json({
        success: true,
        message: `${type} 보고서 생성이 시작되었습니다. 5-10분 후 완료됩니다.`,
        type: type
      });
    }

    // GET - 최신 보고서 목록 조회
    if (req.method === 'GET') {
      const { file } = req.query;

      // 특정 파일 내용 조회
      if (file) {
        const content = await readReport(octokit, file);
        return res.status(200).json({
          success: true,
          file: file,
          content: content
        });
      }

      // 보고서 목록 조회
      const reports = await getLatestReports(octokit);

      return res.status(200).json({
        success: true,
        reports: reports
      });
    }

    // 지원하지 않는 메서드
    return res.status(405).json({
      error: 'Method not allowed',
      allowed: ['GET', 'POST']
    });

  } catch (error) {
    console.error('Report API Error:', error);
    return res.status(500).json({
      error: error.message || 'Internal server error'
    });
  }
};
