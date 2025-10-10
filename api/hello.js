// 간단한 테스트 API
module.exports = (req, res) => {
  res.status(200).json({
    message: 'Hello from Vercel!',
    timestamp: new Date().toISOString()
  });
};
