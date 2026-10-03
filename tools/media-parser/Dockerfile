# Official Debian bookworm-slim multi-architecture index, resolved 2026-10-02.
# Rebuilds deliberately update this digest; workers never pull at runtime.
FROM debian:bookworm-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg=7:5.1.9-0+deb12u1 fonts-dejavu-core=2.37-6 python3-minimal \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir /input /work \
 && chmod 0755 /input /work
COPY export-output.py /usr/local/bin/mediaflock-export-output
RUN echo "d29d8cde0e5d93bb47a63e503d5f300af5914071aee621ddc5527abea052167b  /usr/local/bin/mediaflock-export-output" | sha256sum --check \
 && chmod 0755 /usr/local/bin/mediaflock-export-output
LABEL mediaflock.parser=true mediaflock.parser.version=1
ENV HOME=/tmp LANG=C.UTF-8
USER 65532:65532
ENTRYPOINT ["/bin/sleep", "infinity"]
