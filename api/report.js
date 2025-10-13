/**
 * Vercel 서버리스 함수: 특정 리포트 내용 API
 * GET /api/report?filename=20250915_unified_gpt5.md
 * GitHub Repository에서 직접 데이터 가져오기
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
    console.log('📡 [/api/report] Request query:', req.query);

    const { filename } = req.query;

    if (!filename) {
      console.log('❌ [/api/report] No filename provided');
      return res.status(400).json({ success: false, error: 'Filename is required' });
    }

    console.log('📄 [/api/report] Requested filename:', filename);

    // 보안: 파일명 검증
    if (!/^[\w\d_-]+\.md$/.test(filename)) {
      console.log('❌ [/api/report] Invalid filename format:', filename);
      return res.status(400).json({ success: false, error: 'Invalid filename' });
    }

    // GitHub에서 파일 내용 가져오기
    const GITHUB_REPO = 'kx2471/nasdaq_auto';
    const GITHUB_BRANCH = 'main';
    const contentUrl = `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/data/report/${filename}`;

    console.log('🔗 [/api/report] Fetching from:', contentUrl);

    const response = await fetch(contentUrl);

    console.log('📥 [/api/report] GitHub response status:', response.status);

    if (!response.ok) {
      if (response.status === 404) {
        console.log('⚠️ [/api/report] File not found');
        return res.status(404).json({ success: false, error: 'Report not found' });
      }
      throw new Error(`GitHub fetch error: ${response.status}`);
    }

    const content = await response.text();
    console.log('✅ [/api/report] Content loaded, length:', content.length);

    res.status(200).json({
      success: true,
      data: {
        filename,
        content
      }
    });

  } catch (error) {
    console.error('❌ [/api/report] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
};
