# UX Map Orchestrator

Standalone project to exhaustively map Procright user journeys and feature-level interactions across multiple subagent rounds.

## What It Solves

Single-run agents stop too early due to context and weak completion criteria. This orchestrator enforces:

- persistent maps (`journey-map`, `feature-map`)
- queue/frontier based exploration
- reviewer-style merge with dedupe and confidence gates
- explicit completion gates (coverage + empty frontier + stagnation rounds)

## Project Structure

- `docs/journey-map.md`: accepted journey catalog
- `docs/feature-map.md`: accepted feature interaction catalog
- `docs/journey-frontier.json`: pending journey exploration shards
- `docs/feature-frontier.json`: pending feature interaction shards
- `docs/journey-candidates.jsonl`: append-only journey decisions
- `docs/feature-candidates.jsonl`: append-only feature decisions
- `docs/journey-coverage.json`: journey coverage snapshots
- `docs/feature-coverage.json`: feature coverage snapshots
- `docs/orchestration.config.json`: thresholds and worker settings
- `docs/orchestration-state.json`: round state and no-findings streak
- `docs/subagent-prompts/*`: reusable subagent prompts
- `scripts/journey-orchestrator.mjs`: CLI orchestrator

## Workflow

1. Initialize once:

```bash
npm run init
```

2. Generate next round tasks (sharded by mode):

```bash
npm run prepare-round
```

3. For each task in `docs/agent-runs/round-XXX/tasks/*.json`:
- run one subagent using the prompt file in the task payload
- save JSON result to `docs/agent-runs/round-XXX/outputs/<task-id>.json`

4. Merge and evaluate gates:

```bash
npm run merge-round
```

5. Check progress:

```bash
npm run status
```

Repeat until orchestrator marks `completed: true`.

## Completion Gates

The orchestrator only marks complete when all are true:

- `routeGate`: expected route coverage threshold met (if expected routes configured)
- `featureGate`: feature coverage threshold met
- `roleGate`: all configured roles have accepted journeys
- `frontierGate`: no pending journey/feature frontier items
- `stagnationGate`: no-new-findings streak reached configured threshold

## Important Config

Edit `docs/orchestration.config.json`:

- `roles`
- `expectedRoutes`
- `expectedFeatureUnits`
- `targetRouteCoveragePct`
- `targetFeatureCoveragePct`
- `stagnationThreshold`
- `minimumConfidence`
- `maxWorkersPerRound`
- `defaultShardSize`

For strict feature exhaustiveness, populate `expectedFeatureUnits` with normalized unit keys or objects.
