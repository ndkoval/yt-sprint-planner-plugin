# Records the Sprint Capacity Planner demo reels headed under a virtual display (Xvfb).
#
# Based on the official Playwright image pinned to the same version as @playwright/test in
# package-lock.json (1.61.1) so the browsers baked into /ms-playwright match — the recorder
# also runs `playwright install chromium` defensively at run time so a version drift
# self-heals. Host node_modules are kept out via a named volume. The suite drives the app
# installed in the HOST YouTrack, reached at host.docker.internal:8080.
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

# ffmpeg/ffprobe for any in-container video inspection. The voiceover mux (macOS `say`) runs
# on the host after recording; the container only produces the silent webm + WebVTT tracks.
# xvfb is already present in the Playwright image.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /work
