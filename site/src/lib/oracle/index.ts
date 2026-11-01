/** The Oracle's computation, loaded on first use so the observatory's first paint stays light. */
export { RateLimited, readRepo } from './github'
export { emptySignals, parseRepo, readText } from './intent'
export { buildIndex, compose, search, weigh } from './rank'
