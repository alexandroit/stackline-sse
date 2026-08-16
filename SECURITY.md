# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | Yes |
| Pre-release or unpublished builds | No |

Security fixes are released as new immutable npm versions. A vulnerable
published version is deprecated when appropriate; it is not silently replaced.

## Reporting a vulnerability

Do not open a public issue for an undisclosed vulnerability. Use GitHub's
private vulnerability reporting for
[alexandroit/stackline-sse](https://github.com/alexandroit/stackline-sse/security/advisories/new).

Include:

- affected version and runtime;
- minimal reproduction or malformed byte sequence;
- security impact and expected behavior;
- whether the issue affects parser, encoder, client, or server APIs.

Reports are acknowledged as soon as practical. Confirmed issues receive a
coordinated fix, regression tests, release notes, and credit when requested.

## Security boundaries

The package limits parser memory and validates encoded control fields. It does
not authenticate event producers, authorize endpoints, validate event JSON
schemas, encrypt transport, or make arbitrary event data safe for HTML output.
Applications must still use HTTPS, validate origin and payloads, and escape
data at the rendering boundary.
