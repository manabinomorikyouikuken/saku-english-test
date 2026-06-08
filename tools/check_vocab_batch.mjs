#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import vm from 'node:vm';

const DEFAULT_MIN = 10;
const DEFAULT_MAX = 20;
const DEFAULT_PH_MAX = 15;
const VOCAB_FILE = 'index.html';
const COMPARED_FIELDS = [
  'id',
  'w',
  'cat',
  'cats',
  'pos',
  'level',
  'ipa',
  'ph',
  'm',
  'ex',
  'exJa',
  'choiceGroup',
  'origin',
  'originType',
  'bridge'
];

function parseArgs(argv) {
  const refs = [];
  let min = DEFAULT_MIN;
  let max = DEFAULT_MAX;
  let phMax = DEFAULT_PH_MAX;
  let json = false;
  let phoneticsOnly = false;

  argv.forEach(arg => {
    if (arg === '--json') {
      json = true;
      return;
    }
    if (arg === '--phonetics') {
      phoneticsOnly = true;
      return;
    }
    if (arg.startsWith('--min=')) {
      min = Number(arg.slice('--min='.length));
      return;
    }
    if (arg.startsWith('--max=')) {
      max = Number(arg.slice('--max='.length));
      return;
    }
    if (arg.startsWith('--ph-max=')) {
      phMax = Number(arg.slice('--ph-max='.length));
      return;
    }
    refs.push(arg);
  });

  if (!Number.isFinite(min) || min < 0) throw new Error('--min must be a non-negative number');
  if (!Number.isFinite(max) || max < 1) throw new Error('--max must be a positive number');
  if (!Number.isFinite(phMax) || phMax < 1) throw new Error('--ph-max must be a positive number');
  if (min > max) throw new Error('--min must be less than or equal to --max');
  if (refs.length > 2) {
    throw new Error('Usage: node tools/check_vocab_batch.mjs [before-ref] [after-ref] [--min=10] [--max=20] [--phonetics] [--ph-max=15] [--json]');
  }

  return { refs, min, max, phMax, json, phoneticsOnly };
}

function readHtml(spec) {
  if (!spec || spec === 'WORKTREE') return fs.readFileSync(VOCAB_FILE, 'utf8');
  if (fs.existsSync(spec)) return fs.readFileSync(spec, 'utf8');
  return execFileSync('git', ['show', `${spec}:${VOCAB_FILE}`], {
    encoding: 'utf8',
    maxBuffer: 30 * 1024 * 1024
  });
}

function extractWords(html, label) {
  const marker = 'const WORDS = [';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error(`WORDS array not found in ${label}`);

  const arrayStart = html.indexOf('[', start);
  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;

  for (let i = arrayStart; i < html.length; i += 1) {
    const ch = html[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '[') depth += 1;
    if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }

  if (end < 0) throw new Error(`WORDS array end not found in ${label}`);
  const arrayText = html.slice(arrayStart, end);
  return vm.runInNewContext(`const WORDS = ${arrayText}; WORDS;`, {});
}

function normaliseWord(value) {
  return String(value || '').trim().toLowerCase();
}

function buildWordMap(words) {
  const occurrenceCounts = new Map();
  const result = new Map();

  words.forEach((word, index) => {
    const explicitId = String(word.id || '').trim();
    const baseKey = explicitId ? `id:${explicitId}` : `word:${normaliseWord(word.w)}`;
    const occurrence = occurrenceCounts.get(baseKey) || 0;
    occurrenceCounts.set(baseKey, occurrence + 1);
    const key = explicitId ? baseKey : `${baseKey}#${occurrence}`;
    result.set(key, { word, index });
  });

  return result;
}

function stringifyField(value) {
  return JSON.stringify(value ?? '');
}

function compareWords(beforeWords, afterWords) {
  const beforeMap = buildWordMap(beforeWords);
  const afterMap = buildWordMap(afterWords);
  const allKeys = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const changed = [];
  const added = [];
  const removed = [];

  [...allKeys].sort().forEach(key => {
    const before = beforeMap.get(key);
    const after = afterMap.get(key);
    if (!before && after) {
      added.push({ key, word: after.word.w || '', index: after.index });
      return;
    }
    if (before && !after) {
      removed.push({ key, word: before.word.w || '', index: before.index });
      return;
    }
    const fieldChanges = COMPARED_FIELDS.filter(field =>
      stringifyField(before.word[field]) !== stringifyField(after.word[field])
    ).map(field => ({
      field,
      before: before.word[field] ?? '',
      after: after.word[field] ?? ''
    }));

    if (fieldChanges.length) {
      changed.push({
        key,
        word: after.word.w || before.word.w || '',
        index: after.index,
        beforeWord: before.word,
        afterWord: after.word,
        changes: fieldChanges
      });
    }
  });

  return { changed, added, removed };
}

function summariseFieldCounts(entries) {
  const counts = new Map();
  entries.forEach(entry => {
    entry.changes.forEach(change => counts.set(change.field, (counts.get(change.field) || 0) + 1));
  });
  return Object.fromEntries([...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function getChangeValue(entry, fieldName, side) {
  const change = entry.changes.find(item => item.field === fieldName);
  if (change) return change[side];
  return side === 'before' ? entry.beforeWord?.[fieldName] ?? '' : entry.afterWord?.[fieldName] ?? '';
}

function getPhoneticChanges(entries) {
  return entries
    .filter(entry => entry.changes.some(change => change.field === 'ph' || change.field === 'ipa'))
    .map(entry => ({
      key: entry.key,
      word: entry.word,
      pos: entry.afterWord?.pos || entry.beforeWord?.pos || '',
      meaning: entry.afterWord?.m || entry.beforeWord?.m || '',
      ipaBefore: getChangeValue(entry, 'ipa', 'before'),
      ipaAfter: getChangeValue(entry, 'ipa', 'after'),
      phBefore: getChangeValue(entry, 'ph', 'before'),
      phAfter: getChangeValue(entry, 'ph', 'after'),
      changedFields: entry.changes.map(change => change.field)
    }));
}

function main() {
  const { refs, min, max, phMax, json, phoneticsOnly } = parseArgs(process.argv.slice(2));
  const beforeRef = refs[0] || 'HEAD';
  const afterRef = refs[1] || 'WORKTREE';
  const beforeWords = extractWords(readHtml(beforeRef), beforeRef);
  const afterWords = extractWords(readHtml(afterRef), afterRef);
  const result = compareWords(beforeWords, afterWords);
  const changedEntries = result.changed.length + result.added.length + result.removed.length;
  const phoneticChanges = getPhoneticChanges(result.changed);
  const batchStatus = changedEntries > max
    ? 'fail'
    : changedEntries > 0 && changedEntries < min
      ? 'warn'
      : 'pass';
  const phoneticsStatus = phoneticChanges.length > phMax
    ? 'fail'
    : phoneticChanges.length > 0
      ? 'review'
      : 'pass';
  const status = phoneticsOnly ? phoneticsStatus : batchStatus;

  const report = {
    goal: `Keep vocabulary data edits in ${min}-${max} changed entries per batch. More than ${max} stops the release path.`,
    phoneticsGoal: `Review every ph change against the British IPA shown here before release. Keep ph/IPA edits at ${phMax} or fewer per batch.`,
    beforeRef,
    afterRef,
    min,
    max,
    phMax,
    status,
    batchStatus,
    phoneticsStatus,
    changedEntries,
    modified: result.changed.length,
    addedCount: result.added.length,
    removedCount: result.removed.length,
    phoneticChangeCount: phoneticChanges.length,
    fieldCounts: summariseFieldCounts(result.changed),
    phoneticChanges,
    changed: result.changed,
    added: result.added,
    removed: result.removed
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`${phoneticsOnly ? 'Pronunciation helper check' : 'Vocabulary batch check'}: ${status.toUpperCase()}`);
    console.log(`Goal: ${phoneticsOnly ? report.phoneticsGoal : report.goal}`);
    console.log(`Range: ${beforeRef} -> ${afterRef}`);
    if (phoneticsOnly) {
      console.log(`Pronunciation changes: ${phoneticChanges.length}`);
      if (phoneticChanges.length) {
        console.log('Review against British IPA before release:');
        phoneticChanges.forEach(entry => {
          console.log(`- ${entry.word}`);
          console.log(`  IPA: ${entry.ipaBefore} -> ${entry.ipaAfter}`);
          console.log(`  ph: ${entry.phBefore} -> ${entry.phAfter}`);
          console.log(`  pos/meaning: ${entry.pos} / ${entry.meaning}`);
        });
      }
      if (phoneticChanges.length > phMax) {
        console.log(`Too many pronunciation edits: ${phoneticChanges.length} > ${phMax}. Split the batch before release.`);
      }
      if (phoneticChanges.length > 0 && phoneticChanges.length <= phMax) {
        console.log('Status REVIEW means this batch is small enough, but each line still needs IPA-based human review.');
      }
    } else {
    console.log(`Changed entries: ${changedEntries} (modified ${report.modified}, added ${report.addedCount}, removed ${report.removedCount})`);
    console.log(`Pronunciation changes: ${phoneticChanges.length}`);
    console.log(`Field counts: ${JSON.stringify(report.fieldCounts)}`);
    if (changedEntries) {
      console.log('Entries:');
      [...result.changed, ...result.added, ...result.removed].slice(0, 30).forEach(entry => {
        const fields = entry.changes ? entry.changes.map(change => change.field).join(',') : entry.key;
        console.log(`- ${entry.word || '(blank)'} [${fields}]`);
      });
      if (changedEntries > 30) console.log(`... ${changedEntries - 30} more`);
    }
    }
  }

  if (status === 'fail') process.exitCode = 2;
}

main();
