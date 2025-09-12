import express from 'express';

const router = express.Router();

/**
 * 데이터베이스 뷰어 웹 페이지 (HTML 반환)
 */

// 데이터베이스 뷰어 메인 페이지
router.get('/', (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NASDAQ Auto - 데이터베이스 뷰어</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            margin: 0; 
            background: #f5f7fa; 
            color: #333;
        }
        .container { 
            max-width: 1200px; 
            margin: 0 auto; 
            padding: 20px; 
        }
        .header { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
            color: white; 
            padding: 30px; 
            border-radius: 12px; 
            margin-bottom: 30px; 
            text-align: center; 
        }
        .cards { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); 
            gap: 20px; 
            margin-bottom: 30px; 
        }
        .card { 
            background: white; 
            border-radius: 12px; 
            padding: 25px; 
            box-shadow: 0 4px 6px rgba(0,0,0,0.1); 
            border: 1px solid #e1e8ed; 
        }
        .card h3 { 
            margin: 0 0 15px 0; 
            color: #2c5aa0; 
            display: flex; 
            align-items: center; 
            gap: 8px; 
        }
        .btn { 
            background: #4CAF50; 
            color: white; 
            border: none; 
            padding: 12px 20px; 
            border-radius: 6px; 
            cursor: pointer; 
            text-decoration: none; 
            display: inline-block; 
            margin: 5px; 
            transition: all 0.3s;
        }
        .btn:hover { 
            background: #45a049; 
            transform: translateY(-2px); 
        }
        .btn-secondary { 
            background: #6c757d; 
        }
        .btn-secondary:hover { 
            background: #5a6268; 
        }
        .data-section { 
            background: white; 
            border-radius: 12px; 
            margin-bottom: 20px; 
            overflow: hidden; 
            box-shadow: 0 4px 6px rgba(0,0,0,0.1); 
        }
        .data-header { 
            background: #f8f9fa; 
            padding: 15px 25px; 
            border-bottom: 1px solid #dee2e6; 
            font-weight: 600; 
        }
        .data-content { 
            padding: 25px; 
        }
        .loading { 
            text-align: center; 
            padding: 40px; 
            color: #666; 
        }
        .error { 
            background: #f8d7da; 
            color: #721c24; 
            padding: 15px; 
            border-radius: 6px; 
            margin: 10px 0; 
        }
        table { 
            width: 100%; 
            border-collapse: collapse; 
        }
        th, td { 
            padding: 12px; 
            text-align: left; 
            border-bottom: 1px solid #dee2e6; 
        }
        th { 
            background: #f8f9fa; 
            font-weight: 600; 
        }
        .number { 
            text-align: right; 
            font-family: 'Monaco', 'Menlo', monospace; 
        }
        .positive { color: #28a745; }
        .negative { color: #dc3545; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 NASDAQ Auto 데이터베이스 뷰어</h1>
            <p>실시간 포트폴리오 및 거래 데이터 조회</p>
        </div>

        <div class="cards">
            <div class="card">
                <h3>💼 포트폴리오</h3>
                <p>현재 보유 종목 및 현금 잔액</p>
                <button class="btn" onclick="loadPortfolio()">포트폴리오 조회</button>
                <button class="btn btn-secondary" onclick="loadHoldings()">보유종목 상세</button>
            </div>
            
            <div class="card">
                <h3>📈 거래 기록</h3>
                <p>매수/매도 거래 내역</p>
                <button class="btn" onclick="loadTrades()">거래기록 조회</button>
                <button class="btn btn-secondary" onclick="loadCashEvents()">현금이벤트</button>
            </div>
            
            <div class="card">
                <h3>📊 종목 & 성과</h3>
                <p>종목 리스트 및 성과 기록</p>
                <button class="btn" onclick="loadSymbols()">종목리스트</button>
                <button class="btn btn-secondary" onclick="loadPerformance()">성과기록</button>
            </div>
            
            <div class="card">
                <h3>📝 리포트 기록</h3>
                <p>AI 리포트 생성 이력 및 성과</p>
                <button class="btn" onclick="loadReports()">리포트 기록</button>
                <button class="btn btn-secondary" onclick="loadReportStats()">리포트 통계</button>
            </div>
            
            <div class="card">
                <h3>🔧 시스템 상태</h3>
                <p>데이터베이스 및 파일 상태</p>
                <button class="btn" onclick="loadStatus()">시스템 상태</button>
                <button class="btn btn-secondary" onclick="refreshAll()">전체 새로고침</button>
            </div>
        </div>

        <div id="content">
            <div class="data-section">
                <div class="data-header">시작하기</div>
                <div class="data-content">
                    <p>위의 버튼들을 클릭해서 데이터를 조회하세요.</p>
                    <p><strong>API 키 필요:</strong> 이 페이지를 사용하려면 올바른 API 키가 필요합니다.</p>
                </div>
            </div>
        </div>
    </div>

    <script>
        const API_KEY = '${process.env.API_KEY || 'nasdaq-autotrader-secret-2025'}';
        
        function showLoading(title) {
            document.getElementById('content').innerHTML = \`
                <div class="data-section">
                    <div class="data-header">\${title}</div>
                    <div class="data-content">
                        <div class="loading">🔄 데이터를 불러오는 중...</div>
                    </div>
                </div>
            \`;
        }
        
        function showError(title, error) {
            document.getElementById('content').innerHTML = \`
                <div class="data-section">
                    <div class="data-header">\${title}</div>
                    <div class="data-content">
                        <div class="error">❌ 오류: \${error}</div>
                    </div>
                </div>
            \`;
        }
        
        async function apiCall(endpoint) {
            const response = await fetch(\`/v1/database/\${endpoint}\`, {
                headers: {
                    'X-API-Key': API_KEY,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
            }
            
            return await response.json();
        }
        
        async function loadPortfolio() {
            showLoading('💼 포트폴리오 현황');
            try {
                const result = await apiCall('portfolio');
                const data = result.data;
                
                let html = \`
                    <div class="data-section">
                        <div class="data-header">💼 포트폴리오 현황</div>
                        <div class="data-content">
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 20px;">
                                <div style="background: #e8f5e8; padding: 15px; border-radius: 8px;">
                                    <h4 style="margin: 0 0 5px 0; color: #2e7d32;">총 보유종목</h4>
                                    <div style="font-size: 24px; font-weight: bold;">\${data.summary.totalHoldings}개</div>
                                </div>
                                <div style="background: #e3f2fd; padding: 15px; border-radius: 8px;">
                                    <h4 style="margin: 0 0 5px 0; color: #1976d2;">투자금액</h4>
                                    <div style="font-size: 24px; font-weight: bold;">$\${data.summary.totalInvestment.toLocaleString()}</div>
                                </div>
                                <div style="background: #fff3e0; padding: 15px; border-radius: 8px;">
                                    <h4 style="margin: 0 0 5px 0; color: #f57c00;">현금잔액</h4>
                                    <div style="font-size: 24px; font-weight: bold;">$\${data.summary.cashBalance.toLocaleString()}</div>
                                </div>
                                <div style="background: #f3e5f5; padding: 15px; border-radius: 8px;">
                                    <h4 style="margin: 0 0 5px 0; color: #7b1fa2;">총 자산</h4>
                                    <div style="font-size: 24px; font-weight: bold;">$\${data.summary.totalPortfolioValue.toLocaleString()}</div>
                                </div>
                            </div>
                            
                            <h4>보유 종목 목록:</h4>
                            <table>
                                <thead>
                                    <tr>
                                        <th>종목</th>
                                        <th class="number">보유량</th>
                                        <th class="number">평균단가</th>
                                        <th class="number">총 비용</th>
                                    </tr>
                                </thead>
                                <tbody>
                \`;
                
                data.holdings.forEach(holding => {
                    html += \`
                        <tr>
                            <td><strong>\${holding.symbol}</strong></td>
                            <td class="number">\${holding.shares.toLocaleString()}</td>
                            <td class="number">$\${holding.avgCost.toLocaleString()}</td>
                            <td class="number">$\${holding.totalCost.toLocaleString()}</td>
                        </tr>
                    \`;
                });
                
                html += \`
                                </tbody>
                            </table>
                        </div>
                    </div>
                \`;
                
                document.getElementById('content').innerHTML = html;
            } catch (error) {
                showError('포트폴리오 현황', error.message);
            }
        }
        
        async function loadStatus() {
            showLoading('🔧 시스템 상태');
            try {
                const result = await apiCall('status');
                const data = result.data;
                
                let html = \`
                    <div class="data-section">
                        <div class="data-header">🔧 시스템 상태</div>
                        <div class="data-content">
                            <h4>데이터베이스 정보:</h4>
                            <p><strong>타입:</strong> \${data.database}</p>
                            <p><strong>Supabase 활성화:</strong> \${data.environment.supabaseEnabled ? '✅ 예' : '❌ 아니오'}</p>
                            <p><strong>환경:</strong> \${data.environment.nodeEnv}</p>
                            <p><strong>마지막 확인:</strong> \${new Date(data.environment.lastReportTime).toLocaleString()}</p>
                            
                            <h4>포트폴리오 요약:</h4>
                            <p><strong>보유 종목:</strong> \${data.portfolio.holdings}개</p>
                            <p><strong>현금 잔액:</strong> $\${data.portfolio.cashBalance.toLocaleString()}</p>
                            <p><strong>총 투자금:</strong> $\${data.portfolio.totalInvestment.toLocaleString()}</p>
                            
                            <h4>파일 상태:</h4>
                            <table>
                                <thead>
                                    <tr>
                                        <th>파일명</th>
                                        <th class="number">레코드 수</th>
                                        <th class="number">파일 크기</th>
                                        <th>마지막 수정</th>
                                    </tr>
                                </thead>
                                <tbody>
                \`;
                
                Object.entries(data.files).forEach(([filename, info]) => {
                    if (info.error) {
                        html += \`
                            <tr>
                                <td>\${filename}</td>
                                <td colspan="3" style="color: #dc3545;">\${info.error}</td>
                            </tr>
                        \`;
                    } else {
                        html += \`
                            <tr>
                                <td>\${filename}</td>
                                <td class="number">\${info.records.toLocaleString()}</td>
                                <td class="number">\${(info.size / 1024).toFixed(1)} KB</td>
                                <td>\${new Date(info.lastModified).toLocaleString()}</td>
                            </tr>
                        \`;
                    }
                });
                
                html += \`
                                </tbody>
                            </table>
                        </div>
                    </div>
                \`;
                
                document.getElementById('content').innerHTML = html;
            } catch (error) {
                showError('시스템 상태', error.message);
            }
        }
        
        // 리포트 기록 조회
        async function loadReports() {
            showLoading('📝 리포트 기록');
            try {
                const result = await apiCall('reports');
                const reports = result.data;
                
                let html = \`
                    <div class="data-section">
                        <div class="data-header">📝 AI 리포트 생성 기록</div>
                        <div class="data-content">
                            <div style="margin-bottom: 20px;">
                                <strong>총 \${reports.length}개의 리포트 기록</strong>
                            </div>
                            
                            <table>
                                <thead>
                                    <tr>
                                        <th>생성시간</th>
                                        <th>타입</th>
                                        <th>상태</th>
                                        <th>AI 모델</th>
                                        <th class="number">분석 종목</th>
                                        <th class="number">처리 시간</th>
                                        <th>요약</th>
                                    </tr>
                                </thead>
                                <tbody>
                \`;
                
                reports.forEach(report => {
                    const statusClass = report.status === 'SUCCESS' ? 'positive' : 
                                       report.status === 'FAILED' ? 'negative' : '';
                    const statusIcon = report.status === 'SUCCESS' ? '✅' : 
                                      report.status === 'FAILED' ? '❌' : '⚠️';
                    
                    html += \`
                        <tr>
                            <td>\${new Date(report.generatedAt).toLocaleString()}</td>
                            <td><span style="background: #e3f2fd; padding: 4px 8px; border-radius: 4px; font-size: 12px;">\${report.type}</span></td>
                            <td class="\${statusClass}">\${statusIcon} \${report.status}</td>
                            <td>\${report.aiModel || '-'}</td>
                            <td class="number">\${report.symbolsAnalyzed}</td>
                            <td class="number">\${report.processingTimeSeconds}초</td>
                            <td style="max-width: 300px; word-break: break-word;">
                                \${report.summary || '-'}
                                \${report.errorMessage ? \`<br><span style="color: #dc3545; font-size: 12px;">\${report.errorMessage}</span>\` : ''}
                            </td>
                        </tr>
                    \`;
                });
                
                html += \`
                                </tbody>
                            </table>
                        </div>
                    </div>
                \`;
                
                document.getElementById('content').innerHTML = html;
            } catch (error) {
                showError('리포트 기록', error.message);
            }
        }
        
        // 리포트 통계
        async function loadReportStats() {
            showLoading('📊 리포트 통계');
            try {
                const result = await apiCall('reports');
                const reports = result.data;
                
                // 통계 계산
                const totalReports = reports.length;
                const successCount = reports.filter(r => r.status === 'SUCCESS').length;
                const failedCount = reports.filter(r => r.status === 'FAILED').length;
                const partialCount = reports.filter(r => r.status === 'PARTIAL').length;
                
                const avgProcessingTime = reports.length > 0 ? 
                    (reports.reduce((sum, r) => sum + (r.processingTimeMs || 0), 0) / reports.length / 1000).toFixed(1) : 0;
                
                const totalSymbolsAnalyzed = reports.reduce((sum, r) => sum + (r.symbolsAnalyzed || 0), 0);
                
                // 모델별 통계
                const modelStats = {};
                reports.forEach(r => {
                    if (r.aiModel) {
                        modelStats[r.aiModel] = (modelStats[r.aiModel] || 0) + 1;
                    }
                });
                
                let html = \`
                    <div class="data-section">
                        <div class="data-header">📊 리포트 생성 통계</div>
                        <div class="data-content">
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px;">
                                <div style="background: #e8f5e8; padding: 15px; border-radius: 8px;">
                                    <h4 style="margin: 0 0 5px 0; color: #2e7d32;">총 리포트</h4>
                                    <div style="font-size: 24px; font-weight: bold;">\${totalReports}개</div>
                                </div>
                                <div style="background: #e8f5e8; padding: 15px; border-radius: 8px;">
                                    <h4 style="margin: 0 0 5px 0; color: #2e7d32;">성공률</h4>
                                    <div style="font-size: 24px; font-weight: bold;">\${totalReports > 0 ? ((successCount/totalReports)*100).toFixed(1) : 0}%</div>
                                </div>
                                <div style="background: #e3f2fd; padding: 15px; border-radius: 8px;">
                                    <h4 style="margin: 0 0 5px 0; color: #1976d2;">평균 처리시간</h4>
                                    <div style="font-size: 24px; font-weight: bold;">\${avgProcessingTime}초</div>
                                </div>
                                <div style="background: #fff3e0; padding: 15px; border-radius: 8px;">
                                    <h4 style="margin: 0 0 5px 0; color: #f57c00;">총 분석 종목</h4>
                                    <div style="font-size: 24px; font-weight: bold;">\${totalSymbolsAnalyzed.toLocaleString()}개</div>
                                </div>
                            </div>
                            
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 30px;">
                                <div>
                                    <h4>상태별 분포:</h4>
                                    <table>
                                        <tr><td>✅ 성공</td><td class="number positive">\${successCount}개</td></tr>
                                        <tr><td>❌ 실패</td><td class="number negative">\${failedCount}개</td></tr>
                                        <tr><td>⚠️ 부분성공</td><td class="number">\${partialCount}개</td></tr>
                                    </table>
                                </div>
                                
                                <div>
                                    <h4>AI 모델별 사용:</h4>
                                    <table>
                \`;
                
                Object.entries(modelStats).forEach(([model, count]) => {
                    html += \`<tr><td>\${model}</td><td class="number">\${count}개</td></tr>\`;
                });
                
                html += \`
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                \`;
                
                document.getElementById('content').innerHTML = html;
            } catch (error) {
                showError('리포트 통계', error.message);
            }
        }
        
        // 다른 함수들도 비슷하게 구현...
        async function loadHoldings() {
            showLoading('💼 보유종목 상세');
            try {
                const result = await apiCall('holdings');
                // 구현 생략 - 위와 비슷한 패턴
                console.log('Holdings:', result);
            } catch (error) {
                showError('보유종목 상세', error.message);
            }
        }
        
        async function loadTrades() {
            showLoading('📈 거래 기록');
            try {
                const result = await apiCall('trades');
                // 구현 생략
                console.log('Trades:', result);
            } catch (error) {
                showError('거래 기록', error.message);
            }
        }
        
        async function loadCashEvents() {
            showLoading('💰 현금 이벤트');
            try {
                const result = await apiCall('cash-events');
                // 구현 생략
                console.log('Cash Events:', result);
            } catch (error) {
                showError('현금 이벤트', error.message);
            }
        }
        
        async function loadSymbols() {
            showLoading('📋 종목 리스트');
            try {
                const result = await apiCall('symbols');
                // 구현 생략
                console.log('Symbols:', result);
            } catch (error) {
                showError('종목 리스트', error.message);
            }
        }
        
        async function loadPerformance() {
            showLoading('📊 성과 기록');
            try {
                const result = await apiCall('performance');
                // 구현 생략
                console.log('Performance:', result);
            } catch (error) {
                showError('성과 기록', error.message);
            }
        }
        
        function refreshAll() {
            location.reload();
        }
        
        // 페이지 로드시 시스템 상태 자동 조회
        window.addEventListener('load', () => {
            loadStatus();
        });
    </script>
</body>
</html>
  `;
  
  res.send(html);
});

export default router;