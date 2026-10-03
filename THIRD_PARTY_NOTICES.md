# Third-party notices

MediaFlock application code is MIT licensed. Dependencies and adapted components retain their own licenses; service access is not included in this license.

- EvilCharts ECharts bar component: MIT, sourced from [legions-developer/evilcharts](https://github.com/legions-developer/evilcharts), including local evidence-click and ECharts 6 typing changes. License retained at `apps/web/components/evilcharts/LICENSE`.
- Apache ECharts: Apache-2.0. Installed as a pinned package; no upstream source relicensing.
- Instrument Serif: SIL Open Font License 1.1. License retained in `apps/web/app/fonts/OFL.txt`.
- Geist: SIL Open Font License; distributed by the pinned `geist` package.
- Libraries.dev packages `thinking-orbs`, `border-beam`, `liquid-gooey`, and `metal-fx`: MIT. Only their installed free functionality is used.
- Adapted drafting principles from [sergebulaev/instagram-skills](https://github.com/sergebulaev/instagram-skills), [sergebulaev/facebook-skills](https://github.com/sergebulaev/facebook-skills), and [Hao0321/claude-skill-social-post](https://github.com/Hao0321/claude-skill-social-post): MIT. Pinned source commits and license copies are retained under `vendor/writing`; account automation code is not included.
- FFmpeg/ffprobe are separately installed open source executables, not embedded or relicensed by this repository. Their build configuration determines applicable LGPL/GPL terms. This app uses them through a subprocess interface.

The sanitized package name/version/license inventory is `docs/dependency-licenses.json`. It includes permissive licenses, OFL fonts, and weak-copyleft transitive components such as libvips/MPL packages. These remain under their upstream terms. Npm/pnpm packages include their own notices.

Post for Me, Supabase hosting and OpenAI API are optional external services. Their hosted offerings are not represented as source code supplied by MediaFlock. All MediaFlock adapters and provider fixture transports are included.
