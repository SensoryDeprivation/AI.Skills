# AI.Skills

Personal Claude Code skill library by [AdamJ](https://github.com/SensoryDeprivation).

## Install

**Step 1 — Add the marketplace (once):**
```
claude plugin marketplace add SensoryDeprivation/AI.Skills
```

**Step 2 — Install the plugin (once):**
```
/plugin install AdamJ@AI.Skills
```

**Step 3 — Use any skill:**
```
/AdamJ:skill-name
```

## Skills

| Skill | Description |
|-------|-------------|
| `/AdamJ:secrets-check` | Scan modified files for API keys, tokens, and certificates before committing |
| `/AdamJ:commit-safe` | Stage, commit, and push — runs secrets scan first, aborts if anything is found |

## Stepflow (separate plugin)

Install on its own, without the skills above (details in [plugins/stepflow/README.md](plugins/stepflow/README.md)):
```
/plugin install stepflow@AI.Skills
```

| Skill | Description |
|-------|-------------|
| `/stepflow:stepflow` | Turn multi-step instructions into a local step-by-step page with per-step Claude troubleshooting and a lessons-learned runbook export |

## Health Patterns (separate plugin)

```
/plugin install health-patterns@AI.Skills
```

| Skill | Description |
|-------|-------------|
| `/health-patterns:health-patterns` | Turns health and wellbeing talk into a `when → what` log (`~/health-log.csv`) of what you said; asks follow-up questions and connects new statements to old ones. No advice. |

## License

[CC BY 4.0](LICENSE) — free to use and adapt with attribution.
