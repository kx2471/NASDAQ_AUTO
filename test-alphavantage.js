require('dotenv').config();
const axios = require('axios');

async function testAlphaVantageAPI() {
  console.log('🔍 Alpha Vantage API 테스트...');
  console.log('API Key:', process.env.ALPHAVANTAGE_API_KEY ? 'Found' : 'Not found');
  
  try {
    const response = await axios.get('https://www.alphavantage.co/query', {
      params: {
        function: 'LISTING_STATUS',
        apikey: process.env.ALPHAVANTAGE_API_KEY
      },
      timeout: 10000
    });
    
    console.log('✅ API Response Status:', response.status);
    console.log('📊 Data Type:', typeof response.data);
    console.log('📊 Data Keys:', Object.keys(response.data || {}));
    console.log('📊 Raw Data Sample:', JSON.stringify(response.data).substring(0, 200) + '...');
    
    if (typeof response.data === 'string') {
      const lines = response.data.split('\n');
      console.log('📈 Total CSV lines:', lines.length);
      
      if (lines.length > 1) {
        console.log('🔍 첫 10개 라인 샘플:');
        for (let i = 0; i < Math.min(10, lines.length); i++) {
          console.log(`  ${i}: ${lines[i].substring(0, 100)}...`);
        }
        
        // 중간 부분도 확인
        const midPoint = Math.floor(lines.length / 2);
        console.log(`\n🔍 중간 부분 (라인 ${midPoint}) 샘플:`);
        for (let i = midPoint; i < Math.min(midPoint + 5, lines.length); i++) {
          console.log(`  ${i}: ${lines[i].substring(0, 100)}...`);
        }
        
        // 끝 부분도 확인
        console.log(`\n🔍 끝 부분 샘플:`);
        const endStart = Math.max(0, lines.length - 5);
        for (let i = endStart; i < lines.length; i++) {
          console.log(`  ${i}: ${lines[i].substring(0, 100)}...`);
        }
      }
    } else {
      console.log('🔍 JSON Response received instead of CSV');
    }
    
  } catch (error) {
    console.error('❌ API 호출 실패:', error.message);
    if (error.response) {
      console.error('Response Status:', error.response.status);
      console.error('Response Data:', error.response.data);
    }
  }
}

testAlphaVantageAPI();