/**
 * Vercel 서버리스 함수: 리포트 목록 API
 * GET /api/reports
 * GitHub Repository에서 직접 데이터 가져오기
 * Updated: 2025-10-13 - Fixed report paths
 */

module.exports = async (req, res) => {
  // CORS 헤더 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    console.log('📡 [/api/reports] Starting request...');

    // GitHub API를 통해 data/report 디렉토리 내용 가져오기
    const GITHUB_REPO = 'kx2471/nasdaq_auto';
    const GITHUB_BRANCH = 'main';
    const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/data/report?ref=${GITHUB_BRANCH}`;

    console.log('🔗 [/api/reports] Fetching from:', apiUrl);

    const response = await fetch(apiUrl, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Nasdaq-AutoTrader'
      }
    });

    console.log('📥 [/api/reports] GitHub API response status:', response.status);

    if (!response.ok) {
      if (response.status === 404) {
        console.log('⚠️ [/api/reports] Directory not found, returning empty array');
        return res.status(200).json({ success: true, data: [] });
      }
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const files = await response.json();
    console.log('📂 [/api/reports] Found', files.length, 'files');

    // .md 파일만 필터링하고 날짜순 정렬
    const mdFiles = files
      .filter(file => file.name.endsWith('.md') && !file.name.includes('_meta'))
      .map(file => file.name)
      .sort((a, b) => b.localeCompare(a)) // 최신순
      .slice(0, 20); // 최근 20개만

    const reports = [];

    for (const filename of mdFiles) {
      const match = filename.match(/^(\d{8})(?:_(\d{4}))?_(.+)\.md$/);
      if (match) {
        const date = match[1];
        const time = match[2] || '';
        const type = match[3];

        try {
          // 파일 내용 가져오기
          const contentUrl = `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/data/report/${filename}`;
          const contentResponse = await fetch(contentUrl);
          const content = await contentResponse.text();

          // 첫 줄을 제목으로 사용
          const lines = content.split('\n');
          const title = lines[0].replace(/^#\s*/, '').trim() || type;

          // 첫 200자를 요약으로 사용
          const summary = content.substring(0, 200).trim() + '...';

          reports.push({
            filename,
            date: date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
            time: time ? time.replace(/(\d{2})(\d{2})/, '$1:$2') : null,
            sector: type,
            title,
            summary,
            htmlPath: filename.replace('.md', '.html'),
            createdAt: null
          });
        } catch (error) {
          console.error(`Error reading file ${filename}:`, error);
        }
      }
    }

    console.log('✅ [/api/reports] Returning', reports.length, 'reports');

    res.status(200).json({
      success: true,
      data: reports
    });

  } catch (error) {
    console.error('❌ [/api/reports] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
};
