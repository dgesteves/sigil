# Sources

Checked on 2026-11-01 against express@5.3.0 (npm `latest`; `latest-4` is 4.22.3). Behaviour claims
in this skill were also reproduced by running them against the installed packages: express@5.3.0,
router@2.2.0, path-to-regexp@8.4.2, body-parser@2.4.0, raw-body@3.0.2, finalhandler@2.1.1, and
@types/express@5.0.6 with TypeScript 7.0.2.

## Official documentation

- Migrating to Express 5: https://expressjs.com/en/guide/migrating-5.html
- Error handling: https://expressjs.com/en/guide/error-handling.html
- Security best practices: https://expressjs.com/en/advanced/best-practice-security.html
- Express behind proxies (`trust proxy`): https://expressjs.com/en/guide/behind-proxies.html
- Version support: https://expressjs.com/en/support/

## Release notes and source

- Express releases (5.1.0, 5.2.0, 5.2.1, 5.3.0): https://github.com/expressjs/express/releases
- Express 5.3.0 source (`lib/response.js` for `res.status`, `res.send`, `res.json`, `res.redirect`;
  `lib/application.js` for default settings and `app.listen`; `lib/request.js` for the `req.query`
  getter): https://github.com/expressjs/express/tree/v5.3.0/lib
- path-to-regexp syntax and error explanations: https://github.com/pillarjs/path-to-regexp#readme
- body-parser options and error types: https://github.com/expressjs/body-parser#readme
- Express codemods (transform list in `codemods/`): https://github.com/expressjs/codemod

## Types

- `@types/express-serve-static-core` (route string parameter inference, handler return type):
  https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/express-serve-static-core
