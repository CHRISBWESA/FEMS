// Shows Kiswahili for the English text that screens write directly (not through t()).
// It swaps only exact matches from the dictionary, so names, amounts and other data are left alone,
// and puts the original English back when English is chosen again.
import { SW, SW_PATTERNS } from './swDictionary';

const ATTRS = ['placeholder', 'title', 'aria-label'] as const;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'NOSCRIPT']);

let dict: Map<string, string> = new Map();
let dictLower: Map<string, string> = new Map();
let active = false;
let observer: MutationObserver | null = null;

// Original English for every text node / attribute changed, so it can be restored.
const textOriginal = new WeakMap<Text, { en: string; sw: string }>();
const attrOriginal = new WeakMap<Element, Record<string, { en: string; sw: string }>>();
const touchedText = new Set<WeakRef<Text>>();
const touchedEls = new Set<WeakRef<Element>>();

export function buildDictionary(extra: Record<string, string>) {
  const all = { ...extra, ...SW };
  dict = new Map();
  dictLower = new Map();
  for (const [en, sw] of Object.entries(all)) {
    if (!en || !sw || en === sw) continue;
    const k = en.replace(/\s+/g, ' ').trim();
    dict.set(k, sw);
    if (!dictLower.has(k.toLowerCase())) dictLower.set(k.toLowerCase(), sw);
  }
}

const SUFFIX = /(\s*(?:\*|:|,|…|\.\.\.|\?|!|\s+→))+$/;
const COUNT = /^(\d[\d,.]*)\s+(.+)$/;

function lookup(core: string): string | undefined {
  const hit = dict.get(core);
  if (hit) return hit;
  const low = dictLower.get(core.toLowerCase());
  if (low) {
    // Keep the case style of the screen text (e.g. a lower-case status shown with CSS capitalize).
    return core[0] === core[0].toLowerCase() ? low[0].toLowerCase() + low.slice(1) : low;
  }
  return undefined;
}

export function translateString(text: string, isAttr = false): string | null {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed || trimmed.length > 400 || !/[A-Za-z]/.test(trimmed)) return null;
  let out = lookup(trimmed);
  if (!out) {
    const m = trimmed.match(SUFFIX);
    if (m) {
      const core = trimmed.slice(0, trimmed.length - m[0].length);
      const t = core && lookup(core);
      if (t) out = t + m[0];
    }
  }
  if (!out) {
    // "12 Members" → "12 Wanachama"
    const m = trimmed.match(COUNT);
    if (m) {
      const t = lookup(m[2]);
      if (t) out = `${m[1]} ${t}`;
    }
  }
  if (!out) {
    for (const [re, to, only] of SW_PATTERNS) {
      if (only === 'attr' && !isAttr) continue;
      if (re.test(trimmed)) { out = trimmed.replace(re, to); break; }
    }
  }
  if (!out) return null;
  // Keep the surrounding spaces React put around the text.
  const lead = text.match(/^\s*/)![0];
  const trail = text.match(/\s*$/)![0];
  return lead + out + trail;
}

function skipped(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP_TAGS.has(e.tagName)) return true;
    if ((e as HTMLElement).isContentEditable) return true;
    if (e.hasAttribute('data-no-translate') || e.getAttribute('translate') === 'no') return true;
  }
  return false;
}

function doText(node: Text) {
  const prev = textOriginal.get(node);
  const value = node.nodeValue ?? '';
  if (prev && value === prev.sw) return; // already ours
  if (skipped(node.parentElement)) return;
  const sw = translateString(value);
  if (sw === null) {
    if (prev) textOriginal.delete(node);
    return;
  }
  textOriginal.set(node, { en: value, sw });
  touchedText.add(new WeakRef(node));
  node.nodeValue = sw;
}

function doAttrs(el: Element) {
  if (skipped(el)) return;
  for (const a of ATTRS) {
    const value = el.getAttribute(a);
    if (!value) continue;
    const store = attrOriginal.get(el) ?? {};
    if (store[a] && store[a].sw === value) continue;
    const sw = translateString(value, true);
    if (sw === null) continue;
    store[a] = { en: value, sw };
    attrOriginal.set(el, store);
    touchedEls.add(new WeakRef(el));
    el.setAttribute(a, sw);
  }
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) { doText(root as Text); return; }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) doAttrs(root as Element);
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) doText(n as Text);
    else doAttrs(n as Element);
  }
}

function restoreAll() {
  for (const ref of touchedText) {
    const n = ref.deref();
    const o = n && textOriginal.get(n);
    if (n && o && n.nodeValue === o.sw) n.nodeValue = o.en;
    if (n) textOriginal.delete(n);
  }
  touchedText.clear();
  for (const ref of touchedEls) {
    const el = ref.deref();
    const store = el && attrOriginal.get(el);
    if (el && store) {
      for (const [a, o] of Object.entries(store)) if (el.getAttribute(a) === o.sw) el.setAttribute(a, o.en);
      attrOriginal.delete(el);
    }
  }
  touchedEls.clear();
}

// Native alert / confirm / prompt messages.
const nativeAlert = typeof window !== 'undefined' ? window.alert.bind(window) : null;
const nativeConfirm = typeof window !== 'undefined' ? window.confirm.bind(window) : null;
const nativePrompt = typeof window !== 'undefined' ? window.prompt.bind(window) : null;
const tr = (m?: unknown) => (typeof m === 'string' && active ? translateString(m) ?? m : m);

export function setAutoTranslate(on: boolean) {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  if (on === active) { if (on) walk(document.body); return; }
  active = on;
  if (on) {
    walk(document.body);
    observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'characterData') doText(r.target as Text);
        else if (r.type === 'attributes') doAttrs(r.target as Element);
        else r.addedNodes.forEach(walk);
      }
    });
    observer.observe(document.body, {
      subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS],
    });
    if (nativeAlert) window.alert = (m?: unknown) => nativeAlert(tr(m) as string);
    if (nativeConfirm) window.confirm = (m?: string) => nativeConfirm(tr(m) as string);
    if (nativePrompt) window.prompt = (m?: string, d?: string) => nativePrompt(tr(m) as string, d);
  } else {
    observer?.disconnect();
    observer = null;
    restoreAll();
    if (nativeAlert) window.alert = nativeAlert;
    if (nativeConfirm) window.confirm = nativeConfirm;
    if (nativePrompt) window.prompt = nativePrompt;
  }
}
