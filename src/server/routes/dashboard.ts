import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { getHoldings, getCashBalance } from '../../storage/database';
import { getCachedExchangeRate } from '../../services/exchange';
import { fetchDailyPrices } from '../../services/market';
import { calculateCurrentPerformance, analyzeTargetProgress } from '../../services/performance';

const router = express.Router();

/**
 * 대시보드 메인 페이지
 * GET /dashboard
 */
router.get('/', async (req, res) => {
  try {
    const dashboardHtml = await generateDashboardHtml();
    res.send(dashboardHtml);
  } catch (error) {
    console.error('❌ 대시보드 로드 실패:', error);
    res.status(500).send('대시보드를 불러올 수 없습니다.');
  }
});

/**
 * 포트폴리오 현황 API
 * GET /dashboard/api/portfolio
 */
router.get('/api/portfolio', async (req, res) => {
  try {
    const [holdings, cashBalance, exchangeRate] = await Promise.all([
      getHoldings(),
      getCashBalance(),
      getCachedExchangeRate()
    ]);

    // 보유 종목 현재가 조회
    const symbols = holdings.map(h => h.symbol);
    const pricesData = await fetchDailyPrices(symbols);
    
    const currentPrices: Record<string, number> = {};
    for (const [symbol, prices] of Object.entries(pricesData)) {
      if (prices.length > 0) {
        currentPrices[symbol] = prices[prices.length - 1].close;
      }
    }

    // 성과 계산
    const performance = calculateCurrentPerformance(
      holdings,
      currentPrices,
      exchangeRate.usd_to_krw
    );

    const targetAnalysis = analyzeTargetProgress(performance);

    res.json({
      success: true,
      data: {
        holdings: holdings.map(h => ({
          ...h,
          current_price: currentPrices[h.symbol] || 0,
          current_value: (currentPrices[h.symbol] || 0) * h.shares,
          pnl: ((currentPrices[h.symbol] || 0) - h.avg_cost) * h.shares,
          pnl_percent: h.avg_cost > 0 ? (((currentPrices[h.symbol] || 0) - h.avg_cost) / h.avg_cost * 100) : 0
        })),
        performance,
        targetAnalysis,
        exchangeRate: exchangeRate.usd_to_krw,
        lastUpdated: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ 포트폴리오 데이터 조회 실패:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * 성과 기록 API
 * GET /dashboard/api/performance
 */
router.get('/api/performance', async (req, res) => {
  try {
    const performanceFile = path.join(process.cwd(), 'data/json/performance_history.json');
    
    try {
      const data = await fs.readFile(performanceFile, 'utf-8');
      const performanceHistory = JSON.parse(data);
      
      res.json({
        success: true,
        data: performanceHistory
      });
    } catch (fileError) {
      // 파일이 없으면 빈 배열 반환
      res.json({
        success: true,
        data: []
      });
    }

  } catch (error) {
    console.error('❌ 성과 데이터 조회 실패:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * 최근 리포트 목록 API
 * GET /dashboard/api/reports
 */
router.get('/api/reports', async (req, res) => {
  try {
    const reportDir = path.join(process.cwd(), 'data/report');
    const files = await fs.readdir(reportDir);
    
    // 메타데이터 파일 필터링하고 날짜순 정렬
    const metaFiles = files
      .filter(file => file.endsWith('_meta.json'))
      .sort((a, b) => b.localeCompare(a)) // 최신순
      .slice(0, 20); // 최근 20개만

    const reports = await Promise.all(
      metaFiles.map(async (file) => {
        try {
          const filePath = path.join(reportDir, file);
          const metaContent = await fs.readFile(filePath, 'utf-8');
          const metadata = JSON.parse(metaContent);
          
          return {
            filename: path.basename(metadata.mdPath),
            date: metadata.date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
            sector: metadata.type,
            title: metadata.title,
            summary: metadata.summary,
            htmlPath: metadata.htmlPath,
            createdAt: metadata.createdAt
          };
        } catch (error) {
          console.error(`❌ 메타데이터 파일 읽기 실패: ${file}`, error);
          return null;
        }
      })
    );

    // null 값 필터링
    const validReports = reports.filter(report => report !== null);

    // 기존 .md 파일도 포함하여 호환성 유지 (메타데이터가 없는 경우)
    const mdFiles = files
      .filter(file => file.endsWith('.md') && !file.includes('_meta'))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 5); // 최근 5개만 추가 확인

    for (const file of mdFiles) {
      const match = file.match(/^(\d{8})_(.+)\.md$/);
      if (match) {
        const date = match[1];
        const sector = match[2];
        
        // 이미 메타데이터가 있는 리포트는 제외
        const alreadyExists = validReports.some(r => 
          r.filename === file && r.date === date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')
        );
        
        if (!alreadyExists) {
          try {
            const filePath = path.join(reportDir, file);
            const content = await fs.readFile(filePath, 'utf-8');
            
            validReports.push({
              filename: file,
              date: date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
              sector,
              title: content.split('\n')[0].replace(/^#\s*/, ''),
              summary: content.substring(0, 200) + '...', // 기본 요약
              htmlPath: null,
              createdAt: null
            });
          } catch (error) {
            console.error(`❌ 레거시 리포트 파일 읽기 실패: ${file}`, error);
          }
        }
      }
    }

    // 날짜순 재정렬
    validReports.sort((a, b) => b.date.localeCompare(a.date));

    res.json({
      success: true,
      data: validReports.slice(0, 20) // 최종적으로 20개만
    });

  } catch (error) {
    console.error('❌ 리포트 목록 조회 실패:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * 특정 리포트 내용 API
 * GET /dashboard/api/reports/:filename
 */
router.get('/api/reports/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    
    // 보안: 파일명 검증 (YYYYMMDD_HHMM_name.md 또는 YYYYMMDD_name.md)
    if (!/^\d{8}(_\d{4})?_[a-z_]+\.md$/.test(filename)) {
      return res.status(400).json({ success: false, error: 'Invalid filename' });
    }

    const filePath = path.join(process.cwd(), 'data/report', filename);
    const content = await fs.readFile(filePath, 'utf-8');
    
    res.json({
      success: true,
      data: {
        filename,
        content
      }
    });

  } catch (error: any) {
    if (error.code === 'ENOENT') {
      res.status(404).json({ success: false, error: 'Report not found' });
    } else {
      console.error('❌ 리포트 조회 실패:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
});

/**
 * 대시보드 HTML 생성
 */
async function generateDashboardHtml(): Promise<string> {
  return `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>📊 Nasdaq AutoTrader Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
               background: #f5f7fa; color: #2c3e50; line-height: 1.6; }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { text-align: center; margin-bottom: 40px; }
        .header h1 { color: #2c3e50; font-size: 2.5rem; margin-bottom: 10px; }
        .header p { color: #7f8c8d; font-size: 1.1rem; }
        
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); 
                      gap: 20px; margin-bottom: 40px; }
        .stat-card { background: white; padding: 25px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                     border-left: 4px solid #3498db; }
        .stat-card h3 { color: #7f8c8d; font-size: 0.9rem; text-transform: uppercase; 
                        letter-spacing: 1px; margin-bottom: 8px; }
        .stat-card .value { font-size: 2rem; font-weight: bold; color: #2c3e50; }
        .stat-card .change { font-size: 0.9rem; margin-top: 5px; }
        .positive { color: #27ae60; }
        .negative { color: #e74c3c; }
        
        .progress-bar { width: 100%; height: 20px; background: #ecf0f1; border-radius: 10px; 
                        overflow: hidden; margin: 10px 0; }
        .progress-fill { height: 100%; background: linear-gradient(90deg, #3498db, #2ecc71); 
                         transition: width 0.3s ease; }
        
        .section { background: white; border-radius: 12px; padding: 30px; margin-bottom: 30px; 
                   box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .section h2 { color: #2c3e50; margin-bottom: 20px; font-size: 1.5rem; }
        
        .holdings-table { width: 100%; border-collapse: collapse; }
        .holdings-table th, .holdings-table td { padding: 12px; text-align: left; border-bottom: 1px solid #ecf0f1; }
        .holdings-table th { background: #f8f9fa; font-weight: 600; color: #2c3e50; }
        
        .reports-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
        .report-card { border: 1px solid #ecf0f1; border-radius: 8px; padding: 20px; 
                       cursor: pointer; transition: all 0.2s; }
        .report-card:hover { transform: translateY(-2px); box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
        .report-card .date { color: #3498db; font-weight: bold; }
        .report-card .sector { background: #3498db; color: white; padding: 4px 8px; 
                              border-radius: 4px; font-size: 0.8rem; display: inline-block; margin: 8px 0; }
        
        .loading { text-align: center; color: #7f8c8d; padding: 40px; }
        .error { color: #e74c3c; text-align: center; padding: 20px; }
        
        @media (max-width: 768px) {
            .container { padding: 10px; }
            .header h1 { font-size: 2rem; }
            .stats-grid { grid-template-columns: 1fr; }
            .stat-card .value { font-size: 1.5rem; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 Nasdaq AutoTrader</h1>
            <p>1년 1000만원 목표 달성을 위한 포트폴리오 대시보드</p>
        </div>

        <!-- 주요 지표 -->
        <div class="stats-grid" id="statsGrid">
            <div class="loading">포트폴리오 데이터 로딩 중...</div>
        </div>

        <!-- 목표 진행률 -->
        <div class="section">
            <h2>🎯 1000만원 목표 진행률</h2>
            <div id="targetProgress">
                <div class="loading">목표 진행률 로딩 중...</div>
            </div>
        </div>

        <!-- 보유 종목 -->
        <div class="section">
            <h2>💼 보유 종목</h2>
            <div id="holdingsTable">
                <div class="loading">보유 종목 로딩 중...</div>
            </div>
        </div>

        <!-- 최근 리포트 -->
        <div class="section">
            <h2>📄 최근 리포트</h2>
            <div id="recentReports">
                <div class="loading">리포트 로딩 중...</div>
            </div>
        </div>
    </div>

    <script>
        // 페이지 로드시 데이터 가져오기
        document.addEventListener('DOMContentLoaded', function() {
            loadDashboardData();
            loadRecentReports();
            
            // 30초마다 데이터 새로고침
            setInterval(loadDashboardData, 30000);
        });

        async function loadDashboardData() {
            try {
                const response = await fetch('/dashboard/api/portfolio');
                const result = await response.json();
                
                if (result.success) {
                    updateStatsGrid(result.data);
                    updateTargetProgress(result.data);
                    updateHoldingsTable(result.data);
                } else {
                    showError('포트폴리오 데이터를 불러올 수 없습니다.');
                }
            } catch (error) {
                console.error('데이터 로드 실패:', error);
                showError('서버 연결에 실패했습니다.');
            }
        }

        function updateStatsGrid(data) {
            const { performance, exchangeRate } = data;
            const grid = document.getElementById('statsGrid');
            
            grid.innerHTML = \`
                <div class="stat-card">
                    <h3>현재 포트폴리오 가치</h3>
                    <div class="value">₩\${performance.current_value_krw.toLocaleString()}</div>
                    <div class="change \${performance.total_return_krw >= 0 ? 'positive' : 'negative'}">
                        \${performance.total_return_krw >= 0 ? '+' : ''}₩\${performance.total_return_krw.toLocaleString()}
                    </div>
                </div>
                <div class="stat-card">
                    <h3>총 수익률</h3>
                    <div class="value \${performance.total_return_percent >= 0 ? 'positive' : 'negative'}">
                        \${performance.total_return_percent >= 0 ? '+' : ''}\${performance.total_return_percent}%
                    </div>
                    <div class="change">투자원금: ₩\${performance.total_investment_krw.toLocaleString()}</div>
                </div>
                <div class="stat-card">
                    <h3>실시간 환율</h3>
                    <div class="value">₩\${exchangeRate.toFixed(2)}</div>
                    <div class="change">1 USD 기준</div>
                </div>
                <div class="stat-card">
                    <h3>마지막 업데이트</h3>
                    <div class="value" style="font-size: 1.2rem;">
                        \${new Date(data.lastUpdated).toLocaleString('ko-KR')}
                    </div>
                </div>
            \`;
        }

        function updateTargetProgress(data) {
            const { targetAnalysis } = data;
            const container = document.getElementById('targetProgress');
            
            container.innerHTML = \`
                <div class="progress-bar">
                    <div class="progress-fill" style="width: \${targetAnalysis.progress_percent}%"></div>
                </div>
                <p><strong>\${targetAnalysis.progress_percent}%</strong> 달성 
                   (₩\${targetAnalysis.remaining_amount_krw.toLocaleString()} 남음)</p>
                <p>필요 수익률: <strong>\${targetAnalysis.required_return_percent}%</strong> 
                   | 현재 수익률: <strong>\${targetAnalysis.current_return_percent}%</strong></p>
                <p>\${targetAnalysis.is_on_track ? '✅ 목표 달성 가능' : '⚠️ 전략 재검토 필요'}</p>
            \`;
        }

        function updateHoldingsTable(data) {
            const { holdings } = data;
            const container = document.getElementById('holdingsTable');
            
            let tableHtml = \`
                <table class="holdings-table">
                    <thead>
                        <tr>
                            <th>종목</th>
                            <th>수량</th>
                            <th>평단가</th>
                            <th>현재가</th>
                            <th>평가액</th>
                            <th>수익률</th>
                        </tr>
                    </thead>
                    <tbody>
            \`;
            
            holdings.forEach(holding => {
                tableHtml += \`
                    <tr>
                        <td><strong>\${holding.symbol}</strong></td>
                        <td>\${holding.shares}</td>
                        <td>$\${holding.avg_cost.toFixed(2)}</td>
                        <td>$\${holding.current_price.toFixed(2)}</td>
                        <td>$\${holding.current_value.toFixed(2)}</td>
                        <td class="\${holding.pnl_percent >= 0 ? 'positive' : 'negative'}">
                            \${holding.pnl_percent >= 0 ? '+' : ''}\${holding.pnl_percent.toFixed(1)}%
                        </td>
                    </tr>
                \`;
            });
            
            tableHtml += '</tbody></table>';
            container.innerHTML = tableHtml;
        }

        async function loadRecentReports() {
            try {
                console.log('리포트 로딩 시작...');
                const response = await fetch('/dashboard/api/reports');
                const result = await response.json();
                
                console.log('리포트 API 응답:', result);
                
                if (result.success) {
                    console.log('리포트 ' + result.data.length + '개 로드됨');
                    updateRecentReports(result.data);
                } else {
                    console.error('리포트 API 실패:', result.error);
                    document.getElementById('recentReports').innerHTML = '<div class="error">리포트를 불러올 수 없습니다.</div>';
                }
            } catch (error) {
                console.error('리포트 로드 실패:', error);
                document.getElementById('recentReports').innerHTML = '<div class="error">서버 연결에 실패했습니다.</div>';
            }
        }

        function updateRecentReports(reports) {
            const container = document.getElementById('recentReports');
            
            console.log('리포트 UI 업데이트 중...', reports);
            
            if (reports.length === 0) {
                container.innerHTML = '<p>저장된 리포트가 없습니다.</p>';
                return;
            }
            
            let reportsHtml = '<div class="reports-grid">';
            
            reports.slice(0, 6).forEach(report => {
                reportsHtml += \`
                    <div class="report-card" onclick="openReport('\${report.filename}')">
                        <div class="date">\${report.date}</div>
                        <div class="sector">\${report.sector === 'unified' ? '통합분석' : report.sector}</div>
                        <h4>\${report.title}</h4>
                        <p style="color: #7f8c8d; font-size: 0.9rem; margin-top: 8px;">\${report.summary}</p>
                    </div>
                \`;
            });
            
            reportsHtml += '</div>';
            container.innerHTML = reportsHtml;
        }

        function openReport(filename) {
            window.open(\`/dashboard/api/reports/\${filename}\`, '_blank');
        }

        function showError(message) {
            document.getElementById('statsGrid').innerHTML = \`<div class="error">\${message}</div>\`;
        }
    </script>
</body>
</html>
  `.trim();
}

export default router;