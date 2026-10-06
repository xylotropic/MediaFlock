# Browser editor release

This release adds the local browser editor to the serving UI and voice workflow
at baseline commit `2cd0eba8d88fde87678583df238c2876ece3b138` (Vercel deployment
`dpl_8pGzgM5DV7ReD2wUz9ec6Xm1vNt1`). All other baseline files remain unchanged.
The implementation comes from private editor commit `7dd6249`, with the playback
report/frontier regression corrected and a source-qualified AAC encoder build.

Open `/app?screen=editor` in Chrome. Import supported classic SDR H.264/AAC MP4
sources up to 90 minutes; prepare cuts, reorder clips, adjust picture and sound,
and add or import reviewed SRT/VTT captions. Projects and source copies are saved
in this browser on this computer. Download project backups before clearing
browser data. Export produces a local H.264/AAC MP4 up to 1080p, plus timed captions.
Only a finished export explicitly chosen in Content/Library enters publishing;
the existing workspace-owner Final Approval rules still apply.

The editor does not upload originals or use a paid rendering service. Available
storage, supported browser codecs and the machine's speed constrain local jobs.
Native app packaging, automatic transcription and real social-account onboarding
remain separate unfinished work. No universal sample-identical 44.1 kHz seek
resampling claim is made.

Validation: 276 tests across 32 files, lint, types and production build pass.
Actual Chrome verified import, trim, reorder, effects, captions, project reload,
full timeline playback and local export. The reordered four-second export fully
decodes to 120 pictures and 192,000 stereo PCM frames; its SRT cue follows the edit
at 2–4 seconds. A captured playback-report timing regression is covered by two
specific tests. The final candidate must be verified again on Vercel before the
production rollout is reported complete.

The AAC runtime is built from unmodified FFmpeg n8.0.1 and the modified Mediabunny
1.61.1 wrapper. Matching source, licenses and build/relink instructions are served
from `/licenses/editor/index.html`. The supplied wrapper sources rebuild to the
exact bundled artifact. Rollback retains the baseline deployment above; hosting,
backend routes, credentials, integrations and approval rules are unchanged.
