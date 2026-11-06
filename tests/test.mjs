// tests/test.mjs — the F030 runner: eight bare side-effect imports in first-banner
// order, so every suite runs at import time at its first banner's position in the
// former monolith. helpers.mjs — imported by every suite before its own body —
// registers the exit handler and the shared tmpRoot before any suite body runs.
import "./suites/config.mjs";
import "./suites/gate.mjs";
import "./suites/prompt.mjs";
import "./suites/advisor.mjs";
import "./suites/triggers.mjs";
import "./suites/memory.mjs";
import "./suites/dialogue.mjs";
import "./suites/tools.mjs";
