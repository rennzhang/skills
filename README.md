# Claude Code Skills

A collection of custom skills for [Claude Code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview).

## Skills

### doc-reviewer

Technical document deep review & optimization. Treats review comments as hypotheses to verify against actual code, not commands to blindly follow.

**Core workflow**: Classify suggestions → Verify against code (Grep/Read) → Accept / Partially accept / Reject → Apply minimal fixes

### skill-reflection

Metacognitive introspection tool. Examines any skill's execution process from a third-eye perspective to discover cognitive blind spots.

**Four-layer framework**: Observe (What) → Analyze (Why) → Reflect (So What) → Suggest (Now What)

> Output is analysis reports only — no automatic modifications.

### team-compete

Competitive multi-team proposal review. Three differentiated teams produce independent proposals in parallel, then an isolated expert reviewer scores and merges the best solution.

**Team differentiation**:
- Team 1: Pragmatic & stable
- Team 2: User experience maximalist
- Team 3: Minimalist & disruptive

## Installation

Copy any skill folder into your `~/.claude/skills/` directory:

```bash
cp -r skills/doc-reviewer ~/.claude/skills/
cp -r skills/skill-reflection ~/.claude/skills/
cp -r skills/team-compete ~/.claude/skills/
```

## License

MIT
