/**
 * Vercel 서버리스 함수: 리포트 목록 API
 * GET /api/reports
 */

const fs = require('fs');
const path = require('path');

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
    const reportDir = path.join(process.cwd(), 'data', 'report');

    // 디렉토리 존재 확인
    if (!fs.existsSync(reportDir)) {
      return res.status(200).json({ success: true, data: [] });
    }

    const files = fs.readdirSync(reportDir);

    // .md 파일만 필터링하고 날짜순 정렬
    const mdFiles = files
      .filter(file => file.endsWith('.md') && !file.includes('_meta'))
      .sort((a, b) => b.localeCompare(a)) // 최신순
      .slice(0, 20); // 최근 20개만

    const reports = [];

    for (const file of mdFiles) {
      const match = file.match(/^(\d{8})(?:_(\d{4}))?_(.+)\.md$/);
      if (match) {
        const date = match[1];
        const time = match[2] || '';
        const type = match[3];

        try {
          const filePath = path.join(reportDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');

          // 첫 줄을 제목으로 사용
          const lines = content.split('\n');
          const title = lines[0].replace(/^#\s*/, '').trim() || type;

          // 첫 200자를 요약으로 사용
          const summary = content.substring(0, 200).trim() + '...';

          reports.push({
            filename: file,
            date: date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
            time: time ? time.replace(/(\d{2})(\d{2})/, '$1:$2') : null,
            sector: type,
            title,
            summary,
            htmlPath: file.replace('.md', '.html'),
            createdAt: null
          });
        } catch (error) {
          console.error(`Error reading file ${file}:`, error);
        }
      }
    }

    res.status(200).json({
      success: true,
      data: reports
    });

  } catch (error) {
    console.error('Error listing reports:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
};
