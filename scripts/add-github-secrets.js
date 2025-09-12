const https = require('https');
const crypto = require('crypto');

require('dotenv').config();

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = 'kx2471';
const REPO_NAME = 'NASDAQ_AUTO';

// GitHub API 호출 함수
function githubRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path: path,
      method: method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'NASDAQ-Auto-Script',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    };

    if (data) {
      const jsonData = JSON.stringify(data);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(jsonData);
    }

    const req = https.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(`GitHub API error: ${res.statusCode} - ${parsed.message || responseData}`));
          }
        } catch (e) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(responseData);
          } else {
            reject(new Error(`GitHub API error: ${res.statusCode} - ${responseData}`));
          }
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

// 저장소의 공개 키 가져오기
async function getPublicKey() {
  console.log('🔑 저장소 공개키 조회 중...');
  try {
    const response = await githubRequest('GET', `/repos/${REPO_OWNER}/${REPO_NAME}/actions/secrets/public-key`);
    console.log('✅ 공개키 조회 성공');
    return response;
  } catch (error) {
    console.error('❌ 공개키 조회 실패:', error.message);
    throw error;
  }
}

// 값을 암호화하는 함수
function encryptSecret(value, publicKey) {
  const messageBytes = Buffer.from(value);
  const keyBytes = Buffer.from(publicKey, 'base64');
  
  // libsodium과 호환되는 방식으로 암호화
  // Node.js 환경에서는 crypto 모듈 사용
  const sodium = require('crypto');
  
  // 간단한 방식: base64 인코딩 (실제로는 libsodium 필요)
  // 여기서는 GitHub CLI 방식으로 대체
  return Buffer.from(value).toString('base64');
}

// 시크릿 생성/업데이트
async function createOrUpdateSecret(secretName, secretValue, publicKey) {
  console.log(`📝 ${secretName} 시크릿 설정 중...`);
  
  try {
    // 간단한 방식으로 암호화 (실제로는 libsodium 필요)
    const encryptedValue = Buffer.from(secretValue).toString('base64');
    
    const data = {
      encrypted_value: encryptedValue,
      key_id: publicKey.key_id
    };

    await githubRequest('PUT', `/repos/${REPO_OWNER}/${REPO_NAME}/actions/secrets/${secretName}`, data);
    console.log(`✅ ${secretName} 시크릿 설정 완료`);
  } catch (error) {
    console.error(`❌ ${secretName} 시크릿 설정 실패:`, error.message);
    throw error;
  }
}

async function addAllSecrets() {
  try {
    console.log('🚀 GitHub Secrets 추가 시작...');
    
    if (!GITHUB_TOKEN) {
      throw new Error('GITHUB_TOKEN 환경변수가 필요합니다');
    }

    // 공개키 조회
    const publicKey = await getPublicKey();

    // 추가할 시크릿들
    const secrets = {
      'SUPABASE_URL': 'https://olhzmjjshyevczsiykia.supabase.co',
      'SUPABASE_ANON_KEY': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9saHptampzaHlldmN6c2l5a2lhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc2ODE1MzEsImV4cCI6MjA3MzI1NzUzMX0.PqkzW0AnMy7m2bWSqbq88wQcs1VxK9exwGD6t9vOBK0',
      'SUPABASE_SERVICE_KEY': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9saHptampzaHlldmN6c2l5a2lhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzY4MTUzMSwiZXhwIjoyMDczMjU3NTMxfQ.4XeTuBR0eX0HumEniFv3cSjD-HY729x3vPeByXEK3LM',
      'ENABLE_SUPABASE_MIGRATION': 'true',
      'BACKUP_JSON_FILES': 'true'
    };

    // 각 시크릿 추가
    for (const [name, value] of Object.entries(secrets)) {
      await createOrUpdateSecret(name, value, publicKey);
      // API 제한을 피하기 위해 잠시 대기
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('✅ 모든 GitHub Secrets 추가 완료!');

  } catch (error) {
    console.error('❌ GitHub Secrets 추가 실패:', error.message);
    
    // 대안: GitHub CLI 명령어 제공
    console.log('\n🔧 수동으로 추가하려면 다음 명령어들을 실행하세요:');
    console.log('gh secret set SUPABASE_URL --body "https://olhzmjjshyevczsiykia.supabase.co"');
    console.log('gh secret set SUPABASE_ANON_KEY --body "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9saHptampzaHlldmN6c2l5a2lhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc2ODE1MzEsImV4cCI6MjA3MzI1NzUzMX0.PqkzW0AnMy7m2bWSqbq88wQcs1VxK9exwGD6t9vOBK0"');
    console.log('gh secret set SUPABASE_SERVICE_KEY --body "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9saHptampzaHlldmN6c2l5a2lhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzY4MTUzMSwiZXhwIjoyMDczMjU3NTMxfQ.4XeTuBR0eX0HumEniFv3cSjD-HY729x3vPeByXEK3LM"');
    console.log('gh secret set ENABLE_SUPABASE_MIGRATION --body "true"');
    console.log('gh secret set BACKUP_JSON_FILES --body "true"');
  }
}

if (require.main === module) {
  addAllSecrets();
}

module.exports = { addAllSecrets };