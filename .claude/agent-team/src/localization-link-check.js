const { execFileSync } = require('child_process');

function recordTitle(record) {
  return record.metadata?.title || record.title || record.slug || record.metadata?.slug || '(untitled)';
}

function recordUrl(record) {
  return record.metadata?.link || record.link || record.url || '';
}

function extractMarkdownLinks(markdown) {
  const links = [];
  const markdownLinkRe = /\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g;
  const bareUrlRe = /https?:\/\/[^\s)<>"']+/g;
  for (const match of markdown.matchAll(markdownLinkRe)) {
    links.push({ type: 'link', url: match[1].replace(/[.,;:!?]+$/, '') });
  }
  for (const match of markdown.matchAll(bareUrlRe)) {
    const url = match[0].replace(/[.,;:!?]+$/, '');
    if (!links.some(link => link.url === url)) links.push({ type: 'link', url });
  }
  return links;
}

function extractMentionDocs(markdown) {
  const mentions = [];
  for (const line of markdown.split('\n')) {
    if (!/mention_doc/i.test(line)) continue;
    const url = (line.match(/https?:\/\/[^\s)<>"']+/) || [])[0];
    const token = (line.match(/\b(?:docx?|wiki)_[A-Za-z0-9]+\b/) || [])[0];
    if (url || token) mentions.push({ type: 'mention_doc', url, token, raw: line.trim() });
  }
  return mentions;
}

function fetchDocMarkdownWithLarkCli(urlOrToken) {
  const out = execFileSync('lark-cli', [
    'docs',
    '+fetch',
    '--doc',
    urlOrToken,
    '--doc-format',
    'markdown',
    '--format',
    'json',
  ], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  const parsed = JSON.parse(out);
  return parsed.data?.document?.content || parsed.document?.content || '';
}

async function defaultVerifyHttpLink(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = await fetch(url, { method: 'HEAD', signal: controller.signal });
    if (response.status === 405) {
      response = await fetch(url, { method: 'GET', signal: controller.signal });
    }
    return { ok: response.status < 400, status: response.status };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function checkLocalizationLinks({ records, config, fetchDocMarkdown = fetchDocMarkdownWithLarkCli, verifyHttpLink = defaultVerifyHttpLink }) {
  const linkConfig = config.surfaces.localization.linkCheck || {};
  if (!linkConfig.enabled) return { summary: { checkedDocs: 0, brokenLinks: 0, brokenMentionDocs: 0 }, findings: [] };
  const findings = [];
  for (const record of records) {
    const docUrl = recordUrl(record);
    if (!docUrl) continue;
    let markdown = '';
    try {
      markdown = await fetchDocMarkdown(docUrl);
    } catch (error) {
      findings.push({ type: 'doc_fetch_failed', docUrl, title: recordTitle(record), error: error.message });
      continue;
    }
    if (linkConfig.checkMentionDoc) {
      for (const mention of extractMentionDocs(markdown)) {
        try {
          await fetchDocMarkdown(mention.url || mention.token);
        } catch (error) {
          findings.push({ type: 'broken_mention_doc', docUrl, title: recordTitle(record), target: mention.url || mention.token, error: error.message });
        }
      }
    }
    if (linkConfig.checkExternalLinks) {
      for (const link of extractMarkdownLinks(markdown).filter(item => !/feishu\.cn|larksuite\.com/.test(item.url))) {
        const result = await verifyHttpLink(link.url, linkConfig.timeoutMs || 10000);
        if (!result.ok) {
          findings.push({ type: 'broken_link', docUrl, title: recordTitle(record), target: link.url, status: result.status, error: result.error });
        }
      }
    }
  }
  return {
    summary: {
      checkedDocs: records.filter(record => recordUrl(record)).length,
      brokenLinks: findings.filter(finding => finding.type === 'broken_link').length,
      brokenMentionDocs: findings.filter(finding => finding.type === 'broken_mention_doc').length,
    },
    findings,
  };
}

module.exports = {
  checkLocalizationLinks,
  extractMarkdownLinks,
  extractMentionDocs,
  fetchDocMarkdownWithLarkCli,
};
