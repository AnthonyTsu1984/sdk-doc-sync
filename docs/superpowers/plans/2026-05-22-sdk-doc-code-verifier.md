# SDK Doc Code Verifier — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a skill that reads Feishu docx documents, extracts Python code blocks, translates them to Java/Node.js/Go/REST/CLI, runs the translated code in Docker sandboxes, and patches verified translations back into the Feishu doc.

**Architecture:** Reuse `sdk-doc-sync/lib/lark-docs` for Feishu API interactions. Build a new `sdk-doc-code-verifier/` directory with modular components: doc reader, code chainer, repo finder, LLM translator, Docker sandbox, and doc patcher. Orchestrate via a CLI entry point.

**Tech Stack:** Node.js, Docker, Feishu API (via existing `larkTokenFetcher`), OpenAI API (translation fallback), AST parsing for code extraction.

---

## File Structure

```
.claude/skills/sdk-doc-code-verifier/
├── SKILL.md                          # Skill documentation
├── bin/
│   └── verify-doc-code.js            # CLI entry point
├── src/
│   ├── index.js                      # Main orchestrator
│   ├── feishu-doc-reader.js          # Fetch & parse Feishu doc blocks
│   ├── code-chainer.js               # Extract & chain Python code blocks
│   ├── repo-finder.js                # Search SDK repos for matching examples
│   ├── llm-translator.js             # LLM-based translation fallback
│   ├── docker-sandbox.js             # Build & run Docker containers
│   └── feishu-doc-patcher.js         # Patch translations back to Feishu
├── docker/
│   ├── Dockerfile.java
│   ├── Dockerfile.node
│   ├── Dockerfile.go
│   ├── Dockerfile.rest
│   └── Dockerfile.cli
├── lib/
│   └── lang-mappings.js              # Feishu lang IDs ↔ markdown fences
├── tests/
│   └── verify-doc-code.test.js       # Integration tests
└── config/
    └── default.json                  # Default configuration
```

---

## Task 1: Scaffold the skill directory and shared utilities

**Files:**
- Create: `.claude/skills/sdk-doc-code-verifier/lib/lang-mappings.js`
- Create: `.claude/skills/sdk-doc-code-verifier/config/default.json`
- Create: `.claude/skills/sdk-doc-code-verifier/package.json`
- Modify: `.claude/skills/sdk-doc-sync/package.json` (add workspace or dependency link if needed)

- [ ] **Step 1: Create language mapping module**

```javascript
// lib/lang-mappings.js
const langMappings = {
  python:     { feishuId: 49,  markdownFence: 'python',     dockerfile: null },
  java:       { feishuId: 29,  markdownFence: 'java',       dockerfile: 'Dockerfile.java' },
  javascript: { feishuId: 30,  markdownFence: 'javascript', dockerfile: 'Dockerfile.node' },
  go:         { feishuId: 22,  markdownFence: 'go',         dockerfile: 'Dockerfile.go' },
  bash:       { feishuId: 7,   markdownFence: 'bash',       dockerfile: 'Dockerfile.rest' },
  shell:      { feishuId: 60,  markdownFence: 'shell',      dockerfile: 'Dockerfile.cli' },
};

function getLangByFeishuId(id) {
  return Object.entries(langMappings).find(([, v]) => v.feishuId === id)?.[0] || null;
}

function getLangByName(name) {
  const key = name.toLowerCase();
  return langMappings[key] || null;
}

module.exports = { langMappings, getLangByFeishuId, getLangByName };
```

- [ ] **Step 2: Create default config**

```json
// config/default.json
{
  "languages": ["java", "javascript", "go", "bash", "shell"],
  "dockerTimeout": 60,
  "maxLlmRetries": 2,
  "repoSearchDepth": 3,
  "mockMilvus": true,
  "feishuHost": "https://open.feishu.cn",
  "repoMappings": {
    "java":       { "path": "repos/milvus-sdk-java",       "examplesDir": "examples" },
    "javascript": { "path": "repos/milvus-sdk-node",       "examplesDir": "examples" },
    "go":         { "path": "repos/milvus-sdk-go",         "examplesDir": "examples" },
    "bash":       { "path": "repos/milvus",                "examplesDir": "internal/distributed/proxy/httpserver" },
    "shell":      { "path": "repos/zilliz-cloud/vdc/zilliz-tui", "examplesDir": null }
  }
}
```

- [ ] **Step 3: Create package.json**

```json
{
  "name": "sdk-doc-code-verifier",
  "version": "1.0.0",
  "description": "Verify SDK doc code examples by translating and running in Docker sandboxes",
  "main": "src/index.js",
  "bin": {
    "verify-doc-code": "./bin/verify-doc-code.js"
  },
  "scripts": {
    "test": "node tests/verify-doc-code.test.js"
  },
  "dependencies": {
    "node-fetch": "^2.7.0",
    "dotenv": "^16.4.0"
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/sdk-doc-code-verifier/
git commit -m "feat: scaffold sdk-doc-code-verifier skill"
```

---

## Task 2: Build Feishu Doc Reader

**Files:**
- Create: `.claude/skills/sdk-doc-code-verifier/src/feishu-doc-reader.js`

- [ ] **Step 1: Write the module**

```javascript
// src/feishu-doc-reader.js
const larkTokenFetcher = require('../../sdk-doc-sync/lib/lark-docs/larkTokenFetcher');

class FeishuDocReader {
  constructor({ docToken }) {
    this.docToken = docToken;
    this.tokenFetcher = new larkTokenFetcher();
    this.baseUrl = process.env.FEISHU_HOST || 'https://open.feishu.cn';
  }

  async fetchAllBlocks(pageToken = null, accumulated = []) {
    const token = await this.tokenFetcher.token();
    const url = `${this.baseUrl}/open-apis/docx/v1/documents/${this.docToken}/blocks` +
      (pageToken ? `?page_token=${pageToken}` : '');

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (data.code !== 0) throw new Error(`Fetch blocks failed: ${data.msg}`);

    accumulated.push(...data.data.items);
    if (data.data.has_more && data.data.page_token) {
      return this.fetchAllBlocks(data.data.page_token, accumulated);
    }
    return accumulated;
  }

  groupBlocksByExample(blocks) {
    const examples = [];
    let current = null;

    for (const block of blocks) {
      const type = this._getBlockTypeName(block.block_type);

      if (['heading2', 'heading3'].includes(type)) {
        if (current) examples.push(current);
        current = {
          headingBlock: block,
          heading: this._extractText(block),
          blocks: [],
          pythonBlocks: []
        };
      } else if (current) {
        current.blocks.push(block);
        if (type === 'code' && block.code?.style?.language === 49) {
          current.pythonBlocks.push(block);
        }
      }
    }

    if (current) examples.push(current);
    return examples.filter(e => e.pythonBlocks.length > 0);
  }

  _getBlockTypeName(typeId) {
    const types = [
      'page','text','heading1','heading2','heading3','heading4','heading5',
      'heading6','heading7','heading8','heading9','bullet','ordered','code',
      'quote',null,'todo','bitable','callout','chat_card','diagram','divider',
      'file','grid','grid_column','iframe','image','isv','mindnote','sheet',
      'table','table_cell','view','quote_container','task','okr','okr_objective',
      'okr_key_result','okr_progress','add_ons','jira_issue','wiki_catelog',
      'board','agenda','agenda_item','agenda_item_title','agenda_item_content',
      'link_preview','source_synced','reference_synced','sub_page_list','ai_template'
    ];
    return types[typeId - 1] || 'unknown';
  }

  _extractText(block) {
    if (block.text?.elements) {
      return block.text.elements.map(e => e.text_run?.content || '').join('');
    }
    if (block.heading2?.elements) {
      return block.heading2.elements.map(e => e.text_run?.content || '').join('');
    }
    if (block.heading3?.elements) {
      return block.heading3.elements.map(e => e.text_run?.content || '').join('');
    }
    return '';
  }
}

module.exports = FeishuDocReader;
```

- [ ] **Step 2: Write a quick test**

```bash
node -e "
const Reader = require('./.claude/skills/sdk-doc-code-verifier/src/feishu-doc-reader');
const r = new Reader({ docToken: 'test' });
console.log('Reader instantiated:', !!r.fetchAllBlocks);
"
```

Expected output: `Reader instantiated: true`

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/sdk-doc-code-verifier/src/feishu-doc-reader.js
git commit -m "feat: add Feishu doc reader with block grouping"
```

---

## Task 3: Build Code Extractor & Chainer

**Files:**
- Create: `.claude/skills/sdk-doc-code-verifier/src/code-chainer.js`

- [ ] **Step 1: Write the module**

```javascript
// src/code-chainer.js
class CodeChainer {
  constructor() {
    this.setupBoilerplate = 'from pymilvus import MilvusClient\n';
  }

  extractScripts(examples) {
    return examples.map((ex, idx) => {
      const rawCode = ex.pythonBlocks.map(b => this._extractCodeContent(b)).join('\n\n');
      const script = this._injectBoilerplate(rawCode);
      return {
        exampleId: idx + 1,
        heading: ex.heading,
        pythonScript: script,
        blockIds: ex.pythonBlocks.map(b => b.block_id),
        rawBlocks: ex.pythonBlocks
      };
    });
  }

  _extractCodeContent(block) {
    if (!block.code?.elements) return '';
    return block.code.elements
      .map(e => e.text_run?.content || '')
      .join('')
      .replace(/&#36;/g, '$');
  }

  _injectBoilerplate(code) {
    const hasImports = /^from pymilvus import|^import pymilvus/m.test(code);
    const hasClient = /MilvusClient\s*\(/m.test(code);

    let result = code;
    if (!hasImports) {
      result = this.setupBoilerplate + result;
    }
    if (!hasClient && !hasImports) {
      result += '\n\nclient = MilvusClient("http://localhost:19530")\n';
    }
    return result;
  }
}

module.exports = CodeChainer;
```

- [ ] **Step 2: Quick test**

```bash
node -e "
const Chainer = require('./.claude/skills/sdk-doc-code-verifier/src/code-chainer');
const c = new Chainer();
const mock = [{ heading: 'Test', pythonBlocks: [{ block_id: 'b1', code: { elements: [{ text_run: { content: 'print(1)' } }] } }] }];
const out = c.extractScripts(mock);
console.log('Script extracted:', out[0].pythonScript.includes('print(1)'));
"
```

Expected: `Script extracted: true`

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/sdk-doc-code-verifier/src/code-chainer.js
git commit -m "feat: add code chainer for extracting Python scripts"
```

---

## Task 4: Build Repo Example Finder

**Files:**
- Create: `.claude/skills/sdk-doc-code-verifier/src/repo-finder.js`

- [ ] **Step 1: Write the module**

```javascript
// src/repo-finder.js
const fs = require('fs');
const path = require('path');

class RepoFinder {
  constructor(config) {
    this.config = config;
  }

  async findExample(pythonScript, targetLang) {
    const mapping = this.config.repoMappings[targetLang];
    if (!mapping || !mapping.examplesDir) return null;

    const methods = this._extractMethodNames(pythonScript);
    if (methods.length === 0) return null;

    const examplesDir = path.join(mapping.path, mapping.examplesDir);
    if (!fs.existsSync(examplesDir)) return null;

    const files = this._listFilesRecursive(examplesDir);
    const candidates = files.map(file => {
      const content = fs.readFileSync(file, 'utf8');
      const score = methods.reduce((acc, m) => acc + (content.includes(m) ? 1 : 0), 0);
      return { file, content, score };
    }).filter(c => c.score > 0);

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] || null;
  }

  _extractMethodNames(script) {
    const methods = [];
    const patterns = [
      /client\.(\w+)\s*\(/g,
      /milvusClient\.(\w+)\s*\(/g,
      /collection\.(\w+)\s*\(/gi,
    ];
    for (const pat of patterns) {
      let m;
      while ((m = pat.exec(script)) !== null) {
        methods.push(m[1]);
      }
    }
    return [...new Set(methods)];
  }

  _listFilesRecursive(dir) {
    const results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this._listFilesRecursive(fullPath));
      } else if (/\.(java|js|ts|go|py|sh|rs)$/.test(entry.name)) {
        results.push(fullPath);
      }
    }
    return results;
  }
}

module.exports = RepoFinder;
```

- [ ] **Step 2: Quick test**

```bash
node -e "
const Finder = require('./.claude/skills/sdk-doc-code-verifier/src/repo-finder');
const config = require('./.claude/skills/sdk-doc-code-verifier/config/default.json');
const f = new Finder(config);
const result = f.findExample('client.create_collection(', 'java');
console.log('Repo finder loaded:', !!f.findExample);
"
```

Expected: `Repo finder loaded: true`

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/sdk-doc-code-verifier/src/repo-finder.js
git commit -m "feat: add repo example finder"
```

---

## Task 5: Build LLM Translator

**Files:**
- Create: `.claude/skills/sdk-doc-code-verifier/src/llm-translator.js`

- [ ] **Step 1: Write the module**

```javascript
// src/llm-translator.js
const fetch = require('node-fetch');

class LlmTranslator {
  constructor({ apiKey, model = 'gpt-4o' } = {}) {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY;
    this.model = model;
    this.baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  }

  async translate(pythonScript, targetLang, repoExample = null) {
    const prompt = this._buildPrompt(pythonScript, targetLang, repoExample);
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.1,
        messages: [
          { role: 'system', content: 'You are an expert SDK developer. Translate Python examples to other languages precisely.' },
          { role: 'user', content: prompt }
        ]
      })
    });

    const data = await response.json();
    if (!data.choices?.[0]?.message?.content) {
      throw new Error(`LLM translation failed: ${JSON.stringify(data)}`);
    }

    return this._extractCode(data.choices[0].message.content);
  }

  _buildPrompt(pythonScript, targetLang, repoExample) {
    let prompt = `Translate the following Python pymilvus example into ${targetLang} using the corresponding Milvus SDK.\n\nPython example:\n\`\`\`python\n${pythonScript}\n\`\`\`\n`;
    if (repoExample) {
      prompt += `\nReference example from repo:\n\`\`\`\n${repoExample.content}\n\`\`\`\n`;
    }
    prompt += `\nRules:\n- Keep the same logic and API calls\n- Use idiomatic ${targetLang} patterns\n- Include necessary imports and connection setup\n- Return ONLY the translated code, no explanations\n`;
    return prompt;
  }

  _extractCode(responseText) {
    const match = responseText.match(/```(\w+)?\n([\s\S]*?)```/);
    return match ? match[2].trim() : responseText.trim();
  }
}

module.exports = LlmTranslator;
```

- [ ] **Step 2: Quick test**

```bash
node -e "
const Translator = require('./.claude/skills/sdk-doc-code-verifier/src/llm-translator');
const t = new Translator();
console.log('Translator loaded:', !!t.translate);
"
```

Expected: `Translator loaded: true`

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/sdk-doc-code-verifier/src/llm-translator.js
git commit -m "feat: add LLM translator with OpenAI API"
```

---

## Task 6: Build Docker Sandbox

**Files:**
- Create: `.claude/skills/sdk-doc-code-verifier/docker/Dockerfile.java`
- Create: `.claude/skills/sdk-doc-code-verifier/docker/Dockerfile.node`
- Create: `.claude/skills/sdk-doc-code-verifier/docker/Dockerfile.go`
- Create: `.claude/skills/sdk-doc-code-verifier/docker/Dockerfile.rest`
- Create: `.claude/skills/sdk-doc-code-verifier/docker/Dockerfile.cli`
- Create: `.claude/skills/sdk-doc-code-verifier/src/docker-sandbox.js`

- [ ] **Step 1: Write Dockerfiles**

```dockerfile
# docker/Dockerfile.java
FROM maven:3.9-eclipse-temurin-17
WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline -q || true
COPY . .
CMD ["mvn", "exec:java", "-q"]
```

```dockerfile
# docker/Dockerfile.node
FROM node:20-slim
WORKDIR /app
COPY package.json .
RUN npm install --silent
COPY . .
CMD ["node", "script.js"]
```

```dockerfile
# docker/Dockerfile.go
FROM golang:1.22
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -o app .
CMD ["./app"]
```

```dockerfile
# docker/Dockerfile.rest
FROM curlimages/curl:latest
WORKDIR /app
COPY . .
CMD ["sh", "script.sh"]
```

```dockerfile
# docker/Dockerfile.cli
FROM rust:1.75
WORKDIR /app
COPY . .
CMD ["sh", "script.sh"]
```

- [ ] **Step 2: Write Docker sandbox module**

```javascript
// src/docker-sandbox.js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

class DockerSandbox {
  constructor({ timeout = 60 } = {}) {
    this.timeout = timeout;
    this.dockerfilesDir = path.join(__dirname, '..', 'docker');
  }

  async run(scriptContent, language, envVars = {}) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-verify-'));
    const dockerfile = this._getDockerfile(language);
    const tag = `sdk-doc-verify:${language}`;

    try {
      this._writeScript(tmpDir, language, scriptContent);
      this._buildImage(tmpDir, dockerfile, tag);
      return this._runContainer(tag, tmpDir, envVars);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  _getDockerfile(language) {
    const map = {
      java: 'Dockerfile.java',
      javascript: 'Dockerfile.node',
      go: 'Dockerfile.go',
      bash: 'Dockerfile.rest',
      shell: 'Dockerfile.cli'
    };
    const file = map[language];
    if (!file) throw new Error(`No Dockerfile for language: ${language}`);
    return path.join(this.dockerfilesDir, file);
  }

  _writeScript(tmpDir, language, content) {
    const filenames = {
      java: 'src/main/java/App.java',
      javascript: 'script.js',
      go: 'main.go',
      bash: 'script.sh',
      shell: 'script.sh'
    };
    const filename = filenames[language];
    const fullPath = path.join(tmpDir, filename);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  _buildImage(tmpDir, dockerfile, tag) {
    const cmd = `docker build -f ${dockerfile} -t ${tag} ${tmpDir}`;
    execSync(cmd, { stdio: 'pipe', timeout: 120000 });
  }

  _runContainer(tag, tmpDir, envVars) {
    const envFlags = Object.entries(envVars)
      .map(([k, v]) => `-e ${k}=${v}`)
      .join(' ');

    const cmd = `docker run --rm ${envFlags} -v ${tmpDir}:/app ${tag}`;
    try {
      const stdout = execSync(cmd, {
        encoding: 'utf8',
        timeout: this.timeout * 1000,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      return { passed: true, stdout, stderr: '', exitCode: 0 };
    } catch (err) {
      return {
        passed: false,
        stdout: err.stdout || '',
        stderr: err.stderr || '',
        exitCode: err.status || 1
      };
    }
  }
}

module.exports = DockerSandbox;
```

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/sdk-doc-code-verifier/docker/
git add .claude/skills/sdk-doc-code-verifier/src/docker-sandbox.js
git commit -m "feat: add Docker sandbox with language-specific images"
```

---

## Task 7: Build Feishu Doc Patcher

**Files:**
- Create: `.claude/skills/sdk-doc-code-verifier/src/feishu-doc-patcher.js`

- [ ] **Step 1: Write the module**

```javascript
// src/feishu-doc-patcher.js
const larkTokenFetcher = require('../../sdk-doc-sync/lib/lark-docs/larkTokenFetcher');
const { getLangByName } = require('../lib/lang-mappings');

class FeishuDocPatcher {
  constructor({ docToken }) {
    this.docToken = docToken;
    this.tokenFetcher = new larkTokenFetcher();
    this.baseUrl = process.env.FEISHU_HOST || 'https://open.feishu.cn';
  }

  async patch(translations, originalBlocks) {
    const updates = [];
    const creates = [];

    for (const t of translations) {
      const langInfo = getLangByName(t.language);
      if (!langInfo) continue;

      const existing = this._findExistingBlock(originalBlocks, t.blockIds, langInfo.feishuId);
      if (existing) {
        updates.push({
          block_id: existing.block_id,
          update_text_elements: {
            elements: [{ text_run: { content: t.code, text_element_style: {} } }]
          }
        });
      } else {
        const afterBlockId = t.blockIds[t.blockIds.length - 1];
        creates.push({
          afterBlockId,
          block: {
            block_type: 14,
            code: {
              elements: [{ text_run: { content: t.code, text_element_style: {} } }],
              style: { language: langInfo.feishuId }
            }
          }
        });
      }
    }

    await this._batchUpdate(updates);
    await this._batchCreate(creates);
  }

  _findExistingBlock(allBlocks, blockIds, langId) {
    const allowedSet = new Set(blockIds);
    return allBlocks.find(b =>
      b.block_type === 14 &&
      b.code?.style?.language === langId &&
      allowedSet.has(b.block_id)
    ) || null;
  }

  async _batchUpdate(requests) {
    if (requests.length === 0) return;
    const token = await this.tokenFetcher.token();
    const url = `${this.baseUrl}/open-apis/docx/v1/documents/${this.docToken}/blocks/batch_update`;

    for (let i = 0; i < requests.length; i += 200) {
      const batch = requests.slice(i, i + 200);
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: batch })
      });
      const data = await res.json();
      if (data.code !== 0) throw new Error(`Batch update failed: ${data.msg}`);
    }
  }

  async _batchCreate(requests) {
    if (requests.length === 0) return;
    const token = await this.tokenFetcher.token();

    for (const req of requests) {
      const url = `${this.baseUrl}/open-apis/docx/v1/documents/${this.docToken}/blocks/${req.afterBlockId}/children`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ children: [req.block] })
      });
      const data = await res.json();
      if (data.code !== 0) throw new Error(`Create block failed: ${data.msg}`);
    }
  }
}

module.exports = FeishuDocPatcher;
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/sdk-doc-code-verifier/src/feishu-doc-patcher.js
git commit -m "feat: add Feishu doc patcher with update/create logic"
```

---

## Task 8: Build Main Orchestrator & CLI

**Files:**
- Create: `.claude/skills/sdk-doc-code-verifier/src/index.js`
- Create: `.claude/skills/sdk-doc-code-verifier/bin/verify-doc-code.js`

- [ ] **Step 1: Write the orchestrator**

```javascript
// src/index.js
const FeishuDocReader = require('./feishu-doc-reader');
const CodeChainer = require('./code-chainer');
const RepoFinder = require('./repo-finder');
const LlmTranslator = require('./llm-translator');
const DockerSandbox = require('./docker-sandbox');
const FeishuDocPatcher = require('./feishu-doc-patcher');
const config = require('../config/default.json');

class SdkDocCodeVerifier {
  constructor({ docToken, languages = config.languages, dryRun = false }) {
    this.docToken = docToken;
    this.languages = languages;
    this.dryRun = dryRun;
    this.reader = new FeishuDocReader({ docToken });
    this.chainer = new CodeChainer();
    this.finder = new RepoFinder(config);
    this.translator = new LlmTranslator();
    this.sandbox = new DockerSandbox({ timeout: config.dockerTimeout });
    this.patcher = new FeishuDocPatcher({ docToken });
  }

  async run() {
    console.log(`Fetching doc: ${this.docToken}`);
    const allBlocks = await this.reader.fetchAllBlocks();
    const examples = this.reader.groupBlocksByExample(allBlocks);
    console.log(`Found ${examples.length} examples with Python code`);

    const scripts = this.chainer.extractScripts(examples);
    const results = [];

    for (const script of scripts) {
      console.log(`\nExample: ${script.heading}`);
      const exampleResult = {
        heading: script.heading,
        pythonScript: script.pythonScript,
        translations: []
      };

      for (const lang of this.languages) {
        const tResult = await this._translateAndVerify(script, lang);
        exampleResult.translations.push(tResult);
        this._printResult(lang, tResult);
      }

      results.push(exampleResult);
    }

    const summary = this._summarize(results);
    console.log(`\nSummary: ${summary.passed}/${summary.total} translations passed (${summary.percent}%)`);

    if (!this.dryRun && summary.passed > 0) {
      const patchList = results.flatMap(r =>
        r.translations.filter(t => t.passed).map(t => ({
          language: t.language,
          code: t.code,
          blockIds: scripts.find(s => s.heading === r.heading).blockIds
        }))
      );
      await this.patcher.patch(patchList, allBlocks);
      console.log('Patched translations back to doc');
    }

    return { docToken: this.docToken, examples: results, summary };
  }

  async _translateAndVerify(script, lang) {
    const repoExample = await this.finder.findExample(script.pythonScript, lang);
    let code;
    let source;

    if (repoExample) {
      code = repoExample.content;
      source = 'repo';
    } else {
      code = await this.translator.translate(script.pythonScript, lang, repoExample);
      source = 'llm';
    }

    const envVars = {};
    if (process.env.MILVUS_HOST) {
      envVars.MILVUS_HOST = process.env.MILVUS_HOST;
    }

    const testResult = await this.sandbox.run(code, lang, envVars);

    return {
      language: lang,
      code,
      source,
      passed: testResult.passed,
      stdout: testResult.stdout,
      stderr: testResult.stderr,
      exitCode: testResult.exitCode
    };
  }

  _printResult(lang, result) {
    const icon = result.passed ? '✅' : '❌';
    const srcLabel = result.source === 'repo' ? '(repo)' : '(llm)';
    console.log(`  ${lang}: ${icon} ${srcLabel}`);
    if (!result.passed && result.stderr) {
      console.log(`    Error: ${result.stderr.slice(0, 200)}`);
    }
  }

  _summarize(results) {
    const total = results.reduce((acc, r) => acc + r.translations.length, 0);
    const passed = results.reduce((acc, r) => acc + r.translations.filter(t => t.passed).length, 0);
    return { total, passed, percent: ((passed / total) * 100).toFixed(1) };
  }
}

module.exports = SdkDocCodeVerifier;
```

- [ ] **Step 2: Write the CLI**

```javascript
#!/usr/bin/env node
// bin/verify-doc-code.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const SdkDocCodeVerifier = require('../src/index');

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = { doc: null, languages: null, dryRun: false, output: null, recursive: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--doc' && args[i + 1]) opts.doc = args[++i];
    else if (args[i] === '--languages' && args[i + 1]) opts.languages = args[++i].split(',');
    else if (args[i] === '--dry-run') opts.dryRun = true;
    else if (args[i] === '--output' && args[i + 1]) opts.output = args[++i];
    else if (args[i] === '--recursive') opts.recursive = true;
    else if (!opts.doc && !args[i].startsWith('--')) opts.doc = args[i];
  }

  return opts;
}

async function main() {
  const opts = parseArgs(process.argv);

  if (!opts.doc) {
    console.error('Usage: node verify-doc-code.js <doc-token> [options]');
    console.error('Options:');
    console.error('  --languages <list>   Comma-separated languages (default: all)');
    console.error('  --dry-run            Do not patch Feishu doc');
    console.error('  --output <file>      Write JSON results to file');
    console.error('  --recursive          Include child docs');
    process.exit(1);
  }

  const verifier = new SdkDocCodeVerifier({
    docToken: opts.doc,
    languages: opts.languages,
    dryRun: opts.dryRun
  });

  const results = await verifier.run();

  if (opts.output) {
    const fs = require('fs');
    fs.writeFileSync(opts.output, JSON.stringify(results, null, 2));
    console.log(`Results written to ${opts.output}`);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
```

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/sdk-doc-code-verifier/src/index.js
git add .claude/skills/sdk-doc-code-verifier/bin/verify-doc-code.js
git commit -m "feat: add main orchestrator and CLI entry point"
```

---

## Task 9: Write SKILL.md documentation

**Files:**
- Create: `.claude/skills/sdk-doc-code-verifier/SKILL.md`

- [ ] **Step 1: Write the skill documentation**

```markdown
---
name: sdk-doc-code-verifier
description: Use when verifying SDK documentation code examples by translating Python to other languages and running tests in Docker sandboxes.
---

# SDK Doc Code Verifier

Verify that code examples in Feishu SDK documentation are correct by translating them to other languages and running them in isolated Docker containers.

## When to Use

- When a Feishu doc contains Python examples that need equivalents in Java, Node.js, Go, REST, or Zilliz CLI
- When you need to verify that translated code examples actually compile and run
- When patching verified translations back into Feishu documents

## Prerequisites

- Docker daemon running
- `.env` file with `FEISHU_HOST`, `APP_ID`, `APP_SECRET`
- `OPENAI_API_KEY` (optional, for LLM translation fallback)
- SDK repos cloned in `repos/`

## Usage

```bash
# Verify all languages
node .claude/skills/sdk-doc-code-verifier/bin/verify-doc-code.js PR2adhLOKo3qCtxug65cKieMnUM

# Verify specific languages
node .claude/skills/sdk-doc-code-verifier/bin/verify-doc-code.js PR2adhLOKo3qCtxug65cKieMnUM --languages java,go

# Dry-run (no patching)
node .claude/skills/sdk-doc-code-verifier/bin/verify-doc-code.js PR2adhLOKo3qCtxug65cKieMnUM --dry-run
```

## How It Works

1. **Read** — Fetch all blocks from Feishu doc via API
2. **Extract** — Group Python code blocks by example section
3. **Chain** — Concatenate blocks within each example into a runnable script
4. **Find** — Search SDK repos for matching examples in target languages
5. **Translate** — Fall back to LLM if no repo match found
6. **Verify** — Run each translated script in a Docker sandbox
7. **Patch** — Update or append verified translations to the Feishu doc

## Language Support

| Language | Repo | Docker Image |
|----------|------|-------------|
| Java | `repos/milvus-sdk-java` | `maven:3.9-eclipse-temurin-17` |
| Node.js | `repos/milvus-sdk-node` | `node:20-slim` |
| Go | `repos/milvus-sdk-go` | `golang:1.22` |
| REST | `repos/milvus` | `curlimages/curl` |
| Zilliz CLI | `repos/zilliz-cloud` | `rust:1.75` |
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/sdk-doc-code-verifier/SKILL.md
git commit -m "docs: add SKILL.md for sdk-doc-code-verifier"
```

---

## Task 10: Integration Test

**Files:**
- Create: `.claude/skills/sdk-doc-code-verifier/tests/verify-doc-code.test.js`

- [ ] **Step 1: Write the test**

```javascript
// tests/verify-doc-code.test.js
const assert = require('assert');

// Test lang-mappings
const { getLangByFeishuId, getLangByName } = require('../lib/lang-mappings');
assert.strictEqual(getLangByFeishuId(49), 'python');
assert.strictEqual(getLangByName('java').feishuId, 29);

// Test code-chainer
const CodeChainer = require('../src/code-chainer');
const chainer = new CodeChainer();
const mockExamples = [{
  heading: 'Create Collection',
  pythonBlocks: [{
    block_id: 'b1',
    code: {
      elements: [{ text_run: { content: 'client.create_collection("foo")' } }],
      style: { language: 49 }
    }
  }]
}];
const scripts = chainer.extractScripts(mockExamples);
assert(scripts[0].pythonScript.includes('create_collection'));

// Test repo-finder (with mock config)
const RepoFinder = require('../src/repo-finder');
const finder = new RepoFinder({ repoMappings: {} });
assert.strictEqual(typeof finder.findExample, 'function');

// Test docker-sandbox (dry-run instantiation)
const DockerSandbox = require('../src/docker-sandbox');
const sandbox = new DockerSandbox();
assert.strictEqual(sandbox.timeout, 60);

console.log('All tests passed!');
```

- [ ] **Step 2: Run the test**

```bash
cd .claude/skills/sdk-doc-code-verifier
node tests/verify-doc-code.test.js
```

Expected: `All tests passed!`

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/sdk-doc-code-verifier/tests/
git commit -m "test: add integration tests for core modules"
```

---

## Plan Self-Review

**1. Spec coverage:**
- Doc reader ✓ (Task 2)
- Code chainer ✓ (Task 3)
- Repo finder ✓ (Task 4)
- LLM translator ✓ (Task 5)
- Docker sandbox ✓ (Task 6)
- Doc patcher ✓ (Task 7)
- Orchestrator + CLI ✓ (Task 8)
- Documentation ✓ (Task 9)
- Tests ✓ (Task 10)

**2. Placeholder scan:** No TBD, TODO, or vague steps found.

**3. Type consistency:** All modules use consistent property names (`block_id`, `block_type`, `code`, `style.language`).

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-22-sdk-doc-code-verifier.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
