import https from 'https';

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_BASE_URL = 'api.deepseek.com';

const SYSTEM_PROMPTS = {
  career: `你是一位经验丰富的职业规划教练。你的职责是：
1. 帮助用户探索职业方向和兴趣
2. 提供职业发展建议和行业洞察
3. 指导用户制定职业目标和行动计划
4. 帮助用户识别自身优势和待发展领域
请用温暖、专业、鼓励的语气回复。每次回复后，可以提出1-2个引导性问题来深入了解用户需求。`,

  study: `你是一位专业的学习指导教练。你的职责是：
1. 帮助用户找到适合自己的学习方法
2. 提供时间管理和学习计划建议
3. 指导备考策略和考试技巧
4. 帮助用户克服学习中的困难和障碍
请用耐心、细致、鼓励的语气回复。结合认知科学和学习理论的原理给出建议。`,

  life: `你是一位温暖的人生教练和生活导师。你的职责是：
1. 帮助用户在生活各方面找到平衡
2. 提供压力管理和情绪调节建议
3. 引导用户思考人生目标和价值观
4. 帮助用户建立积极的生活习惯
请用温暖、共情、支持的语���回复。关注用户的身心健康和整体幸福感。`,

  general: `你是一位全面的 AI 生活教练，可以在职业发展、学习成长、生活平衡等多方面提供指导。
请用友善、专业、鼓励的语气回复用户的问题。
根据用户的具体情况，提供个性化的建议和行动方案。
每次回复后，可以提出引导性问题来更好地了解用户需求。`,
};

function buildSystemPrompt(category) {
  return SYSTEM_PROMPTS[category] || SYSTEM_PROMPTS.general;
}

function chatWithCoach(messages, category) {
  return new Promise((resolve, reject) => {
    if (!DEEPSEEK_API_KEY || DEEPSEEK_API_KEY === 'sk-your-api-key-here') {
      // Fallback: return a friendly message when API key is not configured
      resolve({
        content: getFallbackResponse(category, messages[messages.length - 1]?.content || ''),
        tokens: 0,
      });
      return;
    }

    const systemPrompt = buildSystemPrompt(category);
    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    const postData = JSON.stringify({
      model: 'deepseek-chat',
      messages: apiMessages,
      temperature: 0.7,
      max_tokens: 2000,
      stream: false,
    });

    const options = {
      hostname: DEEPSEEK_BASE_URL,
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 30000,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            console.error('[AI] DeepSeek API error:', json.error);
            resolve({
              content: `抱歉，AI 服务暂时遇到问题：${json.error.message || '未知错误'}\n\n请稍后再试，或者检查 API 密钥配置。`,
              tokens: 0,
            });
            return;
          }
          const content = json.choices?.[0]?.message?.content || '抱歉，我暂时无法回复，请稍后再试。';
          const tokens = json.usage?.total_tokens || 0;
          resolve({ content, tokens });
        } catch (e) {
          console.error('[AI] Parse error:', e.message);
          resolve({
            content: '抱歉，处理 AI 回复时出现了问题，请稍后再试。',
            tokens: 0,
          });
        }
      });
    });

    req.on('error', (e) => {
      console.error('[AI] Request error:', e.message);
      resolve({
        content: `抱歉，无法连接到 AI 服务。请检查网络连接和 API 密钥配置。\n\n错误信息：${e.message}`,
        tokens: 0,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        content: '抱歉，AI 服务响应超时，请稍后再试。如果问题持续，请检查网络连接。',
        tokens: 0,
      });
    });

    req.write(postData);
    req.end();
  });
}

function getFallbackResponse(category, userMessage) {
  const responses = {
    career: `感谢你的咨询！我注意到你提到了职业相关的问题。

为了更好地帮助你，请确保已配置 DeepSeek API 密钥：
1. 访问 https://platform.deepseek.com 注册账号
2. 获取 API Key（新用户有 500 万 token 免费额度）
3. 在 .env 文件中设置 DEEPSEEK_API_KEY=你的密钥
4. 重启服务器

在此期间，你可以：
- 完成我们的「职业兴趣问卷」
- 尝试「职业价值观评估」测试
- 浏览其他用户的经验分享

有什么其他问题我可以帮你吗？`,

    study: `感谢你的咨询！我注意到你提到了学习相关的问题。

要获得 AI 教练的个性化指导，请配置 DeepSeek API 密钥：
1. 访问 https://platform.deepseek.com 注册账号
2. 获取 API Key（新用户有 500 万 token 免费额度）
3. 在 .env 文件中设置 DEEPSEEK_API_KEY=你的密钥
4. 重启服务器

在此期间，你可以：
- 完成「学习习惯调查」问卷
- 试试「学习风格评估 (VARK)」测试
- 探索我们的学习资源

有什么其他问题我可以帮你吗？`,

    life: `感谢你的分享！生活平衡确实很重要。

要获得 AI 教练的深入指导，请配置 DeepSeek API 密钥：
1. 访问 https://platform.deepseek.com 注册账号
2. 获取 API Key（新用户有 500 万 token 免费额度）
3. 在 .env 文件中设置 DEEPSEEK_API_KEY=你的密钥
4. 重启服务器

在此期间，你可以：
- 完成「生活满意度调查」问卷
- 与朋友或家人交流你的感受
- 尝试一些放松和正念练习

有什么其他问题我可以帮你吗？`,

    general: `你好！我是 ExpressCoach AI 教练，很高兴为你服务！

要获得完整的 AI 教练体验，请配置 DeepSeek API 密钥：
1. 访问 https://platform.deepseek.com 注册账号（免费）
2. 获取 API Key（新用户有 500 万 token 免费额度）
3. 在 .env 文件中设置 DEEPSEEK_API_KEY=你的密钥
4. 重启服务器

在此期间，你仍然可以使用以下功能：
- 📝 填写调查问卷
- 🧪 参加评估测试
- 📊 查看数据仪表盘

有什么我可以帮你的吗？`,
  };

  return responses[category] || responses.general;
}

export { chatWithCoach, buildSystemPrompt };
