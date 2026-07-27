export default function handler(req, res) {
  res.status(200).json({
    success: true,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      appId: process.env.FEISHU_APP_ID ? '已配置' : '未配置',
      bitableToken: process.env.BITABLE_APP_TOKEN ? '已配置' : '未配置',
    },
  });
}
