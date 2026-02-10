#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const DOCS_DIR = path.join(ROOT, 'docs');
const RUNS_DIR = path.join(DOCS_DIR, 'agent-runs');

const PATHS = {
  config: path.join(DOCS_DIR, 'orchestration.config.json'),
  state: path.join(DOCS_DIR, 'orchestration-state.json'),
  journeyMapJson: path.join(DOCS_DIR, 'journey-map.json'),
  featureMapJson: path.join(DOCS_DIR, 'feature-map.json'),
  journeyMapMd: path.join(DOCS_DIR, 'journey-map.md'),
  featureMapMd: path.join(DOCS_DIR, 'feature-map.md'),
  journeyFrontier: path.join(DOCS_DIR, 'journey-frontier.json'),
  featureFrontier: path.join(DOCS_DIR, 'feature-frontier.json'),
  journeyCoverage: path.join(DOCS_DIR, 'journey-coverage.json'),
  featureCoverage: path.join(DOCS_DIR, 'feature-coverage.json'),
  journeyCandidates: path.join(DOCS_DIR, 'journey-candidates.jsonl'),
  featureCandidates: path.join(DOCS_DIR, 'feature-candidates.jsonl')
};

const JOURNEY_MODES = new Set(['discover_new', 'extend_existing']);
const FEATURE_MODES = new Set(['inventory', 'exercise', 'expansion']);

const DEFAULT_CONFIG = {
  version: 1,
  roles: ['admin', 'manager', 'worker'],
  expectedRoutes: [],
  expectedFeatureUnits: [],
  targetRouteCoveragePct: 95,
  targetFeatureCoveragePct: 100,
  stagnationThreshold: 3,
  minimumConfidence: 0.6,
  maxWorkersPerRound: 6,
  defaultShardSize: 4
};

const DEFAULT_STATE = {
  version: 1,
  round: 0,
  pendingRound: null,
  consecutiveNoFindings: 0,
  completed: false,
  lastRunAt: null,
  history: []
};

const DEFAULT_JOURNEY_FRONTIER = {
  version: 1,
  items: [
    {
      id: 'seed-journey-admin-dashboard',
      mode: 'discover_new',
      role: 'admin',
      route: '/dashboard',
      state: 'default',
      note: 'Start from dashboard and discover first-level journeys.',
      priority: 1
    },
    {
      id: 'seed-journey-manager-dashboard',
      mode: 'discover_new',
      role: 'manager',
      route: '/dashboard',
      state: 'default',
      note: 'Start from dashboard and discover manager-specific journeys.',
      priority: 1
    }
  ]
};

const DEFAULT_FEATURE_FRONTIER = {
  version: 1,
  items: [
    {
      id: 'seed-feature-admin-dashboard-filter',
      mode: 'inventory',
      role: 'admin',
      route: '/dashboard',
      state: 'default',
      selector: "button[aria-label*='filter'], button:has-text('Filter')",
      action: 'click',
      note: 'Open filter popup and enumerate all interactive controls.',
      priority: 1
    }
  ]
};

const DEFAULT_JOURNEY_MAP = { version: 1, journeys: [] };
const DEFAULT_FEATURE_MAP = { version: 1, features: [] };

const DEFAULT_JOURNEY_COVERAGE = {
  version: 1,
  lastUpdated: null,
  summary: {
    totalJourneys: 0,
    routesDiscovered: 0,
    routeCoveragePct: null,
    byRole: {}
  },
  history: []
};

const DEFAULT_FEATURE_COVERAGE = {
  version: 1,
  lastUpdated: null,
  summary: {
    totalFeatureUnits: 0,
    exercisedFeatureUnits: 0,
    featureCoveragePct: 0,
    byRole: {}
  },
  history: []
};

const DEFAULT_JOURNEY_MAP_MD = `# Journey Map

Accepted end-to-end journeys discovered by subagents.

## Completion Gates

- Route coverage target: \`95%\` of expected routes (if configured)
- Role coverage target: all configured roles should have accepted journeys
- Frontier must be empty
- No-new-findings streak must meet threshold (default: \`3\` rounds)

## Accepted Journeys

| id | role | goal | entrypoint | terminal_state | key_routes | status | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
`;

const DEFAULT_FEATURE_MAP_MD = `# Feature Map

Accepted feature-level interactions discovered by subagents.

## Interaction Contract

1. Control is visible and enabled.
2. Interaction is executed.
3. Expected effect is asserted.
4. Newly revealed UI is recrawled and added to frontier.

## Accepted Features

| id | role | route | state | selector | action | expected | discovered_after | status | evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
`;

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function ensureFile(filePath, content) {
  if (!fs.existsSync(filePath)) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, idx) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at ${filePath}:${idx + 1}: ${error.message}`);
      }
    });
}

function appendJsonl(filePath, record) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
}

function timestamp() {
  return new Date().toISOString();
}

function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function padRound(roundNumber) {
  return `round-${String(roundNumber).padStart(3, '0')}`;
}

function stableHash(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function journeyFingerprint(candidate) {
  const keyRoutes = safeArray(candidate.keyRoutes).length
    ? safeArray(candidate.keyRoutes)
    : safeArray(candidate.steps).map((step) => step.route).filter(Boolean);

  return [
    normalize(candidate.role),
    normalize(candidate.goal),
    keyRoutes.map((route) => normalize(route)).join('>'),
    normalize(candidate.terminalState || candidate.terminal_state)
  ].join('|');
}

function featureFingerprint(candidate) {
  return [
    normalize(candidate.role),
    normalize(candidate.route),
    normalize(candidate.state),
    normalize(candidate.selector),
    normalize(candidate.action)
  ].join('|');
}

function hasJourneyEvidence(candidate) {
  const topLevelEvidence = safeArray(candidate.evidence).some((entry) => {
    if (!entry || typeof entry !== 'object') {
      return false;
    }

    return Boolean(entry.path || entry.url || entry.note || entry.log);
  });

  const stepEvidence = safeArray(candidate.steps).some((step) => {
    const evidence = step?.evidence;
    if (!evidence || typeof evidence !== 'object') {
      return false;
    }

    return Boolean(evidence.url || evidence.screenshot || evidence.log);
  });

  return topLevelEvidence || stepEvidence;
}

function hasFeatureEvidence(candidate) {
  const evidence = candidate.evidence;
  if (!evidence || typeof evidence !== 'object') {
    return false;
  }

  return Boolean(evidence.url && (evidence.assertion || evidence.screenshot || evidence.log));
}

function validateJourneyCandidate(candidate, minimumConfidence) {
  if (!candidate || typeof candidate !== 'object') {
    return { ok: false, reason: 'Candidate is not an object' };
  }

  if (!candidate.role) {
    return { ok: false, reason: 'Missing role' };
  }

  if (!candidate.goal) {
    return { ok: false, reason: 'Missing goal' };
  }

  const hasSteps = safeArray(candidate.steps).length > 0;
  const hasRoutes = safeArray(candidate.keyRoutes).length > 0;
  if (!hasSteps && !hasRoutes) {
    return { ok: false, reason: 'Missing steps and keyRoutes' };
  }

  if (!hasJourneyEvidence(candidate)) {
    return { ok: false, reason: 'Missing evidence' };
  }

  const confidence = Number(candidate.confidence ?? 0);
  if (Number.isNaN(confidence) || confidence < minimumConfidence) {
    return { ok: false, reason: `Confidence below minimum (${minimumConfidence})` };
  }

  return { ok: true };
}

function validateFeatureCandidate(candidate, minimumConfidence) {
  if (!candidate || typeof candidate !== 'object') {
    return { ok: false, reason: 'Candidate is not an object' };
  }

  if (!candidate.role || !candidate.route || !candidate.state || !candidate.selector || !candidate.action) {
    return {
      ok: false,
      reason: 'Missing one of required fields: role, route, state, selector, action'
    };
  }

  if (!candidate.expected) {
    return { ok: false, reason: 'Missing expected assertion' };
  }

  if (!hasFeatureEvidence(candidate)) {
    return { ok: false, reason: 'Missing evidence' };
  }

  const confidence = Number(candidate.confidence ?? 0);
  if (Number.isNaN(confidence) || confidence < minimumConfidence) {
    return { ok: false, reason: `Confidence below minimum (${minimumConfidence})` };
  }

  return { ok: true };
}

function ensureId(prefix, candidate, existingIds, fingerprint) {
  const provided = String(candidate.id ?? '').trim();
  if (provided && !existingIds.has(provided)) {
    existingIds.add(provided);
    return provided;
  }

  const generated = `${prefix}-${stableHash(fingerprint)}`;
  if (!existingIds.has(generated)) {
    existingIds.add(generated);
    return generated;
  }

  let suffix = 2;
  while (existingIds.has(`${generated}-${suffix}`)) {
    suffix += 1;
  }

  const unique = `${generated}-${suffix}`;
  existingIds.add(unique);
  return unique;
}

function roundToTwo(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return null;
  }

  return Math.round(Number(value) * 100) / 100;
}

function buildJourneyMarkdown(journeyMap, config) {
  const header = [
    '# Journey Map',
    '',
    'Accepted end-to-end journeys discovered by subagents.',
    '',
    '## Completion Gates',
    '',
    `- Route coverage target: \`${config.targetRouteCoveragePct}%\` of expected routes (if configured)`,
    '- Role coverage target: all configured roles should have accepted journeys',
    '- Frontier must be empty',
    `- No-new-findings streak must meet threshold (default: \`${config.stagnationThreshold}\` rounds)`,
    '',
    '## Accepted Journeys',
    '',
    '| id | role | goal | entrypoint | terminal_state | key_routes | status | evidence |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |'
  ];

  const rows = safeArray(journeyMap.journeys).map((journey) => {
    const keyRoutes = safeArray(journey.keyRoutes).join(' -> ');
    const evidence = safeArray(journey.evidence)
      .map((entry) => entry.path || entry.url || entry.note || '')
      .filter(Boolean)
      .slice(0, 2)
      .join('; ');

    return `| ${escapeCell(journey.id)} | ${escapeCell(journey.role)} | ${escapeCell(journey.goal)} | ${escapeCell(
      journey.entrypoint
    )} | ${escapeCell(journey.terminalState)} | ${escapeCell(keyRoutes)} | ${escapeCell(
      journey.status || 'accepted'
    )} | ${escapeCell(evidence)} |`;
  });

  return `${header.concat(rows).join('\n')}\n`;
}

function buildFeatureMarkdown(featureMap) {
  const header = [
    '# Feature Map',
    '',
    'Accepted feature-level interactions discovered by subagents.',
    '',
    '## Interaction Contract',
    '',
    '1. Control is visible and enabled.',
    '2. Interaction is executed.',
    '3. Expected effect is asserted.',
    '4. Newly revealed UI is recrawled and added to frontier.',
    '',
    '## Accepted Features',
    '',
    '| id | role | route | state | selector | action | expected | discovered_after | status | evidence |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
  ];

  const rows = safeArray(featureMap.features).map((feature) => {
    const evidence = feature.evidence?.screenshot || feature.evidence?.assertion || feature.evidence?.url || '';
    return `| ${escapeCell(feature.id)} | ${escapeCell(feature.role)} | ${escapeCell(feature.route)} | ${escapeCell(
      feature.state
    )} | ${escapeCell(feature.selector)} | ${escapeCell(feature.action)} | ${escapeCell(
      feature.expected
    )} | ${escapeCell(feature.discoveredAfter || '')} | ${escapeCell(feature.status || 'accepted')} | ${escapeCell(
      evidence
    )} |`;
  });

  return `${header.concat(rows).join('\n')}\n`;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0] || 'status';
  const flags = new Set();
  const options = {};

  for (let i = 1; i < args.length; i += 1) {
    const token = args[i];
    if (token.startsWith('--')) {
      const [key, rawValue] = token.split('=');
      if (rawValue !== undefined) {
        options[key] = rawValue;
      } else {
        const next = args[i + 1];
        if (next && !next.startsWith('--')) {
          options[key] = next;
          i += 1;
        } else {
          flags.add(key);
        }
      }
    }
  }

  return { command, flags, options };
}

function detectCandidateType(candidate, fallbackType) {
  if (candidate?.candidateType === 'journey' || candidate?.candidateType === 'feature') {
    return candidate.candidateType;
  }

  return fallbackType;
}

function contextFilesForTask(agentType) {
  switch (agentType) {
    case 'journey-discover-new':
    case 'journey-extend-existing':
      return [
        'docs/journey-map.md',
        'docs/feature-map.md',
        'docs/subagent-prompts/output-schemas.md'
      ];
    case 'feature-inventory':
    case 'feature-exercise':
    case 'feature-expansion':
      return ['docs/feature-map.md', 'docs/subagent-prompts/output-schemas.md'];
    default:
      return ['docs/subagent-prompts/output-schemas.md'];
  }
}

function makeTask(roundNumber, index, agentType, promptFile, items) {
  const taskId = `task-${String(index).padStart(2, '0')}-${agentType}`;
  const roundSlug = padRound(roundNumber);

  return {
    taskId,
    round: roundNumber,
    roundSlug,
    agentType,
    promptFile,
    outputPath: `docs/agent-runs/${roundSlug}/outputs/${taskId}.json`,
    contextFiles: contextFilesForTask(agentType),
    items
  };
}

function sortByPriorityThenId(left, right) {
  const leftPriority = Number(left.priority ?? 1000);
  const rightPriority = Number(right.priority ?? 1000);
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  return String(left.id || '').localeCompare(String(right.id || ''));
}

function buildTasksFromFrontiers(journeyFrontier, featureFrontier, config, roundNumber) {
  const shardSize = Math.max(1, Number(config.defaultShardSize || 4));

  const grouped = [];

  const journeyItems = safeArray(journeyFrontier.items).slice().sort(sortByPriorityThenId);
  const featureItems = safeArray(featureFrontier.items).slice().sort(sortByPriorityThenId);

  for (const mode of JOURNEY_MODES) {
    const items = journeyItems.filter((item) => (item.mode || 'discover_new') === mode).slice(0, shardSize);
    if (items.length > 0) {
      const prompt =
        mode === 'discover_new'
          ? 'docs/subagent-prompts/journey-discover-new.md'
          : 'docs/subagent-prompts/journey-extend-existing.md';
      grouped.push({
        agentType: mode === 'discover_new' ? 'journey-discover-new' : 'journey-extend-existing',
        promptFile: prompt,
        items,
        groupPriority: Math.min(...items.map((item) => Number(item.priority ?? 1000)))
      });
    }
  }

  for (const mode of FEATURE_MODES) {
    const items = featureItems.filter((item) => (item.mode || 'inventory') === mode).slice(0, shardSize);
    if (items.length > 0) {
      const promptMap = {
        inventory: 'docs/subagent-prompts/feature-inventory.md',
        exercise: 'docs/subagent-prompts/feature-exercise.md',
        expansion: 'docs/subagent-prompts/feature-expansion.md'
      };

      grouped.push({
        agentType: `feature-${mode}`,
        promptFile: promptMap[mode],
        items,
        groupPriority: Math.min(...items.map((item) => Number(item.priority ?? 1000)))
      });
    }
  }

  grouped.sort((a, b) => a.groupPriority - b.groupPriority);

  const workerLimit = Math.max(1, Number(config.maxWorkersPerRound || 6));
  const selectedGroups = grouped.slice(0, workerLimit);

  const tasks = selectedGroups.map((group, idx) =>
    makeTask(roundNumber, idx + 1, group.agentType, group.promptFile, group.items)
  );

  const selectedJourneyIds = [];
  const selectedFeatureIds = [];

  for (const task of tasks) {
    for (const item of task.items) {
      if (task.agentType.startsWith('journey-')) {
        selectedJourneyIds.push(item.id);
      }
      if (task.agentType.startsWith('feature-')) {
        selectedFeatureIds.push(item.id);
      }
    }
  }

  return { tasks, selectedJourneyIds, selectedFeatureIds };
}

function readRoundOutputs(roundDir) {
  const outputsDir = path.join(roundDir, 'outputs');
  ensureDir(outputsDir);

  const files = fs
    .readdirSync(outputsDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({
      name,
      path: path.join(outputsDir, name)
    }));

  const parsed = [];
  for (const file of files) {
    const raw = fs.readFileSync(file.path, 'utf8');
    try {
      parsed.push({
        fileName: file.name,
        payload: JSON.parse(raw)
      });
    } catch (error) {
      throw new Error(`Invalid JSON output in ${file.path}: ${error.message}`);
    }
  }

  return parsed;
}

function extractCandidates(outputs) {
  const journeyCandidates = [];
  const featureCandidates = [];
  const reportedTaskIds = new Set();

  for (const output of outputs) {
    const fallbackType = output.fileName.includes('journey-') ? 'journey' : 'feature';
    const taskId = output.fileName.replace(/\.json$/, '');
    reportedTaskIds.add(taskId);

    const payload = output.payload;
    const candidates = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.candidates)
        ? payload.candidates
        : payload?.candidateType
          ? [payload]
          : [];

    for (const candidate of candidates) {
      const candidateType = detectCandidateType(candidate, fallbackType);
      const enriched = {
        ...candidate,
        __sourceFile: output.fileName,
        __taskId: taskId
      };

      if (candidateType === 'journey') {
        journeyCandidates.push(enriched);
      } else if (candidateType === 'feature') {
        featureCandidates.push(enriched);
      }
    }
  }

  return { journeyCandidates, featureCandidates, reportedTaskIds };
}

function discoverKind(item) {
  if (item.kind === 'journey' || item.kind === 'feature') {
    return item.kind;
  }

  if (JOURNEY_MODES.has(item.mode)) {
    return 'journey';
  }

  if (FEATURE_MODES.has(item.mode)) {
    return 'feature';
  }

  if (item.selector || item.action) {
    return 'feature';
  }

  return 'journey';
}

function journeyFrontierKey(item) {
  return [
    normalize(item.mode || 'discover_new'),
    normalize(item.role),
    normalize(item.route),
    normalize(item.state),
    normalize(item.note)
  ].join('|');
}

function featureFrontierKey(item) {
  return [
    normalize(item.mode || 'inventory'),
    normalize(item.role),
    normalize(item.route),
    normalize(item.state),
    normalize(item.selector),
    normalize(item.action)
  ].join('|');
}

function coerceJourneyFrontierItem(item) {
  return {
    id: item.id || `journey-frontier-${stableHash(journeyFrontierKey(item))}`,
    mode: item.mode || 'discover_new',
    role: item.role || 'admin',
    route: item.route || '/dashboard',
    state: item.state || 'default',
    note: item.note || item.goal || 'Discovered follow-up journey',
    priority: Number(item.priority ?? 3)
  };
}

function coerceFeatureFrontierItem(item) {
  return {
    id: item.id || `feature-frontier-${stableHash(featureFrontierKey(item))}`,
    mode: item.mode || 'inventory',
    role: item.role || 'admin',
    route: item.route || '/dashboard',
    state: item.state || 'default',
    selector: item.selector || 'unknown-selector',
    action: item.action || 'click',
    note: item.note || item.expected || 'Discovered follow-up feature',
    priority: Number(item.priority ?? 3)
  };
}

function toExpectedFeatureKey(entry) {
  if (typeof entry === 'string') {
    return normalize(entry);
  }

  if (entry && typeof entry === 'object') {
    return featureFingerprint(entry);
  }

  return '';
}

function computeJourneyCoverage(journeyMap, config) {
  const journeys = safeArray(journeyMap.journeys);
  const byRole = {};
  const discoveredRouteSet = new Set();

  for (const journey of journeys) {
    const role = journey.role || 'unknown';
    byRole[role] = (byRole[role] || 0) + 1;

    for (const route of safeArray(journey.keyRoutes)) {
      discoveredRouteSet.add(normalize(route));
    }

    for (const step of safeArray(journey.steps)) {
      if (step?.route) {
        discoveredRouteSet.add(normalize(step.route));
      }
    }
  }

  const expectedRoutes = safeArray(config.expectedRoutes).map((route) => normalize(route)).filter(Boolean);
  let routeCoveragePct = null;
  if (expectedRoutes.length > 0) {
    const covered = expectedRoutes.filter((route) => discoveredRouteSet.has(route)).length;
    routeCoveragePct = roundToTwo((covered / expectedRoutes.length) * 100);
  }

  return {
    totalJourneys: journeys.length,
    routesDiscovered: discoveredRouteSet.size,
    routeCoveragePct,
    byRole
  };
}

function computeFeatureCoverage(featureMap, config) {
  const features = safeArray(featureMap.features);
  const byRole = {};
  const allUnitKeys = new Set();
  const exercisedKeys = new Set();

  for (const feature of features) {
    const key = feature.fingerprint || featureFingerprint(feature);
    allUnitKeys.add(key);

    const role = feature.role || 'unknown';
    if (!byRole[role]) {
      byRole[role] = { total: 0, exercised: 0 };
    }

    byRole[role].total += 1;

    const status = normalize(feature.status || '');
    if (status === 'exercised' || normalize(feature.mode) === 'exercise') {
      exercisedKeys.add(key);
      byRole[role].exercised += 1;
    }
  }

  const expected = safeArray(config.expectedFeatureUnits)
    .map((entry) => toExpectedFeatureKey(entry))
    .filter(Boolean);

  let totalFeatureUnits;
  let exercisedFeatureUnits;

  if (expected.length > 0) {
    totalFeatureUnits = expected.length;
    exercisedFeatureUnits = expected.filter((key) => exercisedKeys.has(key)).length;
  } else {
    totalFeatureUnits = allUnitKeys.size;
    exercisedFeatureUnits = exercisedKeys.size;
  }

  const featureCoveragePct =
    totalFeatureUnits === 0 ? 0 : roundToTwo((exercisedFeatureUnits / totalFeatureUnits) * 100);

  return {
    totalFeatureUnits,
    exercisedFeatureUnits,
    featureCoveragePct,
    byRole
  };
}

function runInit() {
  ensureDir(DOCS_DIR);
  ensureDir(RUNS_DIR);
  ensureDir(path.join(DOCS_DIR, 'subagent-prompts'));

  ensureFile(PATHS.config, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
  ensureFile(PATHS.state, `${JSON.stringify(DEFAULT_STATE, null, 2)}\n`);
  ensureFile(PATHS.journeyFrontier, `${JSON.stringify(DEFAULT_JOURNEY_FRONTIER, null, 2)}\n`);
  ensureFile(PATHS.featureFrontier, `${JSON.stringify(DEFAULT_FEATURE_FRONTIER, null, 2)}\n`);
  ensureFile(PATHS.journeyMapJson, `${JSON.stringify(DEFAULT_JOURNEY_MAP, null, 2)}\n`);
  ensureFile(PATHS.featureMapJson, `${JSON.stringify(DEFAULT_FEATURE_MAP, null, 2)}\n`);
  ensureFile(PATHS.journeyCoverage, `${JSON.stringify(DEFAULT_JOURNEY_COVERAGE, null, 2)}\n`);
  ensureFile(PATHS.featureCoverage, `${JSON.stringify(DEFAULT_FEATURE_COVERAGE, null, 2)}\n`);
  ensureFile(PATHS.journeyMapMd, DEFAULT_JOURNEY_MAP_MD);
  ensureFile(PATHS.featureMapMd, DEFAULT_FEATURE_MAP_MD);
  ensureFile(PATHS.journeyCandidates, '');
  ensureFile(PATHS.featureCandidates, '');
  ensureFile(path.join(RUNS_DIR, '.gitkeep'), '');

  const prompts = {
    'output-schemas.md': '# Output Schemas\n\nSubagents must return JSON only.\n',
    'journey-discover-new.md': '# Journey Discover-New Agent Prompt\n',
    'journey-extend-existing.md': '# Journey Extend-Existing Agent Prompt\n',
    'journey-reviewer.md': '# Journey Reviewer Agent Prompt\n',
    'feature-inventory.md': '# Feature Inventory Agent Prompt\n',
    'feature-exercise.md': '# Feature Exercise Agent Prompt\n',
    'feature-expansion.md': '# Feature Expansion Agent Prompt\n',
    'feature-audit.md': '# Feature Audit Agent Prompt\n'
  };

  for (const [fileName, content] of Object.entries(prompts)) {
    ensureFile(path.join(DOCS_DIR, 'subagent-prompts', fileName), content);
  }

  console.log('Initialized ux-map workspace.');
}

function runPrepareRound() {
  const config = { ...DEFAULT_CONFIG, ...readJson(PATHS.config, DEFAULT_CONFIG) };
  const state = { ...DEFAULT_STATE, ...readJson(PATHS.state, DEFAULT_STATE) };

  if (state.pendingRound !== null) {
    throw new Error(
      `Round ${state.pendingRound} is pending merge. Run merge-round first or clear docs/orchestration-state.json intentionally.`
    );
  }

  const journeyFrontier = readJson(PATHS.journeyFrontier, DEFAULT_JOURNEY_FRONTIER);
  const featureFrontier = readJson(PATHS.featureFrontier, DEFAULT_FEATURE_FRONTIER);

  const roundNumber = Number(state.round || 0) + 1;
  const roundSlug = padRound(roundNumber);
  const roundDir = path.join(RUNS_DIR, roundSlug);
  ensureDir(roundDir);
  ensureDir(path.join(roundDir, 'tasks'));
  ensureDir(path.join(roundDir, 'outputs'));
  ensureDir(path.join(roundDir, 'screenshots'));

  const { tasks, selectedJourneyIds, selectedFeatureIds } = buildTasksFromFrontiers(
    journeyFrontier,
    featureFrontier,
    config,
    roundNumber
  );

  if (tasks.length === 0) {
    console.log('No frontier items available to schedule.');
    return;
  }

  for (const task of tasks) {
    const taskPath = path.join(roundDir, 'tasks', `${task.taskId}.json`);
    writeJson(taskPath, task);
  }

  const manifest = {
    round: roundNumber,
    roundSlug,
    createdAt: timestamp(),
    status: 'prepared',
    selectedJourneyIds,
    selectedFeatureIds,
    tasks: tasks.map((task) => ({
      taskId: task.taskId,
      agentType: task.agentType,
      promptFile: task.promptFile,
      itemCount: task.items.length,
      ids: task.items.map((item) => item.id)
    }))
  };

  writeJson(path.join(roundDir, 'manifest.json'), manifest);

  const instructionLines = [
    `# ${roundSlug}`,
    '',
    '1. For each task file in `tasks/`, run one subagent.',
    '2. Use the task `promptFile` and the assigned `items` shard.',
    '3. Save JSON output to `outputs/<task-id>.json`.',
    '4. Run `npm run merge-round` to review, dedupe, and merge accepted findings.'
  ];

  fs.writeFileSync(path.join(roundDir, 'ROUND-INSTRUCTIONS.md'), `${instructionLines.join('\n')}\n`, 'utf8');

  state.pendingRound = roundNumber;
  state.lastRunAt = timestamp();
  writeJson(PATHS.state, state);

  console.log(`Prepared ${roundSlug}.`);
  console.log(`Tasks: ${tasks.length}`);
  console.log(`Journey frontier assigned: ${selectedJourneyIds.length}`);
  console.log(`Feature frontier assigned: ${selectedFeatureIds.length}`);
  console.log(`Task files: ${path.join(roundDir, 'tasks')}`);
}

function runMergeRound() {
  const config = { ...DEFAULT_CONFIG, ...readJson(PATHS.config, DEFAULT_CONFIG) };
  const state = { ...DEFAULT_STATE, ...readJson(PATHS.state, DEFAULT_STATE) };

  if (state.pendingRound === null) {
    throw new Error('No pending round to merge. Run prepare-round first.');
  }

  const roundNumber = Number(state.pendingRound);
  const roundSlug = padRound(roundNumber);
  const roundDir = path.join(RUNS_DIR, roundSlug);
  const manifestPath = path.join(roundDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing manifest for ${roundSlug}: ${manifestPath}`);
  }

  const manifest = readJson(manifestPath, null);
  const outputs = readRoundOutputs(roundDir);
  const { journeyCandidates, featureCandidates, reportedTaskIds } = extractCandidates(outputs);

  const journeyMap = readJson(PATHS.journeyMapJson, DEFAULT_JOURNEY_MAP);
  const featureMap = readJson(PATHS.featureMapJson, DEFAULT_FEATURE_MAP);

  const existingJourneyFingerprints = new Set(
    safeArray(journeyMap.journeys).map((journey) => journey.fingerprint || journeyFingerprint(journey))
  );
  const existingFeatureFingerprints = new Set(
    safeArray(featureMap.features).map((feature) => feature.fingerprint || featureFingerprint(feature))
  );

  const seenJourneyFingerprints = new Set(existingJourneyFingerprints);
  const seenFeatureFingerprints = new Set(existingFeatureFingerprints);

  const journeyIds = new Set(safeArray(journeyMap.journeys).map((journey) => journey.id));
  const featureIds = new Set(safeArray(featureMap.features).map((feature) => feature.id));

  const acceptedJourneys = [];
  const rejectedJourneys = [];
  const acceptedFeatures = [];
  const rejectedFeatures = [];

  for (const candidate of journeyCandidates) {
    const validation = validateJourneyCandidate(candidate, Number(config.minimumConfidence));
    if (!validation.ok) {
      rejectedJourneys.push({ candidate, reason: validation.reason });
      continue;
    }

    const fingerprint = journeyFingerprint(candidate);
    if (seenJourneyFingerprints.has(fingerprint)) {
      rejectedJourneys.push({ candidate, reason: 'Duplicate journey fingerprint' });
      continue;
    }

    seenJourneyFingerprints.add(fingerprint);
    const id = ensureId('journey', candidate, journeyIds, fingerprint);

    const normalized = {
      id,
      candidateType: 'journey',
      mode: candidate.mode || 'discover_new',
      role: candidate.role,
      goal: candidate.goal,
      entrypoint: candidate.entrypoint || candidate.route || '/dashboard',
      steps: safeArray(candidate.steps),
      terminalState: candidate.terminalState || candidate.terminal_state || 'terminal state unspecified',
      keyRoutes: safeArray(candidate.keyRoutes).length
        ? safeArray(candidate.keyRoutes)
        : safeArray(candidate.steps).map((step) => step.route).filter(Boolean),
      status: 'accepted',
      evidence: safeArray(candidate.evidence),
      confidence: Number(candidate.confidence),
      discoveredFrontier: safeArray(candidate.discoveredFrontier),
      fingerprint,
      acceptedRound: roundNumber,
      acceptedAt: timestamp(),
      sourceFile: candidate.__sourceFile
    };

    acceptedJourneys.push(normalized);
  }

  for (const candidate of featureCandidates) {
    const validation = validateFeatureCandidate(candidate, Number(config.minimumConfidence));
    if (!validation.ok) {
      rejectedFeatures.push({ candidate, reason: validation.reason });
      continue;
    }

    const fingerprint = featureFingerprint(candidate);
    if (seenFeatureFingerprints.has(fingerprint)) {
      rejectedFeatures.push({ candidate, reason: 'Duplicate feature unit' });
      continue;
    }

    seenFeatureFingerprints.add(fingerprint);
    const id = ensureId('feature', candidate, featureIds, fingerprint);

    const normalized = {
      id,
      candidateType: 'feature',
      mode: candidate.mode || 'exercise',
      role: candidate.role,
      route: candidate.route,
      state: candidate.state,
      selector: candidate.selector,
      action: candidate.action,
      expected: candidate.expected,
      discoveredAfter: candidate.discoveredAfter || '',
      status: candidate.status || 'exercised',
      evidence: candidate.evidence,
      confidence: Number(candidate.confidence),
      revealedUnits: safeArray(candidate.revealedUnits),
      fingerprint,
      acceptedRound: roundNumber,
      acceptedAt: timestamp(),
      sourceFile: candidate.__sourceFile
    };

    acceptedFeatures.push(normalized);
  }

  journeyMap.journeys = safeArray(journeyMap.journeys).concat(acceptedJourneys);
  featureMap.features = safeArray(featureMap.features).concat(acceptedFeatures);

  writeJson(PATHS.journeyMapJson, journeyMap);
  writeJson(PATHS.featureMapJson, featureMap);

  const journeyFrontier = readJson(PATHS.journeyFrontier, DEFAULT_JOURNEY_FRONTIER);
  const featureFrontier = readJson(PATHS.featureFrontier, DEFAULT_FEATURE_FRONTIER);

  const assignedJourneyIds = new Set(safeArray(manifest.selectedJourneyIds));
  const assignedFeatureIds = new Set(safeArray(manifest.selectedFeatureIds));

  journeyFrontier.items = safeArray(journeyFrontier.items).filter((item) => !assignedJourneyIds.has(item.id));
  featureFrontier.items = safeArray(featureFrontier.items).filter((item) => !assignedFeatureIds.has(item.id));

  for (const task of safeArray(manifest.tasks)) {
    if (!reportedTaskIds.has(task.taskId)) {
      const taskFile = path.join(roundDir, 'tasks', `${task.taskId}.json`);
      if (fs.existsSync(taskFile)) {
        const payload = readJson(taskFile, { items: [] });
        for (const item of safeArray(payload.items)) {
          if (task.agentType.startsWith('journey-')) {
            journeyFrontier.items.push({ ...item, note: `${item.note || ''} [requeued: missing output]`.trim() });
          }
          if (task.agentType.startsWith('feature-')) {
            featureFrontier.items.push({ ...item, note: `${item.note || ''} [requeued: missing output]`.trim() });
          }
        }
      }
    }
  }

  const discoveredItems = [];
  for (const journey of acceptedJourneys) {
    for (const discovered of safeArray(journey.discoveredFrontier)) {
      discoveredItems.push(discovered);
    }
  }
  for (const feature of acceptedFeatures) {
    for (const discovered of safeArray(feature.revealedUnits)) {
      discoveredItems.push(discovered);
    }
    for (const discovered of safeArray(feature.discoveredFrontier)) {
      discoveredItems.push(discovered);
    }
  }

  const journeyFrontierKeySet = new Set(safeArray(journeyFrontier.items).map((item) => journeyFrontierKey(item)));
  const featureFrontierKeySet = new Set(safeArray(featureFrontier.items).map((item) => featureFrontierKey(item)));

  for (const discovered of discoveredItems) {
    const kind = discoverKind(discovered);
    if (kind === 'journey') {
      const item = coerceJourneyFrontierItem(discovered);
      const key = journeyFrontierKey(item);
      if (!journeyFrontierKeySet.has(key)) {
        journeyFrontierKeySet.add(key);
        journeyFrontier.items.push(item);
      }
    } else {
      const item = coerceFeatureFrontierItem(discovered);
      const key = featureFrontierKey(item);
      if (!featureFrontierKeySet.has(key)) {
        featureFrontierKeySet.add(key);
        featureFrontier.items.push(item);
      }
    }
  }

  writeJson(PATHS.journeyFrontier, journeyFrontier);
  writeJson(PATHS.featureFrontier, featureFrontier);

  const journeyCoverageSummary = computeJourneyCoverage(journeyMap, config);
  const featureCoverageSummary = computeFeatureCoverage(featureMap, config);

  const journeyCoverage = readJson(PATHS.journeyCoverage, DEFAULT_JOURNEY_COVERAGE);
  const featureCoverage = readJson(PATHS.featureCoverage, DEFAULT_FEATURE_COVERAGE);

  journeyCoverage.lastUpdated = timestamp();
  journeyCoverage.summary = journeyCoverageSummary;
  journeyCoverage.history = safeArray(journeyCoverage.history).concat([
    {
      round: roundNumber,
      at: timestamp(),
      summary: journeyCoverageSummary
    }
  ]);

  featureCoverage.lastUpdated = timestamp();
  featureCoverage.summary = featureCoverageSummary;
  featureCoverage.history = safeArray(featureCoverage.history).concat([
    {
      round: roundNumber,
      at: timestamp(),
      summary: featureCoverageSummary
    }
  ]);

  writeJson(PATHS.journeyCoverage, journeyCoverage);
  writeJson(PATHS.featureCoverage, featureCoverage);

  fs.writeFileSync(PATHS.journeyMapMd, buildJourneyMarkdown(journeyMap, config), 'utf8');
  fs.writeFileSync(PATHS.featureMapMd, buildFeatureMarkdown(featureMap), 'utf8');

  for (const entry of acceptedJourneys) {
    appendJsonl(PATHS.journeyCandidates, {
      round: roundNumber,
      decision: 'accepted',
      at: timestamp(),
      id: entry.id,
      fingerprint: entry.fingerprint,
      sourceFile: entry.sourceFile,
      candidate: entry
    });
  }

  for (const entry of rejectedJourneys) {
    appendJsonl(PATHS.journeyCandidates, {
      round: roundNumber,
      decision: 'rejected',
      at: timestamp(),
      reason: entry.reason,
      sourceFile: entry.candidate.__sourceFile,
      candidate: entry.candidate
    });
  }

  for (const entry of acceptedFeatures) {
    appendJsonl(PATHS.featureCandidates, {
      round: roundNumber,
      decision: 'accepted',
      at: timestamp(),
      id: entry.id,
      fingerprint: entry.fingerprint,
      sourceFile: entry.sourceFile,
      candidate: entry
    });
  }

  for (const entry of rejectedFeatures) {
    appendJsonl(PATHS.featureCandidates, {
      round: roundNumber,
      decision: 'rejected',
      at: timestamp(),
      reason: entry.reason,
      sourceFile: entry.candidate.__sourceFile,
      candidate: entry.candidate
    });
  }

  const findingsCount = acceptedJourneys.length + acceptedFeatures.length;
  if (findingsCount === 0) {
    state.consecutiveNoFindings = Number(state.consecutiveNoFindings || 0) + 1;
  } else {
    state.consecutiveNoFindings = 0;
  }

  const routeGate =
    journeyCoverageSummary.routeCoveragePct === null
      ? true
      : Number(journeyCoverageSummary.routeCoveragePct) >= Number(config.targetRouteCoveragePct);

  const featureGate =
    Number(featureCoverageSummary.featureCoveragePct) >= Number(config.targetFeatureCoveragePct);

  const roleGate = safeArray(config.roles).every((role) => (journeyCoverageSummary.byRole[role] || 0) > 0);

  const frontierGate =
    safeArray(journeyFrontier.items).length === 0 && safeArray(featureFrontier.items).length === 0;

  const stagnationGate = Number(state.consecutiveNoFindings) >= Number(config.stagnationThreshold);

  const completed = routeGate && featureGate && roleGate && frontierGate && stagnationGate;

  state.round = roundNumber;
  state.pendingRound = null;
  state.completed = completed;
  state.lastRunAt = timestamp();
  state.history = safeArray(state.history).concat([
    {
      round: roundNumber,
      at: timestamp(),
      acceptedJourneys: acceptedJourneys.length,
      rejectedJourneys: rejectedJourneys.length,
      acceptedFeatures: acceptedFeatures.length,
      rejectedFeatures: rejectedFeatures.length,
      noFindingsStreak: state.consecutiveNoFindings,
      gates: {
        routeGate,
        featureGate,
        roleGate,
        frontierGate,
        stagnationGate
      },
      completed
    }
  ]);

  writeJson(PATHS.state, state);

  const mergeSummary = {
    round: roundNumber,
    roundSlug,
    mergedAt: timestamp(),
    counts: {
      acceptedJourneys: acceptedJourneys.length,
      rejectedJourneys: rejectedJourneys.length,
      acceptedFeatures: acceptedFeatures.length,
      rejectedFeatures: rejectedFeatures.length
    },
    coverage: {
      journey: journeyCoverageSummary,
      feature: featureCoverageSummary
    },
    frontier: {
      journeyRemaining: safeArray(journeyFrontier.items).length,
      featureRemaining: safeArray(featureFrontier.items).length
    },
    noFindingsStreak: state.consecutiveNoFindings,
    gates: {
      routeGate,
      featureGate,
      roleGate,
      frontierGate,
      stagnationGate
    },
    completed,
    rejectedExamples: {
      journey: rejectedJourneys.slice(0, 5).map((item) => ({
        reason: item.reason,
        sourceFile: item.candidate.__sourceFile
      })),
      feature: rejectedFeatures.slice(0, 5).map((item) => ({
        reason: item.reason,
        sourceFile: item.candidate.__sourceFile
      }))
    }
  };

  writeJson(path.join(roundDir, 'merge-summary.json'), mergeSummary);

  manifest.status = 'merged';
  manifest.mergedAt = timestamp();
  manifest.mergeSummary = {
    acceptedJourneys: acceptedJourneys.length,
    acceptedFeatures: acceptedFeatures.length,
    completed
  };
  writeJson(manifestPath, manifest);

  console.log(`Merged ${roundSlug}.`);
  console.log(JSON.stringify(mergeSummary, null, 2));
}

function runStatus() {
  const config = { ...DEFAULT_CONFIG, ...readJson(PATHS.config, DEFAULT_CONFIG) };
  const state = { ...DEFAULT_STATE, ...readJson(PATHS.state, DEFAULT_STATE) };
  const journeyCoverage = readJson(PATHS.journeyCoverage, DEFAULT_JOURNEY_COVERAGE);
  const featureCoverage = readJson(PATHS.featureCoverage, DEFAULT_FEATURE_COVERAGE);
  const journeyFrontier = readJson(PATHS.journeyFrontier, DEFAULT_JOURNEY_FRONTIER);
  const featureFrontier = readJson(PATHS.featureFrontier, DEFAULT_FEATURE_FRONTIER);
  const journeyMap = readJson(PATHS.journeyMapJson, DEFAULT_JOURNEY_MAP);
  const featureMap = readJson(PATHS.featureMapJson, DEFAULT_FEATURE_MAP);

  const status = {
    workspace: ROOT,
    config: {
      roles: config.roles,
      targetRouteCoveragePct: config.targetRouteCoveragePct,
      targetFeatureCoveragePct: config.targetFeatureCoveragePct,
      stagnationThreshold: config.stagnationThreshold,
      minimumConfidence: config.minimumConfidence,
      maxWorkersPerRound: config.maxWorkersPerRound,
      defaultShardSize: config.defaultShardSize
    },
    state: {
      round: state.round,
      pendingRound: state.pendingRound,
      consecutiveNoFindings: state.consecutiveNoFindings,
      completed: state.completed,
      lastRunAt: state.lastRunAt
    },
    counts: {
      acceptedJourneys: safeArray(journeyMap.journeys).length,
      acceptedFeatures: safeArray(featureMap.features).length,
      journeyFrontier: safeArray(journeyFrontier.items).length,
      featureFrontier: safeArray(featureFrontier.items).length
    },
    coverage: {
      journey: journeyCoverage.summary,
      feature: featureCoverage.summary
    }
  };

  console.log(JSON.stringify(status, null, 2));
}

function printUsage() {
  console.log(`Usage:
  node scripts/journey-orchestrator.mjs init
  node scripts/journey-orchestrator.mjs prepare-round
  node scripts/journey-orchestrator.mjs merge-round
  node scripts/journey-orchestrator.mjs status

Notes:
  - Run from project root (where docs/ exists).
  - prepare-round creates tasks under docs/agent-runs/round-XXX/tasks.
  - Save subagent outputs as JSON into docs/agent-runs/round-XXX/outputs.
  - merge-round applies validation, dedupe, coverage updates, and completion gates.
`);
}

function main() {
  const { command } = parseArgs(process.argv);

  switch (command) {
    case 'init':
      runInit();
      break;
    case 'prepare-round':
      runPrepareRound();
      break;
    case 'merge-round':
      runMergeRound();
      break;
    case 'status':
      runStatus();
      break;
    case 'help':
    case '--help':
    case '-h':
      printUsage();
      break;
    default:
      printUsage();
      throw new Error(`Unknown command: ${command}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
