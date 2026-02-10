# Output Schemas

All subagents must return JSON only.

## Journey Candidate

```json
{
  "candidateType": "journey",
  "mode": "discover_new",
  "role": "admin",
  "goal": "Create a new specification",
  "entrypoint": "/dashboard",
  "steps": [
    {
      "route": "/specifications",
      "action": "Click 'Specifications' in sidebar",
      "selector": "a[href='/specifications']",
      "expected": "Specifications list is visible",
      "evidence": {
        "url": "https://app.example.com/specifications",
        "screenshot": "docs/agent-runs/round-001/screenshots/specifications.png",
        "log": "Navigation succeeded"
      }
    }
  ],
  "terminalState": "Specification detail page is open",
  "keyRoutes": ["/dashboard", "/specifications", "/specifications/new"],
  "evidence": [
    {
      "type": "screenshot",
      "path": "docs/agent-runs/round-001/screenshots/specifications.png",
      "note": "Final state"
    }
  ],
  "confidence": 0.82,
  "discoveredFrontier": [
    {
      "id": "seed-feature-admin-spec-filter",
      "kind": "feature",
      "mode": "inventory",
      "role": "admin",
      "route": "/specifications",
      "state": "list_loaded",
      "selector": "button:has-text('Filter')",
      "action": "click",
      "note": "Filter panel discovered during journey"
    }
  ]
}
```

## Feature Candidate

```json
{
  "candidateType": "feature",
  "mode": "exercise",
  "role": "admin",
  "route": "/specifications",
  "state": "list_loaded",
  "selector": "button:has-text('Filter')",
  "action": "click",
  "expected": "Filter dialog opens",
  "discoveredAfter": "Dialog with additional controls is visible",
  "status": "exercised",
  "evidence": {
    "url": "https://app.example.com/specifications",
    "screenshot": "docs/agent-runs/round-001/screenshots/filter-open.png",
    "assertion": "Dialog role=dialog is present"
  },
  "confidence": 0.87,
  "revealedUnits": [
    {
      "id": "feature-admin-spec-filter-status-select",
      "kind": "feature",
      "mode": "exercise",
      "role": "admin",
      "route": "/specifications",
      "state": "filter_dialog_open",
      "selector": "select[name='status']",
      "action": "select:upcoming",
      "note": "New control revealed after opening filter dialog"
    }
  ]
}
```

## Reviewer Output

```json
{
  "accepted": [
    {
      "candidateRef": "journey-001",
      "decision": "accept",
      "reason": "Unique goal and route sequence with valid evidence"
    }
  ],
  "rejected": [
    {
      "candidateRef": "journey-002",
      "decision": "reject",
      "reason": "Duplicate fingerprint of existing journey J-0012"
    }
  ]
}
```
