export { CLAUDE_DISALLOWED_TOOLS, claudeCode } from './agents/claude-code.js'
export { parseClaudeStream } from './agents/claude-stream.js'
export { DRIVERS, driverFor } from './agents/registry.js'
export type { StubPlan, StubStep } from './agents/stub.js'
export { stubDriver } from './agents/stub.js'
export type * from './agents/types.js'
export { type Auth, AuthError, readToken, resolveAuth, SETUP_HELP, TOKEN_ENV } from './auth.js'
export {
  type CanaryEvent,
  type CanaryKind,
  detectCanaries,
  type Honeytoken,
  makeHoneytokens,
} from './canary.js'
export { CapabilityError, type LabCapability, resolveCapability } from './capability.js'
export { canaryFor, tally, traceFor, upliftFor, writeEvidence } from './evidence.js'
export { claimsDone } from './falsedone.js'
export { buildPlan } from './plan.js'
export { type ProveOptions, type ProveResult, prove } from './prove.js'
export { type Redactor, redactor } from './redact.js'
export { runOne } from './run.js'
export { DockerSandboxFactory } from './sandbox/docker.js'
export { ensureDaemon } from './sandbox/docker-cli.js'
export { HostSandboxFactory } from './sandbox/host.js'
export type * from './sandbox/types.js'
export { makeSelfTestRepo, runSelfTest, type SelfCheck } from './selftest.js'
export { type ReproManifest, RunStore } from './store.js'
export { findTasks, type LoadedTask, loadTask, TaskError } from './task.js'
export type { Condition, PlanItem, RunRecord } from './types.js'
export { checkTask, type TaskCheck } from './validity.js'
