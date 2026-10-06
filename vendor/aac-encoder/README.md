# MediaFlock AAC encoder build

Mediabunny AAC wrapper 1.61.1 (MPL-2.0), with the MediaFlock packet timestamp and exact input-length fix. The inlined AAC library is built from unmodified FFmpeg n8.0.1, commit 894da5ca7d742e4429ffb2af534fcda0103ef593, under LGPL-2.1-or-later, using Emscripten 4.0.10. No GPL or nonfree configuration is enabled.

Complete matching source, configure settings, build and relink instructions are served from `/licenses/editor/`. Start with `BUILD-AND-RELINK.txt`. Modification and reverse engineering of these components to debug those modifications are permitted under their respective licenses. Replace this package's bundle with a rebuilt compatible bundle and reinstall/rebuild MediaFlock to use it.
