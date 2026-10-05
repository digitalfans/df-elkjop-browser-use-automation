# Dedicated work Chrome, attached over CDP

Recording and automation run in a dedicated Chrome user-data directory that the Copywriter uses day to day for Elkjøp work. It is launched as a normal Chrome (real macOS Keychain, no automation flags) with a local remote-debugging port, and Playwright attaches to it with `connectOverCDP` instead of launching its own browser. The Copywriter logs in once by hand in that browser, so recording and automation share one authenticated environment.

## Considered Options

- **Her default Chrome profile**: Chrome 136+ refuses remote debugging on the default user-data directory, and every profile in Chrome's people picker lives inside it.
- **Browser launched by Playwright**: Google blocks sign-in in it, and Playwright's `--use-mock-keychain` makes cookies saved by a normal Chrome unreadable, so sessions don't carry over.
- **Copy of her profile**: the copy drifts from the original, some identity providers invalidate sessions used in two places, and copying a browser profile looks like credential theft to endpoint security.
- **Chrome extension in her real profile**: the only way to use her real profile, but it depends on Elkjøp's extension policy and doesn't exercise the Playwright runtime the automation needs.

## Consequences

- The Copywriter switches to a separate Chrome for Elkjøp work.
- There can be several Work Profiles (e.g. one per account or market), each its own user-data directory on its own local port, open at the same time; a recording names the one it attached to.
- A local debugging port is open while that Chrome runs. Any local process can drive it, so this needs Elkjøp IT's acceptance.
