# Quick Setup Guide for Translation Engines

Choose and configure one or more translation engines based on your needs.

## 🚀 Quick Start

### Claude (Recommended for Technical Docs)

```bash
# 1. Get API key
# Visit: https://console.anthropic.com

# 2. Add to .env
echo "ANTHROPIC_API_KEY=sk-ant-xxx..." >> .env

# 3. Test
node bin/feishu-doc-translator.js \
  --translator claude \
  --source-bitable YOUR_SOURCE \
  --target-bitable YOUR_TARGET \
  --source-root YOUR_SOURCE_ROOT \
  --target-root YOUR_TARGET_ROOT \
  --dry-run
```

**Cost:** ~$2-5 per 1MB documentation

### DeepL (Best for European Languages)

```bash
# 1. Sign up for free tier
# Visit: https://www.deepl.com/pro-api
# Free: 500,000 chars/month

# 2. Add to .env
echo "DEEPL_API_KEY=your-key-here" >> .env

# 3. Test
node bin/feishu-doc-translator.js \
  --translator deepl \
  --source-lang en \
  --target-lang de \
  --dry-run
```

**Cost:** Free tier (500k chars/month) or €5.49/month

### Ollama (Free & Private)

```bash
# 1. Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# 2. Pull a model (choose one)
ollama pull qwen2.5:7b          # Recommended (3.8GB)
# OR
ollama pull mixtral:8x7b        # Highest quality (26GB)
# OR
ollama pull llama3.1:8b         # Fast (4.7GB)

# 3. Start server
ollama serve

# 4. Test
node bin/feishu-doc-translator.js \
  --translator ollama \
  --dry-run
```

**Cost:** $0 (runs locally)

### Feishu (Built-in)

```bash
# Already configured if you have Feishu credentials

# Test
node bin/feishu-doc-translator.js \
  --translator feishu \
  --dry-run
```

**Cost:** Free (included with Feishu)

## 🧪 Testing

Test individual translators:

```bash
# Test DeepL
node tests/test-deepl-translator.js

# Test Ollama
node tests/test-ollama-translator.js

# Compare all translators
node examples/translator-comparison.js
```

## 🎯 Which Translator Should I Use?

### Use **Claude** if:
- ✅ Translating technical documentation with code
- ✅ Need context-aware translation
- ✅ Quality is top priority
- ✅ Have budget ($2-10 per large doc)

### Use **DeepL** if:
- ✅ Translating to/from European languages
- ✅ Need professional business quality
- ✅ Want fast turnaround
- ✅ Can use free tier quota

### Use **Ollama** if:
- ✅ Privacy is critical (no cloud)
- ✅ Working offline
- ✅ Zero budget
- ✅ Have decent hardware (8GB+ RAM)

### Use **Feishu** if:
- ✅ Simple content
- ✅ Already on Feishu
- ✅ Need quick basic translation

## 📊 Performance Comparison

| Engine | Quality | Speed | Privacy | Cost |
|--------|---------|-------|---------|------|
| Claude | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | Cloud | $$$ |
| DeepL  | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Cloud | $$ |
| Ollama | ⭐⭐⭐⭐ | ⭐⭐ | Local | Free |
| Feishu | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Cloud | Free |

## 🔧 Advanced Configuration

### Claude Options

```env
# .env
ANTHROPIC_API_KEY=sk-ant-xxx
CLAUDE_MODEL=claude-haiku-4-5-20251001  # Optional, default is Haiku
```

### DeepL Options

```env
# .env
DEEPL_API_KEY=your-key
DEEPL_API_URL=https://api-free.deepl.com/v2/translate  # Free tier
# OR
# DEEPL_API_URL=https://api.deepl.com/v2/translate      # Pro tier
```

### Ollama Options

```env
# .env
OLLAMA_BASE_URL=http://localhost:11434  # Default
OLLAMA_MODEL=qwen2.5:7b                 # Default
```

Models ranked by quality:
1. `mixtral:8x7b` - Highest quality (26GB)
2. `qwen2.5:7b` - Best balance (3.8GB) **← Recommended**
3. `llama3.1:8b` - Fast (4.7GB)

### Hybrid Approach

Use different engines for different content:

```bash
# Technical docs → Claude
node bin/feishu-doc-translator.js \
  --translator claude \
  --action new

# Marketing docs → DeepL
node bin/feishu-doc-translator.js \
  --translator deepl \
  --action new

# Internal docs → Ollama (private)
node bin/feishu-doc-translator.js \
  --translator ollama \
  --action new
```

## ❓ Troubleshooting

### Claude: "Invalid API key"
- Verify key at https://console.anthropic.com
- Check `ANTHROPIC_API_KEY` in .env

### DeepL: "Authentication failed"
- Check `DEEPL_API_KEY` in .env
- Verify correct API URL (free vs pro)

### Ollama: "Connection refused"
```bash
# Start the server
ollama serve
```

### Ollama: "Model not found"
```bash
# Pull the model
ollama pull qwen2.5:7b
```

### Ollama: "Out of memory"
- Use smaller model: `ollama pull qwen2.5:3b`
- Close other applications
- Upgrade RAM

## 📚 More Information

- **Full comparison:** See `docs/TRANSLATORS.md`
- **API documentation:** Each translator class has detailed JSDoc comments
- **Examples:** Check `examples/translator-comparison.js`

## 🆘 Getting Help

```bash
# Show help
node bin/feishu-doc-translator.js --help

# Dry run (preview without executing)
node bin/feishu-doc-translator.js --dry-run

# Test single translator
node tests/test-deepl-translator.js
node tests/test-ollama-translator.js
```
