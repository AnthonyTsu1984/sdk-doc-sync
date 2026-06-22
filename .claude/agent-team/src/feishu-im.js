const fetch = require('node-fetch');
const larkTokenFetcher = require('../../skills/sdk-doc-sync/lib/lark-docs/larkTokenFetcher');

class FeishuImClient {
  constructor({ host = process.env.FEISHU_HOST || 'https://open.feishu.cn' } = {}) {
    this.host = host;
    this.tokenFetcher = new larkTokenFetcher();
  }

  async sendCard({ chatId, card }) {
    const token = await this.tokenFetcher.token();
    const response = await fetch(`${this.host}/open-apis/im/v1/messages?receive_id_type=chat_id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      }),
    });
    const data = await response.json();
    if (data.code !== 0) {
      throw new Error(`Failed to send Feishu card: ${data.msg || response.status}`);
    }
    return data.data;
  }
}

module.exports = {
  FeishuImClient,
};
