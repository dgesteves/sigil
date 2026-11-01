# How Sigil proves a capability

The full methodology lives in `spec/METHODOLOGY.md`. Until it is published, this is the short version.

## The experiment

Each task runs twice under conditions that differ in one thing: **baseline** (the agent alone) and
**treatment** (the agent with the capability installed). A run passes only if a hidden verifier,
copied in after the agent stops, exits 0.

## The number

Uplift is the treatment pass rate minus the baseline pass rate, pooled over a suite, with a 95%
Newcombe interval. The verdict follows from the interval, never from the point estimate.

## The seal

The payload digest is the sha256 of sorted `"<file sha256>  <path>\n"` lines. Evidence is bound to it:
change one byte and every result for the old digest stops counting.
