# Third-party notices

MediaFlock application code is MIT licensed. Dependencies and adapted components retain their own licenses; service access is not included in this license.

- EvilCharts ECharts bar component: MIT, sourced from [legions-developer/evilcharts](https://github.com/legions-developer/evilcharts), including local evidence-click and ECharts 6 typing changes. License retained at `apps/web/components/evilcharts/LICENSE`.
- `@vercel/functions` 3.9.11 and its `@vercel/oidc` dependency: Apache-2.0, retained in their installed packages.
- Apache ECharts: Apache-2.0. Installed as a pinned package; no upstream source relicensing.
- Instrument Serif: SIL Open Font License 1.1. License retained in `apps/web/app/fonts/OFL.txt`.
- Geist: SIL Open Font License; distributed by the pinned `geist` package.
- Libraries.dev packages `thinking-orbs`, `border-beam`, `liquid-gooey`, `metal-fx`, and `bot-avatars`: MIT. Only their installed free functionality is used.
- Adapted drafting principles from [sergebulaev/instagram-skills](https://github.com/sergebulaev/instagram-skills), [sergebulaev/facebook-skills](https://github.com/sergebulaev/facebook-skills), and [Hao0321/claude-skill-social-post](https://github.com/Hao0321/claude-skill-social-post): MIT. Pinned source commits and license copies are retained under `vendor/writing`; account automation code is not included.
- [FFmpeg/ffprobe](https://ffmpeg.org/legal.html) run as separate executables. The live parser image installs Debian’s FFmpeg package with GPL components, including libx264; Debian’s package notice identifies the resulting binaries as GPL-2.0-or-later. Their libraries retain their applicable upstream terms. They are not relicensed as MIT.
- The parser image installs [DejaVu fonts](https://dejavu-fonts.github.io/License.html) for libass subtitles. Bitstream Vera and Arev copyright and permission notices apply; DejaVu changes are public domain. The package retains its complete font notices.
- The parser’s fixed output helper uses Debian’s Python 3 runtime under the [Python Software Foundation and historical Python licenses](https://docs.python.org/3.11/license.html). The helper itself is MediaFlock application code under MIT.

The sanitized package name/version/license inventory is `docs/dependency-licenses.json`. It includes permissive licenses, OFL fonts, and weak-copyleft transitive components such as libvips/MPL packages. These remain under their upstream terms. Npm/pnpm packages include their own notices.

Post for Me, Supabase hosting and OpenAI API are optional external services. Their hosted offerings are not represented as source code supplied by MediaFlock. All MediaFlock adapters and provider fixture transports are included.

The parser Dockerfile builds locally from a pinned official Debian image and Debian APT packages. Package copyright and license files remain under `/usr/share/doc` in that image; this repository does not publish a prebuilt parser image. Redistributing a built image must preserve the applicable package notices and corresponding source obligations. The Debian base and installed libraries retain their individual licenses.
