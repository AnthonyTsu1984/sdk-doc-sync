# Translation Engines

The Feishu Doc Translator supports multiple translation engines, each with different strengths and use cases.

## Overview

| Engine | Quality | Speed | Cost | Best For |
|--------|---------|-------|------|----------|
| **Claude** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | $$$ | Technical docs, context-aware |
| **DeepL** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | $$ | European languages, formal text |
| **Feishu** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | $ | Simple text, already on Feishu |
| **Ollama** | ⭐⭐⭐⭐ | ⭐⭐ | Free | Privacy-sensitive, offline work |

## Claude Translator

**Best for:** Technical documentation with code examples and complex context

### Features
- Context-aware translation preserves technical terminology
- Excellent at understanding markdown structure
- Maintains code blocks and inline code untouched
- Natural language quality

### Setup

```bash
# 1. Get API key from https://console.anthropic.com
# 2. Add to .env
ANTHROPIC_API_KEY=sk-ant-xxx...

# 3. Use with translator
node bin/feishu-doc-translator.js \
  --translator claude \
  --source-lang en \
  --target-lang ja \
  ...
```

### Configuration

```env
# .env
ANTHROPIC_API_KEY=sk-ant-xxx...        # Required
CLAUDE_MODEL=claude-haiku-4-5-20251001 # Optional, defaults to Haiku 4.5
```

### Pricing
- Haiku 4.5: $0.25/MTok input, $1.25/MTok output
- Sonnet 4.5: $3.00/MTok input, $15.00/MTok output
- Typical doc (5KB): ~$0.01-0.05

## DeepL Translator

**Best for:** European languages, formal business documents

### Features
- Industry-leading quality for European languages
- Excellent handling of idioms and formal language
- Fast API responses
- Support for 31+ languages

### Setup

```bash
# 1. Sign up at https://www.deepl.com/pro-api
# 2. Get API key (free tier: 500k chars/month)
# 3. Add to .env
DEEPL_API_KEY=your-key-here

# 4. Use with translator
node bin/feishu-doc-translator.js \
  --translator deepl \
  --source-lang en \
  --target-lang de \
  ...
```

### Configuration

```env
# .env
DEEPL_API_KEY=xxx...                              # Required
DEEPL_API_URL=https://api-free.deepl.com/v2/translate  # Optional (free tier)
# For pro tier:
# DEEPL_API_URL=https://api.deepl.com/v2/translate
```

### Language Codes
- `EN` - English
- `DE` - German
- `FR` - French
- `ES` - Spanish
- `IT` - Italian
- `JA` - Japanese
- `ZH` - Chinese
- `KO` - Korean
- [See full list](https://www.deepl.com/docs-api/translate-text)

### Pricing
- Free tier: 500,000 characters/month
- Pro tier: Starting at €5.49/month for 1M chars
- Pay-as-you-go: €20/1M characters

## Ollama Translator

**Best for:** Privacy-sensitive content, offline work, cost reduction

### Features
- Runs completely locally (no data sent to cloud)
- Free and unlimited usage
- Works offline
- Multiple model choices (quality vs speed tradeoff)

### Setup

```bash
# 1. Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# 2. Pull a translation model
ollama pull qwen2.5:7b          # Recommended (3.8GB)
# OR
ollama pull mixtral:8x7b        # Higher quality (26GB)
# OR
ollama pull llama3.1:8b         # General purpose (4.7GB)

# 3. Start Ollama (runs in background)
ollama serve

# 4. Use with translator
node bin/feishu-doc-translator.js \
  --translator ollama \
  --source-lang en \
  --target-lang ja \
  ...
```

### Configuration

```env
# .env (all optional)
OLLAMA_BASE_URL=http://localhost:11434  # Default Ollama URL
OLLAMA_MODEL=qwen2.5:7b                 # Your preferred model
```

### Recommended Models

**Qwen 2.5 (7B)** - Best balance
```bash
ollama pull qwen2.5:7b
```
- Size: 3.8GB
- Quality: ⭐⭐⭐⭐
- Speed: ⭐⭐⭐
- Excellent multilingual support (Chinese, Japanese, Korean, European)

**Mixtral (8x7B)** - Highest quality
```bash
ollama pull mixtral:8x7b
```
- Size: 26GB
- Quality: ⭐⭐⭐⭐⭐
- Speed: ⭐⭐
- Best for complex technical documentation

**Llama 3.1 (8B)** - Fast and capable
```bash
ollama pull llama3.1:8b
```
- Size: 4.7GB
- Quality: ⭐⭐⭐⭐
- Speed: ⭐⭐⭐
- Good general-purpose translation

### Performance
- Speed depends on hardware (CPU/GPU)
- Requires 8GB+ RAM for 7B models
- GPU acceleration recommended for large docs

## Feishu Translator

**Best for:** Simple text, quick translations, already on Feishu platform

### Features
- Built into Feishu platform
- No additional API keys needed
- Fast and reliable
- Good for basic translations

### Setup

```bash
# Already configured if you have Feishu credentials
node bin/feishu-doc-translator.js \
  --translator feishu \
  --source-lang en \
  --target-lang ja \
  ...
```

### Limitations
- Less context-aware than Claude
- May not preserve technical terminology as well
- Rate limits (30 requests/minute)

## Comparison

### Translation Quality

**Technical Documentation (EN→JA)**
1. Claude ⭐⭐⭐⭐⭐ - Best context understanding
2. DeepL ⭐⭐⭐⭐⭐ - Excellent fluency
3. Ollama (Qwen 2.5) ⭐⭐⭐⭐ - Good quality, free
4. Feishu ⭐⭐⭐ - Basic translation

**European Languages (EN→DE)**
1. DeepL ⭐⭐⭐⭐⭐ - Native quality
2. Claude ⭐⭐⭐⭐⭐ - Excellent context
3. Ollama (Mixtral) ⭐⭐⭐⭐ - Very good
4. Feishu ⭐⭐⭐ - Adequate

### Cost Comparison

For translating 1MB of documentation (~200 pages):

| Engine | Cost | Time |
|--------|------|------|
| Claude Haiku | ~$2-5 | 10-15 min |
| DeepL Free | Free (quota) | 5-10 min |
| DeepL Pro | ~€20 | 5-10 min |
| Ollama | $0 | 20-60 min* |
| Feishu | $0 | 15-20 min |

*Depends on hardware

### When to Use Each

**Use Claude if:**
- You need highest quality for technical docs
- Context awareness is critical
- Code examples and API docs involved
- Budget allows ($2-10 per large doc)

**Use DeepL if:**
- Translating to/from European languages
- Need professional business quality
- Want fast turnaround
- Have budget or free quota

**Use Ollama if:**
- Privacy is paramount (local processing)
- Working offline
- Budget is $0
- Have good hardware
- Can tolerate slower speed

**Use Feishu if:**
- Already on Feishu platform
- Simple content
- Need quick basic translation
- No external dependencies

## Advanced Usage

### Hybrid Approach

Use different engines for different content types:

```bash
# Technical docs → Claude
node bin/feishu-doc-translator.js \
  --translator claude \
  --action new \
  --dry-run | grep "API Reference"

# Marketing docs → DeepL
node bin/feishu-doc-translator.js \
  --translator deepl \
  --action new \
  --dry-run | grep "Product Guide"

# Internal docs → Ollama (private)
node bin/feishu-doc-translator.js \
  --translator ollama \
  --action new \
  --dry-run | grep "Internal"
```

### Custom Prompts

All translators support markdown translation with structure preservation. The prompts are optimized for:
- Preserving code blocks
- Maintaining markdown syntax
- Keeping technical terms
- Formal documentation tone

## Troubleshooting

### Claude Errors

**"Invalid API key"**
- Check `ANTHROPIC_API_KEY` in .env
- Verify key at https://console.anthropic.com

**"Rate limit exceeded"**
- Claude has generous limits (default: 5 concurrent)
- Add delays if needed

### DeepL Errors

**"Authentication failed"**
- Check `DEEPL_API_KEY` in .env
- Ensure using correct API URL (free vs pro)

**"Quota exceeded"**
- Free tier: 500k chars/month
- Upgrade to pro or wait for reset

### Ollama Errors

**"Connection refused"**
```bash
# Start Ollama server
ollama serve
```

**"Model not found"**
```bash
# Pull the model first
ollama pull qwen2.5:7b
```

**"Out of memory"**
- Use smaller model (qwen2.5:3b)
- Close other applications
- Upgrade RAM

### Feishu Errors

**"Translation API error"**
- Check Feishu credentials
- Verify rate limits not exceeded
- Check language code compatibility

## Performance Tips

1. **Use caching** - All translators cache results automatically
2. **Batch processing** - Translate multiple docs in one run
3. **Dry run first** - Preview changes before executing
4. **Monitor costs** - Check API usage regularly
5. **Choose right model** - Balance quality vs speed/cost

## Language Support

### All Engines
✅ English (en)
✅ Japanese (ja)
✅ Chinese Simplified (zh)
✅ Korean (ko)

### DeepL + Claude + Ollama
✅ German (de)
✅ French (fr)
✅ Spanish (es)
✅ Italian (it)
✅ Portuguese (pt)
✅ Russian (ru)
✅ Dutch (nl)
✅ Polish (pl)

See each provider's documentation for complete language lists.
