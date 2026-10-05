# Elkjøp Localization Automation

Automates the Swedish copywriter's workflow of taking a Jira ticket from the Elkjøp central team and localizing, configuring and publishing the referenced content on Elgiganten.se via Coremedia.

## Language

### Work

**Ticket**:
A Jira issue from the Elkjøp central team asking for content to be localized for the Swedish market. Resolving one Ticket is the unit of work, even when it covers several pieces of content.
_Avoid_: Task, process, job, request

**Workflow**:
The kind of work a Ticket asks for, chosen when it is recorded: Enriched Content (the default), Virtual Categories, Campaign page localization, Banner publishing, or one the Copywriter adds.
_Avoid_: Ticket type, category, task type

**Briefing**:
The unstructured instructions inside a Ticket (body and comments) that determine what must be done: content location, schedule, copy source, URLs and warnings.
_Avoid_: Brief, ticket text, prompt

**Run**:
One execution of the automation that resolves exactly one Ticket.
_Avoid_: Task, session, job

**Checkpoint**:
A point in a Run where the automation pauses for the Copywriter to review, act or approve before it continues. In a Recording, a Checkpoint Annotation marks where she wants one and what she expects to verify.
_Avoid_: Approval gate, pause, breakpoint

**Recording**:
The material captured while the Copywriter resolves one Ticket by hand, used to learn the workflow before automating it.
_Avoid_: Capture, take, trace

**Recording Session**:
One continuous stretch of a Recording, from start to finish; a Recording has one or more.
_Avoid_: Run, take

**Annotation**:
A note the Copywriter places in a Recording's timeline, in her own words: a Step, a Checkpoint or an Observation.
_Avoid_: Comment, marker, tag

**Step**:
One stage of resolving a Ticket, as the Copywriter divides her own process; numbered in order across the whole Recording.
_Avoid_: Stage, phase, task

**Observation**:
An Annotation explaining a decision the Copywriter made from the Briefing, and why.
_Avoid_: Note, comment, rationale

**Work Profile**:
A dedicated Chrome the Copywriter uses for Elkjøp work, logged in once by hand, which recording and automation attach to.
_Avoid_: Chrome profile, browser profile, user data dir, work Chrome

**Copywriter**:
The person who owns the Ticket and supervises Runs; today Lydia, for Elgiganten.se.
_Avoid_: User, operator, editor

### Content

**English Master**:
The English version of the content in Coremedia, prepared by the central team and used as the source for localization. Briefings call it "EN-local" or "en local".
_Avoid_: EN-local, source, original

**Localize**:
To produce the Swedish-market version of content from the English Master, including copy, scheduling and metadata.
_Avoid_: Translate, copy over

**Local Copy**:
Swedish text supplied with a Ticket (in its assets or comments) to be used when localizing.
_Avoid_: Copy deck, translation

**Launch Page**:
A page announcing a product launch under a brand page, often with a strict go-live time. Abbreviated LP.
_Avoid_: Landing page

**Enriched SKU**:
Additional rich content attached to a single product (SKU), placed according to the component names.
_Avoid_: Rich SKU, PDP content

**Value Campaign**:
A campaign page grouping offers for a product line, with its own URL and SEO text. Abbreviated VC.
_Avoid_: Campaign page, promo

**Brand Page**:
The page for a brand, identified by a brand ID (e.g. Brand:001026), which Launch Pages and CTAs hang off.
_Avoid_: Parent page, brand hub

**Validity**:
The time window during which a piece of content is visible on the live site.
_Avoid_: Go-live, schedule, visibility

**Time-Travel Preview**:
The Coremedia preview of the site as it will look at a chosen future date and time.
_Avoid_: Preview, staging
