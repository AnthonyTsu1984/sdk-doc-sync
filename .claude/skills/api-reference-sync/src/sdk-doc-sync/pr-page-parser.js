'use strict';
// Canonical PR page parser (campaign-control batch 15, design §4.2).
//
// The four intake composers of 2026-10-15 (go/node/java/python) each carried a
// bespoke page parser whose grammars are isomorphic at the grammar-layer: the
// differences are all data (config/pr-page-profiles.json, §4.3). This module
// is the shared parsing kernel; parse-java-pr-page.js (the only fail-loud
// standalone implementation) is its direct base draft.
//
// Fail-loud by design (§4.5): every unrecognizable page shape throws a typed
// rejection carrying the page name and a raw excerpt — no best-effort field
// dropping. Every parse also returns per-rule hit counts so the composer can
// emit the profile coverage report (§4.5-3, template-drift signal).

const REJECTION_CODES = Object.freeze({
  PAGE_H1_MISSING: 'PAGE_H1_MISSING',
  PAGE_SUMMARY_MISSING: 'PAGE_SUMMARY_MISSING',
  SIGNATURE_FENCE_MISSING: 'SIGNATURE_FENCE_MISSING',
  BULLET_FORM_UNRECOGNIZED: 'BULLET_FORM_UNRECOGNIZED',
  RETURN_TYPE_MISSING: 'RETURN_TYPE_MISSING',
});

function typedError(code, message) {
  const error = new Error(`[${code}] ${message}`);
  error.code = code;
  return error;
}

function excerpt(line) {
  return String(line).trim().slice(0, 80);
}

function stripMdEscapes(text) {
  return String(text).replace(/\\([[\]<>_*])/g, '$1');
}

// ---- fence-aware sectioning (java base draft, verbatim) --------------------

function splitOrderedFences(markdown) {
  const lines = String(markdown).split(/\r?\n/);
  const out = [];
  let inFence = false;
  let lang = '';
  let buf = [];
  let prose = [];
  const flushProse = () => {
    if (prose.length > 0) {
      out.push({ fence: false, lang: '', text: prose.join('\n'), index: out.length });
      prose = [];
    }
  };
  for (const line of lines) {
    const open = line.match(/^```(\w*)\s*$/);
    if (!inFence && open) {
      flushProse();
      inFence = true;
      lang = open[1] || '';
      buf = [];
      continue;
    }
    if (inFence && /^```\s*$/.test(line)) {
      inFence = false;
      out.push({ fence: true, lang, text: buf.join('\n'), index: out.length });
      continue;
    }
    if (inFence) buf.push(line);
    else prose.push(line);
  }
  if (inFence) throw typedError(REJECTION_CODES.SIGNATURE_FENCE_MISSING, 'unterminated fence on page');
  flushProse();
  return out;
}

function section(parts, startRe, endRe) {
  // Fence-aware slice between markers: only markers on their own line OUTSIDE
  // fences count. Stops at the FIRST end marker match.
  const lines = [];
  let inSection = false;
  outer:
  for (const part of parts) {
    if (part.fence) {
      if (inSection) lines.push('```' + part.lang, part.text, '```');
      continue;
    }
    for (const line of part.text.split('\n')) {
      if (!inSection && startRe.test(line)) {
        inSection = true;
        continue;
      }
      if (inSection && endRe && endRe.test(line)) break outer;
      if (inSection) lines.push(line);
    }
  }
  return lines.join('\n');
}

function compile(regexOrString) {
  if (regexOrString instanceof RegExp) return regexOrString;
  return new RegExp(regexOrString, 'm');
}

// ---- bullet tree (five forms + profile-gated extras, §4.2-2) ----------------
//
//   `name(Type arg)`                 builder/constructor form (builderArg*)
//   `getX()` (*Type*) -              getter form
//   **name** (*Type*) -              parameter form
//   **Name**                         untyped (exception/group) form
//   UndefiedState(0) / `REPLACE`     bare choice forms (nested)
//   `name` (*Type*) -                python backtick-name parameter form
//   `Name` - text                    python single-line exception form
//
// Tail modifiers: **[REQUIRED]** line, Default: `x` line (marker regexes are
// profile data); 4-space indent = one level deeper subtree.

function flattenDescription(lines) {
  const text = lines.map((line) => line.trim()).filter(Boolean).join(' ');
  return text.replace(/\s+/g, ' ').trim();
}

function parseBulletTree(block, profile, pageName, stats) {
  const lines = block.split('\n');
  const entries = [];
  const forms = new Set(profile.bulletForms || ['builder', 'getter', 'param', 'untyped', 'enumChoice', 'backtickChoice']);
  const requiredMarker = compile(profile.requiredMarker || '^\\s*\\*\\*\\[REQUIRED\\]\\*\\*\\s*$');
  const defaultMarker = compile(profile.defaultMarker || '^\\s*Default: `?([^`\\n]+)`?\\s*$');
  let current = null;
  function pushEntry(entry, indent) {
    const depth = Math.floor(indent / 4);
    if (depth === 0) {
      entries.push(entry);
    } else {
      let parent = entries[entries.length - 1];
      if (!parent) throw typedError(REJECTION_CODES.BULLET_FORM_UNRECOGNIZED, `${pageName}: nested bullet without parent: ${excerpt(entry.raw)}`);
      for (let level = 1; level < depth; level += 1) {
        const next = parent.children[parent.children.length - 1];
        if (!next) throw typedError(REJECTION_CODES.BULLET_FORM_UNRECOGNIZED, `${pageName}: nested bullet chain gap: ${excerpt(entry.raw)}`);
        parent = next;
      }
      parent.children.push(entry);
    }
  }
  for (const raw of lines) {
    const bullet = raw.match(/^(\s*)- (.*)$/);
    if (bullet) {
      const indent = bullet[1].length;
      const rest = stripMdEscapes(bullet[2]);
      let entry = null;
      let m;
      if (forms.has('builder') && (m = rest.match(/^`([A-Za-z_$][\w$]*)\(([^)]*)\)`(?:\s*\(\*(.+?)\*\))?/))) {
        // `roleName(String roleName)` possibly (*Type*) after
        entry = {
          name: m[1],
          type: m[3] || null,
          builderArg: m[2] || '',
          builderArgType: (m[2] || '').trim().split(/\s+/)[0] || null,
          fullSignature: `${m[1]}(${m[2]})`,
          children: [], required: false, defaultValue: null, descriptionLines: [],
        };
        stats.bulletForms.builder += 1;
      } else if (forms.has('getter') && (m = rest.match(/^`([A-Za-z_$][\w$]*)\(\)`\s*\(\*(.+?)\*\)/))) {
        // `getRoleName()` (*String*) -
        entry = { name: m[1], type: m[2], children: [], required: false, defaultValue: null, descriptionLines: [], method: true };
        stats.bulletForms.getter += 1;
      } else if (forms.has('param') && (m = rest.match(/^\*\*(.+?)\*\*\s*\(([^)]*)\)\s*(?:-\s*)?(.*)$/))) {
        // **apiKey** (*String*) - description... Union emphasis spans inside
        // the type parens (*str* | *None*) are flattened to their words.
        entry = {
          name: m[1].trim(),
          type: stripEmphasisSpans(m[2]).trim(),
          children: [], required: false, defaultValue: null, descriptionLines: [],
        };
        if (m[3]) entry.descriptionLines.push(m[3]);
        stats.bulletForms.param += 1;
      } else if (forms.has('untyped') && (m = rest.match(/^\*\*(.+?)\*\*\s*$/))) {
        // **MilvusClientException** — exception/group entries carry no type.
        entry = { name: m[1], type: null, children: [], required: false, defaultValue: null, descriptionLines: [] };
        stats.bulletForms.untyped += 1;
      } else if (forms.has('untypedDescribed') && (m = rest.match(/^\*\*(.+?)\*\*\s+-\s+(.*)$/))) {
        // **error** - description — go ERROR HANDLING single-line shape.
        entry = { name: m[1], type: null, children: [], required: false, defaultValue: null, descriptionLines: [m[2]] };
        stats.bulletForms.untypedDescribed += 1;
      } else if (forms.has('enumChoice') && (m = rest.match(/^([A-Za-z_$][\w$]*)\(([^())]*)\)\s*$/))) {
        // UndefiedState(0) / Executing(1) — bare enum-value bullets.
        entry = { name: m[1], type: null, children: [], required: false, defaultValue: null, descriptionLines: [], choice: true };
        stats.bulletForms.enumChoice += 1;
      } else if (forms.has('pythonParam') && (m = rest.match(/^`([^`]+)`\s*\((.+)\)\s*(?:-\s*)?(.*)$/))) {
        // python: `texts` (*Union[str, List[str]]*) - description...
        // The type span may itself carry emphasis markers (*str* | *None*),
        // so the capture runs to the closing paren of the type annotation.
        entry = {
          name: m[1].trim(),
          type: stripEmphasisSpans(m[2]).trim(),
          children: [], required: false, defaultValue: null, descriptionLines: [],
        };
        if (m[3]) entry.descriptionLines.push(m[3]);
        stats.bulletForms.pythonParam += 1;
      } else if (forms.has('pythonException') && (m = rest.match(/^`([^`]+)`\s+-\s+(.*)$/))) {
        // python single-line exception: `MilvusException` - Raised if ...
        entry = { name: m[1].trim(), type: null, children: [], required: false, defaultValue: null, descriptionLines: [m[2]] };
        stats.bulletForms.pythonException += 1;
      } else if (forms.has('backtickChoice') && (m = rest.match(/^`([^`]+)`\s*(?:-\s*)?$/))) {
        // `REPLACE` — backticked bare choice nested in a description.
        entry = { name: m[1], type: null, children: [], required: false, defaultValue: null, descriptionLines: [], choice: true };
        stats.bulletForms.backtickChoice += 1;
      } else {
        throw typedError(
          REJECTION_CODES.BULLET_FORM_UNRECOGNIZED,
          `${pageName}: unrecognized bullet form: ${JSON.stringify(bullet[2].slice(0, 80))} (rule-candidate: add the form's profile data, do not patch this kernel)`,
        );
      }
      entry.raw = rest;
      pushEntry(entry, indent);
      current = entry;
      continue;
    }
    if (current && requiredMarker.test(raw)) {
      current.required = true;
      stats.tailModifiers.required += 1;
      continue;
    }
    const def = raw.match(defaultMarker);
    if (current && def) {
      current.defaultValue = def[1].trim();
      stats.tailModifiers.default += 1;
      continue;
    }
    if (current && raw.trim()) current.descriptionLines.push(raw);
  }
  return entries;
}

function stripEmphasisSpans(text) {
  // python union types: "*str* | *None*" -> "str | None"
  return String(text).replace(/\*([^*]+)\*/g, '$1');
}

// ---- summary register normalization (§4.2-4, three branches) ----------------

function articleFor(word) {
  return /^[aeiou]/i.test(word) ? 'An' : 'A';
}

function lowerFirst(text) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function isAllCapsAcronym(word) {
  return word.length > 1 && word === word.toUpperCase() && /^[A-Z]+$/.test(word);
}

// Branch 1: already in register ("This operation ..." / "A(n) Xxx instance ...")
// Branch 2: "This (function|method|getter|setter) ..." -> "This operation ..."
// Branch 3: verb-first/type-page -> instance register or "This operation ..." wrap.
// Acronym protection (java precedent): an all-caps first word is never
// lower-cased.
function normalizeSummary(paragraph, { title, isTypePage, profile }) {
  const text = String(paragraph).replace(/\s+/g, ' ').trim();
  if (/^This operation\b/.test(text) || /^A(n)? \w+ instance\b/.test(text)) return { summary: text, normalized: false };
  const getter = text.match(/^This (function|method|getter|setter) (.*)$/);
  if (getter) return { summary: `This operation ${getter[2]}`, normalized: true };
  const verbStarts = new Set(profile.verbStarts || []);
  const firstWord = text.split(' ')[0] || '';
  const lead = isAllCapsAcronym(firstWord)
    ? firstWord
    : lowerFirst(firstWord);
  const rest = text.slice(firstWord.length);
  if (isTypePage) {
    if (verbStarts.has(firstWord.toLowerCase())) {
      return { summary: `${articleFor(title)} ${title} instance ${lead}${rest}`, normalized: true };
    }
    return { summary: `${articleFor(title)} ${title} instance is ${lead}${rest}`, normalized: true };
  }
  return { summary: `This operation ${lead}${rest}`, normalized: true };
}

// ---- page parse (§4.2 contract) ---------------------------------------------

function newStats() {
  return {
    bulletForms: {
      builder: 0, getter: 0, param: 0, untyped: 0, untypedDescribed: 0, enumChoice: 0, backtickChoice: 0,
      pythonParam: 0, pythonException: 0,
    },
    tailModifiers: { required: 0, default: 0 },
    sections: {},
  };
}

function firstParagraphAfterH1(parts) {
  // Prose between the H1 and the first fence/heading/bullet/callout-open.
  const pre = (parts.find((p) => !p.fence) || { text: '' }).text;
  const lines = pre.split('\n').slice(1);
  const paragraph = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (paragraph.length > 0) break;
      continue;
    }
    if (/^#{1,6}\s/.test(trimmed) || /^[-*]\s/.test(trimmed) || /^```/.test(trimmed) || /^<div\b/i.test(trimmed)) break;
    paragraph.push(trimmed);
  }
  return paragraph.join(' ').replace(/\s+/g, ' ').trim();
}

// Node callout blocks: <div class="alert note"> ... </div> between H1 and the
// first paragraph — collected as summaryCallouts (node precedent).
function summaryCalloutsAfterH1(parts) {
  const pre = (parts.find((p) => !p.fence) || { text: '' }).text;
  const joined = pre.split('\n').slice(1).join('\n');
  const callouts = [];
  for (const m of joined.matchAll(/<div[^>]*class="alert (\w+)"[^>]*>([\s\S]*?)<\/div>/g)) {
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) callouts.push({ kind: m[1], text });
  }
  return callouts;
}

function parsePage(markdown, profile, pageName, opts = {}) {
  const stats = newStats();
  const h1Match = String(markdown).match(/^# (.+)$/m);
  if (!h1Match) throw typedError(REJECTION_CODES.PAGE_H1_MISSING, `${pageName}: no H1 title`);
  const title = h1Match[1].trim();
  const titleBase = profile.titleSuffix && title.endsWith(profile.titleSuffix)
    ? title.slice(0, -profile.titleSuffix.length)
    : title;

  const parts = splitOrderedFences(markdown);

  const summaryRaw = firstParagraphAfterH1(parts);
  if (!summaryRaw) throw typedError(REJECTION_CODES.PAGE_SUMMARY_MISSING, `${pageName}: no summary paragraph after H1`);
  const summaryCallouts = summaryCalloutsAfterH1(parts);
  // A page is a type page when its live record type is not Function (go
  // precedent: row.type wins) or its title carries no method-call suffix
  // ("Index" vs "AddPrivilegesToGroup()").
  const suffix = profile.titleSuffix || '()';
  const isTypePage = opts.isTypePage !== undefined
    ? opts.isTypePage
    : !title.endsWith(suffix);
  const summaryNormalized = normalizeSummary(summaryRaw, { title: titleBase, isTypePage, profile });

  // signature: first signatureFenceLang fence anywhere on the page
  const signatureLang = new RegExp(`^${profile.signatureFenceLang}$`, 'i');
  const signatureFences = parts.filter((p) => p.fence && signatureLang.test(p.lang)).map((p) => p.text);
  const signature = signatureFences.length > 0 ? signatureFences[0].trim() : null;
  if (!signature && profile.route === 'structured' && profile.requireSignature !== false) {
    throw typedError(REJECTION_CODES.SIGNATURE_FENCE_MISSING, `${pageName}: no ${profile.signatureFenceLang} fence`);
  }

  // request syntax section: intro lines + first fence's first non-empty line
  const requestSyntaxHeading = compile(profile.requestSyntaxHeading);
  let requestIntro = '';
  let requestDisplay = null;
  let requestFenceText = null;
  // Request Syntax section: ends at the next H2 (## x, not ### x — H3
  // sub-headings belong to the section, java precedent) or bold label.
  const reqSection = section(parts, requestSyntaxHeading, compile(profile.requestSyntaxStop || '^## [^#]|^\\*\\*[A-Z]'));
  stats.sections.requestSyntax = reqSection.trim() !== '';
  if (reqSection.trim()) {
    const reqParts = splitOrderedFences(reqSection);
    requestIntro = reqParts.filter((p) => !p.fence).map((p) => p.text).join('\n')
      .split('\n').map((l) => l.trim()).filter(Boolean).join(' ');
    const fence = reqParts.find((p) => p.fence && signatureLang.test(p.lang));
    if (fence) {
      requestFenceText = fence.text;
      requestDisplay = fence.text.split('\n').map((l) => l.trim()).filter(Boolean)[0] || null;
    }
  }

  // params section: ordered heading fallback chain
  let params = [];
  let paramsHeadingHit = null;
  for (const heading of profile.paramsHeadings || []) {
    const block = section(parts, compile(heading), compile(profile.paramsStop || '^\\*\\*(RETURN TYPE|RETURNS|EXCEPTIONS|EXAMPLES|NOTES|ERROR HANDLING)\\b'));
    if (block.trim()) {
      paramsHeadingHit = heading;
      params = parseBulletTree(block, profile, pageName, stats);
      break;
    }
  }
  stats.sections.params = paramsHeadingHit !== null;

  // return type: first *type* line in the section
  let returnType = null;
  if (profile.returnTypeHeading) {
    const returnTypeMatch = section(parts, compile(profile.returnTypeHeading), compile(profile.returnTypeStop || '^\\*\\*(RETURNS|EXCEPTIONS|EXAMPLES|NOTES|ERROR HANDLING)\\b'))
      .match(/^\s*\*(.+?)\*\s*$/m);
    returnType = returnTypeMatch ? stripMdEscapes(returnTypeMatch[1]).trim() : null;
    if (!returnType && profile.returnTypeRequired) {
      throw typedError(REJECTION_CODES.RETURN_TYPE_MISSING, `${pageName}: RETURN TYPE section has no *type* line`);
    }
  }
  stats.sections.returnType = returnType !== null;

  // returns prose + getter tree
  let returnsDescription = '';
  let getters = [];
  let returnsTypeLine = null;
  let returnsSchemaFence = null;
  if (profile.returnsHeading) {
    const returnsSection = section(parts, compile(profile.returnsHeading), compile(profile.returnsStop || '^(\\*\\*[A-Z]|## )'));
    const returnsParts = splitOrderedFences(returnsSection);
    const proseLines = [];
    const bulletLines = [];
    let inBullets = false;
    let typeSeen = false;
    for (const part of returnsParts) {
      if (part.fence) {
        if (!returnsSchemaFence && profile.returnsSchemaFence === true) returnsSchemaFence = part.text;
        continue;
      }
      for (const line of part.text.split('\n')) {
        const trimmed = line.trim();
        if (!typeSeen && /^\*(.+?)\*\s*$/.test(trimmed) && profile.returnsTypeInline === true) {
          returnsTypeLine = stripMdEscapes(trimmed.slice(1, -1)).trim();
          typeSeen = true;
          continue;
        }
        if (/^\s*-\s/.test(line)) inBullets = true;
        if (inBullets && profile.returnsBulletsAsProse !== true) (bulletLines).push(line);
        else proseLines.push(line);
      }
    }
    returnsDescription = proseLines.map((l) => l.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    getters = bulletLines.length ? parseBulletTree(bulletLines.join('\n'), profile, pageName, stats) : [];
  }
  stats.sections.returns = Boolean(returnsDescription || getters.length || returnsTypeLine);

  // exceptions / error handling
  let exceptions = [];
  if (profile.errorHeading) {
    const errorBlock = section(parts, compile(profile.errorHeading), compile(profile.errorStop || '^(\\*\\*[A-Z]|## )'));
    exceptions = errorBlock.trim()
      ? parseBulletTree(errorBlock, profile, pageName, stats).map((entry) => ({
        name: entry.name,
        description: flattenDescription(entry.descriptionLines),
        required: entry.required,
        children: entry.children,
      }))
      : [];
  }
  stats.sections.exceptions = exceptions.length > 0;

  // examples: every exampleFenceLang fence in the Example section, in order
  let exampleIntro = '';
  let exampleFences = [];
  let exampleSectionPresent = false;
  if (profile.exampleHeading) {
    const exampleSection = section(parts, compile(profile.exampleHeading), compile(profile.exampleStop || '^## '));
    exampleSectionPresent = exampleSection.trim() !== '';
    if (exampleSectionPresent) {
      const exampleParts = splitOrderedFences(exampleSection);
      exampleIntro = exampleParts.filter((p) => !p.fence).map((p) => p.text).join('\n')
        .split('\n').map((l) => l.trim()).filter(Boolean).join(' ');
      exampleFences = exampleParts
        .filter((p) => p.fence && new RegExp(`^${profile.exampleFenceLang}$`, 'i').test(p.lang))
        .map((p) => p.text.trim())
        .filter(Boolean);
    }
  }
  stats.sections.examples = exampleFences.length > 0;

  // related operations: [text](target.md) pairs
  let related = [];
  if (profile.relatedHeading) {
    const relatedSection = section(parts, compile(profile.relatedHeading), compile('^## '));
    for (const m of relatedSection.matchAll(/\[([^\]]+)\]\(([^)]+\.md)\)/g)) {
      related.push({ text: m[1], target: m[2] });
    }
  }

  return {
    pageName,
    title,
    titleBase,
    summary: summaryNormalized.summary,
    summaryRegisterNormalized: summaryNormalized.normalized,
    summaryCallouts,
    signature,
    signatureFences,
    requestIntro,
    requestDisplay,
    requestFenceText,
    params,
    returnType,
    returnsTypeLine,
    returnsDescription,
    returnsSchemaFence,
    getters,
    exceptions,
    exampleIntro,
    exampleFences,
    exampleSectionPresent,
    related,
    stats,
  };
}

module.exports = {
  REJECTION_CODES,
  articleFor,
  flattenDescription,
  isAllCapsAcronym,
  lowerFirst,
  normalizeSummary,
  parseBulletTree,
  parsePage,
  section,
  splitOrderedFences,
  stripEmphasisSpans,
  stripMdEscapes,
  typedError,
};
