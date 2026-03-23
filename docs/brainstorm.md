# AnyTrunk — Business Use Case Brainstorm

> Work in progress. Needs validation with someone who has business/enterprise insight.

---

## The core pitch to business users

AnyTrunk lets non-technical teams run lightweight, structured workflows — decision logs, policy sign-offs, async check-ins, brief collection — without buying a SaaS tool. Data lives in GitHub repos the company controls: plain JSON, exportable, no vendor lock-in.

---

## Commercial angle: GitHub pricing reality check

"No per-seat cost" is an overstatement. Honest version:

| GitHub plan | Cost | Constraint |
|---|---|---|
| Free | $0 | Max 3 collaborators on private repos — useless for business |
| Team | $4/user/month | Unlimited collaborators — minimum viable for business |
| Enterprise | $21/user/month | SSO, audit logs, compliance features |

**Key nuance:** Many companies already pay for GitHub (engineering orgs on Team or Enterprise). Adding 10 business users to an existing org may cost nothing incremental.

**Reframe:** "Lower cost + you own your data" rather than "zero cost."

The data ownership angle is the stronger differentiator vs. enterprise SaaS ($25-150/seat). IT and legal teams care about this in ways business users may not articulate but would endorse.

> ⚠️ Needs validation: Is "data ownership" actually a decision factor for target buyers? Who in the org cares — IT, legal, CFO? How does it compare to their current tools?

---

## Use cases explored

### Decision log
Teams log key decisions with rationale. GitHub provides an immutable, timestamped audit trail. Useful for: exec teams, product orgs, architecture review boards.

### Policy acknowledgments
HR sends a policy; employees submit an acknowledgment file. Organizer sees who has and hasn't responded. Lightweight alternative to DocuSign for internal compliance.

### Async check-ins
Weekly/sprint status submissions from a team. No meeting required. Organizer sees a table of responses.

### Brief/proposal collection
Marketing, design, or agency workflows: collect creative briefs, proposals, or feedback from multiple contributors without a shared doc or email thread.

---

## Open questions

- Is "no GitHub account needed for participants" achievable at scale? (Requires Worker + service account — adds setup complexity.)
- Who is the buyer? IT? Team lead? HR director? That shapes the pitch entirely.
- What's the realistic competition? Google Forms + Sheets is free and familiar. What does AnyTrunk offer that it doesn't?
- Is the audit trail angle (GitHub = immutable history) genuinely valued, or is it a technical curiosity?
- Enterprise GitHub mandates SSO — does that complicate participant onboarding?

---

## Angles not yet explored

- Financial/legal workflows (approvals, sign-offs)
- Education / HR onboarding
- Cross-company collaboration (vendor/partner workflows)
- Internal tooling for non-eng teams at software companies (already on GitHub)

---

## AI agent memory

### The observation

GitHub-as-agent-memory isn't that different from what Claude Code already does: write markdown, commit, load at session start. The Claude Code memory system (`~/.claude/projects/{path}/memory/`) is already this pattern — global by user, scoped by project, human-readable and editable.

What AnyTrunk could add that doesn't exist yet:
- **Team-shared memory** — the whole team sees what the agent "knows" and can correct it
- **Cross-agent access** — any tool can read/write via GitHub API, not just Claude Code
- **Reviewable memory updates** — "memory PRs" where humans approve what the agent learns

### The hard problems not yet solved

**What counts as high-value memory?** Current heuristic: things expensive to re-derive next session (user preferences, non-obvious decisions, things that surprised the agent). The boundary is fuzzy.

**How do memories get back into a session?** Currently: MEMORY.md index loads at start, individual files read on demand. Breaks at scale — can't load everything.

**Is RAG dead?** The argument is that million-token context windows make retrieval unnecessary — just load everything. Partially true, but cost scales with tokens, models attend better to beginning/end, and most apps can't fit everything anyway. RAG is evolving (less chunking, better semantic routing), not dying.

### The genuinely open question

Shared, team-level agent memory — where a whole team sees and corrects what the agent knows, with a git history of how its understanding evolved — doesn't exist yet in a usable form. Whether it's valuable enough to build is unknown.

> ⚠️ Revisit later. No concrete next step yet.

---

## Creative collaboration

### The constraint

AnyTrunk stores JSON text. Creative work is binary — stems, video, images, PSDs. AnyTrunk cannot be the content layer. The question is whether a *coordination* layer is worth building.

> ⚠️ Near-term: scavenger hunt app will need low-res image storage. GitHub Contents API handles binary as base64 — same mechanism as current JSON writes. Low-res images (< a few hundred KB) are feasible. This opens the door to creative use cases that need lightweight media.

**Scavenger hunt demo (third app concept):**
Each submission: `{ image: base64, lat: number, lng: number, timestamp, note? }`. `append()` writes it, `readAll()` builds the view. Organizer sees a map (Leaflet.js or similar) with photo markers — no backend, all client-side rendering. Geo coords optional (phone permission). Validates image storage extension to GitHubStore.

### Where it fits

**Music:** Not the stems, but the metadata around them — session notes, mix feedback, version history. The most interesting angle: **credits and attribution**. Publishing splits and performance rights (ASCAP/BMI) are currently tracked in spreadsheets and email. An append-only, timestamped log of contribution agreements is a meaningful legal artifact. Credit disputes are common; an immutable record isn't a solved problem.

**Film/video:** Client feedback rounds, shot notes, approval sign-offs. The coordination layer Frame.io sits on top of, without the media playback. Much lighter, much less capable, but zero infrastructure.

**Writing/screenwriting:** Best fit — text is native, feedback rounds are structured. But Google Docs owns this space entirely.

**Architecture, game design:** Design review rounds, playtester feedback, client sign-offs. Same pattern as business use cases.

### Compared to Adobe Frame.io

Frame.io does video playback with timestamped comments and visual annotation. AnyTrunk would be the skeleton — feedback submissions, approval signals, version notes — without any media layer.

### The angle worth revisiting

Music/film **attribution logging as a legal artifact**. Specific pain point, no great existing solution, doesn't require touching binary files at all.

