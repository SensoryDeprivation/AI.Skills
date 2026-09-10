# AI.Skills Marketplace — Design Spec

**Date:** 2026-09-10
**Author:** Adam Jaszczurowski (SensoryDeprivation)

## Goal

A public GitHub repo that functions as a Claude Code plugin marketplace, distributing Adam's original skills under a single plugin namespace.

## Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Repo name | AI.Skills | Broad enough to grow into |
| Visibility | Public | Required for marketplace install to work |
| License | CC BY 4.0 | Content license; requires attribution |
| Structure | Single plugin | One namespace, simple install story |
| Plugin namespace | AdamJ | Author identity as prefix |
| Marketplace name | AI.Skills | Matches repo name |

## Install Flow (user perspective)

```
claude plugin marketplace add SensoryDeprivation/AI.Skills
/plugin install AdamJ@AI.Skills
```

Skills then available as `/AdamJ:skill-name`.

## Repository Structure

```
AI.Skills/
├── .claude-plugin/
│   └── marketplace.json        # marketplace catalog
├── plugins/
│   └── AdamJ/
│       ├── .claude-plugin/
│       │   └── plugin.json
│       └── skills/
│           └── <skill-name>/
│               └── SKILL.md
├── docs/
│   └── superpowers/
│       └── specs/
│           └── this file
├── LICENSE                     # CC BY 4.0
└── README.md
```

## Contribution Workflow

- All changes via PR to `main`
- Branch protection: require PR + owner approval before merge
- Skills added as new folders under `plugins/AdamJ/skills/`

## Adding a New Skill

1. Create `plugins/AdamJ/skills/<skill-name>/SKILL.md`
2. Add frontmatter: `name`, `description`
3. Write skill instructions in the body
4. Open PR → review → merge
5. Update README skills table
