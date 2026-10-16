# PR page replay corpus (offline)

Harvested 2026-10-15 from the main tree's intake wave dumps
(`tmp/sdk-release-scout/{go-pr1179,java-pr1178,node-pr1180,python-pr1181}-intake-2026-10-15/pages-{v26,v30}/`),
which are the sha256-pinned page dumps of the merged upstream PRs
(#1177-#1181) produced by dump-pr-pages.js, plus the 2026-10-16 second harvest
(`python-pr1173-1181-intake-2026-10-16/pages-v30/`: the 5 pages that first
exercised the `untypedColon` and `backtickChoiceDescribed` forms). One page per file, named by the
decisions' canonicalSlug; bytes are the git-show exports of the pinned
revisions.

Purpose: the batch-15 review (P1-2) requires the canonical page parser to
replay the four real language grammars with ZERO typed rejections
(BULLET_FORM_UNRECOGNIZED / SIGNATURE_FENCE_MISSING / PAGE_SUMMARY_MISSING).
Every bullet form the parser accepts is data on the profile
(config/pr-page-profiles.json, each `formEvidence` key naming its harvest
page); a page that stops parsing clean means upstream template drift and
must be fixed with profile data, never by loosening the kernel.

Counts: go 101+118, java 64+26, node 140+159, python 15+25 = 648 pages.
